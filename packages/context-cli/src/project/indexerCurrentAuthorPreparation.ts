import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { streamingAuthorBase } from "./indexerStreamingAuthorBase.js";
import { readPartitionStream } from "./indexerPartitionStream.js";
import { hasCurrentIndexerRegistryProjection } from "./indexerCurrentRegistryFreshness.js";
import { loadSelectedPageTemplate } from "./indexerPageTemplate.js";
import {
  buildIndexerMainAuthorWorksets,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  canonicalIndexerInventoryMembers,
  indexerPartitionGroupBindingDigest,
  indexerPartitionGroupRef,
  resolveIndexerArtifactPolicyEligibility,
  validateIndexerPartitionInputs,
  validateIndexerQuestionTargetInventory,
  type IndexerInventoryMember,
  type IndexerPartitionPlan,
  type IndexerPartitionValidationInput,
  type IndexerRegistry,
} from "@c4a/context";
import {
  type ProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { createIndexerAuthorSourceResolver, mergeIndexerAuthorSourceBindings } from "./indexerAuthorSources.js";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";
import { currentExecutionWorksetFields, reuseCurrentIndexerRuns } from "./indexerRunContinuation.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { buildCurrentProjectIndexerAuthorRunSpec } from
  "./indexerCurrentMainRunSpec.js";
import { materializeCurrentIndexerExtensionFacts } from "./indexerCurrentInspector.js";
import { buildProjectIndexerAuthorDependencyView } from "./indexerAuthorDependencyView.js";
import { summarizeIndexerObsoleteScope } from "./indexerObsoleteScope.js";
import {
  resolveProjectIndexerAuthorQuestionTargets,
  takeProjectIndexerGroupTargetView,
  type ProjectIndexerTargetResolutionViewBinding,
} from "./indexerAuthorQuestionTargets.js";

type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
type PartitionGroup = CompletePartitionPlan["groups"][number];
type CurrentPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

type ValidatedPartitionInput = Omit<IndexerPartitionValidationInput, "plan"> & {
  plan: IndexerPartitionPlan;
};

function artifactLogicalUnit(input: {
  authority: CurrentPrimaryAuthority;
  partition_unit_type: string;
}) {
  const candidates = (input.authority.manifest.provides.logical_units ?? []).filter((unit) =>
    unit.artifacts !== undefined
  );
  const exact = candidates.find((unit) => unit.id === input.partition_unit_type);
  if (exact !== undefined) return exact;
  if (candidates.length === 1) return candidates[0]!;
  throw new TypeError(
    `Provider cannot uniquely map partition unit ${input.partition_unit_type} to an Artifact policy`,
  );
}

function groupMembers(input: {
  partition: IndexerPartitionValidationInput;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
}): IndexerInventoryMember[] {
  const inventoryById = new Map(input.partition.canonical_inventory_members.map((member) => [
    member.member_id,
    member,
  ]));
  return canonicalIndexerInventoryMembers(input.group.member_ids.map((memberId) => {
    const member = inventoryById.get(memberId);
    if (member === undefined) {
      throw new TypeError(`partition group references unknown inventory member ${memberId}`);
    }
    const disposition = input.plan.member_dispositions.find((candidate) =>
      candidate.member_id === memberId
    );
    if (
      disposition?.inventory_disposition !== "owned" ||
      disposition.group_key !== input.group.group_key
    ) {
      throw new TypeError(`partition group does not own inventory member ${memberId}`);
    }
    return member;
  }));
}

export async function prepareCurrentProjectIndexerAuthorRuns(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  partitions: readonly IndexerPartitionValidationInput[];
  source_partitions?: readonly IndexerPartitionValidationInput[];
  source_projections?: ReadonlyMap<string, IndexerConsumerWorksetProjection>;
  origins_by_group_ref?: ReadonlyMap<string, readonly {
    partition_workset_digest: string;
    group_key: string;
  }[]>;
  question_target_inventory: unknown;
  target_resolution_views: readonly ProjectIndexerTargetResolutionViewBinding[];
}) {
  const inventory = validateIndexerQuestionTargetInventory(input.question_target_inventory);
  const validatedPartitions = validateIndexerPartitionInputs(input.partitions);
  const partitions: ValidatedPartitionInput[] = input.partitions.map((partition, index) => ({
    ...partition,
    workset: validatedPartitions[index]!.workset,
    plan: validatedPartitions[index]!.plan,
  }));
  const views = new Map(input.target_resolution_views.map((binding) => [
    binding.group_ref,
    binding.view,
  ]));
  if (views.size !== input.target_resolution_views.length) {
    throw new TypeError("target resolution view bindings must have unique group refs");
  }
  const authorityByIndexer = new Map<string, CurrentPrimaryAuthority>();
  const bindingByPartition = new Map<string, ProjectIndexerMainSourceBinding>();
  const resolveBinding = createIndexerAuthorSourceResolver({
    projectRoot: input.projectRoot, projections: input.source_projections ?? new Map(),
  });
  const rawSourcePartitions = input.source_partitions ?? input.partitions;
  const validatedSourcePartitions = validateIndexerPartitionInputs(rawSourcePartitions);
  const sourcePartitions: ValidatedPartitionInput[] = rawSourcePartitions.map(
    (partition, index) => ({
      ...partition,
      workset: validatedSourcePartitions[index]!.workset,
      plan: validatedSourcePartitions[index]!.plan,
    }),
  );
  const sourcePartitionByDigest = new Map(sourcePartitions.map((partition) => [
    partition.workset.workset_digest,
    partition,
  ]));
  if (sourcePartitionByDigest.size !== sourcePartitions.length) {
    throw new TypeError("source partitions must have unique workset digests");
  }
  for (const partition of sourcePartitions) {
    if (partition.plan.status !== "complete") {
      throw new TypeError("failed PartitionPlan cannot produce author worksets");
    }
    if (
      !hasCurrentIndexerRegistryProjection(input.registry, partition.workset) ||
      partition.workset.allowed_question_target_refs.some((ref) => !inventory.items.some((item) => item.target_ref === ref))
    ) {
      throw new TypeError("author workset input targets a stale question inventory");
    }
    let authority = authorityByIndexer.get(partition.workset.indexer_id);
    if (authority === undefined) {
      authority = await resolveCurrentProjectIndexerPrimaryAuthority({
        projectRoot: input.projectRoot,
        registry: input.registry,
        indexer_id: partition.workset.indexer_id,
      });
      authorityByIndexer.set(partition.workset.indexer_id, authority);
    }
    if (partition.plan.groups.length === 0) continue;
    const binding = await resolveBinding(partition);
    bindingByPartition.set(partition.workset.workset_digest, binding);
  }

  function originsForGroup(inputGroup: {
    partition: ValidatedPartitionInput;
    group: PartitionGroup;
  }): Array<{
    partition: ValidatedPartitionInput;
    authority: CurrentPrimaryAuthority;
    binding: ProjectIndexerMainSourceBinding;
    plan: CompletePartitionPlan;
    group: PartitionGroup;
    members: IndexerInventoryMember[];
    parser_projection?: IndexerConsumerWorksetProjection;
  }> {
    const groupRef = indexerPartitionGroupRef({
      partition_workset_digest: inputGroup.partition.workset.workset_digest,
      group_key: inputGroup.group.group_key,
    });
    const origins = input.origins_by_group_ref?.get(groupRef) ?? [{
      partition_workset_digest: inputGroup.partition.workset.workset_digest,
      group_key: inputGroup.group.group_key,
    }];
    return origins.map((origin) => {
      const partition = sourcePartitionByDigest.get(origin.partition_workset_digest);
      if (partition === undefined || partition.plan.status !== "complete") {
        throw new TypeError(`author group origin references unknown partition ${origin.partition_workset_digest}`);
      }
      const plan = partition.plan;
      const group = plan.groups.find((candidate) =>
        candidate.group_key === origin.group_key
      );
      if (group === undefined) {
        throw new TypeError(`author group origin references unknown group ${origin.group_key}`);
      }
      if (group.logical_unit_ref !== inputGroup.group.logical_unit_ref) {
        throw new TypeError("author group origin crosses logical Subjects");
      }
      const authority = authorityByIndexer.get(partition.workset.indexer_id);
      const binding = bindingByPartition.get(partition.workset.workset_digest);
      if (authority === undefined || binding === undefined) {
        throw new TypeError("author group origin is missing Provider authority or source binding");
      }
      const projection = input.source_projections?.get(partition.workset.workset_digest);
      return {
        partition,
        authority,
        binding,
        plan,
        group,
        members: groupMembers({ partition, plan, group }),
        ...(projection === undefined ? {} : { parser_projection: projection }),
      };
    });
  }

  const preparations = partitions.flatMap((partition) => {
    if (partition.plan.status !== "complete") return [];
    const plan = partition.plan;
    const authority = authorityByIndexer.get(partition.workset.indexer_id)!;
    const logicalUnit = artifactLogicalUnit({
      authority,
      partition_unit_type: plan.unit_type,
    });
    const artifactPolicy = logicalUnit.artifacts;
    if (artifactPolicy === undefined) {
      throw new TypeError("Author logical unit requires an Artifact policy");
    }
    const eligibility = resolveIndexerArtifactPolicyEligibility({
      profile_id: authority.profile.id,
      canonical_facts: { target: { eligible: true } },
      provider_supported_variants: artifactPolicy.supported_policy_variants,
      profile_contract: authority.profile_contract,
      operator_contract: authority.operator_contract,
    });
    return plan.groups.map((group) => {
      const members = groupMembers({
        partition,
        plan,
        group,
      });
      const origins = originsForGroup({ partition, group });
      const scopeChange = [...new Set(origins.flatMap((origin) => origin.group.scope_change?.removed_member_ids ?? []))].sort();
      const binding = mergeIndexerAuthorSourceBindings(origins.filter((origin) =>
        origin.binding.source_ref === partition.workset.source_ref &&
        origin.binding.module_ref === partition.workset.module_ref
      ).map((origin) => origin.binding));
      // Each origin was checked against its exact Partition projection by the
      // source resolver. The merged source binding covers several shards and
      // must not be compared to the first shard's local dependency digest.
      const view = buildProjectIndexerAuthorDependencyView({
        primary_binding: binding,
        synthetic_plan: plan,
        synthetic_group: group,
        synthetic_members: members,
        origins,
      });
      const targetResolutionView = takeProjectIndexerGroupTargetView({
        views,
        partition_workset_digest: partition.workset.workset_digest,
        group,
      });
      return {
        partition,
        authority,
        binding,
        group,
        scopeChange,
        members,
        dependency_view: view,
        supplementary_sources: origins.flatMap((origin) =>
          origin.binding.source_ref === binding.source_ref &&
              origin.binding.module_ref === binding.module_ref
            ? []
            : [{
                indexer_id: origin.partition.workset.indexer_id,
                source_ref: origin.binding.source_ref,
                module_ref: origin.binding.module_ref,
                profile_contract_digest: origin.binding.profile_contract_digest,
                source_binding_digest: origin.binding.source_binding_digest,
              }]
        ),
        eligibility,
        allowed_question_targets: resolveProjectIndexerAuthorQuestionTargets({
          registry: input.registry,
          inventory,
          authority,
          group,
        }),
        group_context: {
          partition_workset_digest: partition.workset.workset_digest,
          group_key: group.group_key,
          group_dependency_view_digest: view.view_digest,
          allowed_artifact_policy_variants: eligibility.eligible_variants.map((variant) =>
            variant.id
          ),
          artifact_policy_eligibility_digest: eligibility.eligibility_digest,
          ...(targetResolutionView === undefined
            ? {}
            : { target_resolution_view: targetResolutionView }),
        },
      };
    });
  });
  if (views.size > 0) {
    throw new TypeError("target resolution views contain unknown partition groups");
  }
  const built = buildIndexerMainAuthorWorksets({
    partitions: input.partitions,
    group_contexts: preparations.map((item) => item.group_context),
  });
  const groupIdentity = (value: {
    indexer_id: string;
    requirement_ref: string;
    source_ref: string;
    module_ref: string | null;
    partition_plan_binding_digest: string;
    group_key: string;
  }) => [
    value.indexer_id,
    value.requirement_ref,
    value.source_ref,
    value.module_ref ?? "",
    value.partition_plan_binding_digest,
    value.group_key,
  ].join("\u0000");
  const preparationByGroup = new Map(preparations.map((item) => [
    groupIdentity({
      indexer_id: item.partition.workset.indexer_id,
      requirement_ref: item.partition.workset.requirement_ref,
      source_ref: item.partition.workset.source_ref,
      module_ref: item.partition.workset.module_ref,
      partition_plan_binding_digest: indexerPartitionGroupBindingDigest(
        item.partition.plan,
        item.group.group_key,
      ),
      group_key: item.group.group_key,
    }),
    item,
  ]));
  if (preparationByGroup.size !== preparations.length) {
    throw new TypeError("author preparation contains duplicate group identities");
  }
  const stream = await readPartitionStream(input.projectRoot);
  const approvedStructure = stream ? await readKnowledgeStructure(input.projectRoot) : undefined;
  const runSpecs = await Promise.all(built.worksets.map(async (partitionWorkset) => {
    const prepared = preparationByGroup.get(groupIdentity(partitionWorkset));
    if (prepared === undefined) {
      throw new TypeError(`author run preparation is missing ${partitionWorkset.group_key}`);
    }
    // The accepted grouping stays intact. A newly prepared Author request uses
    // current instructions without pretending its parent used the same bundle.
    const base = stream ? await streamingAuthorBase(input.projectRoot, partitionWorkset.logical_unit_ref, approvedStructure) : undefined;
    const workset = buildIndexerMainWorkset({ ...currentExecutionWorksetFields({
      workset: partitionWorkset, execution: prepared.authority.primary_execution,
    }), ...(base === undefined ? {} : { repair_intent: base }) });
    if (workset.stage !== "author") throw new TypeError("expected author workset");
    const selectedFactRefs = prepared.dependency_view.positive_nodes.flatMap((node) =>
      node.kind === "selected-fact" && prepared.binding.adapter === "parser-facts" &&
          prepared.binding.parser_fact_index.has(node.fact_ref)
        ? [node.fact_ref]
        : []
    );
    let enrichment: Awaited<ReturnType<typeof materializeCurrentIndexerExtensionFacts>> | undefined;
    if (prepared.binding.adapter === "parser-facts") {
      try {
        enrichment = await materializeCurrentIndexerExtensionFacts({
          projectRoot: input.projectRoot,
          authority: prepared.authority,
          workset_digest: workset.workset_digest,
          target_ref: workset.logical_unit_ref,
          parser_fact_view: prepared.binding.parser_fact_view,
          selected_fact_refs: selectedFactRefs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TypeError(
          `extension fact materialization failed for ${workset.indexer_id}/${workset.group_key}: ${message}`,
          { cause: error },
        );
      }
    }
    return buildCurrentProjectIndexerAuthorRunSpec({
      workset,
      binding: prepared.binding,
      authority: prepared.authority,
      registry: input.registry,
      dependency_view: prepared.dependency_view,
      canonical_inventory_members: prepared.members,
      expected_subject_key: prepared.group.subject_key,
      page_template: await loadSelectedPageTemplate({ projectRoot: input.projectRoot, authority: prepared.authority, templateId: prepared.scopeChange.length ? undefined : prepared.group.template_id }),
      page_plan: Object.fromEntries(Object.entries({
        reader_task: prepared.group.reader_task,
        outline: prepared.group.outline,
        artifact_intent: prepared.scopeChange.length ? undefined : prepared.group.artifact_intent,
        template_id: prepared.scopeChange.length ? undefined : prepared.group.template_id,
        scope_change: prepared.scopeChange.length ? { removed_member_ids: prepared.scopeChange } : undefined,
        priority: prepared.group.priority,
        delivery_boundary: prepared.group.delivery_boundary,
        ready_for_author: prepared.group.ready_for_author,
      }).filter(([, value]) => value !== undefined)),
      artifact_policy_eligibility: prepared.eligibility,
      allowed_question_targets: prepared.allowed_question_targets,
      ...(enrichment === undefined ? {} : { enrichment }),
      supplementary_sources: prepared.supplementary_sources,
    });
  }));
  const currentRuns = await reuseCurrentIndexerRuns({ projectRoot: input.projectRoot, specs: runSpecs });
  const currentWorksets = currentRuns.map((spec) => {
    if (spec.request.workset.stage !== "author") throw new TypeError("expected author workset");
    return spec.request.workset;
  });
  return {
    requirement_set_digest: inventory.requirement_set_digest,
    obsolete_scope: summarizeIndexerObsoleteScope(currentRuns, {
      titles: new Map(preparations.map((item) => [item.group.group_key, item.group.label])),
      deprecated_member_ids: new Set(preparations.flatMap((item) => item.members.flatMap((member) => {
        if (item.binding.adapter !== "parser-facts") return [];
        const payload = item.binding.parser_fact_index.get(member.member_id)?.fact.payload;
        return payload !== null && typeof payload === "object" && !Array.isArray(payload) && payload.deprecated === true
          ? [member.member_id] : [];
      }))),
    }),
    worksets: currentWorksets,
    workset_set: buildIndexerMainWorksetSet(currentWorksets),
    run_specs: currentRuns,
  };
}
