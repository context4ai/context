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
      const references = [];
      for (const [index, reference] of edit.references.entries()) {
        if (!inScope(reference.source_ref)) throw new SubmissionInputError(
          `Fragment ${id} cites ${reference.source_ref}, which is outside this revision; allowed sources: ${input.sourceRefs.join(", ")}. `
          + "To cite new independent evidence, register it as a source, associate it with the selected requirement in src/indexers.yaml, then run context task adjust for this revision.",
          [...at, index, "source_ref"]);
        const text = await readSource(reference.source_ref, reference.locator.path);
        let locator;
        try { locator = resolveSubmittedSourceLocator(reference.locator, text); }
        catch (error) {
          if (error instanceof SubmissionInputError) throw new SubmissionInputError(`Fragment ${id}: ${error.message}`, [...at, index, "locator"]);
          throw error;
        }
        const resolved = createArticleSourceReference(reference.source_ref, locator, text);
        rememberArticleRegion(input.projectRoot, resolved, text);
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
