import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";
import {
  canonicalOwnerCellRef,
  indexerRegistryDigests,
  indexerRegistrySchema,
  type IndexRequirement,
  type IndexerRegistry,
  type IndexerRegistryEntry,
  type IndexerScopeTarget,
} from "./indexerRegistry.js";

const visibleSkillSchema = z.object({
  skill: indexerIdSchema,
  version: indexerSemverSchema.nullable(),
  source_type: z.enum([
    "community-plugin",
    "cli-bundled",
    "workspace",
    "installed-plugin",
    "marketplace",
  ]),
}).strict();

const providerRouteInputPayloadSchema = z.object({
  protocol: z.literal("context.indexer.provider-route-input/v1"),
  project_ref: z.string().min(1),
  registry: indexerRegistrySchema,
  visible_skills: z.array(visibleSkillSchema),
  community_fallback_attempted: z.boolean(),
}).strict();

export const indexerProviderRouteInputSchema = providerRouteInputPayloadSchema.extend({
  input_digest: indexerDigestSchema,
}).strict();

export type IndexerProviderRouteInput = z.infer<typeof indexerProviderRouteInputSchema>;

const ownerConflictSchema = z.object({
  owner_cell_ref: z.string().min(1),
  indexer_ids: z.array(indexerIdSchema).min(2),
  skill_ids: z.array(indexerIdSchema).min(1),
}).strict();

const capabilityGapSchema = z.object({
  owner_cell_ref: z.string().min(1).nullable(),
  requirement_ref: indexerIdSchema.nullable(),
  coverage_domain: indexerIdSchema.nullable(),
  capability: z.string().min(1),
}).strict();

const capabilityGapProofPayloadSchema = z.object({
  protocol: z.literal("context.indexer.capability-gap-proof/v1"),
  project_ref: z.string().min(1),
  route_input_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  visible_skill_set_digest: indexerDigestSchema,
  community_fallback_attempted: z.literal(true),
  gaps: z.array(capabilityGapSchema).min(1),
}).strict();

export const indexerCapabilityGapProofSchema = capabilityGapProofPayloadSchema.extend({
  gap_digest: indexerDigestSchema,
}).strict();

export type IndexerCapabilityGapProof = z.infer<
  typeof indexerCapabilityGapProofSchema
>;

const readScopeOverlapSchema = z.object({
  left_indexer_id: indexerIdSchema,
  right_indexer_id: indexerIdSchema,
  scope_refs: z.array(z.string().min(1)).min(1),
}).strict();

const providerRouteDecisionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("selection-validation-required"),
    graph_outcome: z.literal("completed"),
    next_action: z.literal("validate-indexer-selection-proposal"),
  }).strict(),
  z.object({
    outcome: z.literal("community-fallback-required"),
    graph_outcome: z.literal("partial"),
    next_action: z.literal("configure-community-indexer-fallback"),
  }).strict(),
  z.object({
    outcome: z.literal("indexer-provider-conflict"),
    graph_outcome: z.literal("waiting-user"),
    next_action: z.literal("configure-indexer-providers"),
  }).strict(),
  z.object({
    outcome: z.literal("indexer-customization-required"),
    graph_outcome: z.literal("blocked"),
    next_action: z.literal("propose-indexer-customization"),
  }).strict(),
]);

const providerRouteReportPayloadSchema = z.object({
  protocol: z.literal("context.indexer.provider-route-report/v1"),
  project_ref: z.string().min(1),
  input_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  registry_digest: indexerDigestSchema,
  visible_skill_set_digest: indexerDigestSchema,
  selected_skill_ids: z.array(indexerIdSchema),
  composition_mode: z.enum(["none", "single-skill", "multi-skill"]),
  community_fallback_attempted: z.boolean(),
  unowned_required_owner_cells: z.array(z.string().min(1)),
  conflicting_owner_cells: z.array(ownerConflictSchema),
  read_scope_overlaps: z.array(readScopeOverlapSchema),
  capability_gaps: z.array(capabilityGapSchema),
  capability_gap_proof: indexerCapabilityGapProofSchema.nullable(),
  route: providerRouteDecisionSchema,
  selection_proposal_input: z.object({
    protocol: z.literal("context.indexer.selection-proposal-input/v1"),
    project_ref: z.string().min(1),
    registry: indexerRegistrySchema,
  }).strict().nullable(),
}).strict();

export const indexerProviderRouteReportSchema = providerRouteReportPayloadSchema.extend({
  report_digest: indexerDigestSchema,
}).strict();

export type IndexerProviderRouteReport = z.infer<typeof indexerProviderRouteReportSchema>;

function buildCapabilityGapProof(input: {
  project_ref: string;
  route_input_digest: string;
  requirement_set_digest: string;
  registry_digest: string;
  visible_skill_set_digest: string;
  community_fallback_attempted: boolean;
  gaps: z.infer<typeof capabilityGapSchema>[];
  is_final_gap: boolean;
}): IndexerCapabilityGapProof | null {
  if (!input.is_final_gap) return null;
  const payload = capabilityGapProofPayloadSchema.parse({
    protocol: "context.indexer.capability-gap-proof/v1",
    project_ref: input.project_ref,
    route_input_digest: input.route_input_digest,
    requirement_set_digest: input.requirement_set_digest,
    registry_digest: input.registry_digest,
    visible_skill_set_digest: input.visible_skill_set_digest,
    community_fallback_attempted: input.community_fallback_attempted,
    gaps: input.gaps,
  });
  return indexerCapabilityGapProofSchema.parse({
    ...payload,
    gap_digest: indexerProtocolDigest(payload),
  });
}

interface OwnerCellDescription {
  owner_cell_ref: string;
  requirement_ref: string;
  coverage_domain: string;
}

function uniqueSorted(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return sorted;
}

export function buildIndexerProviderRouteInput(input: {
  project_ref: string;
  registry: unknown;
  visible_skills: unknown[];
  community_fallback_attempted: boolean;
}): IndexerProviderRouteInput {
  const parsed = providerRouteInputPayloadSchema.parse({
    protocol: "context.indexer.provider-route-input/v1",
    project_ref: input.project_ref,
    registry: input.registry,
    visible_skills: input.visible_skills,
    community_fallback_attempted: input.community_fallback_attempted,
  });
  const visibleSkills = [...parsed.visible_skills].sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.skill}\u0000${left.version ?? ""}\u0000${left.source_type}`,
      `${right.skill}\u0000${right.version ?? ""}\u0000${right.source_type}`,
    )
  );
  uniqueSorted(
    visibleSkills.map((skill) => `${skill.skill}\u0000${skill.version ?? ""}\u0000${skill.source_type}`),
    "visible Skill identities",
  );
  const payload = providerRouteInputPayloadSchema.parse({
    ...parsed,
    visible_skills: visibleSkills,
  });
  return indexerProviderRouteInputSchema.parse({
    ...payload,
    input_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProviderRouteInput(
  value: unknown,
): IndexerProviderRouteInput {
  const input = indexerProviderRouteInputSchema.parse(value);
  const rebuilt = buildIndexerProviderRouteInput({
    project_ref: input.project_ref,
    registry: input.registry,
    visible_skills: input.visible_skills,
    community_fallback_attempted: input.community_fallback_attempted,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(input)) {
    throw new TypeError("Indexer Provider route input is stale or non-canonical");
  }
  return input;
}

function bindingTargets(
  requirement: IndexRequirement,
  binding: IndexerRegistryEntry["requirement_bindings"][number],
): readonly IndexerScopeTarget[] {
  return "ref" in binding.owned_scope
    ? requirement.target_scope.targets
    : binding.owned_scope.targets;
}

function ownerCellDescriptions(registry: IndexerRegistry): OwnerCellDescription[] {
  return registry.requirements.flatMap((requirement) =>
    Object.entries(requirement.coverage_domains).flatMap(([coverageDomain, state]) => {
      if (state !== "required") return [];
      return requirement.target_scope.targets.flatMap((target) => {
        const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
        return modules.map((moduleRef) => ({
          owner_cell_ref: canonicalOwnerCellRef({
            requirementRef: requirement.id,
            coverageDomain,
            sourceRef: target.source_ref,
            moduleRef,
          }),
          requirement_ref: requirement.id,
          coverage_domain: coverageDomain,
        }));
      });
    })
  ).sort((left, right) =>
    compareIndexerCanonicalText(left.owner_cell_ref, right.owner_cell_ref)
  );
}

function primaryOwners(registry: IndexerRegistry): Map<string, string[]> {
  const requirements = new Map(
    registry.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const owners = new Map<string, string[]>();
  for (const indexer of registry.indexers) {
    for (const binding of indexer.requirement_bindings) {
      const requirement = requirements.get(binding.requirement_ref);
      if (requirement === undefined) {
        throw new TypeError(`Indexer binding references unknown requirement ${binding.requirement_ref}`);
      }
      if (binding.role !== "primary") continue;
      for (const coverageDomain of binding.coverage_domains) {
        for (const target of bindingTargets(requirement, binding)) {
          const modules = target.module_refs.length === 0 ? [null] : target.module_refs;
          for (const moduleRef of modules) {
            const ref = canonicalOwnerCellRef({
              requirementRef: requirement.id,
              coverageDomain,
              sourceRef: target.source_ref,
              moduleRef,
            });
            owners.set(ref, [...(owners.get(ref) ?? []), indexer.id]);
          }
        }
      }
    }
  }
  return owners;
}

function selectedSkills(registry: IndexerRegistry): string[] {
  return [...new Set(registry.indexers.flatMap((indexer) =>
    indexer.providers.map((provider) => provider.skill)
  ))].sort(compareIndexerCanonicalText);
}

function providerSkillsForIndexers(
  registry: IndexerRegistry,
  indexerIds: readonly string[],
): string[] {
  const wanted = new Set(indexerIds);
  return [...new Set(registry.indexers.flatMap((indexer) =>
    wanted.has(indexer.id)
      ? indexer.providers.map((provider) => provider.skill)
      : []
  ))].sort(compareIndexerCanonicalText);
}

function readScopeOverlaps(registry: IndexerRegistry) {
  const overlaps: z.infer<typeof readScopeOverlapSchema>[] = [];
  for (let leftIndex = 0; leftIndex < registry.indexers.length; leftIndex += 1) {
    const left = registry.indexers[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < registry.indexers.length; rightIndex += 1) {
      const right = registry.indexers[rightIndex]!;
      const rightRefs = new Set(right.read_scope.refs);
      const scopeRefs = [...new Set(left.read_scope.refs.filter((ref) => rightRefs.has(ref)))]
        .sort(compareIndexerCanonicalText);
      if (scopeRefs.length > 0) {
        overlaps.push({
          left_indexer_id: left.id,
          right_indexer_id: right.id,
          scope_refs: scopeRefs,
        });
      }
    }
  }
  return overlaps.sort((left, right) =>
    compareIndexerCanonicalText(
      `${left.left_indexer_id}\u0000${left.right_indexer_id}`,
      `${right.left_indexer_id}\u0000${right.right_indexer_id}`,
    )
  );
}

export function buildIndexerProviderRouteReport(
  value: unknown,
): IndexerProviderRouteReport {
  const input = validateIndexerProviderRouteInput(value);
  const registry = input.registry;
  const ownerCells = ownerCellDescriptions(registry);
  const owners = primaryOwners(registry);
  const unowned = ownerCells.filter((cell) => (owners.get(cell.owner_cell_ref)?.length ?? 0) === 0);
  const conflicting = ownerCells.flatMap((cell) => {
    const indexerIds = [...new Set(owners.get(cell.owner_cell_ref) ?? [])]
      .sort(compareIndexerCanonicalText);
    return indexerIds.length < 2 ? [] : [{
      owner_cell_ref: cell.owner_cell_ref,
      indexer_ids: indexerIds,
      skill_ids: providerSkillsForIndexers(registry, indexerIds),
    }];
  });
  const skills = selectedSkills(registry);
  const needsProvider = skills.length === 0 || unowned.length > 0;
  const capabilityGaps = unowned.length > 0
    ? unowned.map((cell) => ({
        owner_cell_ref: cell.owner_cell_ref,
        requirement_ref: cell.requirement_ref,
        coverage_domain: cell.coverage_domain,
        capability: `coverage-domain:${cell.coverage_domain}`,
      }))
    : skills.length === 0
    ? [{
        owner_cell_ref: null,
        requirement_ref: null,
        coverage_domain: null,
        capability: "indexer-provider",
      }]
    : [];
  const route: z.infer<typeof providerRouteDecisionSchema> = conflicting.length > 0
    ? {
        outcome: "indexer-provider-conflict",
        graph_outcome: "waiting-user",
        next_action: "configure-indexer-providers",
      }
    : needsProvider && !input.community_fallback_attempted
    ? {
        outcome: "community-fallback-required",
        graph_outcome: "partial",
        next_action: "configure-community-indexer-fallback",
      }
    : needsProvider
    ? {
        outcome: "indexer-customization-required",
        graph_outcome: "blocked",
        next_action: "propose-indexer-customization",
      }
    : {
        outcome: "selection-validation-required",
        graph_outcome: "completed",
        next_action: "validate-indexer-selection-proposal",
      };
  const digests = indexerRegistryDigests(registry);
  const visibleSkillSetDigest = indexerProtocolDigest(input.visible_skills);
  const capabilityGapProof = buildCapabilityGapProof({
    project_ref: input.project_ref,
    route_input_digest: input.input_digest,
    requirement_set_digest: digests.requirementSetDigest,
    registry_digest: digests.registryDigest,
    visible_skill_set_digest: visibleSkillSetDigest,
    community_fallback_attempted: input.community_fallback_attempted,
    gaps: capabilityGaps,
    is_final_gap: route.outcome === "indexer-customization-required",
  });
  const payload = providerRouteReportPayloadSchema.parse({
    protocol: "context.indexer.provider-route-report/v1",
    project_ref: input.project_ref,
    input_digest: input.input_digest,
    requirement_set_digest: digests.requirementSetDigest,
    registry_digest: digests.registryDigest,
    visible_skill_set_digest: visibleSkillSetDigest,
    selected_skill_ids: skills,
    composition_mode: skills.length === 0
      ? "none"
      : skills.length === 1
      ? "single-skill"
      : "multi-skill",
    community_fallback_attempted: input.community_fallback_attempted,
    unowned_required_owner_cells: unowned.map((cell) => cell.owner_cell_ref),
    conflicting_owner_cells: conflicting,
    read_scope_overlaps: readScopeOverlaps(registry),
    capability_gaps: capabilityGaps,
    capability_gap_proof: capabilityGapProof,
    route,
    selection_proposal_input: route.outcome === "selection-validation-required"
      ? {
          protocol: "context.indexer.selection-proposal-input/v1",
          project_ref: input.project_ref,
          registry,
        }
      : null,
  });
  return indexerProviderRouteReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProviderRouteReport(input: {
  route_input: unknown;
  report: unknown;
}): IndexerProviderRouteReport {
  const report = indexerProviderRouteReportSchema.parse(input.report);
  const expected = buildIndexerProviderRouteReport(input.route_input);
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(report)) {
    throw new TypeError("Indexer Provider route report is stale or invalid");
  }
  return report;
}

export function validateIndexerCapabilityGapProof(input: {
  route_input: unknown;
  report: unknown;
}): IndexerCapabilityGapProof {
  const report = validateIndexerProviderRouteReport(input);
  if (
    report.route.outcome !== "indexer-customization-required" ||
    report.capability_gap_proof === null
  ) {
    throw new TypeError("Indexer customization requires a final CLI capability-gap proof");
  }
  return report.capability_gap_proof;
}
