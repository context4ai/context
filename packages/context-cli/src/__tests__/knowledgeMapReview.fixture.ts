import { applyKnowledgeMapUpdate, readKnowledgeMap } from "../project/knowledgeMap.js";
import { completeCurrentIndexerStructureReview as complete, currentIndexerStructureReview } from "../project/indexerStructureReview.js";
import { approvedKnowledgeMapTargets } from "../project/knowledgeMapCoverage.js";
import { completeCurrentIndexerAction as completeAction } from "../project/indexerCurrentAction.js";
import { readKnowledgeUpdate } from "../project/knowledgeUpdate.js";
export { currentIndexerStructureReview };
/** Legacy scenario authors use a flat reader layout; still submit through the real action. */
export async function completeCurrentIndexerAction(input: Parameters<typeof completeAction>[0]) {
  const value = input.value as { stage?: string; decision?: string; knowledge_map?: unknown };
  if (value?.stage !== "structure-review" || value.decision !== "approved" || value.knowledge_map !== undefined ||
    (await readKnowledgeUpdate(input.cwd))?.structure_proposal) return completeAction(input);
  const current = await currentIndexerStructureReview(input.cwd);
  const articles = [...await approvedKnowledgeMapTargets(input.cwd), ...current?.preview.topics.flatMap(topic => topic.article_targets ?? []) ?? []];
  return completeAction({ ...input, value: { ...value, knowledge_map: {
    expected_revision: current?.knowledge_map?.revision ?? null, remove: [],
    upsert: [...new Map(articles.map(article => [article.artifact_ref, article])).values()].map(article => ({
      key: `reader:${article.artifact_ref}`, parent: null, title: article.artifact_ref, order: 0,
      target: { artifact_ref: article.artifact_ref },
    })),
  } } });
}
/** Test authors choose a simple explicit reader layout, as real authors must. */
export async function completeCurrentIndexerStructureReview(input: Parameters<typeof complete>[0]) {
  if ((input.decision !== "approved" && input.decision !== "exclude-obsolete") || input.knowledge_map !== undefined) return complete(input);
  const current = await currentIndexerStructureReview(input.projectRoot);
  const articles = [...await approvedKnowledgeMapTargets(input.projectRoot), ...current?.preview.topics.flatMap(topic => topic.article_targets ?? []) ?? []];
  const unique = [...new Map(articles.map(article => [article.artifact_ref, article])).values()];
  return complete({ ...input, knowledge_map: { expected_revision: current?.knowledge_map?.revision ?? null, remove: [],
    upsert: unique.map(article => ({ key: `reader:${article.artifact_ref}`, parent: null, title: article.artifact_ref, order: 0,
      target: { artifact_ref: article.artifact_ref } })) } });
}

export async function placeApprovedReadingFixture(root: string) {
  const current = await readKnowledgeMap(root);
  const articles = await approvedKnowledgeMapTargets(root);
  const placed = new Set(current?.entries.flatMap(entry => entry.target ? [entry.target.artifact_ref] : []) ?? []);
  const missing = articles.filter(article => !placed.has(article.artifact_ref));
  if (missing.length === 0) return;
  await applyKnowledgeMapUpdate(root, { expected_revision: current?.revision ?? null, remove: [],
    upsert: missing.map(article => ({ key: `reader:${article.artifact_ref}`, parent: null, title: article.title ?? article.artifact_ref, order: 0, target: { artifact_ref: article.artifact_ref } })) });
}
