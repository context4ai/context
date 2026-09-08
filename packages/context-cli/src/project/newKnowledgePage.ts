import YAML from "yaml";
import { indexerKnowledgeCollectionSchema, canonicalIndexerNodeRef, indexerLayoutArtifactRef, indexerLayoutViewRef } from "@c4a/context";
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
  const identity = page.path.replace(/\.md$/u, "");
  const nodeRef = canonicalIndexerNodeRef({ protocol: "context.subject-key/v1", namespace: collection,
    kind: "entity", local_key: identity.slice(collection.length + 1) });
  const artifactRef = indexerLayoutArtifactRef(nodeRef, { artifact_id: "main", artifact_kind: "content" });
  const target = { path: page.path, collection, node_ref: nodeRef, view_ref: indexerLayoutViewRef(artifactRef, collection),
    source_refs: page.source_refs, base_digest: null };
  const metadata = { title: page.title, type: okfTypeForCollection(collection), node_ref: target.node_ref,
    view_ref: target.view_ref, node_type: "entity", description: page.title, tags: [collection],
    timestamp: new Date().toISOString(), resource: `knowledge:${identity}`, sources: page.source_refs, visibility: "public" };
  return { ...target, markdown: `---\n${YAML.stringify(metadata)}---\n\n# ${page.title}\n` };
}
