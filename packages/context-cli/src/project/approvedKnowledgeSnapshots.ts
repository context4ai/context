import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerApprovedKnowledge, indexerProtocolDigest, validateArticleStructureEntries,
  type IndexerApprovedKnowledge, type IndexerProjectFileTarget,
} from "@c4a/context";
import type { CandidateRecord } from "./candidateLedger.js";
import { compactApprovedKnowledgeMarkdown, ensureApprovedKnowledgePresentation } from "./approvedKnowledgeMetadata.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";

const STRUCTURE_PATH = "knowledge/structure.yaml";

export function approvedKnowledgeContentDigest(markdown: string): string {
  return indexerProtocolDigest(compactApprovedKnowledgeMarkdown(ensureApprovedKnowledgePresentation(markdown)));
}

export function approvedKnowledgeSnapshotsFromStructure(structure: Record<string, unknown> | null): IndexerApprovedKnowledge[] {
  return validateArticleStructureEntries(structure?.articles ?? []);
}

/** Existing Review transaction commits these references with the Markdown.
 * No history scan, reverse fact matching, prose copy or second evidence table. */
export async function prepareApprovedKnowledgeSnapshotTarget(input: {
  projectRoot: string;
  pages: readonly { id: string; relPath: string; content: string }[];
  candidates: readonly CandidateRecord[];
}): Promise<IndexerProjectFileTarget | undefined> {
  if (!input.pages.length) return undefined;
  let before: string | undefined;
  try { before = await readFile(join(input.projectRoot, STRUCTURE_PATH), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const structure = before === undefined ? {} : YAML.parse(before) as Record<string, unknown>;
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) throw new TypeError("Invalid knowledge structure");
  const articles = new Map(approvedKnowledgeSnapshotsFromStructure(structure).map(article => [article.article_id, article]));
  const candidates = new Map(input.candidates.map(candidate => [candidate.candidate_id, candidate]));
  for (const page of input.pages) {
    const candidate = candidates.get(page.id);
    if (!candidate) throw new TypeError("Approved page has no accepted candidate");
    const binding = candidate.indexer_candidate;
    const previous = [...articles.values()].find(article =>
      article.article_id === binding.artifact_ref || article.path === (candidate.approved_revision?.previous_path ?? candidate.path));
    const article = buildIndexerApprovedKnowledge({
      article_id: previous?.article_id ?? binding.artifact_ref,
      path: page.relPath.replace(/^knowledge\//u, ""),
      collection: candidate.collection,
      visibility: candidate.visibility,
      sections: binding.sections.map(section => ({
        id: section.section_key,
        references: section.references,
      })),
    });
    articles.set(article.article_id, article);
  }
  const entries = validateArticleStructureEntries([...articles.values()]);
  const content = YAML.stringify({
    ...structure, articles: entries.sort((a, b) => a.article_id.localeCompare(b.article_id)),
  });
  if (content === before) return undefined;
  return { path: STRUCTURE_PATH, operation: "write", base_digest: before === undefined ? null : durableContentDigest(before),
    target_digest: durableContentDigest(content), content };
}
