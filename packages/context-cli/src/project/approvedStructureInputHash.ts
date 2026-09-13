import { createHash } from "node:crypto";

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

export function approvedStructureInputHash(input: {
  schemaVersion: string;
  files: readonly ApprovedStructureInputFile[];
  metadata?: readonly Record<string, unknown>[];
}): string {
  return stableHash({
    schema_version: input.schemaVersion,
    files: [...input.files]
      .map((file) => ({ path: file.path, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    metadata: [...(input.metadata ?? [])]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}
