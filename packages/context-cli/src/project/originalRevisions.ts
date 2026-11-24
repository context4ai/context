import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { articleSourceLocatorSchema, articleSourceReferenceSchema, articleSourceRegionDigest } from "@c4a/context";
import YAML from "yaml";
import { z } from "zod";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";

/**
 * Revisions to pages kept as written (`preserve_original` requirements). Each
 * proposal records the original passage, the corrected text and the code that
 * contradicts it; the user's decision stays with the workspace.
 */
export const ORIGINAL_REVISIONS_PATH = "src/original-revisions.yaml";

export const ORIGINAL_REVISION_DECISIONS = ["upstream", "local", "kept"] as const;
export type OriginalRevisionDecision = typeof ORIGINAL_REVISION_DECISIONS[number];

const text = z.string().trim().min(1);
const originalRevisionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u, "Use a lowercase path-safe id"),
  /** Knowledge-relative article path, as shown in the review report. */
  article: text,
  section: text.optional(),
  original: z.object({ source_ref: text, locator: articleSourceLocatorSchema, text }).strict(),
  revised: text,
  /** `wrong`: never matched the code; `stale`: matched once, the code changed since. */
  reason: z.enum(["wrong", "stale"]),
  evidence: z.array(articleSourceReferenceSchema).min(1),
  /** `proposed` awaits a decision; `upstream` and `local` revise the article; `kept` keeps the original text. */
  status: z.enum(["proposed", ...ORIGINAL_REVISION_DECISIONS]),
  /** Outcome of a correction proposed to the original document, when `upstream`. */
  upstream: text.optional(),
  note: text.optional(),
}).strict();

const originalRevisionsSchema = z.object({ revisions: z.array(originalRevisionSchema).default([]) }).strict();

export type OriginalRevision = z.infer<typeof originalRevisionSchema>;

function invalid(message: string): ContextError {
  return new ContextError(ExitCode.UserError, `Invalid ${ORIGINAL_REVISIONS_PATH}: ${message}`, {
    category: ErrorCategory.UserInputInvalid,
    reason_code: "invalid-original-revisions",
    next: `Correct ${ORIGINAL_REVISIONS_PATH}, keeping each proposal's original passage, revised text, evidence and decision.`,
  });
}

export async function readOriginalRevisions(projectRoot: string): Promise<OriginalRevision[]> {
  let content: string;
  try {
    content = await readFile(join(projectRoot, ORIGINAL_REVISIONS_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let parsed: z.infer<typeof originalRevisionsSchema>;
  try {
    parsed = originalRevisionsSchema.parse(YAML.parse(content, { uniqueKeys: true }) ?? {});
  } catch (error) {
    throw invalid(error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : String(error));
  }
  const ids = parsed.revisions.map((revision) => revision.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw invalid(`duplicate id ${duplicate}`);
  return parsed.revisions;
}

/** Record decisions for proposals; every id must exist. */
export async function decideOriginalRevisions(
  projectRoot: string,
  decisions: ReadonlyMap<string, { status: OriginalRevisionDecision; upstream?: string }>,
): Promise<OriginalRevision[]> {
  const revisions = await readOriginalRevisions(projectRoot);
  const known = new Set(revisions.map((revision) => revision.id));
  const unknown = [...decisions.keys()].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ContextError(ExitCode.UserError, `Unknown original revision id: ${unknown.join(", ")}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "context review original-revisions --format json",
    });
  }
  const next = revisions.map((revision) => {
    const decision = decisions.get(revision.id);
    if (decision === undefined) return revision;
    return {
      ...revision,
      status: decision.status,
      ...(decision.upstream !== undefined ? { upstream: decision.upstream } : {}),
    };
  });
  await atomicWriteFile(join(projectRoot, ORIGINAL_REVISIONS_PATH), YAML.stringify({ revisions: next }));
  return next;
}

export interface OriginalRevisionView extends OriginalRevision {
  /** A kept original whose code evidence changed since the decision: decide again. */
  reopened?: true;
  /** Evidence that could not be read; the decision cannot be rechecked yet. */
  unreadable?: true;
}

/** Recheck kept originals against the current code: unchanged evidence keeps them settled. */
export async function inspectOriginalRevisions(projectRoot: string): Promise<OriginalRevisionView[]> {
  const revisions = await readOriginalRevisions(projectRoot);
  if (!revisions.some((revision) => revision.status === "kept")) return revisions;
  const read = await registeredArticleSourceReader(projectRoot);
  const views: OriginalRevisionView[] = [];
  for (const revision of revisions) {
    if (revision.status !== "kept") {
      views.push(revision);
      continue;
    }
    let changed = false;
    let unreadable = false;
    for (const evidence of revision.evidence) {
      try {
        const current = await read(evidence.source_ref, evidence.locator.path);
        if (articleSourceRegionDigest(current, evidence.locator) !== evidence.content_digest) changed = true;
      } catch {
        unreadable = true;
      }
    }
    views.push({ ...revision, ...(changed ? { reopened: true as const } : {}), ...(unreadable ? { unreadable: true as const } : {}) });
  }
  return views;
}

export function originalRevisionSummary(views: readonly OriginalRevisionView[]) {
  const count = (status: OriginalRevision["status"]) => views.filter((view) => view.status === status).length;
  return {
    path: ORIGINAL_REVISIONS_PATH,
    proposed: count("proposed"),
    upstream: count("upstream"),
    local: count("local"),
    kept: count("kept"),
    reopened: views.filter((view) => view.reopened === true).length,
  };
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

/** A block shown above an article in the review report listing its proposals. */
export function originalRevisionReviewHtml(revisions: readonly OriginalRevisionView[]): string {
  if (revisions.length === 0) return "";
  const items = revisions.map((revision) => [
    `<li><strong>${escapeHtml(revision.id)}</strong> · ${revision.reason === "wrong" ? "原文写错 / written wrong" : "原文过时 / went stale"}`,
    ` · ${escapeHtml(revision.status)}${revision.reopened ? " · 代码又有变化 / code changed again" : ""}`,
    `<br>原文 / Original: <del>${escapeHtml(revision.original.text)}</del>`,
    `<br>修订 / Revised: <ins>${escapeHtml(revision.revised)}</ins>`,
    `<br>依据 / Evidence: ${revision.evidence.map((item) => escapeHtml(`${item.source_ref} ${item.locator.path} L${item.locator.start_line}-L${item.locator.end_line}`)).join("; ")}`,
    "</li>",
  ].join("")).join("");
  return `<aside class="original-revisions" style="border:1px solid #d0a000;border-radius:6px;padding:8px 12px;margin-bottom:16px">`
    + `<p><strong>原文修订建议 / Revisions to the original</strong>：接受并修正上游、只修订本地，或保留原文 / accept and correct upstream, revise locally only, or keep the original.</p>`
    + `<ul>${items}</ul></aside>`;
}
