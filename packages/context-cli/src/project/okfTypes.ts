import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "@c4a/context";
import { matchesKnowledgePattern } from "./knowledgePathPatterns.js";

export { KNOWLEDGE_COLLECTIONS };

export type OkfOutputRoot = "wikis" | "guides" | "rules" | "feats";

const OKF_TYPE_BY_COLLECTION: Record<KnowledgeCollection, string> = {
  codeindex: "Wiki",
  codegraph: "Wiki",
  business: "Wiki",
  product: "Wiki",
  architecture: "Guide",
  sop: "Guide",
  faq: "Guide",
  standards: "Rule",
  decision: "Guide",
  incident: "Guide",
  test: "Rule",
  feats: "Feature",
};

const OKF_ROOT_BY_COLLECTION: Record<KnowledgeCollection, OkfOutputRoot> = {
  codeindex: "wikis",
  codegraph: "wikis",
  business: "wikis",
  product: "wikis",
  architecture: "guides",
  sop: "guides",
  faq: "guides",
  standards: "rules",
  decision: "guides",
  incident: "guides",
  test: "rules",
  feats: "feats",
};

export function isKnowledgeCollection(value: string | undefined): value is KnowledgeCollection {
  return value !== undefined && (KNOWLEDGE_COLLECTIONS as readonly string[]).includes(value);
}

export function okfTypeForCollection(collection: KnowledgeCollection): string {
  return OKF_TYPE_BY_COLLECTION[collection];
}

export function okfRootForCollection(collection: KnowledgeCollection): OkfOutputRoot {
  return OKF_ROOT_BY_COLLECTION[collection];
}

/** Package path of an approved article. A package's `rules.exclude` ships matching
 * rule articles under `guides/` instead of `rules/`. */
export function okfPackagePathForKnowledgePath(relPath: string, rules?: { exclude?: readonly string[] }): string {
  const parts = relPath.split(/[\\/]+/u).filter(Boolean);
  const hasKnowledgeRoot = parts[0] === "knowledge";
  const collection = hasKnowledgeRoot ? parts[1] : parts[0];
  if (!isKnowledgeCollection(collection)) return relPath;
  const rest = hasKnowledgeRoot ? parts.slice(2) : parts.slice(1);
  let root = okfRootForCollection(collection);
  if (root === "rules" && matchesKnowledgePattern([collection, ...rest].join("/"), rules?.exclude)) root = "guides";
  return root === collection
    ? [root, ...rest].join("/")
    : [root, collection, ...rest].join("/");
}

export function okfTypeForKnowledgePath(relPath: string): string | null {
  const parts = relPath.split(/[\\/]+/u);
  const collection = parts[0] === "knowledge" ? parts[1] : parts[0];
  return isKnowledgeCollection(collection) ? okfTypeForCollection(collection) : null;
}
