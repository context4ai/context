import {
  indexerProtocolDigest,
  indexerSemverSchema,
} from "@c4a/context";
import { z } from "zod";

export const INDEXER_RELEASE_CAPABILITIES = [
  "host-action-v2",
  "provider-lifecycle",
  "code-indexer",
  "markdown-indexer",
  "enterprise-overlay-trust",
  "phase-g-cutover",
] as const;

export type IndexerReleaseCapability = typeof INDEXER_RELEASE_CAPABILITIES[number];

const capabilityMilestones: Readonly<Record<IndexerReleaseCapability, string>> = {
  "host-action-v2": "0.7.0-preview.1",
  "provider-lifecycle": "0.7.0-preview.1",
  "code-indexer": "0.7.0-preview.2",
  "markdown-indexer": "0.7.0-preview.3",
  "enterprise-overlay-trust": "0.7.0-rc.1",
  "phase-g-cutover": "0.7.0",
};

const capabilityEntrySchema = z.object({
  id: z.enum(INDEXER_RELEASE_CAPABILITIES),
  state: z.enum(["ready", "not-ready"]),
  required_milestone: indexerSemverSchema,
}).strict();

const capabilityManifestPayloadSchema = z.object({
  protocol: z.literal("context.indexer.release-capability-manifest/v1"),
  package: z.literal("@c4a/context-cli"),
  version: indexerSemverSchema,
  channel: z.enum(["development", "preview", "rc", "latest"]),
  dist_tag: z.enum(["development", "preview", "rc", "latest"]),
  capabilities: z.array(capabilityEntrySchema).length(INDEXER_RELEASE_CAPABILITIES.length),
}).strict();

export const indexerReleaseCapabilityManifestSchema = capabilityManifestPayloadSchema.extend({
  manifest_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

export type IndexerReleaseCapabilityManifest = z.infer<
  typeof indexerReleaseCapabilityManifestSchema
>;

interface ReleaseStage {
  channel: IndexerReleaseCapabilityManifest["channel"];
  rank: number;
}

function releaseStage(version: string): ReleaseStage {
  if (version === "0.7.0") return { channel: "latest", rank: 5 };
  const preview = /^0\.7\.0-preview\.(\d+)$/u.exec(version);
  if (preview !== null) {
    return { channel: "preview", rank: Math.min(Number(preview[1]), 3) };
  }
  if (/^0\.7\.0-rc\.\d+$/u.test(version)) return { channel: "rc", rank: 4 };
  return { channel: "development", rank: Number.POSITIVE_INFINITY };
}

function capabilityRank(capability: IndexerReleaseCapability): number {
  if (capability === "host-action-v2" || capability === "provider-lifecycle") return 1;
  if (capability === "code-indexer") return 2;
  if (capability === "markdown-indexer") return 3;
  if (capability === "enterprise-overlay-trust") return 4;
  return 5;
}

export function buildIndexerReleaseCapabilityManifest(
  versionValue: string,
): IndexerReleaseCapabilityManifest {
  const version = indexerSemverSchema.parse(versionValue);
  const stage = releaseStage(version);
  const payload = capabilityManifestPayloadSchema.parse({
    protocol: "context.indexer.release-capability-manifest/v1",
    package: "@c4a/context-cli",
    version,
    channel: stage.channel,
    dist_tag: stage.channel,
    capabilities: INDEXER_RELEASE_CAPABILITIES.map((id) => ({
      id,
      state: stage.rank >= capabilityRank(id) ? "ready" : "not-ready",
      required_milestone: capabilityMilestones[id],
    })),
  });
  return indexerReleaseCapabilityManifestSchema.parse({
    ...payload,
    manifest_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerReleaseCapabilityManifest(
  value: unknown,
  expectedVersion?: string,
): IndexerReleaseCapabilityManifest {
  const manifest = indexerReleaseCapabilityManifestSchema.parse(value);
  const { manifest_digest: _digest, ...payload } = manifest;
  void _digest;
  if (indexerProtocolDigest(payload) !== manifest.manifest_digest) {
    throw new TypeError("release capability manifest digest is invalid");
  }
  const ids = manifest.capabilities.map((capability) => capability.id);
  if (
    ids.some((id, index) => id !== INDEXER_RELEASE_CAPABILITIES[index]) ||
    new Set(ids).size !== ids.length
  ) {
    throw new TypeError("release capability manifest is incomplete or reordered");
  }
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
    throw new TypeError("release capability manifest does not match the current CLI version");
  }
  return manifest;
}

export class IndexerFeatureNotReadyError extends Error {
  readonly code = "indexer-feature-not-ready";
  readonly feature: IndexerReleaseCapability;
  readonly releaseVersion: string;
  readonly requiredMilestone: string;

  constructor(input: {
    feature: IndexerReleaseCapability;
    releaseVersion: string;
    requiredMilestone: string;
  }) {
    super(
      `${input.feature} is not available in Context ${input.releaseVersion}; ` +
      `requires ${input.requiredMilestone}`,
    );
    this.name = "IndexerFeatureNotReadyError";
    this.feature = input.feature;
    this.releaseVersion = input.releaseVersion;
    this.requiredMilestone = input.requiredMilestone;
  }
}

export function assertIndexerReleaseCapabilityReady(
  manifestValue: unknown,
  feature: IndexerReleaseCapability,
): void {
  const manifest = validateIndexerReleaseCapabilityManifest(manifestValue);
  const capability = manifest.capabilities.find((item) => item.id === feature)!;
  if (capability.state !== "ready") {
    throw new IndexerFeatureNotReadyError({
      feature,
      releaseVersion: manifest.version,
      requiredMilestone: capability.required_milestone,
    });
  }
}

export function indexerBundleReleaseCapability(skill: string): IndexerReleaseCapability {
  if (skill === "context-code-indexer") return "code-indexer";
  if (skill === "context-markdown-indexer") return "markdown-indexer";
  throw new TypeError(`unknown CLI-bundled Indexer capability: ${skill}`);
}
