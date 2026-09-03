import { z } from "zod";
import {
  validateIndexerCustomizationPlan,
  type IndexerCustomizationPlan,
} from "./indexerCustomizationLadder.js";
import {
  indexerComposerContractSchema,
  indexerProviderManifestSchema,
  indexerToolSourceDeclarationSchema,
  type IndexerComposerContract,
  type IndexerProviderManifest,
} from "./indexerProvider.js";
import {
  indexerProfileContractSchema,
  type IndexerProfileContract,
} from "./indexerProfileContract.js";
import {
  resolveIndexerActiveCompositionProfiles,
  type IndexerResolvedCompositionLayer,
} from "./indexerProviderProfileResolution.js";
import {
  indexerRegistryEntrySchema,
  type IndexerRegistryEntry,
} from "./indexerRegistry.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const skillOperationSchema = z.object({
  id: z.literal("main-index"),
  consumes: z.string().min(1),
  produces: z.string().min(1),
  accepts_layer_fragments: z.array(indexerIdSchema),
  supported_evidence_kinds: z.array(indexerIdSchema),
}).strict();

const skillLogicalUnitSchema = z.object({
  id: indexerIdSchema,
  identity: indexerIdSchema,
  recommended_artifacts: z.array(indexerIdSchema),
  supported_policy_variants: z.array(indexerIdSchema),
}).strict();

const skillToolSourceSchema = indexerToolSourceDeclarationSchema;

const skillCapabilityPayloadSchema = z.object({
  protocol: z.literal("context.indexer.skill-capability/v1"),
  skill: indexerIdSchema,
  version: indexerSemverSchema,
  domains: z.array(indexerIdSchema),
  profiles: z.array(indexerIdSchema),
  operations: z.array(skillOperationSchema),
  layer_fragments: z.array(z.object({
    kind: indexerIdSchema,
    phase: z.enum(["pre-authority", "post-author"]),
    produces: z.string().min(1),
  }).strict()),
  source_roles: z.array(indexerIdSchema),
  tool_sources: z.array(skillToolSourceSchema),
  logical_units: z.array(skillLogicalUnitSchema),
  composers: z.array(z.object({
    id: indexerIdSchema,
    supported_profiles: z.array(indexerIdSchema),
    contract: indexerComposerContractSchema.optional(),
  }).strict()),
  program_capabilities: z.array(indexerIdSchema),
  customization_capabilities: z.array(indexerIdSchema),
}).strict();

export const indexerSkillCapabilitySchema = skillCapabilityPayloadSchema.extend({
  capability_digest: indexerDigestSchema,
}).strict();

export type IndexerSkillCapability = z.infer<typeof indexerSkillCapabilitySchema>;

function uniqueSorted(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return sorted;
}

function skillCapabilityPayload(
  value: IndexerSkillCapability,
): Omit<IndexerSkillCapability, "capability_digest"> {
  const { capability_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function canonicalComposerContract(
  contract: IndexerComposerContract,
): IndexerComposerContract {
  return indexerComposerContractSchema.parse({
    ...contract,
    primary_requirements: {
      fact_kinds: uniqueSorted(
        contract.primary_requirements.fact_kinds,
        "composer primary fact kinds",
      ),
      artifact_kinds: uniqueSorted(
        contract.primary_requirements.artifact_kinds,
        "composer primary Artifact kinds",
      ),
    },
    derived_artifact_policy: {
      ...contract.derived_artifact_policy,
      artifact_kinds: uniqueSorted(
        contract.derived_artifact_policy.artifact_kinds,
        "composer derived Artifact kinds",
      ),
    },
  });
}

export function buildIndexerSkillCapability(
  value: IndexerProviderManifest,
): IndexerSkillCapability {
  const manifest = indexerProviderManifestSchema.parse(value);
  const payload = skillCapabilityPayloadSchema.parse({
    protocol: "context.indexer.skill-capability/v1",
    skill: manifest.id,
    version: manifest.version,
    domains: uniqueSorted(manifest.domains, "Skill domains"),
    profiles: uniqueSorted(manifest.provides.profiles, "Skill profiles"),
    operations: manifest.provides.operations.map((operation) => ({
      id: operation.id,
      consumes: operation.consumes,
      produces: operation.produces,
      accepts_layer_fragments: uniqueSorted(
        operation.accepts_layer_fragments ?? [],
        "accepted layer fragments",
      ),
      supported_evidence_kinds: [],
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    layer_fragments: (manifest.provides.layer_fragments ?? []).map((item) => ({
      kind: item.kind,
      phase: item.phase,
      produces: item.produces,
    })).sort((left, right) => compareIndexerCanonicalText(left.kind, right.kind)),
    source_roles: uniqueSorted(manifest.provides.source_roles ?? [], "source roles"),
    tool_sources: (manifest.provides.tool_sources ?? []).map((toolSource) => ({
      ...toolSource,
      operations: uniqueSorted(
        toolSource.operations,
        `tool source ${toolSource.id} operations`,
      ),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    logical_units: (manifest.provides.logical_units ?? []).map((item) => ({
      id: item.id,
      identity: item.identity,
      recommended_artifacts: uniqueSorted(
        item.artifacts?.recommended ?? [],
        `logical unit ${item.id} artifacts`,
      ),
      supported_policy_variants: uniqueSorted(
        item.artifacts?.supported_policy_variants ?? [],
        `logical unit ${item.id} policy variants`,
      ),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    composers: (manifest.provides.composers ?? []).map((item) => ({
      id: item.id,
      supported_profiles: uniqueSorted(
        item.supported_profiles,
        `composer ${item.id} profiles`,
      ),
      ...(item.contract === undefined
        ? {}
        : { contract: canonicalComposerContract(item.contract) }),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    program_capabilities: uniqueSorted(
      manifest.provider.program?.capabilities ?? [],
      "program capabilities",
    ),
    customization_capabilities: uniqueSorted(
      manifest.customization?.supports ?? [],
      "customization capabilities",
    ),
  });
  return indexerSkillCapabilitySchema.parse({
    ...payload,
    capability_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerSkillCapability(
  value: unknown,
): IndexerSkillCapability {
  const capability = indexerSkillCapabilitySchema.parse(value);
  if (
    indexerProtocolDigest(skillCapabilityPayload(capability)) !==
      capability.capability_digest
  ) {
    throw new TypeError("Skill capability digest is invalid");
  }
  const canonical = buildIndexerSkillCapabilityFromView(capability);
  if (canonicalIndexerJson(canonical) !== canonicalIndexerJson(capability)) {
    throw new TypeError("Skill capability view is not canonical");
  }
  return capability;
}

function buildIndexerSkillCapabilityFromView(
  capability: IndexerSkillCapability,
): IndexerSkillCapability {
  const payload = skillCapabilityPayloadSchema.parse({
    ...skillCapabilityPayload(capability),
    domains: uniqueSorted(capability.domains, "Skill domains"),
    profiles: uniqueSorted(capability.profiles, "Skill profiles"),
    operations: [...capability.operations].sort((left, right) =>
      compareIndexerCanonicalText(left.id, right.id)
    ),
    layer_fragments: [...capability.layer_fragments].sort((left, right) =>
      compareIndexerCanonicalText(left.kind, right.kind)
    ),
    source_roles: uniqueSorted(capability.source_roles, "source roles"),
    tool_sources: capability.tool_sources.map((toolSource) => ({
      ...toolSource,
      operations: uniqueSorted(
        toolSource.operations,
        `tool source ${toolSource.id} operations`,
      ),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    logical_units: [...capability.logical_units].sort((left, right) =>
      compareIndexerCanonicalText(left.id, right.id)
    ),
    composers: capability.composers.map((composer) => ({
      ...composer,
      ...(composer.contract === undefined
        ? {}
        : { contract: canonicalComposerContract(composer.contract) }),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    program_capabilities: uniqueSorted(
      capability.program_capabilities,
      "program capabilities",
    ),
    customization_capabilities: uniqueSorted(
      capability.customization_capabilities,
      "customization capabilities",
    ),
  });
  return indexerSkillCapabilitySchema.parse({
    ...payload,
    capability_digest: indexerProtocolDigest(payload),
  });
}

const stageSchema = z.enum(["primary", "supporting", "extension", "composer"]);

const compositionPlanPayloadSchema = z.object({
  protocol: z.literal("context.indexer.provider-composition-plan/v1"),
  indexer_id: indexerIdSchema,
  primary_layer_id: indexerIdSchema,
  active_profiles: z.array(z.object({
    id: indexerIdSchema,
    kind: z.enum(["primary", "supporting", "extension"]),
    provider_layer_id: indexerIdSchema,
    variants: z.record(indexerIdSchema, indexerIdSchema),
  }).strict()),
  skill_capabilities: z.array(z.object({
    provider_layer_id: indexerIdSchema,
    provider_integrity: indexerDigestSchema,
    manifest_digest: indexerDigestSchema,
    capability: indexerSkillCapabilitySchema,
  }).strict()),
  operation_authorities: z.array(z.object({
    operation: z.literal("main-index"),
    final_authority_layer_id: indexerIdSchema,
    accepts_layer_fragments: z.array(indexerIdSchema),
  }).strict()),
  source_roles: z.array(z.object({
    id: indexerIdSchema,
    provider_layer_ids: z.array(indexerIdSchema).min(1),
  }).strict()),
  tool_sources: z.array(z.object({
    provider_layer_id: indexerIdSchema,
    declaration: skillToolSourceSchema,
  }).strict()),
  logical_units: z.array(z.object({
    id: indexerIdSchema,
    definition_digest: indexerDigestSchema,
    provider_layer_ids: z.array(indexerIdSchema).min(1),
  }).strict()),
  instructions: z.array(z.object({
    stage: stageSchema,
    provider_layer_id: indexerIdSchema,
    profile_id: indexerIdSchema,
    path: portableIndexerPathSchema,
    source: z.enum(["provider", "project-append"]),
    project_digest: indexerDigestSchema.optional(),
  }).strict()),
  templates: z.array(z.object({
    stage: stageSchema,
    provider_layer_id: indexerIdSchema,
    profile_id: indexerIdSchema,
    template_id: indexerIdSchema,
    provider_path: portableIndexerPathSchema,
    source: z.enum(["provider", "project-override"]),
    project_path: portableIndexerPathSchema.optional(),
    project_digest: indexerDigestSchema.optional(),
  }).strict()),
  isolated_configs: z.array(z.object({
    provider_layer_id: indexerIdSchema,
    config_digest: indexerDigestSchema,
  }).strict()),
  composers: z.array(z.object({
    composer_ref: z.string().min(1),
    composer_id: indexerIdSchema,
    provider_layer_id: indexerIdSchema,
    composer_contract_digest: indexerDigestSchema.optional(),
  }).strict()),
  customization: z.object({
    mode: z.enum(["none", "extend", "replace"]),
    fingerprint: indexerDigestSchema,
    plan_digest: indexerDigestSchema,
    selected_capabilities: z.array(indexerIdSchema),
    program_source: z.enum(["provider", "project-extend", "project-replace"]),
  }).strict(),
}).strict();

export const indexerProviderCompositionPlanSchema =
  compositionPlanPayloadSchema.extend({
    composition_digest: indexerDigestSchema,
  }).strict();

export type IndexerProviderCompositionPlan = z.infer<
  typeof indexerProviderCompositionPlanSchema
>;

export interface IndexerCompositionCustomizationInput {
  mode: "none" | "extend" | "replace";
  fingerprint: string;
  files: readonly {
    path: string;
    digest: string;
    capability: "instructions-append" | "template-override" | "program-extend";
    origin: { skill: string; version: string; profile: string };
  }[];
  plan: IndexerCustomizationPlan;
}

export type { IndexerResolvedCompositionLayer } from
  "./indexerProviderProfileResolution.js";

function stageOrder(stage: z.infer<typeof stageSchema>): number {
  return ["primary", "supporting", "extension", "composer"].indexOf(stage);
}

function profileStage(kind: "primary" | "supporting" | "extension") {
  return kind;
}

function compositionPlanPayload(
  value: IndexerProviderCompositionPlan,
): Omit<IndexerProviderCompositionPlan, "composition_digest"> {
  const { composition_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function resourceKey(resource: {
  stage: z.infer<typeof stageSchema>;
  profile_id: string;
  provider_layer_id: string;
  path?: string;
  template_id?: string;
}): string {
  return [
    String(stageOrder(resource.stage)),
    resource.profile_id,
    resource.provider_layer_id,
    resource.template_id ?? "",
    resource.path ?? "",
  ].join("\u0000");
}

function assertCustomization(input: {
  customization: IndexerCompositionCustomizationInput;
  indexer: IndexerRegistryEntry;
  primary: IndexerRegistryEntry["providers"][number];
}): void {
  const plan = validateIndexerCustomizationPlan(input.customization.plan);
  const expectedMode = input.indexer.customization?.mode ?? "none";
  if (
    input.customization.mode !== expectedMode ||
    plan.indexer_id !== input.indexer.id ||
    plan.provider_integrity !== input.primary.integrity ||
    (expectedMode === "none" && plan.workspace_mode !== "registry-only") ||
    (expectedMode !== "none" && plan.workspace_mode !== expectedMode)
  ) {
    throw new TypeError("customization plan does not match the selected Indexer");
  }
  if (
    expectedMode === "none"
      ? input.customization.files.length !== 0
      : input.customization.files.length === 0
  ) {
    throw new TypeError("customization files do not match the selected mode");
  }
  if (
    expectedMode === "replace" &&
    !input.customization.files.some((file) => file.capability === "program-extend")
  ) {
    throw new TypeError("replace composition requires a project program");
  }
  const selectedRank = [
    "provider-only",
    "config",
    "instructions-append",
    "template-override",
    "program-extend",
    "replace",
  ].indexOf(plan.selected_step);
  const invalidFile = input.customization.files.find((file) =>
    [
      "provider-only",
      "config",
      "instructions-append",
      "template-override",
      "program-extend",
    ].indexOf(file.capability) > selectedRank
  );
  if (invalidFile !== undefined) {
    throw new TypeError("customization file skips its authorized ladder step");
  }
}

type CompositionPayload = z.infer<typeof compositionPlanPayloadSchema>;

function resolveOperationAuthorities(input: {
  indexer: IndexerRegistryEntry;
  primary: IndexerRegistryEntry["providers"][number];
  primaryManifest: IndexerProviderManifest;
  resolvedByLayer: ReadonlyMap<string, IndexerResolvedCompositionLayer>;
}): CompositionPayload["operation_authorities"] {
  const authorities = input.indexer.operations.map((operation) => {
    const declared = input.primaryManifest.provides.operations.find((item) =>
      item.id === operation
    );
    if (declared === undefined) {
      throw new TypeError(`primary layer does not provide operation ${operation}`);
    }
    return {
      operation,
      final_authority_layer_id: input.primary.id,
      accepts_layer_fragments: uniqueSorted(
        declared.accepts_layer_fragments ?? [],
        `${operation} fragments`,
      ),
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.operation, right.operation));
  const acceptedFragments = new Set(authorities.flatMap((item) =>
    item.accepts_layer_fragments
  ));
  for (const layer of input.indexer.providers.filter((item) => item.role === "extension")) {
    const unsupported = (input.resolvedByLayer.get(layer.id)!.manifest.provides.layer_fragments ?? [])
      .find((fragment) =>
        fragment.phase === "pre-authority" && !acceptedFragments.has(fragment.kind)
      );
    if (unsupported !== undefined) {
      throw new TypeError(`primary layer does not accept ${unsupported.kind}`);
    }
  }
  return authorities;
}

export function buildIndexerProviderCompositionPlan(input: {
  indexer: IndexerRegistryEntry;
  resolved_layers: readonly IndexerResolvedCompositionLayer[];
  profile_contract: IndexerProfileContract;
  customization: IndexerCompositionCustomizationInput;
}): IndexerProviderCompositionPlan {
  const indexer = indexerRegistryEntrySchema.parse(input.indexer);
  const profileContract = indexerProfileContractSchema.parse(input.profile_contract);
  const primary = indexer.providers.find((provider) => provider.role === "primary")!;
  assertCustomization({ customization: input.customization, indexer, primary });
  const resolvedByLayer = new Map(input.resolved_layers.map((resolved) => [
    resolved.layer_id,
    {
      ...resolved,
      provider_integrity: indexerDigestSchema.parse(resolved.provider_integrity),
      manifest_digest: indexerDigestSchema.parse(resolved.manifest_digest),
      manifest: indexerProviderManifestSchema.parse(resolved.manifest),
    },
  ]));
  if (
    resolvedByLayer.size !== input.resolved_layers.length ||
    resolvedByLayer.size !== indexer.providers.length
  ) {
    throw new TypeError("composition requires exactly one resolved manifest per layer");
  }
  for (const layer of indexer.providers) {
    const resolved = resolvedByLayer.get(layer.id);
    if (
      resolved === undefined ||
      resolved.provider_integrity !== layer.integrity ||
      resolved.manifest.id !== layer.skill ||
      resolved.manifest.version !== layer.version
    ) {
      throw new TypeError(`resolved composition layer ${layer.id} is stale`);
    }
  }
  const activeProfiles = resolveIndexerActiveCompositionProfiles({
    indexer,
    resolvedByLayer,
    profileContract,
  });
  const profileById = new Map(activeProfiles.map((profile) => [profile.id, profile]));
  const primaryManifest = resolvedByLayer.get(primary.id)!.manifest;
  const operationAuthorities = resolveOperationAuthorities({
    indexer,
    primary,
    primaryManifest,
    resolvedByLayer,
  });
  const skillCapabilities = indexer.providers.map((layer) => {
    const resolved = resolvedByLayer.get(layer.id)!;
    return {
      provider_layer_id: layer.id,
      provider_integrity: layer.integrity,
      manifest_digest: resolved.manifest_digest,
      capability: buildIndexerSkillCapability(resolved.manifest),
    };
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.provider_layer_id, right.provider_layer_id)
  );
  const sourceRoleProviders = new Map<string, Set<string>>();
  const logicalUnits = new Map<string, { definition_digest: string; providers: Set<string> }>();
  for (const layer of skillCapabilities) {
    for (const role of layer.capability.source_roles) {
      const providers = sourceRoleProviders.get(role) ?? new Set<string>();
      providers.add(layer.provider_layer_id);
      sourceRoleProviders.set(role, providers);
    }
    for (const logicalUnit of layer.capability.logical_units) {
      const definitionDigest = indexerProtocolDigest(logicalUnit);
      const current = logicalUnits.get(logicalUnit.id);
      if (current !== undefined && current.definition_digest !== definitionDigest) {
        throw new TypeError(`logical unit capability ${logicalUnit.id} conflicts across layers`);
      }
      const providers = current?.providers ?? new Set<string>();
      providers.add(layer.provider_layer_id);
      logicalUnits.set(logicalUnit.id, { definition_digest: definitionDigest, providers });
    }
  }
  const instructions: z.infer<typeof compositionPlanPayloadSchema>["instructions"] =
    activeProfiles.flatMap((profile) => {
    const manifest = resolvedByLayer.get(profile.provider_layer_id)!.manifest;
    return (manifest.provider.instructions ?? []).flatMap((instruction) =>
      instruction.profiles.includes(profile.id)
        ? [{
            stage: profileStage(profile.kind),
            provider_layer_id: profile.provider_layer_id,
            profile_id: profile.id,
            path: instruction.path,
            source: "provider" as const,
          }]
        : []
    );
  });
  const templates: z.infer<typeof compositionPlanPayloadSchema>["templates"] =
    activeProfiles.flatMap((profile) => {
    const manifest = resolvedByLayer.get(profile.provider_layer_id)!.manifest;
    return (manifest.provider.templates ?? []).flatMap((template) =>
      template.profile === profile.id
        ? [{
            stage: profileStage(profile.kind),
            provider_layer_id: profile.provider_layer_id,
            profile_id: profile.id,
            template_id: template.id,
            provider_path: template.path,
            source: "provider" as const,
          }]
        : []
    );
  });
  const selectedCapabilities = [...new Set(
    input.customization.files.map((file) => file.capability),
  )].sort(compareIndexerCanonicalText);
  for (const file of input.customization.files) {
    if (file.origin.skill !== primary.skill || file.origin.version !== primary.version) {
      throw new TypeError("project customization origin is not the primary Provider");
    }
    const profile = profileById.get(file.origin.profile);
    if (profile === undefined || profile.provider_layer_id !== primary.id) {
      throw new TypeError("project customization profile is not owned by primary Provider");
    }
    if (file.capability === "instructions-append") {
      instructions.push({
        stage: profileStage(profile.kind),
        provider_layer_id: primary.id,
        profile_id: profile.id,
        path: portableIndexerPathSchema.parse(file.path),
        source: "project-append",
        project_digest: indexerDigestSchema.parse(file.digest),
      });
    }
    if (file.capability === "template-override") {
      const match = /^templates\/([a-z0-9][a-z0-9._/-]*)\.md$/u.exec(file.path);
      const template = match === null ? undefined : templates.find((item) =>
        item.profile_id === profile.id && item.template_id === match[1]
      );
      if (template === undefined || template.source !== "provider") {
        throw new TypeError("project template override has no exact Provider template");
      }
      template.source = "project-override";
      template.project_path = portableIndexerPathSchema.parse(file.path);
      template.project_digest = indexerDigestSchema.parse(file.digest);
    }
  }
  const activeProfileIds = new Set(activeProfiles.map((profile) => profile.id));
  const composers = (indexer.profile.composers ?? []).map((composer) => {
    const resolved = resolvedByLayer.get(composer.provider);
    const declaration = resolved?.manifest.provides.composers?.find((item) =>
      item.id === composer.id
    );
    if (
      declaration === undefined ||
      !declaration.supported_profiles.some((profile) => activeProfileIds.has(profile))
    ) {
      throw new TypeError(`selected composer ${composer.id} is not profile-applicable`);
    }
    return {
      composer_ref: `provider:${composer.provider}#composer:${composer.id}`,
      composer_id: composer.id,
      provider_layer_id: composer.provider,
      ...(declaration.contract === undefined
        ? {}
        : { composer_contract_digest: indexerProtocolDigest(declaration.contract) }),
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.composer_ref, right.composer_ref));
  const payload = compositionPlanPayloadSchema.parse({
    protocol: "context.indexer.provider-composition-plan/v1",
    indexer_id: indexer.id,
    primary_layer_id: primary.id,
    active_profiles: activeProfiles,
    skill_capabilities: skillCapabilities,
    operation_authorities: operationAuthorities,
    source_roles: [...sourceRoleProviders].map(([id, providers]) => ({
      id,
      provider_layer_ids: [...providers].sort(compareIndexerCanonicalText),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    tool_sources: skillCapabilities.flatMap((layer) =>
      layer.capability.tool_sources.map((declaration) => ({
        provider_layer_id: layer.provider_layer_id,
        declaration,
      }))
    ).sort((left, right) =>
      compareIndexerCanonicalText(left.provider_layer_id, right.provider_layer_id) ||
      compareIndexerCanonicalText(left.declaration.id, right.declaration.id)
    ),
    logical_units: [...logicalUnits].map(([id, value]) => ({
      id,
      definition_digest: value.definition_digest,
      provider_layer_ids: [...value.providers].sort(compareIndexerCanonicalText),
    })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    instructions: instructions.sort((left, right) =>
      compareIndexerCanonicalText(
        resourceKey({ ...left, path: left.path }),
        resourceKey({ ...right, path: right.path }),
      )
    ),
    templates: templates.sort((left, right) =>
      compareIndexerCanonicalText(
        resourceKey({ ...left, template_id: left.template_id }),
        resourceKey({ ...right, template_id: right.template_id }),
      )
    ),
    isolated_configs: indexer.providers.map((layer) => ({
      provider_layer_id: layer.id,
      config_digest: indexerProtocolDigest(layer.config ?? {}),
    })).sort((left, right) =>
      compareIndexerCanonicalText(left.provider_layer_id, right.provider_layer_id)
    ),
    composers,
    customization: {
      mode: input.customization.mode,
      fingerprint: input.customization.fingerprint,
      plan_digest: input.customization.plan.plan_digest,
      selected_capabilities: selectedCapabilities,
      program_source: input.customization.mode === "replace"
        ? "project-replace"
        : selectedCapabilities.includes("program-extend")
        ? "project-extend"
        : "provider",
    },
  });
  return indexerProviderCompositionPlanSchema.parse({
    ...payload,
    composition_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProviderCompositionPlan(
  value: unknown,
): IndexerProviderCompositionPlan {
  const plan = indexerProviderCompositionPlanSchema.parse(value);
  if (indexerProtocolDigest(compositionPlanPayload(plan)) !== plan.composition_digest) {
    throw new TypeError("Provider composition plan digest is invalid");
  }
  return plan;
}
