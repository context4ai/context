import {
  buildIndexerMainPartitionWorksets,
  buildIndexerSubjectCatalog,
  buildIndexerTargetResolutionViews,
  evaluateIndexerCandidateMaterialization,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  indexerSubjectKeySchemaDigest,
  observeIndexerMainWorksetState,
  ownerCells,
  projectIndexerPartitionSubjects,
  validateIndexerQuestionTargetInventory,
  type IndexerProfileContract,
  type IndexerRegistry,
  type IndexerPartitionValidationInput,
} from "@c4a/context";
import { posix } from "node:path";
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
  assertRequirementRefs,
  protocol,
  record,
} from "./indexerMainLifecycleSupport.js";
import { buildProjectIndexerQuestionTargetInventory } from
  "./indexerQuestionTargetInventoryActions.js";
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

function codePartitionShardKey(
  binding: Extract<Awaited<ReturnType<typeof resolveProjectIndexerMainSourceBinding>>, {
    adapter: "parser-facts";
  }>,
  member: { member_id: string; member_kind: string },
): string {
  const directFact = binding.parser_fact_index.get(member.member_id);
  const file = directFact === undefined
    ? binding.parser_fact_view.files.find((candidate) =>
        candidate.file_ref === member.member_id
      )
    : binding.parser_fact_view.files.find((candidate) =>
        candidate.file_ref === directFact.file_ref
      );
  const directory = file === undefined
    ? "."
    : posix.dirname(file.normalized_path);
  return directory;
}

function partitionInventoryShards(
  binding: Awaited<ReturnType<typeof resolveProjectIndexerMainSourceBinding>>,
) {
  if (binding.adapter === "captured-documents") {
    return [{
      inventory: binding.partition_inventory,
      question_carrier_score: binding.partition_inventory.length,
    }];
  }
  const shards = new Map<string, typeof binding.partition_inventory>();
  for (const member of binding.partition_inventory) {
    const key = codePartitionShardKey(binding, member);
    const values = shards.get(key) ?? [];
    values.push(member);
    shards.set(key, values);
  }
  return [...shards.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, members]) => ({
      inventory: members,
      question_carrier_score: members.filter((member) =>
        binding.parser_fact_index.has(member.member_id)
      ).length,
    }));
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

function referenceIdentity(value: string): string {
  const separator = value.indexOf(":");
  const body = separator < 0 ? value : value.slice(separator + 1);
  const parts = body.split("/").filter(Boolean);
  return parts.at(-1) ?? body;
}

function normalizedSubjectValue(value: string, rules: readonly string[]): string {
  let normalized = rules.includes("trim") ? value.trim() : value;
  if (rules.includes("unicode-nfc")) normalized = normalized.normalize("NFC");
  if (rules.includes("lowercase")) normalized = normalized.toLocaleLowerCase("en-US");
  return normalized;
}

function questionTargetSubjectKey(input: {
  profile_contract: IndexerProfileContract;
  profile_id: string;
  subject_kind: string;
  source_ref: string;
  module_ref: string | null;
  normalized_path: string | null;
}) {
  const schema = input.profile_contract.subject_key_schemas.find((candidate) =>
    candidate.profile === input.profile_id
  );
  const kind = schema?.kinds.find((candidate) => candidate.id === input.subject_kind);
  if (schema === undefined || kind === undefined) {
    throw new TypeError(`question target SubjectKey schema is missing for ${input.profile_id}`);
  }
  const sourceIdentity = referenceIdentity(input.source_ref);
  const moduleIdentity = input.module_ref === null
    ? sourceIdentity
    : referenceIdentity(input.module_ref);
  const namespace = (() => {
    switch (schema.namespace.operator) {
      case "canonical-source-module-namespace":
      case "canonical-service-namespace":
        return moduleIdentity;
      default:
        throw new TypeError(
          `unsupported question target namespace operator ${schema.namespace.operator}`,
        );
    }
  })();
  const localIdentity = (() => {
    switch (kind.local_key.operator) {
      case "canonical-module-identity":
        return input.normalized_path === null
          ? moduleIdentity
          : input.normalized_path.replace(/\.[^./]+$/u, "");
      case "canonical-export-family":
        return input.normalized_path === null
          ? moduleIdentity
          : input.normalized_path.replace(/\.[^./]+$/u, "");
      default:
        throw new TypeError(
          `unsupported question target local-key operator ${kind.local_key.operator}`,
        );
    }
  })();
  const rules = schema.normalization ?? [];
  return {
    protocol: "context.subject-key/v1" as const,
    namespace: normalizedSubjectValue(namespace, rules),
    kind: normalizedSubjectValue(input.subject_kind, rules),
    local_key: normalizedSubjectValue(localIdentity, rules),
  };
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
  const prepared = (await Promise.all([...ownerGroups.values()].map(async (owners) => {
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
    const subjectSchema = authority.profile_contract.subject_key_schemas.find((candidate) =>
      candidate.profile === authority.profile.id
    );
    const targetDomain = authority.profile.question_target_domains[0];
    if (subjectSchema === undefined || targetDomain === undefined) {
      throw new TypeError(`missing partition identity contract for ${authority.profile.id}`);
    }
    const strategies = authority.partition_strategies.strategies.map((entry) => ({
      strategy_ref: entry.strategy_ref,
      strategy_digest: entry.strategy_digest,
    }));
    const { profile: _subjectProfile, ...subjectKeyContract } = subjectSchema;
    void _subjectProfile;
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
      subject_key_schema_digest: indexerSubjectKeySchemaDigest(
        authority.profile.id,
        subjectKeyContract,
      ),
      source_scope_digest: indexerProtocolDigest({
        indexer_id: indexerId,
        read_targets: projectIndexerReadTargets({ registry, indexer_id: indexerId }),
      }),
      source_binding_digest: binding.source_binding_digest,
      primary_resource_binding_digest:
        authority.primary_execution.primary_resource_binding_digest,
      question_target_inventory_digest: questionTargets.inventory_digest,
      partition_subject_key: questionTargetSubjectKey({
        profile_contract: authority.profile_contract,
        profile_id: authority.profile.id,
        subject_kind: targetDomain.subject_key_kind,
        source_ref: first.source_ref,
        module_ref: first.module_ref,
        normalized_path: null,
      }),
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
    const shards = partitionInventoryShards(binding);
    const carrierShardIndex = questionCarrierShardIndex(shards);
    return shards.map(({ inventory }, shardIndex) => ({
      input: {
        ...base,
        partition_inventory_digest: indexerInventoryMembersDigest(inventory),
        allowed_question_target_refs: shardIndex === carrierShardIndex ? allowedTargets : [],
      },
      inventory,
      authority,
      binding,
    }));
  }))).flat();
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
    const enrichment = item.binding.adapter === "parser-facts"
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
      ...(enrichment === undefined ? {} : { enrichment }),
    });
  }));
  return {
    protocol: "context.indexer.main-partition-workset-build/v1" as const,
    requirement_set_digest: questionTargets.requirement_set_digest,
    ...built,
    run_specs: runSpecs,
    graph_outcome: "completed" as const,
  };
}

export async function buildProjectIndexerSubjectCatalog(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "subject catalog input");
  protocol(
    value,
    "context.indexer.subject-catalog-build-input/v1",
    "subject catalog input",
  );
  const partitions = array(
    value.partitions,
    "subject catalog input.partitions",
  ) as unknown as IndexerPartitionValidationInput[];
  const requirementDigests = new Set(partitions.map((partition) =>
    partition.workset.requirement_set_digest
  ));
  if (requirementDigests.size !== 1) {
    throw new TypeError("subject catalog partitions must target one requirement set");
  }
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    [...requirementDigests][0],
  );
  assertRequirementRefs(registry, [value.requirement_ref]);
  return buildIndexerSubjectCatalog({
    requirement_ref: String(value.requirement_ref ?? ""),
    subject_key_schema_digest: String(value.subject_key_schema_digest ?? ""),
    approved_subjects: array(value.approved_subjects, "approved_subjects"),
    partition_subjects: projectIndexerPartitionSubjects(partitions),
  });
}

export async function buildProjectIndexerTargetResolutionViews(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "target resolution input");
  protocol(
    value,
    "context.indexer.target-resolution-build-input/v1",
    "target resolution input",
  );
  const catalog = record(value.catalog, "target resolution catalog");
  const requirementDigest = value.requirement_set_digest;
  const registry = await assertCurrentRequirement(input.projectRoot, requirementDigest);
  assertRequirementRefs(registry, [catalog.requirement_ref]);
  const built = buildIndexerTargetResolutionViews({
    catalog,
    queries: array(value.queries, "target resolution queries") as Parameters<
      typeof buildIndexerTargetResolutionViews
    >[0]["queries"],
  });
  const conflicts = built.views.flatMap(({ group_ref, view }) =>
    view.entries.flatMap((entry) => entry.state === "ambiguous" ? [{
      group_ref,
      query_ref: entry.query_ref,
      conflicting_node_refs: entry.conflicting_node_refs,
    }] : [])
  );
  return {
    protocol: "context.indexer.target-resolution-build/v1" as const,
    ...built,
    outcome: conflicts.length === 0
      ? "target-resolution-current" as const
      : "index-target-resolution-ambiguous" as const,
    conflicts,
    graph_outcome: conflicts.length === 0 ? "completed" as const : "blocked" as const,
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
