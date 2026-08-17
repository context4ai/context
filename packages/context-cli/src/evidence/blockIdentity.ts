import { logicalRawHash, toHashId } from "../incremental/hash.js";
import { normalizeMarkdown } from "../lib/normalize.js";

export type EvidenceKind = "md" | "note";

export interface CanonicalEvidenceBlockIdentity {
  block_id: string;
  duplicate_ordinal: number;
}

export function evidenceKindForSourceType(sourceType: string): EvidenceKind {
  return sourceType === "note" ? "note" : "md";
}

export function normalizedEvidenceBodyHash(value: string): string {
  return logicalRawHash(normalizeMarkdown(value).trim());
}

export function canonicalEvidenceBlockId(input: {
  sourceId: string;
  kind: EvidenceKind;
  normalizedHash: string;
  duplicateOrdinal: number;
}): string {
  const suffix = input.duplicateOrdinal > 1 ? `:${input.duplicateOrdinal}` : "";
  // 48 bits keeps ids compact for agent-facing payloads; revisit if a single
  // workspace approaches tens of millions of evidence blocks.
  return toHashId(`${input.sourceId}:${input.kind}:${input.normalizedHash}${suffix}`)
    .replace(/^sha256:/u, "")
    .slice(0, 12);
}

export function assignCanonicalEvidenceBlockIdentities<T extends { block_body_hash: string }>(input: {
  sourceId: string;
  kind: EvidenceKind;
  blocks: readonly T[];
}): Array<T & CanonicalEvidenceBlockIdentity> {
  const duplicateCounts = new Map<string, number>();
  return input.blocks.map((block) => {
    const duplicateOrdinal = (duplicateCounts.get(block.block_body_hash) ?? 0) + 1;
    duplicateCounts.set(block.block_body_hash, duplicateOrdinal);
    return {
      ...block,
      block_id: canonicalEvidenceBlockId({
        sourceId: input.sourceId,
        kind: input.kind,
        normalizedHash: block.block_body_hash,
        duplicateOrdinal,
      }),
      duplicate_ordinal: duplicateOrdinal,
    };
  });
}

export function canonicalEvidenceSpanHash(blocks: readonly Pick<CanonicalEvidenceBlockIdentity, "block_id">[]): string | null {
  if (blocks.length === 0) return null;
  if (blocks.length === 1) return blocks[0]!.block_id;
  return toHashId(blocks.map((block) => block.block_id).join("|"))
    .replace(/^sha256:/u, "")
    .slice(0, 12);
}
