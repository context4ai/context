import { createHash } from "node:crypto";
import type { ApprovedStructureSourceInput } from "./approvedStructureInputs.js";

export interface ApprovedStructureInputFile {
  path: string;
  sha256: string;
}

function stableHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function edgeHashRecord(edge: Record<string, unknown>): Record<string, unknown> {
  return {
    type: edge.type,
    from: edge.from,
    to: edge.to,
    source_refs: Array.isArray(edge.source_refs) ? edge.source_refs : [],
    ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
    ...(edge.note !== undefined ? { note: edge.note } : {}),
  };
}

function edgeHashKey(edge: Record<string, unknown>): string {
  return JSON.stringify(edgeHashRecord(edge));
}

export function approvedStructureInputHash(input: {
  schemaVersion: string;
  files: readonly ApprovedStructureInputFile[];
  edges: readonly Record<string, unknown>[];
  sourceInputs: readonly ApprovedStructureSourceInput[];
}): string {
  const edgeByKey = new Map<string, Record<string, unknown>>();
  for (const edge of input.edges.map(edgeHashRecord)) {
    edgeByKey.set(edgeHashKey(edge), edge);
  }
  return stableHash({
    schema_version: input.schemaVersion,
    files: [...input.files]
      .map((file) => ({ path: file.path, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    edges: [...edgeByKey.values()]
      .sort((left, right) => edgeHashKey(left).localeCompare(edgeHashKey(right))),
    source_inputs: [...input.sourceInputs]
      .map((sourceInput) => ({
        source: sourceInput.source,
        collection: sourceInput.collection,
        snapshot_hash: sourceInput.snapshot_hash,
      }))
      .sort((left, right) =>
        left.source.localeCompare(right.source) || left.collection.localeCompare(right.collection)
      ),
  });
}
