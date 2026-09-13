import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerProtocolDigest, validateArticleStructureEntries } from "@c4a/context";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { knowledgeTargetPathKey, type CandidateRecord } from "./candidateLedger.js";
import type { ApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import type { ProductionTask } from "./productionStage.js";
import type { ProductionArticleBase } from "./productionArticleEdits.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";

export function productionApprovedTargetsIndex(metadata: ApprovedKnowledgeMetadataIndex) {
  const articles = validateArticleStructureEntries(metadata.structure?.articles ?? []);
  return { byPath: new Map(articles.map(article => [article.path, article])),
    byPathIdentity: new Map(articles.map(article => [knowledgeTargetPathKey(article.path), article])),
    byArticleId: new Map(articles.map(article => [article.article_id, article])) };
}

export function productionArticleTargetDigest(input: {
  markdown: string;
  sections: ProductionArticleBase["sections"] | undefined;
  visibility: string;
}): string {
  // Reference-only revisions and permission changes invalidate a pending
  // revision just as body changes do. No Provider/process metadata participates.
  return indexerProtocolDigest({ markdown: input.markdown, sections: input.sections ?? null, visibility: input.visibility });
}

/** Share one approved structure read across a submitted batch. Candidate and
 * formal targets use the same identity and actual-content baseline checks. */
export async function readProductionArticleTarget(input: {
  projectRoot: string;
  task: ProductionTask;
  candidates: readonly CandidateRecord[];
  readApproved: () => Promise<ReturnType<typeof productionApprovedTargetsIndex>>;
}): Promise<{ base?: ProductionArticleBase; visibility: string; approvedBaseDigest: string | null }> {
  const { task } = input;
  const existing = input.candidates.filter(candidate => knowledgeTargetPathKey(candidate.path) === knowledgeTargetPathKey(task.path) || candidate.article_id === task.article_id);
  if (existing.length > 1 || existing.some(candidate => candidate.path !== task.path || candidate.article_id !== task.article_id)) {
    throw new TypeError("The target conflicts with another article identity or candidate. Resolve the plan before resubmitting.");
  }
  const metadata = await input.readApproved();
  const formal = [...new Set([metadata.byPathIdentity.get(knowledgeTargetPathKey(task.path)), metadata.byArticleId.get(task.article_id)])]
    .filter(article => article !== undefined);
  if (formal.length > 1 || formal.some(article => article.path !== task.path || article.article_id !== task.article_id)) {
    throw new TypeError("The target conflicts with an existing formal article identity or path. Use an explicit linked revision to rename or merge articles.");
  }
  let markdown = existing[0]?.body;
  if (markdown === undefined) {
    try { markdown = await readFile(await safeProjectTarget(input.projectRoot, join("knowledge", task.path)), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (markdown === undefined) {
    if (task.base !== null || formal.length) throw new TypeError("The target article disappeared. Read the current article and revise the affected task.");
    return { visibility: "public", approvedBaseDigest: null };
  }
  const visibility = existing[0]?.visibility ?? formal[0]?.visibility;
  if (!visibility) throw new TypeError("The existing article has no valid visibility metadata; repair its formal structure before revising it.");
  const sections = existing[0]?.indexer_candidate?.sections.map(section => ({ id: section.section_key, references: section.references })) ?? formal[0]?.sections;
  if (productionArticleTargetDigest({ markdown, sections, visibility }) !== task.base) {
    throw new TypeError("The target article, references or visibility changed. Read its current version and open a revision task.");
  }
  // Review compares against formal Markdown, not against this task's complete
  // candidate/reference baseline. Preserve the original formal base when a
  // candidate is revised repeatedly before approval.
  let approvedBaseDigest = existing[0]?.approved_revision?.base_digest;
  if (approvedBaseDigest === undefined) {
    const formalMarkdown = formal.length
      ? await readFile(await safeProjectTarget(input.projectRoot, join("knowledge", task.path)), "utf8") : undefined;
    approvedBaseDigest = formalMarkdown === undefined ? null : durableContentDigest(formalMarkdown);
  }
  return { visibility, approvedBaseDigest, ...(sections ? { base: { markdown, sections } } : {}) };
}
