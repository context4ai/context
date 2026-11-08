import { SourceReadError } from "./gitObjectReader.js";
import { createHash } from "node:crypto";
import { type ArticleSourceReference, type ArticleStructureEntry, type ProcessedScope } from "@c4a/context";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { createArticleReferenceObserver, type ReferenceObservation, type SourceRead } from "./articleReferenceObservation.js";

export type ReferenceRelocation = ReferenceObservation;
export async function relocateUnchangedReference(_root: string, read: SourceRead,
  reference: ArticleSourceReference): Promise<ReferenceRelocation> {
  return createArticleReferenceObserver(read)(reference);
}

const settledBy = (scopes: readonly string[], sourceRef: string) => !sourceRef.startsWith("repo-content:") &&
  scopes.some(scope => sourceRef === scope || sourceRef.startsWith(`${scope}#`) || sourceRef.startsWith(`${scope}/`));
export type ObservedArticleReference = ReferenceObservation & { path: string; section_id: string };

/** Only uniquely matching digests relocate; settlement is a separate write.
 * The optional previous scopes are retained for callers that display history. */
export async function inspectSettledReferences(root: string, articles: readonly ArticleStructureEntry[], scopes: readonly string[],
  _previous: readonly ProcessedScope[] = [], options: { advisory?: boolean } = {}) {
  void _previous;
  const read = await registeredArticleSourceReader(root);
  const observe = createArticleReferenceObserver(read);
  const observations: ObservedArticleReference[] = [];
  const fileDigests: Record<string, string> = {};
  const next = await Promise.all(articles.map(async article => ({ ...article,
    sections: await Promise.all(article.sections.map(async section => ({ ...section,
      references: await Promise.all(section.references.map(async reference => {
        if (!settledBy(scopes, reference.source_ref)) return reference;
        try {
          const result = await observe(reference);
          if (result.state !== "unavailable") {
            const text = await read(reference.source_ref, reference.locator.path, true);
            fileDigests[JSON.stringify([reference.source_ref, reference.locator.path])] = createHash("sha256").update(text).digest("hex");
          }
          observations.push({ ...result, path: article.path, section_id: section.id });
          return result.reference;
        } catch (error) {
          if (!options.advisory || !(error instanceof SourceReadError)) throw error;
          observations.push({ state: "unavailable", reference, path: article.path, section_id: section.id,
            reason: `${error.message} No citation state was determined. Run context source recovery-plan --format json.` });
          return reference;
        }
      })),
    }))),
  })));
  observations.sort((a, b) => a.path.localeCompare(b.path) || a.section_id.localeCompare(b.section_id) ||
    a.reference.source_ref.localeCompare(b.reference.source_ref) || a.reference.locator.path.localeCompare(b.reference.locator.path) ||
    a.reference.locator.start_line - b.reference.locator.start_line);
  return { articles: next, observations, fileDigests,
    unresolved: observations.filter(item => item.state !== "current" && item.state !== "moved") };
}
