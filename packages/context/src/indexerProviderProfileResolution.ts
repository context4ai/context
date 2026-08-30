import type { IndexerProviderManifest } from "./indexerProvider.js";
import type {
  IndexerProfileContract,
  IndexerProfileContractEntry,
} from "./indexerProfileContract.js";
import type { IndexerRegistryEntry } from "./indexerRegistry.js";
import { compareIndexerCanonicalText } from "./indexerProtocolCommon.js";

export interface IndexerResolvedCompositionLayer {
  layer_id: string;
  provider_integrity: string;
  manifest_digest: string;
  manifest: IndexerProviderManifest;
}

export interface IndexerActiveCompositionProfile {
  id: string;
  kind: "primary" | "supporting" | "extension";
  provider_layer_id: string;
  variants: Record<string, string>;
}

type ProfileVariantSchema = Pick<
  IndexerProfileContractEntry,
  "variant_schema"
>["variant_schema"];

function profileKey(profile: { id: string; provider_layer_id: string }): string {
  return `${profile.id}\u0000${profile.provider_layer_id}`;
}

function canonicalVariants(
  value: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {}).sort(([left], [right]) =>
      compareIndexerCanonicalText(left, right)
    ),
  );
}

function assertProfileVariants(input: {
  profile: string;
  variants: Readonly<Record<string, string>> | undefined;
  schema: ProfileVariantSchema | undefined;
  authority: string;
}): Record<string, string> {
  const variants = canonicalVariants(input.variants);
  const axes = input.schema?.axes ?? [];
  const axisById = new Map(axes.map((axis) => [axis.id, axis]));
  for (const [axisId, value] of Object.entries(variants)) {
    const axis = axisById.get(axisId);
    if (axis === undefined) {
      throw new TypeError(
        `profile ${input.profile} variant axis ${axisId} is not registered by ${input.authority}`,
      );
    }
    if (!axis.values.includes(value)) {
      throw new TypeError(
        `profile ${input.profile} variant ${axisId}=${value} is not registered by ${input.authority}`,
      );
    }
  }
  const missing = axes.find((axis) =>
    axis.required && variants[axis.id] === undefined
  );
  if (missing !== undefined) {
    throw new TypeError(
      `profile ${input.profile} is missing required variant axis ${missing.id}`,
    );
  }
  return variants;
}

export function resolveIndexerActiveCompositionProfiles(input: {
  indexer: IndexerRegistryEntry;
  resolvedByLayer: ReadonlyMap<string, IndexerResolvedCompositionLayer>;
  profileContract: IndexerProfileContract;
}): IndexerActiveCompositionProfile[] {
  const activeProfiles: IndexerActiveCompositionProfile[] = [
    {
      id: input.indexer.profile.primary.id,
      kind: "primary" as const,
      provider_layer_id: input.indexer.profile.primary.provider,
      variants: canonicalVariants(input.indexer.profile.primary.variants),
    },
    ...(input.indexer.profile.additional ?? []).map(
      (profile): IndexerActiveCompositionProfile => ({
      id: profile.id,
      kind: profile.kind,
      provider_layer_id: profile.provider,
      variants: canonicalVariants(profile.variants),
      }),
    ),
  ].sort((left, right) =>
    compareIndexerCanonicalText(profileKey(left), profileKey(right))
  );
  if (new Set(activeProfiles.map((profile) => profile.id)).size !== activeProfiles.length) {
    throw new TypeError("active profile identities must be unique");
  }
  for (const profile of activeProfiles) {
    const layer = input.indexer.providers.find((candidate) =>
      candidate.id === profile.provider_layer_id
    )!;
    const manifest = input.resolvedByLayer.get(layer.id)!.manifest;
    if (!manifest.provides.profiles.includes(profile.id)) {
      throw new TypeError(`profile ${profile.id} is not provided by layer ${layer.id}`);
    }
    if (profile.kind !== "extension" && layer.role !== "primary") {
      throw new TypeError("primary/supporting profiles require the primary layer");
    }
    if (profile.kind === "extension") {
      const extension = manifest.composition?.extensions.find((candidate) =>
        candidate.profile === profile.id
      );
      if (
        layer.role !== "extension" ||
        extension === undefined ||
        !activeProfiles.some((candidate) =>
          candidate.kind !== "extension" && candidate.id === extension.extends
        )
      ) {
        throw new TypeError("extension profile lacks one active base-profile binding");
      }
      profile.variants = assertProfileVariants({
        profile: profile.id,
        variants: profile.variants,
        schema: extension.variant_schema,
        authority: `Provider layer ${layer.id}`,
      });
    } else {
      const contractProfile = input.profileContract.profiles.find((candidate) =>
        candidate.id === profile.id
      );
      if (contractProfile === undefined) {
        throw new TypeError(
          `community profile ${profile.id} has no CLI base-contract variant authority`,
        );
      }
      profile.variants = assertProfileVariants({
        profile: profile.id,
        variants: profile.variants,
        schema: contractProfile.variant_schema,
        authority: "CLI base profile contract",
      });
    }
  }
  return activeProfiles;
}
