import { z } from "zod";
import { indexerProviderLayerRefSchema } from "./indexerLayerComposition.js";
import {
  indexerPartitionStrategySetDigest,
  type IndexerPartitionStrategy,
} from "./indexerPartitionPlan.js";
import { indexerProviderManifestSchema } from "./indexerProvider.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";

const projectStrategyRefSchema = z.object({
  kind: z.literal("project-indexer"),
  indexer_id: indexerIdSchema,
  strategy_id: indexerIdSchema,
  implementation_digest: indexerDigestSchema,
}).strict();

const cliStrategyRefSchema = z.object({
  kind: z.literal("cli-builtin"),
  strategy_id: indexerIdSchema,
  implementation_digest: indexerDigestSchema,
}).strict();

const providerAuthoritySchema = z.object({
  kind: z.literal("verified-provider"),
  provider_layer_ref: indexerProviderLayerRefSchema,
  provider_id: indexerIdSchema,
  provider_version: indexerSemverSchema,
  provider_integrity: indexerDigestSchema,
  provider_bundle_digest: indexerDigestSchema,
  manifest_digest: indexerDigestSchema,
}).strict();

const customizationAuthoritySchema = z.object({
  kind: z.literal("local-customization"),
  customization_fingerprint: indexerDigestSchema,
  base_provider_integrity: indexerDigestSchema,
}).strict();

const cliAuthoritySchema = z.object({
  kind: z.literal("cli-release"),
  cli_release_digest: indexerDigestSchema,
}).strict();

const commonEntryFields = {
  order: z.number().int().nonnegative(),
  declared_priority: z.number().int().nonnegative(),
  strategy_digest: indexerDigestSchema,
};

const providerEntrySchema = z.object({
  ...commonEntryFields,
  source: z.literal("provider"),
  strategy_ref: projectStrategyRefSchema,
  authority: providerAuthoritySchema,
}).strict();

const customizationEntrySchema = z.object({
  ...commonEntryFields,
  source: z.literal("local-customization"),
  strategy_ref: projectStrategyRefSchema,
  authority: customizationAuthoritySchema,
}).strict();

const cliEntrySchema = z.object({
  ...commonEntryFields,
  source: z.literal("cli-builtin"),
  strategy_ref: cliStrategyRefSchema,
  authority: cliAuthoritySchema,
}).strict();

export const indexerResolvedPartitionStrategySchema = z.discriminatedUnion("source", [
  providerEntrySchema,
  customizationEntrySchema,
  cliEntrySchema,
]);

export const indexerPartitionStrategyResolutionSchema = z.object({
  protocol: z.literal("context.indexer.partition-strategy-resolution/v1"),
  indexer_id: indexerIdSchema,
  indexer_fingerprint: indexerDigestSchema,
  registry_projection_digest: indexerDigestSchema,
  selected_profile_ids: z.array(indexerIdSchema).min(1),
  provider_integrity: indexerDigestSchema,
  customization_fingerprint: indexerDigestSchema.nullable(),
  strategies: z.array(indexerResolvedPartitionStrategySchema).min(1),
  strategy_set_digest: indexerDigestSchema,
  resolution_digest: indexerDigestSchema,
}).strict();

export type IndexerResolvedPartitionStrategy = z.infer<
  typeof indexerResolvedPartitionStrategySchema
>;
export type IndexerPartitionStrategyResolution = z.infer<
  typeof indexerPartitionStrategyResolutionSchema
>;
type WithoutOrder<T> = T extends unknown ? Omit<T, "order"> : never;
type IndexerPartitionStrategyCandidate = WithoutOrder<IndexerResolvedPartitionStrategy>;

export interface IndexerLocalPartitionStrategyDeclaration {
  strategy_id: string;
  profiles: readonly string[];
  priority: number;
  implementation_digest: string;
}

export interface IndexerCliPartitionStrategyDeclaration {
  strategy_id: string;
  priority: number;
  implementation_digest: string;
}

export const INDEXER_CATALOG_FALLBACK_STRATEGY_ID = "catalog-fallback";

export function indexerCatalogFallbackImplementationDigest(
  cliReleaseDigest: string,
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.catalog-fallback-implementation/v1",
    cli_release_digest: indexerDigestSchema.parse(cliReleaseDigest),
  });
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

function sourceRank(source: IndexerResolvedPartitionStrategy["source"]): number {
  return source === "cli-builtin" ? 1 : 0;
}

function strategySortKey(strategy: Pick<
  IndexerResolvedPartitionStrategy,
  "source" | "declared_priority" | "strategy_ref"
>): string {
  return [
    sourceRank(strategy.source),
    strategy.declared_priority.toString().padStart(16, "0"),
    strategy.strategy_ref.strategy_id,
    strategy.source,
  ].join("\u0000");
}

function strategyDigest(input: Pick<
  IndexerResolvedPartitionStrategy,
  "strategy_ref" | "authority"
>): string {
  return indexerProtocolDigest({
    strategy_ref: input.strategy_ref,
    authority: input.authority,
  });
}

function resolutionPayload(
  value: IndexerPartitionStrategyResolution,
): Omit<IndexerPartitionStrategyResolution, "resolution_digest"> {
  const { resolution_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function assertLocalDeclarations(input: {
  declarations: readonly IndexerLocalPartitionStrategyDeclaration[];
  selectedProfiles: ReadonlySet<string>;
}): void {
  const ids = input.declarations.map((item) => indexerIdSchema.parse(item.strategy_id));
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("local partition strategy ids must be unique");
  }
  const priorityByProfile = new Map<string, Set<number>>();
  for (const declaration of input.declarations) {
    if (!Number.isSafeInteger(declaration.priority) || declaration.priority < 0) {
      throw new TypeError("local partition strategy priority must be a non-negative integer");
    }
    const profiles = canonicalUnique(declaration.profiles, "local strategy profiles");
    if (profiles.some((profile) => !input.selectedProfiles.has(profile))) {
      throw new TypeError("local partition strategy references an unselected profile");
    }
    for (const profile of profiles) {
      const priorities = priorityByProfile.get(profile) ?? new Set<number>();
      if (priorities.has(declaration.priority)) {
        throw new TypeError(`local partition strategy priority is ambiguous for ${profile}`);
      }
      priorities.add(declaration.priority);
      priorityByProfile.set(profile, priorities);
    }
    indexerDigestSchema.parse(declaration.implementation_digest);
  }
}

function providerImplementationDigest(input: {
  provider_bundle_digest: string;
  manifest_digest: string;
  strategy_id: string;
  profiles: readonly string[];
  priority: number;
}): string {
  return indexerProtocolDigest(input);
}

export function resolveIndexerPartitionStrategies(input: {
  indexer_id: string;
  indexer_fingerprint: string;
  registry_projection_digest: string;
  selected_profile_ids: readonly string[];
  provider: {
    layer_ref: unknown;
    id: string;
    version: string;
    integrity: string;
    bundle_digest: string;
    manifest_digest: string;
    manifest: unknown;
  };
  local_customization?: {
    fingerprint: string;
    strategies: readonly IndexerLocalPartitionStrategyDeclaration[];
  };
  cli_release_digest: string;
  cli_builtins: readonly IndexerCliPartitionStrategyDeclaration[];
}): IndexerPartitionStrategyResolution {
  const indexerId = indexerIdSchema.parse(input.indexer_id);
  const selectedProfiles = canonicalUnique(
    input.selected_profile_ids,
    "selected partition profiles",
  );
  const selectedProfileSet = new Set(selectedProfiles);
  const manifest = indexerProviderManifestSchema.parse(input.provider.manifest);
  if (manifest.id !== input.provider.id || manifest.version !== input.provider.version) {
    throw new TypeError("partition strategy Provider authority does not match its manifest");
  }
  if (selectedProfiles.some((profile) => !manifest.provides.profiles.includes(profile))) {
    throw new TypeError("partition strategy selection references a profile absent from Provider authority");
  }
  const providerAuthority = providerAuthoritySchema.parse({
    kind: "verified-provider",
    provider_layer_ref: input.provider.layer_ref,
    provider_id: input.provider.id,
    provider_version: input.provider.version,
    provider_integrity: input.provider.integrity,
    provider_bundle_digest: input.provider.bundle_digest,
    manifest_digest: input.provider.manifest_digest,
  });
  const local = input.local_customization;
  if (local !== undefined) {
    assertLocalDeclarations({
      declarations: local.strategies,
      selectedProfiles: selectedProfileSet,
    });
  }
  const localIds = new Set((local?.strategies ?? []).map((item) => item.strategy_id));
  const projectCandidates: IndexerPartitionStrategyCandidate[] = [];
  for (const declaration of local?.strategies ?? []) {
    if (!declaration.profiles.some((profile) => selectedProfileSet.has(profile))) continue;
    const strategyRef: IndexerPartitionStrategy = {
      kind: "project-indexer",
      indexer_id: indexerId,
      strategy_id: indexerIdSchema.parse(declaration.strategy_id),
      implementation_digest: indexerDigestSchema.parse(declaration.implementation_digest),
    };
    const authority = customizationAuthoritySchema.parse({
      kind: "local-customization",
      customization_fingerprint: local!.fingerprint,
      base_provider_integrity: input.provider.integrity,
    });
    projectCandidates.push({
      source: "local-customization",
      declared_priority: declaration.priority,
      strategy_ref: strategyRef,
      authority,
      strategy_digest: strategyDigest({ strategy_ref: strategyRef, authority }),
    });
  }
  for (const declaration of manifest.provides.partition_strategies ?? []) {
    if (
      localIds.has(declaration.id) ||
      !declaration.profiles.some((profile) => selectedProfileSet.has(profile))
    ) {
      continue;
    }
    const strategyRef: IndexerPartitionStrategy = {
      kind: "project-indexer",
      indexer_id: indexerId,
      strategy_id: declaration.id,
      implementation_digest: providerImplementationDigest({
        provider_bundle_digest: input.provider.bundle_digest,
        manifest_digest: input.provider.manifest_digest,
        strategy_id: declaration.id,
        profiles: declaration.profiles,
        priority: declaration.priority,
      }),
    };
    projectCandidates.push({
      source: "provider",
      declared_priority: declaration.priority,
      strategy_ref: strategyRef,
      authority: providerAuthority,
      strategy_digest: strategyDigest({
        strategy_ref: strategyRef,
        authority: providerAuthority,
      }),
    });
  }
  const cliIds = input.cli_builtins.map((item) => indexerIdSchema.parse(item.strategy_id));
  if (new Set(cliIds).size !== cliIds.length) {
    throw new TypeError("CLI builtin partition strategy ids must be unique");
  }
  if (cliIds.includes(INDEXER_CATALOG_FALLBACK_STRATEGY_ID)) {
    throw new TypeError("catalog-fallback is a reserved CLI partition strategy");
  }
  const projectIds = new Set(projectCandidates.map((item) => item.strategy_ref.strategy_id));
  if (cliIds.some((id) => projectIds.has(id))) {
    throw new TypeError("CLI builtin partition strategies cannot shadow project strategies");
  }
  const cliAuthority = cliAuthoritySchema.parse({
    kind: "cli-release",
    cli_release_digest: input.cli_release_digest,
  });
  const cliDeclarations = [...input.cli_builtins, {
    strategy_id: INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
    priority: Number.MAX_SAFE_INTEGER,
    implementation_digest: indexerCatalogFallbackImplementationDigest(
      input.cli_release_digest,
    ),
  }];
  const cliCandidates: IndexerPartitionStrategyCandidate[] =
    cliDeclarations.map((declaration) => {
      if (!Number.isSafeInteger(declaration.priority) || declaration.priority < 0) {
        throw new TypeError("CLI builtin partition priority must be a non-negative integer");
      }
      const strategyRef: IndexerPartitionStrategy = {
        kind: "cli-builtin",
        strategy_id: declaration.strategy_id,
        implementation_digest: indexerDigestSchema.parse(
          declaration.implementation_digest,
        ),
      };
      return {
        source: "cli-builtin",
        declared_priority: declaration.priority,
        strategy_ref: strategyRef,
        authority: cliAuthority,
        strategy_digest: strategyDigest({ strategy_ref: strategyRef, authority: cliAuthority }),
      };
    });
  const ordered = [...projectCandidates, ...cliCandidates].sort((left, right) =>
    compareIndexerCanonicalText(strategySortKey(left), strategySortKey(right))
  );
  if (ordered.length === 0) {
    throw new TypeError("partition strategy resolution produced no authorized strategy");
  }
  const strategies = ordered.map((strategy, order) =>
    indexerResolvedPartitionStrategySchema.parse({ ...strategy, order })
  );
  const strategySetDigest = indexerPartitionStrategySetDigest(strategies.map((strategy) => ({
    strategy_ref: strategy.strategy_ref,
    strategy_digest: strategy.strategy_digest,
  })));
  const payload: Omit<IndexerPartitionStrategyResolution, "resolution_digest"> = {
    protocol: "context.indexer.partition-strategy-resolution/v1",
    indexer_id: indexerId,
    indexer_fingerprint: indexerDigestSchema.parse(input.indexer_fingerprint),
    registry_projection_digest: indexerDigestSchema.parse(
      input.registry_projection_digest,
    ),
    selected_profile_ids: selectedProfiles,
    provider_integrity: providerAuthority.provider_integrity,
    customization_fingerprint: local === undefined
      ? null
      : indexerDigestSchema.parse(local.fingerprint),
    strategies,
    strategy_set_digest: strategySetDigest,
  };
  return validateIndexerPartitionStrategyResolution({
    ...payload,
    resolution_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerPartitionStrategyResolution(
  valueInput: unknown,
): IndexerPartitionStrategyResolution {
  const value = indexerPartitionStrategyResolutionSchema.parse(valueInput);
  if (
    canonicalIndexerJson(value.selected_profile_ids) !==
    canonicalIndexerJson(canonicalUnique(
      value.selected_profile_ids,
      "resolved selected_profile_ids",
    ))
  ) {
    throw new TypeError("resolved selected_profile_ids are not canonical");
  }
  const expected = [...value.strategies].sort((left, right) =>
    compareIndexerCanonicalText(strategySortKey(left), strategySortKey(right))
  );
  if (
    expected.some((strategy, index) => strategy !== value.strategies[index]) ||
    value.strategies.some((strategy, index) => strategy.order !== index)
  ) {
    throw new TypeError("resolved partition strategies do not follow project-first priority");
  }
  const fallbackEntries = value.strategies.filter((strategy) =>
    strategy.strategy_ref.strategy_id === INDEXER_CATALOG_FALLBACK_STRATEGY_ID
  );
  const fallback = fallbackEntries[0];
  if (
    fallbackEntries.length !== 1 ||
    fallback === undefined ||
    fallback !== value.strategies.at(-1) ||
    fallback.source !== "cli-builtin" ||
    fallback.declared_priority !== Number.MAX_SAFE_INTEGER ||
    fallback.strategy_ref.kind !== "cli-builtin" ||
    fallback.strategy_ref.implementation_digest !==
      indexerCatalogFallbackImplementationDigest(fallback.authority.cli_release_digest)
  ) {
    throw new TypeError("resolved partition strategies require one final CLI catalog-fallback");
  }
  const identities = value.strategies.map((strategy) =>
    canonicalIndexerJson(strategy.strategy_ref)
  );
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("resolved partition strategies contain duplicate identities");
  }
  const providerAuthorities = new Set<string>();
  const cliAuthorities = new Set<string>();
  for (const strategy of value.strategies) {
    if (strategy.strategy_digest !== strategyDigest(strategy)) {
      throw new TypeError("resolved partition strategy digest is invalid");
    }
    if (
      strategy.strategy_ref.kind === "project-indexer" &&
      strategy.strategy_ref.indexer_id !== value.indexer_id
    ) {
      throw new TypeError("resolved project strategy belongs to another Indexer");
    }
    if (strategy.source === "provider") {
      if (strategy.authority.provider_integrity !== value.provider_integrity) {
        throw new TypeError("resolved Provider strategy has inconsistent authority");
      }
      providerAuthorities.add(canonicalIndexerJson(strategy.authority));
    }
    if (strategy.source === "local-customization") {
      if (
        value.customization_fingerprint === null ||
        strategy.authority.customization_fingerprint !==
          value.customization_fingerprint ||
        strategy.authority.base_provider_integrity !== value.provider_integrity
      ) {
        throw new TypeError("resolved local strategy has inconsistent authority");
      }
    }
    if (strategy.source === "cli-builtin") {
      cliAuthorities.add(canonicalIndexerJson(strategy.authority));
    }
  }
  if (providerAuthorities.size > 1 || cliAuthorities.size > 1) {
    throw new TypeError("resolved strategy source uses multiple authorities");
  }
  const strategySetDigest = indexerPartitionStrategySetDigest(
    value.strategies.map((strategy) => ({
      strategy_ref: strategy.strategy_ref,
      strategy_digest: strategy.strategy_digest,
    })),
  );
  if (strategySetDigest !== value.strategy_set_digest) {
    throw new TypeError("resolved partition strategy set digest is invalid");
  }
  if (indexerProtocolDigest(resolutionPayload(value)) !== value.resolution_digest) {
    throw new TypeError("partition strategy resolution digest is invalid");
  }
  return value;
}

export function indexerAuthorizedPartitionStrategies(
  value: unknown,
): Array<{ strategy_ref: IndexerPartitionStrategy; strategy_digest: string }> {
  const resolution = validateIndexerPartitionStrategyResolution(value);
  return resolution.strategies.map((strategy) => ({
    strategy_ref: strategy.strategy_ref,
    strategy_digest: strategy.strategy_digest,
  }));
}
