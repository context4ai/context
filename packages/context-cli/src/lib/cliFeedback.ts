/**
 * Unified CLI feedback contract for LLM-friendly output.
 *
 * The LLM consumes the entire stdout/stderr stream as input to its next
 * prompt. So every successful or failed command MUST be parseable in O(1):
 * the first line carries the symbol + action + subject + headline; later
 * lines are quantified body or optional next-step hints.
 *
 * See packages/context-cli/CLAUDE.md "CLI feedback contract" section for
 * the design rationale and per-command shape.
 */

/**
 * First-character status symbol. Single-codepoint, ASCII-friendly so LLMs
 * (and shell pipes) can route on it without parsing prose.
 *
 *   ✓ — success
 *   ✗ — failure
 *   ⚠ — partial success / non-fatal degraded path
 *   = — no-op (operation succeeded but had no effect; e.g. unchanged hash)
 */
export type FeedbackSymbol = "✓" | "✗" | "⚠" | "·" | "=";

/**
 * Error category enum. Stays open-ended (string) but the canonical values
 * below SHOULD be reused so LLMs can write deterministic recovery logic.
 *
 * Add new values here when introducing a new category, not in ad-hoc
 * strings, so follow-up audits can grep the namespace.
 */
export const ErrorCategory = {
  /** No `.context/` workspace found in cwd or its ancestors. */
  WorkspaceNotFound: "workspace-not-found",
  /** Already at max nesting / state, target action is invalid here. */
  WorkspaceStateInvalid: "workspace-state-invalid",
  /** A graph-routed command was selected from an older workspace observation. */
  WorkflowRevisionStale: "workflow-revision-stale",
  /** Source-id referenced does not exist in `_sources.yaml`. */
  SourceNotFound: "source-not-found",
  /** Section.kind ⨯ Node.type combination violates the §4.2 mount matrix. */
  MountMatrixViolation: "mount-matrix-violation",
  /** Frontmatter / schema validation failed against the contract. */
  SchemaInvalid: "schema-invalid",
  /** Subprocess (lark-cli, git, …) exited non-zero or unavailable. */
  ExternalToolFailed: "external-tool-failed",
  /** Multi-step operation completed N of M steps before failing. */
  PartialFailure: "partial-failure",
  /** The user-supplied flag combination / argument is invalid. */
  UserInputInvalid: "user-input-invalid",
  /** Catch-all when no narrower category fits. */
  Unknown: "unknown",
} as const;
export type ErrorCategoryValue = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/**
 * Build the canonical CLI feedback block.
 *
 * Layout (each line ends with '\n'):
 *   <symbol> <action> <subject>: <headline>
 *     <body line 1>
 *     <body line 2>
 *     ...
 *     next: <hint>          ← only when `next` is set
 *
 * Body lines are indented two spaces. Empty body items are filtered out so
 * callers can pass conditional values without guarding.
 */
export interface FeedbackBlock {
  symbol: FeedbackSymbol;
  /** Past-tense or present-participle verb. e.g. "initialized", "captured". */
  action: string;
  /** Object of the action: workspace name, source-id, node slug, or "" if N/A. */
  subject?: string;
  /** ≤80-char human-readable summary. */
  headline: string;
  /** Quantified body lines. Falsy entries are dropped. */
  body?: ReadonlyArray<string | false | null | undefined>;
  /** One-line next-step hint. Only set on pipeline nodes. */
  next?: string;
}

export function formatFeedback(block: FeedbackBlock): string {
  const subjectPart = block.subject ? ` ${block.subject}` : "";
  const lines: string[] = [`${block.symbol} ${block.action}${subjectPart}: ${block.headline}`];
  for (const item of block.body ?? []) {
    // Drop falsy short-circuits (`cond && "..."`) but keep empty strings as
    // blank lines so callers can render markdown paragraphs in the body.
    if (item === false || item === null || item === undefined) continue;
    if (typeof item === "string") {
      lines.push(item.length > 0 ? `  ${item}` : "");
    }
  }
  if (block.next) {
    lines.push(`  next: ${block.next}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build the canonical failure block for stderr.
 *
 * Layout:
 *   ✗ <action> <subject>: <category>
 *     <human detail>
 *     <recovery hint, optional>
 *
 * The `<category>` token is the LLM's routing key. Keep it stable.
 */
export interface FailureBlock {
  action: string;
  subject?: string;
  category: ErrorCategoryValue | string;
  detail: string;
  recovery?: string;
}

export function formatFailure(block: FailureBlock): string {
  const body = [block.detail, block.recovery].filter((line): line is string => typeof line === "string" && line.length > 0);
  return `✗ failed: ${block.category}\n${body.map((line) => `  ${line}`).join("\n")}${body.length > 0 ? "\n" : ""}`;
}

/**
 * Truncate a long string for echo lines so a single oversized parameter
 * doesn't blow the feedback block past readable size.
 */
export function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}
