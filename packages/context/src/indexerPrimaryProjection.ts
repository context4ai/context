import { z } from "zod";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  buildIndexerSharedArtifactFingerprint,
  indexerSharedArtifactFingerprintSchema,
  validateIndexerSharedArtifactFingerprint,
} from "./indexerSharedArtifactFingerprint.js";
import {
  validateFinalizedIndexerRegistry,
  type IndexerJson,
  type IndexerRegistry,
  type IndexerRegistryEntry,
} from "./indexerRegistry.js";

const jsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ])
);

const jsonObjectSchema = z.record(jsonSchema);

export const indexerPrimaryRegistryProjectionSchema = z.object({
  protocol: z.literal("context.indexer.primary-registry-projection/v1"),
  indexer_id: indexerIdSchema,
  operation: z.literal("main-index"),
  requirement_bindings: z.array(jsonObjectSchema).min(1),
  read_scope: jsonObjectSchema,
  profile: z.object({
    primary: jsonObjectSchema,
    additional: z.array(jsonObjectSchema),
  }).strict(),
  provider_layers: z.array(jsonObjectSchema).min(1),
  customization: jsonObjectSchema.nullable(),
  projection_digest: indexerDigestSchema,
}).strict();

export type IndexerPrimaryRegistryProjection = z.infer<
  typeof indexerPrimaryRegistryProjectionSchema
>;

type PrimaryRegistryProjectionPayload = Omit<
  IndexerPrimaryRegistryProjection,
  "projection_digest"
>;

function primaryRegistryProjectionPayload(
  value: PrimaryRegistryProjectionPayload,
): PrimaryRegistryProjectionPayload {
  return {
    protocol: value.protocol,
    indexer_id: value.indexer_id,
    operation: value.operation,
    requirement_bindings: value.requirement_bindings,
    read_scope: value.read_scope,
    profile: value.profile,
    provider_layers: value.provider_layers,
    customization: value.customization,
  };
}

export function indexerPrimaryRegistryProjectionDigest(
  value: PrimaryRegistryProjectionPayload,
): string {
  return indexerProtocolDigest(primaryRegistryProjectionPayload(value));
}

function indexerEntry(registry: IndexerRegistry, indexerId: string): IndexerRegistryEntry {
  const entry = registry.indexers.find((candidate) => candidate.id === indexerId);
  if (entry === undefined) {
    throw new TypeError(`primary registry projection references unknown Indexer ${indexerId}`);
  }
  if (!entry.operations.includes("main-index")) {
    throw new TypeError(`Indexer ${indexerId} does not enable main-index`);
  }
  return entry;
}

function projectedProviderIds(
  entry: IndexerRegistryEntry,
  preAuthorityProviderIds: readonly string[],
): Set<string> {
  const known = new Set(entry.providers.map((provider) => provider.id));
  for (const providerId of preAuthorityProviderIds) {
    if (!known.has(providerId)) {
      throw new TypeError(`pre-authority selection references unknown Provider ${providerId}`);
    }
  }
  return new Set([
    entry.profile.primary.provider,
    ...(entry.profile.additional ?? []).map((profile) => profile.provider),
    ...preAuthorityProviderIds,
  ]);
}

function canonicalTargets<T extends { source_ref: string; module_refs: string[] }>(
  targets: readonly T[],
): T[] {
  return targets.map((target) => ({
    ...target,
    module_refs: [...target.module_refs].sort(compareIndexerCanonicalText),
  })).sort((left, right) =>
    compareIndexerCanonicalText(left.source_ref, right.source_ref)
  );
}

export function buildIndexerPrimaryRegistryProjection(input: {
  registry: IndexerRegistry;
  indexer_id: string;
  pre_authority_provider_ids?: readonly string[];
}): IndexerPrimaryRegistryProjection {
  validateFinalizedIndexerRegistry(input.registry);
  const entry = indexerEntry(input.registry, input.indexer_id);
  const providerIds = projectedProviderIds(
    entry,
    input.pre_authority_provider_ids ?? [],
  );
  const providerLayers = entry.providers
    .filter((provider) => providerIds.has(provider.id))
    .sort((left, right) => compareIndexerCanonicalText(left.id, right.id));
  const requirementBindings = entry.requirement_bindings.map((binding) => ({
    ...binding,
    coverage_domains: [...binding.coverage_domains].sort(compareIndexerCanonicalText),
    owned_scope: "ref" in binding.owned_scope
      ? binding.owned_scope
      : { targets: canonicalTargets(binding.owned_scope.targets) },
  })).sort((left, right) =>
    compareIndexerCanonicalText(indexerProtocolDigest(left), indexerProtocolDigest(right))
  );
  const additionalProfiles = [...(entry.profile.additional ?? [])].sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.provider}\u0000${left.id}\u0000${left.kind}`,
      `${right.provider}\u0000${right.id}\u0000${right.kind}`,
    )
  );
  const payload: PrimaryRegistryProjectionPayload = {
    protocol: "context.indexer.primary-registry-projection/v1",
    indexer_id: entry.id,
    operation: "main-index",
    requirement_bindings: requirementBindings as unknown as Record<
      string,
      IndexerJson
    >[],
    read_scope: {
      refs: [...entry.read_scope.refs].sort(compareIndexerCanonicalText),
      ...(entry.read_scope.extra_targets === undefined
        ? {}
        : { extra_targets: canonicalTargets(entry.read_scope.extra_targets) }),
    } as unknown as Record<string, IndexerJson>,
    profile: {
      primary: entry.profile.primary as unknown as Record<string, IndexerJson>,
      additional: additionalProfiles as unknown as Record<
        string,
        IndexerJson
      >[],
    },
    provider_layers: providerLayers as unknown as Record<string, IndexerJson>[],
    customization: (entry.customization ?? null) as Record<string, IndexerJson> | null,
  };
  return indexerPrimaryRegistryProjectionSchema.parse({
    ...payload,
    projection_digest: indexerPrimaryRegistryProjectionDigest(payload),
  });
}

export function validateIndexerPrimaryRegistryProjection(input: {
  projection: unknown;
  registry: IndexerRegistry;
  indexer_id: string;
  pre_authority_provider_ids?: readonly string[];
}): IndexerPrimaryRegistryProjection {
  const projection = indexerPrimaryRegistryProjectionSchema.parse(input.projection);
  if (
    indexerPrimaryRegistryProjectionDigest(projection) !== projection.projection_digest
  ) {
    throw new TypeError("primary registry projection digest is invalid");
  }
  const expected = buildIndexerPrimaryRegistryProjection(input);
  if (projection.projection_digest !== expected.projection_digest) {
    throw new TypeError("primary registry projection does not match the current registry");
  }
  return projection;
}

const primaryResourceBindingSchema = z.object({
  layer_ref: z.string().min(1),
  phase: z.enum(["primary", "pre-authority"]),
  kind: indexerIdSchema,
  ref: z.string().min(1),
  digest: indexerDigestSchema,
}).strict();

export const indexerPrimaryExecutionProjectionSchema = z.object({
  protocol: z.literal("context.indexer.primary-execution-projection/v1"),
  indexer_id: indexerIdSchema,
  primary_registry_projection_digest: indexerDigestSchema,
  program_digest: indexerDigestSchema.nullable(),
  instructions_digest: indexerDigestSchema,
  template_set_digest: indexerDigestSchema,
  config_digest: indexerDigestSchema,
  cli_contract_digest: indexerDigestSchema,
  profile_contract_digest: indexerDigestSchema,
  resources: z.array(primaryResourceBindingSchema),
  primary_resource_binding_digest: indexerDigestSchema,
  shared_artifact_fingerprint: indexerSharedArtifactFingerprintSchema,
  primary_execution_fingerprint: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.resources.map((resource) =>
      `${resource.layer_ref}\u0000${resource.phase}\u0000${resource.kind}\u0000${resource.ref}`
    ),
    context,
    "resources",
  );
});

export type IndexerPrimaryExecutionProjection = z.infer<
  typeof indexerPrimaryExecutionProjectionSchema
>;

type PrimaryResourceBinding = z.infer<typeof primaryResourceBindingSchema>;
type PrimaryExecutionProjectionPayload = Omit<
  IndexerPrimaryExecutionProjection,
  "primary_execution_fingerprint"
>;

function resourceKey(resource: PrimaryResourceBinding): string {
  return [resource.layer_ref, resource.phase, resource.kind, resource.ref].join("\u0000");
}

function canonicalResources(
  resources: readonly PrimaryResourceBinding[],
): PrimaryResourceBinding[] {
  const sorted = [...resources].sort((left, right) =>
    compareIndexerCanonicalText(resourceKey(left), resourceKey(right))
  );
  if (new Set(sorted.map(resourceKey)).size !== sorted.length) {
    throw new TypeError("primary resources must not contain duplicate identities");
  }
  return sorted;
}

export function indexerPrimaryResourceBindingDigest(
  resources: readonly PrimaryResourceBinding[],
): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.primary-resource-binding/v1",
    resources,
  });
}

function primaryExecutionPayload(
  value: PrimaryExecutionProjectionPayload,
): PrimaryExecutionProjectionPayload {
  return {
    protocol: value.protocol,
    indexer_id: value.indexer_id,
    primary_registry_projection_digest: value.primary_registry_projection_digest,
    program_digest: value.program_digest,
    instructions_digest: value.instructions_digest,
    template_set_digest: value.template_set_digest,
    config_digest: value.config_digest,
    cli_contract_digest: value.cli_contract_digest,
    profile_contract_digest: value.profile_contract_digest,
    resources: value.resources,
    primary_resource_binding_digest: value.primary_resource_binding_digest,
    shared_artifact_fingerprint: value.shared_artifact_fingerprint,
  };
}

export function indexerPrimaryExecutionFingerprint(
  value: PrimaryExecutionProjectionPayload,
): string {
  return indexerProtocolDigest(primaryExecutionPayload(value));
}

export function buildIndexerPrimaryExecutionProjection(input: {
  indexer_id: string;
  primary_registry_projection_digest: string;
  program_digest: string | null;
  instructions_digest: string;
  template_set_digest: string;
  config_digest: string;
  cli_contract_digest: string;
  profile_contract_digest: string;
  resources: readonly PrimaryResourceBinding[];
}): IndexerPrimaryExecutionProjection {
  const resources = canonicalResources(input.resources);
  const payload: PrimaryExecutionProjectionPayload = {
    protocol: "context.indexer.primary-execution-projection/v1",
    indexer_id: input.indexer_id,
    primary_registry_projection_digest: input.primary_registry_projection_digest,
    program_digest: input.program_digest,
    instructions_digest: input.instructions_digest,
    template_set_digest: input.template_set_digest,
    config_digest: input.config_digest,
    cli_contract_digest: input.cli_contract_digest,
    profile_contract_digest: input.profile_contract_digest,
    resources,
    primary_resource_binding_digest: indexerPrimaryResourceBindingDigest(resources),
    shared_artifact_fingerprint: buildIndexerSharedArtifactFingerprint(input),
  };
  return indexerPrimaryExecutionProjectionSchema.parse({
    ...payload,
    primary_execution_fingerprint: indexerPrimaryExecutionFingerprint(payload),
  });
}

export function validateIndexerPrimaryExecutionProjection(
  value: unknown,
): IndexerPrimaryExecutionProjection {
  const projection = indexerPrimaryExecutionProjectionSchema.parse(value);
  const resources = canonicalResources(projection.resources);
  const sharedFingerprint = validateIndexerSharedArtifactFingerprint(
    projection.shared_artifact_fingerprint,
  );
  if (
    resources.some((resource, index) =>
      resourceKey(resource) !== resourceKey(projection.resources[index]!)
    )
  ) {
    throw new TypeError("primary resources must use canonical ordering");
  }
  if (
    indexerPrimaryResourceBindingDigest(resources) !==
      projection.primary_resource_binding_digest
  ) {
    throw new TypeError("primary resource binding digest is invalid");
  }
  const expectedSharedFingerprint = buildIndexerSharedArtifactFingerprint({
    indexer_id: projection.indexer_id,
    program_digest: projection.program_digest,
    instructions_digest: projection.instructions_digest,
    template_set_digest: projection.template_set_digest,
  });
  if (
    sharedFingerprint.fingerprint_digest !==
      expectedSharedFingerprint.fingerprint_digest
  ) {
    throw new TypeError("primary execution shared Artifact fingerprint is invalid");
  }
  if (
    indexerPrimaryExecutionFingerprint(projection) !==
      projection.primary_execution_fingerprint
  ) {
    throw new TypeError("primary execution fingerprint is invalid");
  }
  return projection;
}
