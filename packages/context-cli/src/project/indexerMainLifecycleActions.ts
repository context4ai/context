import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerMainAuthorWorksets,
  buildIndexerMainPartitionWorksets,
  buildIndexerQuestionTargetInventory,
  buildIndexerSubjectCatalog,
  buildIndexerTargetResolutionViews,
  evaluateIndexerCandidateMaterialization,
  indexerRegistryDigests,
  observeIndexerMainWorksetState,
  ownerCells,
  parseIndexerRegistry,
  projectIndexerPartitionSubjects,
  validateAndRecordIndexerMainRun,
  validateIndexerTargetResolutionView,
  type IndexerAuthorGroupContext,
  type IndexerPartitionValidationInput,
  type IndexerRegistry,
} from "@c4a/context";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function protocol(
  value: Record<string, unknown>,
  expected: string,
  label: string,
): void {
  if (value.protocol !== expected) {
    throw new TypeError(`${label}.protocol must be ${expected}`);
  }
}

async function currentRegistry(projectRoot: string): Promise<IndexerRegistry> {
  return parseIndexerRegistry(await readFile(
    join(projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
}

async function assertCurrentRequirement(
  projectRoot: string,
  digest: unknown,
): Promise<IndexerRegistry> {
  const registry = await currentRegistry(projectRoot);
  if (
    typeof digest !== "string" ||
    digest !== indexerRegistryDigests(registry).requirementSetDigest
  ) {
    throw new TypeError("main Indexer lifecycle input targets a stale requirement set");
  }
  return registry;
}

function assertRequirementRefs(
  registry: IndexerRegistry,
  refs: readonly unknown[],
): void {
  const allowed = new Set(registry.requirements.map((item) => `requirement:${item.id}`));
  for (const ref of refs) {
    if (typeof ref !== "string" || !allowed.has(ref)) {
      throw new TypeError(`main Indexer lifecycle references unknown requirement ${String(ref)}`);
    }
  }
}

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

export async function buildProjectIndexerQuestionTargetInventory(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "question target inventory input");
  protocol(
    value,
    "context.indexer.question-target-inventory-input/v1",
    "question target inventory input",
  );
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    value.requirement_set_digest,
  );
  assertRequirementRefs(
    registry,
    array(value.items, "question target inventory input.items").map((item) =>
      record(item, "question target inventory item").requirement_ref
    ),
  );
  return buildIndexerQuestionTargetInventory(
    value as Parameters<typeof buildIndexerQuestionTargetInventory>[0],
  );
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
  const worksets = array(value.worksets, "partition workset input.worksets");
  const requirementDigests = new Set(worksets.map((candidate) =>
    record(candidate, "partition workset").requirement_set_digest
  ));
  if (requirementDigests.size !== 1) {
    throw new TypeError("partition worksets must target one requirement set");
  }
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    [...requirementDigests][0],
  );
  assertRequirementRefs(
    registry,
    worksets.map((candidate) => record(candidate, "partition workset").requirement_ref),
  );
  const built = buildIndexerMainPartitionWorksets(
    worksets as Parameters<typeof buildIndexerMainPartitionWorksets>[0],
  );
  assertClosedOwnerCohorts(registry, built.worksets);
  return {
    protocol: "context.indexer.main-partition-workset-build/v1" as const,
    ...built,
  };
}

export async function validateProjectIndexerMainRun(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "main Indexer run validation input");
  protocol(
    value,
    "context.indexer.main-run-validation-input/v1",
    "main Indexer run validation input",
  );
  const request = record(value.request, "main Indexer run request");
  const workset = record(request.workset, "main Indexer run workset");
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    workset.requirement_set_digest,
  );
  assertRequirementRefs(registry, [workset.requirement_ref]);
  try {
    return {
      protocol: "context.indexer.main-run-validation/v1" as const,
      ...validateAndRecordIndexerMainRun(
        value as Parameters<typeof validateAndRecordIndexerMainRun>[0],
      ),
      graph_outcome: "completed" as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = message.includes("index-target-resolution-ambiguous")
      ? "index-target-resolution-ambiguous" as const
      : message.includes("index-target-resolution-invalid")
      ? "index-target-resolution-invalid" as const
      : undefined;
    if (outcome === undefined) throw error;
    return {
      protocol: "context.indexer.target-resolution-outcome/v1" as const,
      outcome,
      conflicts: [],
      message,
      graph_outcome: outcome === "index-target-resolution-ambiguous"
        ? "blocked" as const
        : "failed" as const,
    };
  }
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

export async function buildProjectIndexerMainAuthorWorksets(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "author workset input");
  protocol(
    value,
    "context.indexer.main-author-workset-build-input/v1",
    "author workset input",
  );
  const partitions = array(
    value.partitions,
    "author workset input.partitions",
  ) as unknown as IndexerPartitionValidationInput[];
  const requirementDigests = new Set(partitions.map((partition) =>
    partition.workset.requirement_set_digest
  ));
  if (requirementDigests.size !== 1) {
    throw new TypeError("author workset partitions must target one requirement set");
  }
  const registry = await assertCurrentRequirement(
    input.projectRoot,
    [...requirementDigests][0],
  );
  assertRequirementRefs(
    registry,
    partitions.map((partition) => partition.workset.requirement_ref),
  );
  const groupContexts = array(
    value.group_contexts,
    "author workset input.group_contexts",
  ) as unknown as IndexerAuthorGroupContext[];
  const conflicts = groupContexts.flatMap((context) => {
    if (context.target_resolution_view === undefined) return [];
    const view = validateIndexerTargetResolutionView(context.target_resolution_view);
    return view.entries.flatMap((entry) => entry.state === "ambiguous" ? [{
      partition_workset_digest: context.partition_workset_digest,
      group_key: context.group_key,
      query_ref: entry.query_ref,
      conflicting_node_refs: entry.conflicting_node_refs,
    }] : []);
  });
  if (conflicts.length > 0) {
    return {
      protocol: "context.indexer.target-resolution-outcome/v1" as const,
      outcome: "index-target-resolution-ambiguous" as const,
      conflicts,
      message: "an exact SubjectKey query resolves to multiple current Nodes",
      graph_outcome: "blocked" as const,
    };
  }
  const built = buildIndexerMainAuthorWorksets({
    partitions,
    group_contexts: groupContexts,
  });
  return {
    protocol: "context.indexer.main-author-workset-build/v1" as const,
    ...built,
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
