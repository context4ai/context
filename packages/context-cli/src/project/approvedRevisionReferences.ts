import { ZodError } from "zod";
import { assertNoCaptureGap, resolveSubmittedSourceLocator } from "./submittedSourceLocator.js";
import { SubmissionInputError, SubmissionInputErrors } from "./productionFeedback.js";
import { articleFragmentReferences, createArticleSourceReference,
  repoContentScopeMatches, type ArticleSourceReference, type ArticleStructureEntry } from "@c4a/context";
import { rememberArticleRegion } from "./articleRegionBaselines.js";
import { relocateUnchangedReference } from "./settledReferenceRelocation.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { SourceReadError, SourceUnavailableError } from "./gitObjectReader.js";
import type { RevisionContentInput } from "./approvedRevisionEdits.js";
import { articleReferenceHistoryReader, LOCAL_SOURCE_REASONS, suggestedRange, type SourceRead } from "./articleReferenceObservation.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { readProcessedScopes } from "@c4a/context";

/** A citation kept in a paragraph whose source no longer confirms it (not blocking). */
export interface ReferenceReminder { section_id: string; state: string; reason?: string; source_ref: string; locator: ArticleSourceReference["locator"] }

const citesScope = (scopes: readonly string[], ref: string) => scopes.some(scope =>
  repoContentScopeMatches(scope, ref) || ref.startsWith(`${scope}#`) || ref.startsWith(`${scope}/`));

interface ReferenceContext {
  projectRoot: string; remember: boolean; previous: ArticleStructureEntry["sections"]; sourceRefs: readonly string[];
  inScope(source: string): boolean;
  readSource: SourceRead;
}

/** One submitted citation; input problems throw SubmissionInputError. */
async function resolveSubmittedReference(context: ReferenceContext, id: string, at: Array<string | number>,
  reference: NonNullable<NonNullable<RevisionContentInput["sections"]>[number]["references"]>[number]): Promise<ArticleSourceReference> {
  if (!context.inScope(reference.source_ref)) throw new SubmissionInputError(
    `Fragment ${id} cites ${reference.source_ref}, which is outside this revision; allowed sources: ${context.sourceRefs.join(", ")}. `
    + "To cite new independent evidence, register it as a source, associate it with the selected requirement in src/indexers.yaml, then run context task adjust for this revision.",
    [...at, "source_ref"], "source-outside-revision");
  // Resubmitting an earlier citation unchanged keeps its earlier evidence;
  // quote and heading locators select current text and never take this path.
  const submitted = reference.locator;
  const previous = context.previous.find(section => section.id === id)?.references ?? [];
  const kept = "start_line" in submitted ? previous.find(old => old.source_ref === reference.source_ref &&
    old.locator.path === submitted.path && old.locator.start_line === submitted.start_line &&
    old.locator.end_line === submitted.end_line) : undefined;
  if (kept) {
    const observed = await relocateUnchangedReference(context.projectRoot, context.readSource, kept);
    if (observed.state === "current" || observed.state === "moved") return observed.reference;
    throw new SubmissionInputError(`Fragment ${id}: ${reference.source_ref} ${kept.locator.path}:${kept.locator.start_line}-${kept.locator.end_line} `
      + `repeats an earlier citation, so it keeps that evidence, which is ${observed.state} in the current source. `
      + "To keep the earlier evidence, cite its current position. To cite the text now at these lines (it may be the correct new content), use a quote or heading locator.",
    [...at, "locator"], "kept-reference-unresolved");
  }
  const text = await context.readSource(reference.source_ref, reference.locator.path, true);
  let locator;
  try { locator = resolveSubmittedSourceLocator(reference.locator, text); assertNoCaptureGap(locator, text); }
  catch (error) {
    if (error instanceof SubmissionInputError) throw new SubmissionInputError(`Fragment ${id}: ${error.message}`, [...at, "locator"]);
    throw error;
  }
  let resolved;
  try { resolved = createArticleSourceReference(reference.source_ref, locator, text); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new SubmissionInputError(`Fragment ${id}: ${reference.source_ref} ${locator.path}:${locator.start_line}-${locator.end_line} `
      + `is outside the file, which has ${text.replace(/\r\n/gu, "\n").split("\n").length} lines. Cite existing lines, or use a quote or heading locator.`,
    [...at, "locator"], "locator-out-of-range");
  }
  if (context.remember) rememberArticleRegion(context.projectRoot, resolved, text);
  return resolved;
}

/** Reference edits share the current revision submission; they are not a second
 * binding workflow. Omitted edits retain prior citations. Only uniquely moved,
 * unchanged source text can update a locator without an Agent decision. A retained
 * citation that no longer matches a source this request processes blocks submission;
 * other stale citations are reminders. Every problem of the page is reported at once. */
export async function prepareRevisionReferences(input: {
  projectRoot: string; sourceRefs: readonly string[];
  previous: ArticleStructureEntry["sections"];
  sectionIds: readonly string[]; edits: RevisionContentInput["sections"];
  /** False for previews: resolve and sign without caching source regions. */
  remember?: boolean;
  /** Sources of the request's processed_scopes; their stale citations block. */
  processedScopes?: readonly string[];
  /** Paragraphs whose text changed; unverifiable citations there are not kept silently. */
  changedBodies?: ReadonlySet<string>;
  onReminder?: (reminder: ReferenceReminder) => void;
  /** Local-only hint for re-citing a blocked citation. */
  suggest?: (reference: ArticleSourceReference) => Promise<string | undefined>;
}): Promise<ArticleStructureEntry["sections"]> {
  const edits = new Map(input.edits?.map(edit => [edit.section_id, edit]));
  if (edits.size !== (input.edits?.length ?? 0)) throw new TypeError("Repeated revision fragment identity");
  for (const id of edits.keys()) if (!input.sectionIds.includes(id)) {
    throw new TypeError(`Reference edit targets a missing fragment: ${id}`);
  }
  let read: Awaited<ReturnType<typeof registeredArticleSourceReader>> | undefined;
  const inScope = (source: string) => input.sourceRefs.some(scope => repoContentScopeMatches(scope, source));
  const context: ReferenceContext = { projectRoot: input.projectRoot, remember: input.remember !== false, previous: input.previous,
    sourceRefs: input.sourceRefs, inScope,
    // Carries the reader's capture-completeness check, so an incomplete capture is reported as such.
    readSource: Object.assign(async (source: string, path: string) => {
      if (!inScope(source)) throw new TypeError(`Source is outside this revision: ${source}`);
      read ??= await registeredArticleSourceReader(input.projectRoot);
      return read(source, path, true);
    }, { incomplete: async (source: string) => {
      read ??= await registeredArticleSourceReader(input.projectRoot);
      return await read.incomplete?.(source) ?? false;
    } }) };
  const result: ArticleStructureEntry["sections"] = [];
  const problems: SubmissionInputError[] = [];
  for (const id of input.sectionIds) {
    const edit = edits.get(id);
    if (edit?.references !== undefined) {
      const at = ["sections", input.edits!.indexOf(edit), "references"];
      const references: ArticleSourceReference[] = [];
      for (const [index, reference] of edit.references.entries()) {
        try { references.push(await resolveSubmittedReference(context, id, [...at, index], reference)); }
        catch (error) {
          // An unreadable source is one more problem of the page; keep checking the other citations.
          if (error instanceof SourceReadError || error instanceof SourceUnavailableError) {
            problems.push(new SubmissionInputError(`Fragment ${id}: ${reference.source_ref} ${reference.locator.path}: ${error.message}`,
              [...at, index, "source_ref"], String(error.detail?.reason_code ?? "source-unavailable")));
          } else if (error instanceof SubmissionInputError) problems.push(error);
          else throw error;
        }
      }
      try { result.push({ id, references: articleFragmentReferences(references) }); }
      catch (error) {
        if (error instanceof ZodError) problems.push(new SubmissionInputError(`Fragment ${id}: ${error.issues.map(issue => issue.message).join("; ")}`, at));
        else throw error;
      }
      continue;
    }
    const references: ArticleSourceReference[] = [];
    const retained = input.previous.find(section => section.id === id)?.references ?? [];
    for (const [index, reference] of retained.entries()) {
      references.push(await retainReference(input, context, id, ["fragments", id, "references", index], reference, problems));
    }
    result.push({ id, references });
  }
  if (problems.length === 1) throw problems[0];
  if (problems.length) throw new SubmissionInputErrors(problems);
  return result;
}

/** A citation the submission did not resubmit: follow moved text; otherwise keep it
 * and decide whether its state blocks, reminds, or (local reasons, unchanged text) passes. */
async function retainReference(input: Parameters<typeof prepareRevisionReferences>[0], context: ReferenceContext, id: string,
  at: Array<string | number>, reference: ArticleSourceReference, problems: SubmissionInputError[]): Promise<ArticleSourceReference> {
  const changed = input.changedBodies?.has(id) === true;
  const where = `${reference.source_ref} ${reference.locator.path}:${reference.locator.start_line}-${reference.locator.end_line}`;
  let observed;
  try { observed = await relocateUnchangedReference(context.projectRoot, context.readSource, reference); }
  catch (error) {
    if (!(error instanceof SourceReadError)) throw error;
    // Unchanged text keeps its citation; changed text must not pass unchecked.
    if (changed) problems.push(new SubmissionInputError(`Fragment ${id}: the text changed, but ${where} cannot be checked: ${error.message}`, at, "reference-unverifiable"));
    return reference;
  }
  if (observed.state === "current" || observed.state === "moved") return observed.reference;
  if (observed.state === "unavailable" && (observed.reason ?? "") in LOCAL_SOURCE_REASONS) {
    if (changed) problems.push(new SubmissionInputError(`Fragment ${id}: the text changed, but ${where} cannot be checked on this machine (${observed.reason}). Make the source available, then submit again.`, at, "reference-unverifiable"));
    return reference;
  }
  if (citesScope(input.processedScopes ?? [], reference.source_ref)) {
    const hint = await input.suggest?.(reference).catch(() => undefined);
    problems.push(new SubmissionInputError(`Fragment ${id}: ${where} is ${observed.state}${observed.reason ? ` (${observed.reason})` : ""} in the source version this revision processes. `
      + `Rewrite the paragraph, cite its current text${hint ? ` (${hint})` : ""}, or remove the citation.`, at, "processed-reference-stale"));
    return reference;
  }
  input.onReminder?.({ section_id: id, state: observed.state, ...(observed.reason ? { reason: observed.reason } : {}),
    source_ref: reference.source_ref, locator: reference.locator });
  return reference;
}

/** Where a blocked citation's old lines now are, from local history only; undefined when unknown. */
export async function suggestedCitation(projectRoot: string, reference: ArticleSourceReference,
  sections: ArticleStructureEntry["sections"]): Promise<string | undefined> {
  const history = await articleReferenceHistoryReader(projectRoot, readProcessedScopes((await readKnowledgeStructure(projectRoot)).parsed))(reference);
  if (!history?.text) return undefined;
  const current = await (await registeredArticleSourceReader(projectRoot))(reference.source_ref, reference.locator.path, true);
  const cited = sections.flatMap(section => section.references.map(item => ({ source_ref: item.source_ref, path: item.locator.path,
    start_line: item.locator.start_line, end_line: item.locator.end_line })));
  const suggested = await suggestedRange(projectRoot, reference, history.text, current, cited);
  if (!suggested) return undefined;
  return "quote" in suggested.locator ? `the old text now maps to lines ${suggested.start_line}-${suggested.end_line}; cite them with a quote locator`
    : `the old text now maps to lines ${suggested.start_line}-${suggested.end_line}`;
}

export interface RemovedCitation { section_id: string; source_ref: string; path: string; start_line: number; end_line: number }

/** Earlier citations a revision no longer carries. A citation is kept when its section
 * still cites the same source and file with the same content digest, so a line move in
 * the same file is kept; the same text from another file or source is not. */
export function removedCitations(previous: ArticleStructureEntry["sections"], next: ArticleStructureEntry["sections"]): RemovedCitation[] {
  const removed: RemovedCitation[] = [];
  for (const section of previous) {
    const current = next.find(item => item.id === section.id)?.references ?? [];
    for (const reference of section.references) {
      const kept = current.some(item => item.source_ref === reference.source_ref &&
        item.locator.path === reference.locator.path && item.content_digest === reference.content_digest);
      if (!kept) removed.push({ section_id: section.id, source_ref: reference.source_ref, path: reference.locator.path,
        start_line: reference.locator.start_line, end_line: reference.locator.end_line });
    }
  }
  return removed;
}

export const REFERENCE_REMINDER_NOTE = "These paragraphs keep citations their sources no longer confirm. The sources are outside what this revision processes, so the citations were kept; check them in a source update or a separate revision.";

/** Citation notes for previews, receipts and summaries; only non-empty keys. */
export function citationNotes(removed: readonly RemovedCitation[], reminders: readonly ReferenceReminder[]) {
  return { ...(removed.length ? { removed_citations: [...removed], removed_citations_note: REMOVED_CITATIONS_NOTE } : {}),
    ...(reminders.length ? { reference_warnings: [...reminders], reference_warning_instruction: REFERENCE_REMINDER_NOTE } : {}) };
}

export const REMOVED_CITATIONS_NOTE = "These earlier citations are no longer in their sections. If you meant to replace or remove them, nothing needs doing; otherwise repeat each with its earlier lines to keep that evidence.";
