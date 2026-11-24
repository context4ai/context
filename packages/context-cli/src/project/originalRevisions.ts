import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { articleSourceLocatorSchema, articleSourceRegion } from "@c4a/context";
import YAML from "yaml";
import { z } from "zod";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";

/**
 * Revisions proposed for pages kept as written (`preserve_original` requirements)
 * while a batch is being reviewed. This is temporary working state: the user's
 * decision is applied to the article itself and recorded in the changelog or
 * commit, so Git history and the article's code citations carry it afterwards.
 */
export const ORIGINAL_REVISION_PROPOSALS_PATH = ".tmp/context-runtime/original-revisions.yaml";

const text = z.string().trim().min(1);
const locatorSchema = z.object({ path: text, start_line: z.number().int().min(1), end_line: z.number().int().min(1) }).strict();
const referenceSchema = z.object({ source_ref: text, locator: locatorSchema }).strict();
const proposalSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/u, "Use a lowercase path-safe id"),
  /** Knowledge-relative article path, as shown in the review report. */
  article: text,
  section: text.optional(),
  original: referenceSchema,
  revised: text,
  /** `wrong`: never matched the code; `stale`: matched once, the code changed since. */
  reason: z.enum(["wrong", "stale"]),
  evidence: z.array(referenceSchema).min(1),
  note: text.optional(),
}).strict();
const storedProposalSchema = proposalSchema.extend({
  original: referenceSchema.extend({ locator: articleSourceLocatorSchema, text }).strict(),
}).strict();
const proposalInputSchema = z.object({ revisions: z.array(proposalSchema).min(1) }).strict();
const storedProposalsSchema = z.object({ revisions: z.array(storedProposalSchema).default([]) }).strict();

export type OriginalRevisionProposal = z.infer<typeof storedProposalSchema>;

function inputError(message: string, reasonCode: string): ContextError {
  return new ContextError(ExitCode.UserError, message, { category: ErrorCategory.UserInputInvalid, reason_code: reasonCode });
}

const issues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");

export async function readOriginalRevisionProposals(projectRoot: string): Promise<OriginalRevisionProposal[]> {
  let content: string;
  try {
    content = await readFile(join(projectRoot, ORIGINAL_REVISION_PROPOSALS_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = storedProposalsSchema.safeParse(YAML.parse(content) ?? {});
  if (!parsed.success) {
    throw inputError(`Invalid ${ORIGINAL_REVISION_PROPOSALS_PATH}: ${issues(parsed.error)}`, "invalid-original-revision-proposals");
  }
  return parsed.data.revisions;
}

async function writeProposals(projectRoot: string, proposals: readonly OriginalRevisionProposal[]): Promise<void> {
  const path = join(projectRoot, ORIGINAL_REVISION_PROPOSALS_PATH);
  if (proposals.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await atomicWriteFile(path, YAML.stringify({ revisions: proposals }));
}

/**
 * Add proposals under the caller's write lock. Context reads the original
 * passage itself; writers supply locations only. A proposal replaces one with
 * the same id.
 */
export async function proposeOriginalRevisions(projectRoot: string, input: unknown): Promise<OriginalRevisionProposal[]> {
  const parsed = proposalInputSchema.safeParse(input);
  if (!parsed.success) throw inputError(`Invalid original revision proposals: ${issues(parsed.error)}`, "invalid-original-revision-proposals");
  const ids = parsed.data.revisions.map((proposal) => proposal.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw inputError(`Original revision id ${repeated} appears more than once in the proposals`, "invalid-original-revision-proposals");
  }
  const read = await registeredArticleSourceReader(projectRoot);
  const region = async (sourceRef: string, locator: { path: string; start_line: number; end_line: number }): Promise<string> => {
    let source: string;
    try {
      source = await read(sourceRef, locator.path);
    } catch (error) {
      throw inputError(`Cannot read ${sourceRef} ${locator.path}: ${error instanceof Error ? error.message : String(error)}`, "original-revision-source-unreadable");
    }
    try {
      return articleSourceRegion(source, locator);
    } catch {
      throw inputError(`Lines ${locator.start_line}-${locator.end_line} are outside ${sourceRef} ${locator.path}`, "original-revision-locator-invalid");
    }
  };
  const byId = new Map((await readOriginalRevisionProposals(projectRoot)).map((proposal) => [proposal.id, proposal]));
  for (const proposal of parsed.data.revisions) {
    const originalText = await region(proposal.original.source_ref, proposal.original.locator);
    for (const item of proposal.evidence) await region(item.source_ref, item.locator);
    byId.set(proposal.id, storedProposalSchema.parse({ ...proposal, original: { ...proposal.original, text: originalText } }));
  }
  const next = [...byId.values()];
  await writeProposals(projectRoot, next);
  return next;
}

/** Remove proposals once their decision has been applied to the article. */
export async function resolveOriginalRevisions(projectRoot: string, ids: readonly string[]): Promise<OriginalRevisionProposal[]> {
  const current = await readOriginalRevisionProposals(projectRoot);
  const known = new Set(current.map((proposal) => proposal.id));
  const unknown = ids.filter((id) => id !== "all" && !known.has(id));
  if (unknown.length > 0) {
    throw new ContextError(ExitCode.UserError, `Unknown original revision id: ${unknown.join(", ")}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "context review original-revisions --format json",
    });
  }
  const remove = new Set(ids.includes("all") ? known : ids);
  const next = current.filter((proposal) => !remove.has(proposal.id));
  await writeProposals(projectRoot, next);
  return next;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);

/** A block shown above an article in the review report listing its proposals. */
export function originalRevisionReviewHtml(proposals: readonly OriginalRevisionProposal[]): string {
  if (proposals.length === 0) return "";
  const items = proposals.map((proposal) => [
    `<li><strong>${escapeHtml(proposal.id)}</strong> · ${proposal.reason === "wrong" ? "原文写错 / written wrong" : "原文过时 / went stale"}`,
    `<br>原文 / Original: <del>${escapeHtml(proposal.original.text)}</del>`,
    `<br>修订 / Revised: <ins>${escapeHtml(proposal.revised)}</ins>`,
    `<br>依据 / Evidence: ${proposal.evidence.map((item) => escapeHtml(`${item.source_ref} ${item.locator.path} L${item.locator.start_line}-L${item.locator.end_line}`)).join("; ")}`,
    "</li>",
  ].join("")).join("");
  return `<aside class="original-revisions" style="border:1px solid #d0a000;border-radius:6px;padding:8px 12px;margin-bottom:16px">`
    + `<p><strong>原文修订建议 / Revisions to the original</strong>：接受并修正上游、只修订本地，或保留原文 / accept and correct upstream, revise locally only, or keep the original.</p>`
    + `<ul>${items}</ul></aside>`;
}
