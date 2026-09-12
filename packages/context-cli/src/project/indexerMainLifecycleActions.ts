import { mapParserWork } from "./parserConcurrency.js";
import { planningInventoryShards } from "./indexerPlanningInventory.js";
import { partitionDependencyDigest } from "./indexerPartitionDependencies.js";
import {
  buildIndexerMainPartitionWorksets,
  buildIndexerMainWorksetSet,
  evaluateIndexerCandidateMaterialization,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  observeIndexerMainWorksetState,
  ownerCells,
  validateIndexerQuestionTargetInventory,
  type IndexerRegistry,
} from "@c4a/context";
import { resolveProjectIndexerMainSourceBinding } from "./indexerMainSourceAdapter.js";
import { projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { buildCurrentProjectIndexerPartitionRunSpec } from
  "./indexerCurrentMainRunSpec.js";
import { materializeCurrentIndexerExtensionFacts } from "./indexerCurrentInspector.js";
import {
  array,
  assertCurrentRequirement,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";
import { buildProjectIndexerQuestionTargetInventory } from
  "./indexerQuestionTargetInventoryActions.js";
import {
  planCapturedDocumentInventoryShards,
  planIndexerConsumerInventoryShards,
  type IndexerConsumerInventoryShard,
} from "./indexerConsumerWorksetPlanner.js";
import { capturedDocumentIndexerRef } from "./indexerWorksetEvidenceProjection.js";
import { reuseCurrentIndexerRuns } from "./indexerRunContinuation.js";
export { buildProjectIndexerQuestionTargetInventory };
export { buildProjectIndexerMainAuthorWorksets } from "./indexerMainAuthorActions.js";
export { validateProjectIndexerMainRun } from "./indexerMainRunValidationActions.js";

function assertClosedOwnerCohorts(
  registry: IndexerRegistry,
  worksets: ReturnType<typeof buildIndexerMainPartitionWorksets>["worksets"],
): void {
  const authorities = ownerCells(registry);
  for (const workset of worksets) {
    const expected = authorities.filter((owner) =>
      owner.obligation !== "out-of-scope" &&
      owner.requirement_ref === workset.requirement_ref &&
      owner.source_ref === workset.source_ref &&
      owner.module_ref === workset.module_ref &&
      owner.owner_indexer_ids.includes(workset.indexer_id)
    ).map((owner) => owner.owner_cell_ref);
    if (
      expected.length === 0 ||
      expected.length !== workset.owner_cell_refs.length ||
      expected.some((ref, index) => ref !== workset.owner_cell_refs[index])
    ) {
      throw new TypeError(
        "partition workset owner cohort is not the complete current registry authority",
      );
    }
  }
}

function partitionInventoryShards(
  input: {
    binding: Awaited<ReturnType<typeof resolveProjectIndexerMainSourceBinding>>;
    profile: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>["profile"];
    strategyId: string;
  },
): IndexerConsumerInventoryShard[] {
  const binding = input.binding;
  if (binding.adapter === "captured-documents") {
    return planCapturedDocumentInventoryShards(
      binding.evidence.index.documents.map((document) => {
        const memberId = capturedDocumentIndexerRef({
          source_ref: binding.source_ref,
          path: document.path,
        });
        const member = binding.partition_inventory.find((candidate) =>
          candidate.member_id === memberId
        );
        if (member === undefined) {
          throw new TypeError(`captured document inventory is missing ${document.path}`);
        }
        return { member, path: document.path };
      }),
    );
  }
  return planIndexerConsumerInventoryShards({
    factView: binding.parser_fact_view,
    profile: input.profile,
    strategyId: input.strategyId,
  });
}

function questionCarrierShardIndex(
  shards: ReturnType<typeof partitionInventoryShards>,
): number {
  let selectedIndex = 0;
  let selectedScore = -1;
  for (const [index, shard] of shards.entries()) {
    if (shard.question_carrier_score > selectedScore) {
      selectedIndex = index;
      selectedScore = shard.question_carrier_score;
    }
  }
  return selectedIndex;
}

export async function buildProjectIndexerMainPartitionWorksets(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "partition workset input");
  protocol(
    value,
    "context.indexer.main-partition-workset-build-input/v1",
    "partition workset input",
  );
  const suppliedQuestionTargets = validateIndexerQuestionTargetInventory(
    value.question_target_inventory,
  );
  const questionTargets = await buildProjectIndexerQuestionTargetInventory({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: suppliedQuestionTargets.requirement_set_digest,
    },
  });
  if (questionTargets.inventory_digest !== suppliedQuestionTargets.inventory_digest) {
    throw new TypeError("partition workset input targets a stale question inventory");
  }
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    questionTargets.requirement_set_digest,
  );
  const currentOwners = ownerCells(registry).filter((owner) =>
    owner.obligation !== "out-of-scope" &&
    !(owner.owner_indexer_ids.length === 0 && owner.obligation === "optional")
  );
  for (const owner of currentOwners) {
    if (owner.owner_indexer_ids.length !== 1) {
      throw new TypeError(
        `partition owner ${owner.owner_cell_ref} requires exactly one primary Indexer`,
      );
    }
  }
  const ownerGroups = new Map<string, typeof currentOwners>();
  for (const owner of currentOwners) {
    const key = [
      owner.owner_indexer_ids[0],
      owner.requirement_ref,
      owner.source_ref,
      owner.module_ref ?? "",
    ].join("\u0000");
    const group = ownerGroups.get(key) ?? [];
    group.push(owner);
    ownerGroups.set(key, group);
  }
  const indexerIds = [...new Set(currentOwners.map((owner) => owner.owner_indexer_ids[0]!))];
  const authorities = new Map<string, Awaited<ReturnType<
    typeof resolveCurrentProjectIndexerPrimaryAuthority
  >>>();
  await Promise.all(indexerIds.map(async (indexerId) => {
    authorities.set(indexerId, await resolveCurrentProjectIndexerPrimaryAuthority({
      projectRoot: input.projectRoot,
      registry,
      indexer_id: indexerId,
    }));
  }));
  const prepared = (await mapParserWork([...ownerGroups.values()], 1, async (owners) => {
    const first = owners[0]!;
    const indexerId = first.owner_indexer_ids[0]!;
    const authority = authorities.get(indexerId);
    if (authority === undefined) throw new TypeError(`missing primary authority ${indexerId}`);
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: input.projectRoot,
      indexer_id: indexerId,
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      profile_contract_digest: authority.profile_contract.contract_digest,
      inventory_only: ["web-application", "api-service", "event-consumer"].includes(authority.profile.id),
    });
    const ownerCellRefs = owners.map((owner) => owner.owner_cell_ref).sort();
    const ownerCellSet = new Set(ownerCellRefs);
    const cohortTargets = questionTargets.items.filter((target) =>
      ownerCellSet.has(target.owner_cell_ref)
    );
    const allowedTargets = cohortTargets.map((target) => target.target_ref).sort();
    const ownerCoverageDomains = new Set(owners.map((owner) => owner.coverage_domain));
    const targetDomainRefs = new Set(cohortTargets.map((target) => target.target_domain_ref));
    const requirement = registry.requirements.find((candidate) =>
      `requirement:${candidate.id}` === first.requirement_ref
    );
    if (requirement === undefined) {
      throw new TypeError(`missing current requirement ${first.requirement_ref}`);
    }
    const authorizedQuestionRefs = new Set(
      (requirement.questions ?? []).map((question) => question.ref),
    );
    const strategies = authority.partition_strategies.strategies.map((entry) => ({
      strategy_ref: entry.strategy_ref,
      strategy_digest: entry.strategy_digest,
    }));
    const base = {
      stage: "partition" as const,
      indexer_id: indexerId,
      requirement_ref: first.requirement_ref,
      owner_cell_refs: ownerCellRefs,
      source_ref: first.source_ref,
      module_ref: first.module_ref,
      primary_registry_projection_digest: authority.primary_registry.projection_digest,
      requirement_set_digest: questionTargets.requirement_set_digest,
      primary_execution_fingerprint:
        authority.primary_execution.primary_execution_fingerprint,
      profile_contract_digest: authority.profile_contract.contract_digest,
      source_scope_digest: indexerProtocolDigest({
        indexer_id: indexerId,
        read_targets: projectIndexerReadTargets({ registry, indexer_id: indexerId }),
      }),
      source_binding_digest: binding.source_binding_digest,
      primary_resource_binding_digest:
        authority.primary_execution.primary_resource_binding_digest,
      question_target_inventory_digest: questionTargets.inventory_digest,
      strategy_set_digest: indexerPartitionStrategySetDigest(strategies),
      reader_question_refs: authority.profile.reader_question_contracts
        .filter((question) =>
          authorizedQuestionRefs.has(question.ref) &&
          ownerCoverageDomains.has(question.coverage_domain) &&
          targetDomainRefs.has(question.target_domain_ref)
        )
        .map((question) => question.ref).sort(),
      partition_input_digests: binding.partition_input_digests,
      allowed_question_target_refs: allowedTargets,
    };
    const primaryStrategy = strategies[0]?.strategy_ref;
    if (primaryStrategy === undefined) {
      throw new TypeError(`missing partition strategy for ${indexerId}`);
    }
    const shards = binding.adapter === "parser-facts" && binding.inventory_only
      ? planningInventoryShards(binding) : partitionInventoryShards({
      binding,
      profile: authority.profile,
      strategyId: primaryStrategy.strategy_id,
    });
    const carrierShardIndex = questionCarrierShardIndex(shards);
    return shards.map(({ inventory, projection }, shardIndex) => {
      const dependency = partitionDependencyDigest(binding, projection);
      return {
        input: {
          ...base,
          ...(dependency === undefined ? {} : { source_binding_digest: dependency, partition_input_digests: [dependency] }),
          partition_inventory_digest: indexerInventoryMembersDigest(inventory),
          allowed_question_target_refs: shardIndex === carrierShardIndex ? allowedTargets : [],
        },
        inventory,
        projection,
        authority,
        binding,
      };
    });
  })).flat();
  const worksets: Parameters<typeof buildIndexerMainPartitionWorksets>[0] =
    prepared.map((item) => item.input);
  const built = buildIndexerMainPartitionWorksets(
    worksets,
  );
  assertClosedOwnerCohorts(registry, built.worksets);
  const preparedByDigest = new Map(prepared.map((item, index) => [
    built.worksets[index]!.workset_digest,
    item,
  ]));
  const runSpecs = await Promise.all(built.worksets.map(async (workset) => {
    const item = preparedByDigest.get(workset.workset_digest);
    if (item === undefined) {
      throw new TypeError("partition run preparation lost its current authority binding");
    }
    const enrichment = item.binding.adapter === "parser-facts" && !item.binding.inventory_only
      ? await materializeCurrentIndexerExtensionFacts({
          projectRoot: input.projectRoot,
          authority: item.authority,
          workset_digest: workset.workset_digest,
          parser_fact_view: item.binding.parser_fact_view,
        })
      : undefined;
    return buildCurrentProjectIndexerPartitionRunSpec({
      workset,
      binding: item.binding,
      authority: item.authority,
      canonical_inventory_members: item.inventory,
      partition_projection: item.projection,
      ...(enrichment === undefined ? {} : { enrichment }),
    });
  }));
  const currentRuns = await reuseCurrentIndexerRuns({ projectRoot: input.projectRoot, specs: runSpecs });
  const currentWorksets = currentRuns.map((spec) => {
    if (spec.request.workset.stage !== "partition") throw new TypeError("expected partition workset");
    return spec.request.workset;
  });
  return {
    protocol: "context.indexer.main-partition-workset-build/v1" as const,
    requirement_set_digest: questionTargets.requirement_set_digest,
    worksets: currentWorksets,
    workset_set: buildIndexerMainWorksetSet(currentWorksets),
    run_specs: currentRuns,
    graph_outcome: "completed" as const,
  };
}

export async function auditProjectIndexerProjectedArtifactFanOut(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "projected Artifact fan-out audit input");
  protocol(
    value,
    "context.indexer.projected-artifact-fan-out-audit-input/v1",
    "projected Artifact fan-out audit input",
  );
  const partitionPlan = record(value.partition_plan, "partition_plan");
  const binding = record(partitionPlan.binding, "partition_plan.binding");
  await assertCurrentRequirement(input.projectRoot, binding.requirement_digest);
  const result = evaluateIndexerCandidateMaterialization({
    partition_plan: partitionPlan,
    projected_artifact_plan: value.projected_artifact_plan,
    artifact_bundles: array(value.artifact_bundles, "artifact_bundles"),
    artifact_policy_eligibilities: array(
      value.artifact_policy_eligibilities,
      "artifact_policy_eligibilities",
    ).map((item) => {
      const candidate = record(item, "artifact policy eligibility binding");
      return {
        logical_unit_ref: String(candidate.logical_unit_ref ?? ""),
        report: candidate.report,
      };
    }),
  });
  return {
    protocol: "context.indexer.candidate-materialization-readiness/v1" as const,
    ...result,
  };
}

export function observeProjectIndexerMainWorksets(value: unknown) {
  const input = record(value, "main workset observation input");
  protocol(
    input,
    "context.indexer.main-workset-observation-input/v1",
    "main workset observation input",
  );
  return observeIndexerMainWorksetState({
    workset_set: input.workset_set,
    records: array(input.records, "main workset observation records"),
  });
}
