import { ZodError } from "zod";
import { resolveSubmittedSourceLocator } from "./submittedSourceLocator.js";
import { SubmissionInputError } from "./productionFeedback.js";
import { articleFragmentReferences, createArticleSourceReference,
  repoContentScopeMatches, type ArticleStructureEntry } from "@c4a/context";
import { rememberArticleRegion } from "./articleRegionBaselines.js";
import { relocateUnchangedReference } from "./settledReferenceRelocation.js";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import type { RevisionContentInput } from "./approvedRevisionEdits.js";

/** Reference edits share the current revision submission; they are not a second
 * binding workflow. Omitted edits retain prior citations. Only uniquely moved,
 * unchanged source text can update a locator without an Agent decision. */
export async function prepareRevisionReferences(input: {
  projectRoot: string; sourceRefs: readonly string[];
  previous: ArticleStructureEntry["sections"];
  sectionIds: readonly string[]; edits: RevisionContentInput["sections"];
  /** False for previews: resolve and sign without caching source regions. */
  remember?: boolean;
}): Promise<ArticleStructureEntry["sections"]> {
  const edits = new Map(input.edits?.map(edit => [edit.section_id, edit]));
  if (edits.size !== (input.edits?.length ?? 0)) throw new TypeError("Repeated revision fragment identity");
  for (const id of edits.keys()) if (!input.sectionIds.includes(id)) {
    throw new TypeError(`Reference edit targets a missing fragment: ${id}`);
  }
  let read: Awaited<ReturnType<typeof registeredArticleSourceReader>> | undefined;
  const inScope = (source: string) => input.sourceRefs.some(scope => repoContentScopeMatches(scope, source));
  const readSource = async (source: string, path: string) => {
    if (!inScope(source)) throw new TypeError(`Source is outside this revision: ${source}`);
    read ??= await registeredArticleSourceReader(input.projectRoot);
    return read(source, path, true);
  };
  const result: ArticleStructureEntry["sections"] = [];
  for (const id of input.sectionIds) {
    const edit = edits.get(id);
    if (edit?.references !== undefined) {
      const at = ["sections", input.edits!.indexOf(edit), "references"];
      const previous = input.previous.find(section => section.id === id)?.references ?? [];
      const references = [];
      for (const [index, reference] of edit.references.entries()) {
        if (!inScope(reference.source_ref)) throw new SubmissionInputError(
          `Fragment ${id} cites ${reference.source_ref}, which is outside this revision; allowed sources: ${input.sourceRefs.join(", ")}. `
          + "To cite new independent evidence, register it as a source, associate it with the selected requirement in src/indexers.yaml, then run context task adjust for this revision.",
          [...at, index, "source_ref"], "source-outside-revision");
        // Resubmitting an earlier citation unchanged keeps its earlier evidence;
        // quote and heading locators select current text and never take this path.
        const submitted = reference.locator;
        const kept = "start_line" in submitted ? previous.find(old => old.source_ref === reference.source_ref &&
          old.locator.path === submitted.path && old.locator.start_line === submitted.start_line &&
          old.locator.end_line === submitted.end_line) : undefined;
        if (kept) {
          const observed = await relocateUnchangedReference(input.projectRoot, readSource, kept);
          if (observed.state === "current" || observed.state === "moved") { references.push(observed.reference); continue; }
          throw new SubmissionInputError(`Fragment ${id}: ${reference.source_ref} ${kept.locator.path}:${kept.locator.start_line}-${kept.locator.end_line} `
            + `repeats an earlier citation, so it keeps that evidence, which is ${observed.state} in the current source. `
            + "To keep the earlier evidence, cite its current position. To cite the text now at these lines (it may be the correct new content), use a quote or heading locator.",
          [...at, index, "locator"], "kept-reference-unresolved");
        }
        const text = await readSource(reference.source_ref, reference.locator.path);
        let locator;
        try { locator = resolveSubmittedSourceLocator(reference.locator, text); }
        catch (error) {
          if (error instanceof SubmissionInputError) throw new SubmissionInputError(`Fragment ${id}: ${error.message}`, [...at, index, "locator"]);
          throw error;
        }
        const resolved = createArticleSourceReference(reference.source_ref, locator, text);
        if (input.remember !== false) rememberArticleRegion(input.projectRoot, resolved, text);
        references.push(resolved);
      }
      try { result.push({ id, references: articleFragmentReferences(references) }); }
      catch (error) {
        if (error instanceof ZodError) throw new SubmissionInputError(`Fragment ${id}: ${error.issues.map(issue => issue.message).join("; ")}`, at);
        throw error;
      }
      continue;
    }
    const references = [];
    for (const reference of input.previous.find(section => section.id === id)?.references ?? []) {
      // An expression-only revision need not recapture unavailable sources.
      // Unresolved references stay unchanged so normal region warnings remain observable.
      references.push((await relocateUnchangedReference(input.projectRoot, readSource, reference)).reference);
    }
    result.push({ id, references });
  }
  return result;
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

export const REMOVED_CITATIONS_NOTE = "These earlier citations are no longer in their sections. If you meant to replace or remove them, nothing needs doing; otherwise repeat each with its earlier lines to keep that evidence.";
