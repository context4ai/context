import type { Command } from "commander";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  applyCodeIndexAuditDecision,
  collectCodeIndexAuditStatus,
} from "../project/codeIndexAudit.js";
import { buildCodeIndexAuditView } from "../project/codeIndexAuditView.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ExitCode } from "../types/exitCode.js";

function outputFormat(value: unknown): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new ContextError(ExitCode.UserError, "--format must be text or json", {
    category: ErrorCategory.UserInputInvalid,
  });
}

function projectRoot(): string {
  const found = findContextProjectRoot(process.cwd());
  if (found === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "code-index audit requires a Context workspace", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  return found.projectRoot;
}

function nextGraphPath(decision: "accept" | "revise" | "request-input"): string[] {
  if (decision === "accept") return ["audit-code-index", "review-current-batch"];
  if (decision === "revise") {
    return [
      "audit-code-index",
      "revise-code-index-audit",
      "preview-extraction-batch",
      "extract-next",
      "audit-code-index",
    ];
  }
  return ["audit-code-index", "resolve-code-index-audit-input", "revise-code-index-audit"];
}

export function registerCodeIndexAuditReviewCommand(review: Command): void {
  review
    .command("code-index")
    .description("Inspect or resolve the current code-index quality audit")
    .option("--input <file>", "apply a context.code-index-audit-decision.v1 YAML/JSON payload, or - for stdin")
    .option("--view <view>", "inspection view: summary | items", "summary")
    .option("--report-digest <digest>", "bind a paginated inspection to one report digest")
    .option("--unit <id>", "with --view items, narrow to one code-index unit")
    .option("--item-kind <kind>", "with --view items, narrow to one stable item kind")
    .option("--token-budget <n>", "limit approximate report item tokens")
    .option("--byte-budget <n>", "limit total report output bytes")
    .option("--page-size <n>", "limit report items selected for this page")
    .option("--page-token <token>", "continue a digest-bound report view")
    .option("--format <format>", "output format: text | json", "text")
    .action(async (options: Record<string, unknown>) => {
      const format = outputFormat(options.format);
      const root = projectRoot();
      if (typeof options.input !== "string") {
        const status = await collectCodeIndexAuditStatus(root);
        if (format === "json") {
          process.stdout.write(`${JSON.stringify(buildCodeIndexAuditView(status, {
            ...(typeof options.view === "string" ? { view: options.view } : {}),
            ...(typeof options.reportDigest === "string" ? { reportDigest: options.reportDigest } : {}),
            ...(typeof options.unit === "string" ? { unit: options.unit } : {}),
            ...(typeof options.itemKind === "string" ? { itemKind: options.itemKind } : {}),
            ...(typeof options.tokenBudget === "string" ? { tokenBudget: options.tokenBudget } : {}),
            ...(typeof options.byteBudget === "string" ? { byteBudget: options.byteBudget } : {}),
            ...(typeof options.pageSize === "string" ? { pageSize: options.pageSize } : {}),
            ...(typeof options.pageToken === "string" ? { pageToken: options.pageToken } : {}),
          }), null, 2)}\n`);
          return;
        }
        if (options.view !== "summary") {
          throw new ContextError(ExitCode.UserError, "code-index audit item views require --format json", {
            category: ErrorCategory.UserInputInvalid,
            view: options.view,
          });
        }
        process.stdout.write(formatFeedback({
          symbol: status.resolved ? "✓" : "⚠",
          action: "code-index audit",
          subject: "current proposed knowledge",
          headline: status.applicable
            ? `${status.report?.summary.units ?? 0} unit(s) · ${status.report?.summary.signals ?? 0} signal(s) · ${status.resolved ? "accepted" : "decision required"}`
            : "not applicable",
          body: status.report === undefined
            ? ["No code-index audit scope is available."]
            : [
                `- report digest → \`${status.report.digest}\``,
                `- pages → ${status.report.summary.pages}`,
                `- effective prose characters → ${status.report.summary.effective_chars}`,
                `- evidence items → ${status.report.summary.evidence}`,
                `- elevated signals → ${status.report.summary.elevated_signals}`,
              ],
          next: status.resolved
            ? "Continue from context status --format json."
            : "Read the Route-selected audit report and submit a decision with --input.",
        }));
        return;
      }
      const payload = await readYamlOrJsonInput({
        path: options.input,
        label: "code-index audit decision",
        missingNext: "Pass --input <payload.yaml|json> or --input -.",
        readFailureNext: "Fix the input path or pass --input - for stdin.",
        parseFailureNext: "Fix the context.code-index-audit-decision.v1 payload and retry.",
      });
      const { record, report } = await applyCodeIndexAuditDecision({ projectRoot: root, payload });
      const graphPath = nextGraphPath(record.decision.decision);
      if (format === "json") {
        process.stdout.write(`${JSON.stringify({
          ...record,
          graph_transition: graphPath,
        }, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatFeedback({
        symbol: "✓",
        action: "code-index audit",
        subject: "decision",
        headline: `${record.decision.decision} · ${report.summary.units} unit(s) · ${report.summary.elevated_signals} elevated signal(s)`,
        body: [
          `- report digest → \`${report.digest}\``,
          `- reviewed units → ${record.decision.reviewed_units.join(", ")}`,
          `- summary → ${record.decision.summary}`,
          `- Graph path → ${graphPath.join(" → ")}`,
        ],
        next: record.decision.decision === "accept"
          ? "Continue from context status --format json."
          : record.decision.decision === "revise"
            ? "Follow the current Route to revise src/index.ts and rerun extraction."
            : "Ask for the requested material, then submit a revised decision.",
      }));
    });
}
