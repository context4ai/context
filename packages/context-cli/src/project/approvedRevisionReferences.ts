import { articleFragmentReferences, articleSourceRegionDigest, createArticleSourceReference,
  locateArticleRegion, type ArticleStructureEntry } from "@c4a/context";
import { readArticleRegionBaseline, rememberArticleRegion } from "./articleRegionBaselines.js";
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
  const readSource = async (source: string, path: string) => {
    if (!input.sourceRefs.includes(source)) throw new TypeError(`Source is outside this revision: ${source}`);
    read ??= await registeredArticleSourceReader(input.projectRoot);
    return read(source, path, true);
  };
  const result: ArticleStructureEntry["sections"] = [];
  for (const id of input.sectionIds) {
    const edit = edits.get(id);
    if (edit?.references !== undefined) {
      if (edit.references.length > 3) throw new TypeError("A fragment can cite at most three source positions");
      const references = [];
      for (const reference of edit.references) {
        const text = await readSource(reference.source_ref, reference.locator.path);
        const resolved = createArticleSourceReference(reference.source_ref, reference.locator, text);
        rememberArticleRegion(input.projectRoot, resolved, text);
        references.push(resolved);
      }
      result.push({ id, references: articleFragmentReferences(references) });
      continue;
    }
    const references = [];
    for (const reference of input.previous.find(section => section.id === id)?.references ?? []) {
      let resolved = reference;
      try {
        const text = await readSource(reference.source_ref, reference.locator.path);
        let digest: string | undefined;
        try { digest = articleSourceRegionDigest(text, reference.locator); }
        catch (error) { if (!(error instanceof RangeError)) throw error; }
        if (digest !== reference.content_digest) {
          const previous = readArticleRegionBaseline(input.projectRoot, reference.content_digest);
          const locator = previous === undefined ? null : locateArticleRegion(previous, text, reference.locator.path);
          if (locator) resolved = { ...reference, locator };
        }
      } catch {
        // An expression-only revision need not recapture unavailable sources.
        // Keep the old reference so normal region warnings remain observable.
      }
      references.push(resolved);
    }
    result.push({ id, references });
  }
  return result;
}
