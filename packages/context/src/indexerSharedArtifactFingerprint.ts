import { z } from "zod";
import {
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const sharedArtifactFingerprintPayloadSchema = z.object({
  protocol: z.literal("context.indexer.shared-artifact-fingerprint/v1"),
  indexer_id: indexerIdSchema,
  implementation_fingerprint: indexerDigestSchema,
  instructions_fingerprint: indexerDigestSchema,
  template_fingerprint: indexerDigestSchema,
}).strict();

export const indexerSharedArtifactFingerprintSchema =
  sharedArtifactFingerprintPayloadSchema.extend({
    fingerprint_digest: indexerDigestSchema,
  }).strict();

export type IndexerSharedArtifactFingerprint = z.infer<
  typeof indexerSharedArtifactFingerprintSchema
>;

export function indexerImplementationFingerprint(
  programDigest: string | null,
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.implementation-fingerprint/v1",
    program_digest: programDigest,
  });
}

export function buildIndexerSharedArtifactFingerprint(input: {
  indexer_id: string;
  program_digest: string | null;
  instructions_digest: string;
  template_set_digest: string;
}): IndexerSharedArtifactFingerprint {
  const payload = sharedArtifactFingerprintPayloadSchema.parse({
    protocol: "context.indexer.shared-artifact-fingerprint/v1",
    indexer_id: input.indexer_id,
    implementation_fingerprint: indexerImplementationFingerprint(
      input.program_digest,
    ),
    instructions_fingerprint: input.instructions_digest,
    template_fingerprint: input.template_set_digest,
  });
  return indexerSharedArtifactFingerprintSchema.parse({
    ...payload,
    fingerprint_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerSharedArtifactFingerprint(
  value: unknown,
): IndexerSharedArtifactFingerprint {
  const fingerprint = indexerSharedArtifactFingerprintSchema.parse(value);
  const expectedPayload = sharedArtifactFingerprintPayloadSchema.parse({
    protocol: fingerprint.protocol,
    indexer_id: fingerprint.indexer_id,
    implementation_fingerprint: fingerprint.implementation_fingerprint,
    instructions_fingerprint: fingerprint.instructions_fingerprint,
    template_fingerprint: fingerprint.template_fingerprint,
  });
  if (indexerProtocolDigest(expectedPayload) !== fingerprint.fingerprint_digest) {
    throw new TypeError("shared Artifact fingerprint digest is invalid");
  }
  return fingerprint;
}
