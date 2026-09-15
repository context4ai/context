import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { readProductionStage } from "./productionStageStore.js";
import { assertProductionPlanRequirementsCurrent } from "./productionPlanning.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { productionApprovedTargetsIndex } from "./productionArticleTarget.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { withProductionFeedback } from "./productionFeedback.js";

/** Select only reviewed formal articles from this stage. This is not Review
 * approval or a delivery authorization, and creates no second process ledger. */
export async function productionDeliverableArticles(root: string, phase: "review" | "delivery" = "delivery") {
  return withProductionFeedback({ operation: "delivery-scope" }, async () => {
  const stage = await readProductionStage(root);
  if (!stage) return [];
  await assertProductionPlanRequirementsCurrent(root, stage);
  const candidates = await readCandidateRecords(root);
  const unresolved = new Set(candidates.map(candidate => candidate.path));
  const unresolvedIds = new Set(candidates.map(candidate => candidate.article_id));
  const formal = productionApprovedTargetsIndex(await readApprovedKnowledgeMetadataIndex(root));
  const selected = new Map<string, { path: string; article_id: string }>();
  for (const task of stage.tasks) {
    if (stage.delivery && !stage.delivery.includes(task.id)) continue;
    if (task.status !== "accepted" || !task.accepted || unresolved.has(task.path) || unresolvedIds.has(task.article_id)) continue;
    const article = formal.byArticleId.get(task.article_id);
    if (!article || article.path !== task.path) continue;
    // Do not deliver an earlier accepted revision while a later writer owns it.
    if (stage.tasks.some(other => other.id !== task.id &&
        (other.path === task.path || other.article_id === task.article_id) &&
        ["pending", "issued", "blocked"].includes(other.status))) continue;
    selected.set(article.article_id, { path: article.path, article_id: article.article_id });
  }
  // Starting Review must not require its own candidates to be approved already.
  // Link completeness remains mandatory after Review, before close/build.
  if (phase === "review") return [...selected.values()];
  for (const article of selected.values()) {
    const markdown = await readFile(await safeProjectTarget(root, join("knowledge", article.path)), "utf8");
    for (const link of markdownReaderLinks(markdown)) {
      if (link.image || /^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(link.target)) continue;
      let href: string;
      try { href = decodeURIComponent(link.target.split(/[?#]/u)[0]!); }
      catch { throw new TypeError(`Invalid link in delivery article ${article.path}: ${link.target}`); }
      const path = posix.normalize(posix.join(posix.dirname(article.path), href));
      if (!/\.md$/iu.test(path)) continue;
      if (path.startsWith("../") || unresolved.has(path) || !formal.byPath.has(path)) {
        throw new TypeError(`Partial delivery needs its linked approved article: ${article.path} → ${path}. Finish that article's Review before delivery.`);
      }
      await readFile(await safeProjectTarget(root, join("knowledge", path)), "utf8");
    }
  }
  return [...selected.values()];
  });
}
