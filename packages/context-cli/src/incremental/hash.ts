import { contentHash } from "@c4a/core";

const HASH_PREFIX = "sha256:";

export function toHashId(input: string | Buffer): string {
  return `${HASH_PREFIX}${contentHash(input)}`;
}

export function logicalRawHash(normalizedMarkdown: string): string {
  return toHashId(normalizedMarkdown);
}
