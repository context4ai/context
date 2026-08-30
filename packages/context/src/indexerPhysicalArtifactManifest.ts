import { Buffer } from "node:buffer";
import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const logicalUnitOwnerSchema = z.object({
  kind: z.literal("logical-unit"),
  logical_unit_ref: indexerCanonicalRefSchema,
  node_ref: indexerCanonicalRefSchema,
  artifact_ref: indexerCanonicalRefSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  bundle_digest: indexerDigestSchema,
  purpose: z.enum(["required", "discretionary", "semantic-split"]),
  split_of: indexerIdSchema.nullable(),
  section_refs: z.array(indexerCanonicalRefSchema).min(1),
  material_state: z.enum(["ready", "blocked"]),
}).strict();

const navigationOwnerSchema = z.object({
  kind: z.literal("navigation"),
  navigation_ref: indexerCanonicalRefSchema,
  artifact_ref: indexerCanonicalRefSchema,
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  plan_digest: indexerDigestSchema,
  child_artifact_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const orphanOwnerSchema = z.object({
  kind: z.literal("orphan"),
  reason: z.literal("unregistered-output-path"),
}).strict();

export const indexerPhysicalArtifactOwnerSchema = z.discriminatedUnion("kind", [
  logicalUnitOwnerSchema,
  navigationOwnerSchema,
  orphanOwnerSchema,
]);

const physicalArtifactManifestEntrySchema = z.object({
  physical_ref: indexerCanonicalRefSchema,
  output_path: portableIndexerPathSchema,
  markdown_digest: indexerDigestSchema,
  byte_count: z.number().int().nonnegative(),
  reader_body_line_count: z.number().int().nonnegative(),
  empty: z.boolean(),
  owner: indexerPhysicalArtifactOwnerSchema,
}).strict();

const artifactManifestPayloadSchema = z.object({
  protocol: z.literal("context.indexer.artifact-manifest/v1"),
  layout_proposal_set_digest: indexerDigestSchema,
  files: z.array(physicalArtifactManifestEntrySchema),
}).strict();

export const indexerArtifactManifestSchema = artifactManifestPayloadSchema.extend({
  manifest_digest: indexerDigestSchema,
}).strict();

export type IndexerPhysicalArtifactOwner = z.infer<typeof indexerPhysicalArtifactOwnerSchema>;
export type IndexerPhysicalArtifactManifestEntry = z.infer<typeof physicalArtifactManifestEntrySchema>;
export type IndexerArtifactManifest = z.infer<typeof indexerArtifactManifestSchema>;

export interface IndexerPhysicalArtifactRegistration {
  output_path: string;
  owner: Exclude<IndexerPhysicalArtifactOwner, { kind: "orphan" }>;
}

export interface IndexerPhysicalArtifactFileInput {
  output_path: string;
  markdown: string;
}

function withoutManifestDigest(
  value: IndexerArtifactManifest,
): Omit<IndexerArtifactManifest, "manifest_digest"> {
  const { manifest_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function normalizedReaderBody(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/u, "").replace(/\r\n?|\n/gu, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.slice(1).findIndex((line) => {
      const trimmed = line.trim();
      return trimmed === "---" || trimmed === "...";
    });
    if (end >= 0) lines.splice(0, end + 2);
  }
  return lines.join("\n").replace(/<!--[\s\S]*?-->/gu, "").trim();
}

function isReaderContentLine(line: string): boolean {
  const value = line.trim();
  if (value.length === 0) return false;
  if (/^#{1,6}(?:\s+.*)?$/u.test(value)) return false;
  if (/^(?:`{3,}|~{3,})(?:[^`]*)?$/u.test(value)) return false;
  if (/^(?:[-=_*]\s*){3,}$/u.test(value)) return false;
  if (/^(?:[-+*]|>)\s*$/u.test(value)) return false;
  return true;
}

function fileMetrics(markdown: string): {
  markdownDigest: string;
  byteCount: number;
  readerBodyLineCount: number;
  empty: boolean;
} {
  const readerBody = normalizedReaderBody(markdown);
  const lines = readerBody.length === 0 ? [] : readerBody.split("\n");
  return {
    markdownDigest: indexerProtocolDigest({
      protocol: "context.indexer.physical-markdown/v1",
      markdown,
    }),
    byteCount: Buffer.byteLength(markdown, "utf8"),
    readerBodyLineCount: lines.length,
    empty: !lines.some(isReaderContentLine),
  };
}

function physicalRef(outputPath: string, markdownDigest: string): string {
  return `physical-artifact:${indexerProtocolDigest({
    protocol: "context.indexer.physical-artifact-identity/v1",
    output_path: outputPath,
    markdown_digest: markdownDigest,
  })}`;
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must be unique`);
  }
}

export function buildIndexerArtifactManifest(input: {
  layout_proposal_set_digest: string;
  registrations: readonly IndexerPhysicalArtifactRegistration[];
  files: readonly IndexerPhysicalArtifactFileInput[];
}): IndexerArtifactManifest {
  const registrations = input.registrations.map((registration) => ({
    output_path: portableIndexerPathSchema.parse(registration.output_path),
    owner: indexerPhysicalArtifactOwnerSchema.parse(registration.owner),
  }));
  assertUnique(registrations.map((registration) => registration.output_path), "registered Artifact paths");
  assertUnique(input.files.map((file) => file.output_path), "physical Artifact file paths");
  const ownerByPath = new Map(registrations.map((registration) => [
    registration.output_path,
    registration.owner,
  ]));
  const files = input.files.map((file) => {
    const outputPath = portableIndexerPathSchema.parse(file.output_path);
    const metrics = fileMetrics(file.markdown);
    return physicalArtifactManifestEntrySchema.parse({
      physical_ref: physicalRef(outputPath, metrics.markdownDigest),
      output_path: outputPath,
      markdown_digest: metrics.markdownDigest,
      byte_count: metrics.byteCount,
      reader_body_line_count: metrics.readerBodyLineCount,
      empty: metrics.empty,
      owner: ownerByPath.get(outputPath) ?? {
        kind: "orphan",
        reason: "unregistered-output-path",
      },
    });
  }).sort((left, right) => compareIndexerCanonicalText(left.output_path, right.output_path));
  const payload = artifactManifestPayloadSchema.parse({
    protocol: "context.indexer.artifact-manifest/v1",
    layout_proposal_set_digest: input.layout_proposal_set_digest,
    files,
  });
  return indexerArtifactManifestSchema.parse({
    ...payload,
    manifest_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerArtifactManifest(value: unknown): IndexerArtifactManifest {
  const manifest = indexerArtifactManifestSchema.parse(value);
  if (indexerProtocolDigest(withoutManifestDigest(manifest)) !== manifest.manifest_digest) {
    throw new TypeError("Artifact manifest digest is invalid");
  }
  const sorted = [...manifest.files].sort((left, right) =>
    compareIndexerCanonicalText(left.output_path, right.output_path)
  );
  assertUnique(sorted.map((file) => file.output_path), "Artifact manifest paths");
  assertUnique(sorted.map((file) => file.physical_ref), "Artifact manifest physical refs");
  if (sorted.some((file) => file.physical_ref !== physicalRef(file.output_path, file.markdown_digest))) {
    throw new TypeError("Artifact manifest contains a forged physical ref");
  }
  if (canonicalIndexerJson(sorted) !== canonicalIndexerJson(manifest.files)) {
    throw new TypeError("Artifact manifest is not canonically ordered");
  }
  return manifest;
}
