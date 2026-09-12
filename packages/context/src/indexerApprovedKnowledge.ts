import { articleStructureEntrySchema, type ArticleStructureEntry } from "./articleStructure.js";

// Approved knowledge has one article record. Prose and reader metadata live in
// Markdown; capture/version/transaction state belongs to the existing runtime.
export const indexerApprovedKnowledgeSchema = articleStructureEntrySchema;
export type IndexerApprovedKnowledge = ArticleStructureEntry;

export function validateIndexerApprovedKnowledge(value: unknown): IndexerApprovedKnowledge {
  return indexerApprovedKnowledgeSchema.parse(value);
}

export function buildIndexerApprovedKnowledge(value: IndexerApprovedKnowledge): IndexerApprovedKnowledge {
  return validateIndexerApprovedKnowledge(value);
}
