import type { KnowledgeCollection } from "@c4a/context";

export const CODE_INDEX_COLLECTION = "codeindex" as const;
export const LEGACY_CODE_INDEX_COLLECTION = "codegraph" as const;

export function isCodeIndexCollection(value: string): value is "codeindex" | "codegraph" {
  return value === CODE_INDEX_COLLECTION || value === LEGACY_CODE_INDEX_COLLECTION;
}

export function currentCodeIndexCollection(value: KnowledgeCollection): "codeindex" | "codegraph" {
  if (!isCodeIndexCollection(value)) throw new TypeError(`not a code-index collection: ${value}`);
  return value;
}
