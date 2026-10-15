import { articleSourceRegion, articleSourceRegionDigest, locateArticleRegion, type ArticleSourceReference, type ArticleStructureEntry, type ProcessedScope } from "@c4a/context";
import { readArticleRegionBaseline } from "./articleRegionBaselines.js";
import { registeredArticleSourceReader, registeredRepoHistoryReader } from "./articleSourceReader.js";

type SourceRead = (sourceRef: string, path: string, captured: boolean) => Promise<string>;
type RegionHistory = (reference: ArticleSourceReference) => Promise<string | undefined>;

export type ReferenceRelocation =
  | { state: "current" | "moved"; reference: ArticleSourceReference }
  | { state: "changed" | "unavailable"; reference: ArticleSourceReference };

/** Only uniquely moved, unchanged cited text may update a locator without an
 * Agent decision. A missing baseline is uncertainty, never proof of no change. */
export async function relocateUnchangedReference(root: string, read: SourceRead,
  reference: ArticleSourceReference, history?: RegionHistory): Promise<ReferenceRelocation> {
  let text: string;
  try { text = await read(reference.source_ref, reference.locator.path, true); }
  catch { return { state: "unavailable", reference }; }
  let digest: string | undefined;
  try { digest = articleSourceRegionDigest(text, reference.locator); }
  catch (error) { if (!(error instanceof RangeError)) throw error; }
  if (digest === reference.content_digest) return { state: "current", reference };
  const previous = readArticleRegionBaseline(root, reference.content_digest) ?? await history?.(reference);
  if (previous === undefined) return { state: "unavailable", reference };
  const locator = locateArticleRegion(previous, text, reference.locator.path);
  return locator ? { state: "moved", reference: { ...reference, locator } } : { state: "changed", reference };
}

const settledBy = (scopes: readonly string[], sourceRef: string) => !sourceRef.startsWith("repo-content:") &&
  scopes.some(scope => sourceRef === scope || sourceRef.startsWith(`${scope}#`) || sourceRef.startsWith(`${scope}/`));

/** The region cache is machine-local. A repository's previously settled commits
 * can stand in for it, but only when the old region still matches its digest. */
async function settledRegionHistory(root: string, previous: readonly ProcessedScope[]): Promise<RegionHistory | undefined> {
  if (!previous.some(scope => scope.source_ref.startsWith("repo:"))) return undefined;
  let readAt: Awaited<ReturnType<typeof registeredRepoHistoryReader>> | undefined;
  return async reference => {
    if (!reference.source_ref.startsWith("repo:")) return undefined;
    const versions = new Set(previous.filter(scope => settledBy([scope.source_ref], reference.source_ref)).map(scope => scope.processed_version));
    for (const version of versions) {
      try {
        readAt ??= await registeredRepoHistoryReader(root);
        const text = await readAt(reference.source_ref, reference.locator.path, version);
        if (articleSourceRegionDigest(text, reference.locator) === reference.content_digest) return articleSourceRegion(text, reference.locator);
      } catch { /* Unreadable history leaves the reference unconfirmed. */ }
    }
    return undefined;
  };
}

/** Repository content keeps its own settlement in advanceRepoContentReferences.
 * `previous` are the processed scopes recorded before this settlement. */
export async function inspectSettledReferences(root: string, articles: readonly ArticleStructureEntry[], scopes: readonly string[],
  previous: readonly ProcessedScope[] = []) {
  const sources = scopes.filter(scope => !scope.startsWith("repo-content:"));
  if (!articles.some(article => article.sections.some(section =>
    section.references.some(reference => settledBy(sources, reference.source_ref))))) {
    return { articles: [...articles], unresolved: [] as Array<{ path: string; section_id: string; reference: ArticleSourceReference; state: "changed" | "unavailable" }> };
  }
  const read = await registeredArticleSourceReader(root);
  const history = await settledRegionHistory(root, previous);
  const unresolved: Array<{ path: string; section_id: string; reference: ArticleSourceReference; state: "changed" | "unavailable" }> = [];
  const next = await Promise.all(articles.map(async article => ({ ...article,
    sections: await Promise.all(article.sections.map(async section => ({ ...section,
      references: await Promise.all(section.references.map(async reference => {
        if (!settledBy(sources, reference.source_ref)) return reference;
        const result = await relocateUnchangedReference(root, read, reference, history);
        if (result.state === "changed" || result.state === "unavailable") {
          unresolved.push({ path: article.path, section_id: section.id, reference, state: result.state });
        }
        return result.reference;
      })),
    }))),
  })));
  return { articles: next, unresolved };
}
