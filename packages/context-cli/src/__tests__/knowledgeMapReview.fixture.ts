import { applyKnowledgeMapUpdate, readKnowledgeMap } from "../project/knowledgeMap.js";
import { approvedKnowledgeMapTargets } from "../project/knowledgeMapCoverage.js";
export { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";

export async function placeApprovedReadingFixture(root: string) {
  const current = await readKnowledgeMap(root);
  const articles = await approvedKnowledgeMapTargets(root);
  const placed = new Set(current?.entries.flatMap(entry => entry.target ? [entry.target.artifact_ref] : []) ?? []);
  const missing = articles.filter(article => !placed.has(article.artifact_ref));
  if (missing.length === 0) return;
  await applyKnowledgeMapUpdate(root, { expected_revision: current?.revision ?? null, remove: [],
    upsert: missing.map(article => ({ key: `reader:${article.artifact_ref}`, parent: null, title: article.title ?? article.artifact_ref, order: 0, target: { artifact_ref: article.artifact_ref } })) });
}
