import YAML from "yaml";
import { indexerKnowledgeCollectionSchema, indexerProtocolDigest } from "@c4a/context";
import { isSafeKnowledgeTargetPath, isReservedKnowledgeIndexPath } from "./candidateLedger.js";
import { okfTypeForCollection } from "./okfTypes.js";

export interface NewKnowledgePage {
  path: string;
  title: string;
  source_refs: string[];
  instruction: string;
}

export function newKnowledgePageTarget(page: NewKnowledgePage) {
  const collection = indexerKnowledgeCollectionSchema.parse(page.path.split("/")[0]);
  if (!isSafeKnowledgeTargetPath(collection, page.path) || isReservedKnowledgeIndexPath(page.path) ||
      !/^[\p{L}\p{N}._/-]+\.md$/u.test(page.path)) throw new TypeError("New page requires a safe, readable path in an existing knowledge collection");
  const articleId = indexerProtocolDigest(page.path);
  const target = { path: page.path, collection, article_id: articleId,
    sections: [], visibility: "public", source_refs: page.source_refs, base_digest: null };
  const metadata = { title: page.title, type: okfTypeForCollection(collection),
    description: page.title, timestamp: new Date().toISOString() };
  return { ...target, markdown: `---\n${YAML.stringify(metadata)}---\n\n# ${page.title}\n` };
}
