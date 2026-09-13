import { articleSourceRegionDigest, locateArticleRegion } from "@c4a/context";
import { registeredArticleSourceReader } from "./articleSourceReader.js";
import { readArticleRegionBaseline } from "./articleRegionBaselines.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

/** Read only cited captured files, once per verification. No parser invocation,
 * article dependency graph, or mutation of approved references. Changed regions
 * are revision hints, not a claim that every source change is covered. */
export async function approvedKnowledgeDependencyWarnings(
  projectRoot: string, structureOverride?: Record<string, unknown>,
): Promise<ProjectVerifyIssue[]> {
  const articles = approvedKnowledgeSnapshotsFromStructure(
    structureOverride ?? (await readKnowledgeStructure(projectRoot)).parsed,
  );
  if (!articles.some(article => article.sections.some(section => section.references.length))) return [];
  const read = await registeredArticleSourceReader(projectRoot);
  const issues: ProjectVerifyIssue[] = [];
  for (const article of articles) {
    const changed: string[] = [];
    const moved: string[] = [];
    for (const section of article.sections) {
      for (const reference of section.references) {
        try {
          const text = await read(reference.source_ref, reference.locator.path);
          let current: string | undefined;
          try { current = articleSourceRegionDigest(text, reference.locator); }
          catch (error) { if (!(error instanceof RangeError)) throw error; }
          if (current === reference.content_digest) continue;
          const previous = readArticleRegionBaseline(projectRoot, reference.content_digest);
          const relocated = previous === undefined ? null : locateArticleRegion(previous, text, reference.locator.path);
          if (relocated) {
            moved.push(`${section.id}: ${reference.source_ref}/${relocated.path} L${relocated.start_line}–L${relocated.end_line}`);
            continue;
          }
        } catch {
          // Missing, unreadable, invalid or shorter sources all need review.
        }
        changed.push(section.id);
        break;
      }
    }
    if (changed.length) issues.push({
      severity: "warning", code: "approved-source-region-changed", path: article.path,
      message: `Source regions changed or are unavailable for fragments: ${changed.join(", ")}. Inspect current sources and revise this article; verification does not rewrite approved references.`,
    });
    if (moved.length) issues.push({
      severity: "warning", code: "approved-source-region-moved", path: article.path,
      message: `Unchanged source regions have new positions: ${moved.join("; ")}. Refresh these locators during the source update; do not rewrite unaffected prose.`,
    });
  }
  return issues;
}
