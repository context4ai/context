import type { EvidenceChunk, EvidenceContext, ProseAlignRunOptions } from "./proseAlignTypes.js";

export function filteredChunks(evidence: EvidenceContext, options: ProseAlignRunOptions): EvidenceChunk[] {
  let chunks = [...evidence.chunks];
  if (options.source !== undefined) {
    chunks = chunks.filter((chunk) => chunk.document_path === options.source || chunk.locator === options.source);
  }
  if (options.chunk !== undefined) {
    chunks = chunks.filter((chunk) => chunk.chunk_id === options.chunk);
  }
  return chunks;
}
