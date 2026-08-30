import { z } from "zod";
import {
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  validateIndexerMainWorksetSet,
  validateIndexerTargetResolutionView,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerMainWorksetSet,
  type IndexerTargetResolutionView,
} from "./indexerMainWorkset.js";
import {
  validateIndexerMainRunResult,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
} from "./indexerMainRunProtocol.js";
import {
  indexerPartitionGroupProjectionDigest,
  indexerPartitionPlanBindingDigest,
  validateIndexerPartitionPlan,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "./indexerPartitionPlan.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerInventoryMembersDigest,
  type IndexerInventoryMember,
} from "./indexerInventoryDisposition.js";
import {
  indexerTargetQueryRef,
  type IndexerPartitionSubject,
} from "./indexerSubjectCatalog.js";

export interface IndexerPartitionValidationInput {
  plan: unknown;
  workset: IndexerMainPartitionWorkset;
  canonical_inventory_members: readonly IndexerInventoryMember[];
  authorized_source_refs: readonly string[];
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: readonly string[];
}

export function validateIndexerPartitionInputs(
  inputs: readonly IndexerPartitionValidationInput[],
): Array<{ workset: IndexerMainPartitionWorkset; plan: IndexerPartitionPlan }> {
  return inputs.map((input) => ({
    workset: input.workset,
    plan: validateIndexerPartitionPlan(input),
  }));
}

export function indexerPartitionGroupRef(input: {
  partition_workset_digest: string;
  group_key: string;
}): string {
  return `partition-group:${indexerProtocolDigest(input)}`;
}

export function projectIndexerPartitionSubjects(
  inputs: readonly IndexerPartitionValidationInput[],
): IndexerPartitionSubject[] {
  return validateIndexerPartitionInputs(inputs).flatMap(({ workset, plan }) => {
    if (plan.status !== "complete") {
      throw new TypeError("failed PartitionPlan cannot enter the subject catalog");
    }
    return plan.groups.map((group) => ({
      partition_workset_digest: workset.workset_digest,
      partition_plan_digest: plan.canonical_hash,
      group_key: group.group_key,
      node_ref: group.logical_unit_ref,
      subject_key: group.subject_key,
    }));
  }).sort((left, right) => compareIndexerCanonicalText(
    `${left.partition_workset_digest}\u0000${left.group_key}`,
    `${right.partition_workset_digest}\u0000${right.group_key}`,
  ));
}

type PartitionWorksetInput = Parameters<typeof buildIndexerMainWorkset>[0] & {
  stage: "partition";
};

export function buildIndexerMainPartitionWorksets(
  inputs: readonly PartitionWorksetInput[],
): { worksets: IndexerMainPartitionWorkset[]; workset_set: IndexerMainWorksetSet } {
  const worksets = inputs.map((input) => {
    const workset = buildIndexerMainWorkset(input);
    if (workset.stage !== "partition") throw new TypeError("expected partition workset");
    return workset;
  });
  return { worksets, workset_set: buildIndexerMainWorksetSet(worksets) };
}

export interface IndexerAuthorGroupContext {
  partition_workset_digest: string;
  group_key: string;
  group_dependency_view_digest: string;
  allowed_artifact_policy_variants: readonly string[];
  artifact_policy_eligibility_digest: string;
  target_resolution_view?: IndexerTargetResolutionView;
}

export function buildIndexerMainAuthorWorksets(input: {
  partitions: readonly IndexerPartitionValidationInput[];
  group_contexts: readonly IndexerAuthorGroupContext[];
}): { worksets: IndexerMainAuthorWorkset[]; workset_set: IndexerMainWorksetSet } {
  const partitions = validateIndexerPartitionInputs(input.partitions);
  const contextByGroup = new Map(input.group_contexts.map((context) => [
    `${context.partition_workset_digest}\u0000${context.group_key}`,
    context,
  ]));
  if (contextByGroup.size !== input.group_contexts.length) {
    throw new TypeError("author group contexts must have unique partition/group identities");
  }
  const worksets = partitions.flatMap(({ workset, plan }) => {
    if (plan.status !== "complete") {
      throw new TypeError("failed PartitionPlan cannot produce author worksets");
    }
    return plan.groups.map((group) => {
      const identity = `${workset.workset_digest}\u0000${group.group_key}`;
      const context = contextByGroup.get(identity);
      if (context === undefined) {
        throw new TypeError(`author group context is missing for ${group.group_key}`);
      }
      const view = context.target_resolution_view === undefined
        ? undefined
        : validateIndexerTargetResolutionView(context.target_resolution_view);
      if (group.subject_intent === "primary" && view !== undefined) {
        throw new TypeError("primary partition group must not receive a TargetResolutionView");
      }
      if (group.subject_intent === "enrich-or-independent") {
        if (view === undefined) {
          throw new TypeError("enrich-or-independent group requires a TargetResolutionView");
        }
        const expectedQuery = indexerTargetQueryRef({
          subject_intent: group.subject_intent,
          subject_key: group.subject_key,
          subject_key_schema_digest: workset.subject_key_schema_digest,
        });
        if (
          view.requirement_ref !== workset.requirement_ref ||
          view.subject_key_schema_digest !== workset.subject_key_schema_digest ||
          view.entries.length !== 1 ||
          view.entries[0]?.query_ref !== expectedQuery
        ) {
          throw new TypeError("TargetResolutionView does not match its partition group query");
        }
      }
      const author = buildIndexerMainWorkset({
        stage: "author",
        indexer_id: workset.indexer_id,
        requirement_ref: workset.requirement_ref,
        owner_cell_refs: workset.owner_cell_refs,
        source_ref: workset.source_ref,
        module_ref: workset.module_ref,
        primary_registry_projection_digest: workset.primary_registry_projection_digest,
        requirement_set_digest: workset.requirement_set_digest,
        primary_execution_fingerprint: workset.primary_execution_fingerprint,
        profile_contract_digest: workset.profile_contract_digest,
        subject_key_schema_digest: workset.subject_key_schema_digest,
        source_scope_digest: workset.source_scope_digest,
        parser_contract_digest: workset.parser_contract_digest,
        primary_resource_binding_digest: workset.primary_resource_binding_digest,
        question_target_inventory_digest: workset.question_target_inventory_digest,
        partition_plan_binding_digest: indexerPartitionPlanBindingDigest(plan),
        group_key: group.group_key,
        logical_unit_ref: group.logical_unit_ref,
        member_ids_digest: indexerProtocolDigest({ member_ids: group.member_ids }),
        member_inventory_digest: indexerInventoryMembersDigest(
          plan.member_dispositions
            .filter((disposition) =>
              disposition.inventory_disposition === "owned" &&
              disposition.group_key === group.group_key
            )
            .map((disposition) => ({
              member_id: disposition.member_id,
              member_kind: disposition.member_kind,
            })),
        ),
        group_projection_digest: indexerPartitionGroupProjectionDigest(
          plan,
          group.group_key,
        ),
        group_dependency_view_digest: context.group_dependency_view_digest,
        ...(view === undefined ? {} : { target_resolution_view: view }),
        allowed_artifact_policy_variants: [...context.allowed_artifact_policy_variants],
        artifact_policy_eligibility_digest: context.artifact_policy_eligibility_digest,
      });
      if (author.stage !== "author") throw new TypeError("expected author workset");
      contextByGroup.delete(identity);
      return author;
    });
  });
  if (contextByGroup.size > 0) {
    throw new TypeError("author group contexts contain unknown partition groups");
  }
  return { worksets, workset_set: buildIndexerMainWorksetSet(worksets) };
}

export const indexerMainAcceptedRecordSchema = z.object({
  protocol: z.literal("context.indexer.main-accepted-result/v1"),
  workset_digest: indexerDigestSchema,
  stage: z.enum(["partition", "author"]),
  execution_request_digest: indexerDigestSchema,
  result_digest: indexerDigestSchema,
  receipt_digest: indexerDigestSchema,
  run_envelope_digest: indexerDigestSchema,
  artifact_dependency_set_digest: indexerDigestSchema.nullable(),
  acceptance_digest: indexerDigestSchema,
}).strict();

export type IndexerMainAcceptedRecord = z.infer<
  typeof indexerMainAcceptedRecordSchema
>;

export function validateIndexerMainAcceptedRecord(
  value: unknown,
): IndexerMainAcceptedRecord {
  const record = indexerMainAcceptedRecordSchema.parse(value);
  if (
    (record.stage === "author") !==
      (record.artifact_dependency_set_digest !== null)
  ) {
    throw new TypeError(
      "accepted author records require an Artifact dependency set and partition records forbid one",
    );
  }
  return record;
}

export function buildIndexerMainAcceptedRecord(input: {
  request: IndexerMainRunRequest;
  result: IndexerMainRunResult;
  run_envelope: ReturnType<typeof validateIndexerMainRunResult>["run_envelope"];
  artifact_dependency_set: ReturnType<
    typeof validateIndexerMainRunResult
  >["artifact_dependency_set"];
}): IndexerMainAcceptedRecord {
  const payload = {
    protocol: "context.indexer.main-accepted-result/v1" as const,
    workset_digest: input.request.workset.workset_digest,
    stage: input.request.workset.stage,
    execution_request_digest: input.request.execution_request_digest,
    result_digest: indexerProtocolDigest(input.result.result.result),
    receipt_digest: indexerProtocolDigest({
      consumed_input_view_digest: input.result.consumed_input_view_digest,
      workset_read_receipt_digests: input.result.workset_read_receipt_digests,
    }),
    run_envelope_digest: input.run_envelope.envelope_digest,
    artifact_dependency_set_digest:
      input.artifact_dependency_set?.dependency_set_digest ?? null,
  };
  return validateIndexerMainAcceptedRecord({
    ...payload,
    acceptance_digest: indexerProtocolDigest(payload),
  });
}

export function validateAndRecordIndexerMainRun(input: Parameters<
  typeof validateIndexerMainRunResult
>[0]): ReturnType<typeof validateIndexerMainRunResult> & {
  accepted_record: IndexerMainAcceptedRecord;
} {
  const validated = validateIndexerMainRunResult(input);
  return {
    ...validated,
    accepted_record: buildIndexerMainAcceptedRecord(validated),
  };
}

export const indexerMainStateRecordSchema = z.union([
  z.object({
    workset_digest: indexerDigestSchema,
    state: z.literal("pending"),
  }).strict(),
  z.object({
    workset_digest: indexerDigestSchema,
    state: z.literal("running"),
    execution_request_digest: indexerDigestSchema,
  }).strict(),
  indexerMainAcceptedRecordSchema.extend({ state: z.literal("accepted") }).strict(),
  z.object({
    workset_digest: indexerDigestSchema,
    state: z.literal("failed"),
    execution_request_digest: indexerDigestSchema,
    reason_code: indexerIdSchema,
    dependency_digests: z.array(indexerDigestSchema),
  }).strict(),
  z.object({
    workset_digest: indexerDigestSchema,
    state: z.literal("stale"),
    previous_workset_digest: indexerDigestSchema,
  }).strict(),
]);

export type IndexerMainStateRecord = z.infer<typeof indexerMainStateRecordSchema>;

const mainNextRefSchema = z.object({
  workset_digest: indexerDigestSchema,
  stage: z.enum(["partition", "author"]),
  indexer_id: indexerIdSchema,
  owner_cohort_ref: indexerDigestSchema,
  group_key: z.string().min(1).optional(),
  state: z.enum(["pending", "failed", "stale"]),
}).strict();

export const indexerMainWorksetStatusSchema = z.object({
  protocol: z.literal("context.indexer.main-workset-status/v1"),
  workset_set_digest: indexerDigestSchema,
  total_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  accepted_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  stale_count: z.number().int().nonnegative(),
  next_refs: z.array(mainNextRefSchema),
  accepted_result_set_digest: indexerDigestSchema,
  outcome: z.enum([
    "complete",
    "index-main-workset-pending",
    "index-main-workset-failed",
    "index-main-workset-stale",
  ]),
  can_advance: z.boolean(),
  status_digest: indexerDigestSchema,
}).strict();

export type IndexerMainWorksetStatus = z.infer<typeof indexerMainWorksetStatusSchema>;

export function observeIndexerMainWorksetState(input: {
  workset_set: unknown;
  records: readonly unknown[];
}): IndexerMainWorksetStatus {
  const currentSet = validateIndexerMainWorksetSet(input.workset_set);
  const records = input.records.map((value) => {
    const record = indexerMainStateRecordSchema.parse(value);
    if (record.state === "accepted") {
      const { state: _state, ...accepted } = record;
      void _state;
      validateIndexerMainAcceptedRecord(accepted);
    }
    return record;
  });
  if (new Set(records.map((record) => record.workset_digest)).size !== records.length) {
    throw new TypeError("main workset state contains duplicate workset records");
  }
  const byDigest = new Map(records.map((record) => [record.workset_digest, record]));
  const currentItems = new Map(currentSet.items.map((item) => [item.workset_digest, item]));
  for (const record of records) {
    const item = currentItems.get(record.workset_digest);
    if (item === undefined) {
      throw new TypeError("main workset state contains a record outside the current set");
    }
    if (record.state === "accepted") {
      const payload = {
        protocol: record.protocol,
        workset_digest: record.workset_digest,
        stage: record.stage,
        execution_request_digest: record.execution_request_digest,
        result_digest: record.result_digest,
        receipt_digest: record.receipt_digest,
        run_envelope_digest: record.run_envelope_digest,
        artifact_dependency_set_digest: record.artifact_dependency_set_digest,
      };
      if (
        record.stage !== item.stage ||
        indexerProtocolDigest(payload) !== record.acceptance_digest
      ) {
        throw new TypeError("accepted main result record is stale or has an invalid digest");
      }
    }
    if (record.state === "failed") {
      const dependencies = [...record.dependency_digests].sort(
        compareIndexerCanonicalText,
      );
      if (
        new Set(dependencies).size !== dependencies.length ||
        dependencies.some((digest, index) =>
          digest !== record.dependency_digests[index]
        )
      ) {
        throw new TypeError("failed main result dependencies must be unique and canonical");
      }
    }
  }
  const joined = currentSet.items.map((item) => ({
    item,
    record: byDigest.get(item.workset_digest) ?? {
      workset_digest: item.workset_digest,
      state: "pending" as const,
    },
  }));
  const counts = {
    pending: joined.filter(({ record }) => record.state === "pending" || record.state === "running").length,
    accepted: joined.filter(({ record }) => record.state === "accepted").length,
    failed: joined.filter(({ record }) => record.state === "failed").length,
    stale: joined.filter(({ record }) => record.state === "stale").length,
  };
  const nextRefs = joined.filter(({ record }) =>
    record.state !== "accepted" && record.state !== "running"
  ).map(({ item, record }) => ({
    ...item,
    state: record.state as "pending" | "failed" | "stale",
  }));
  const accepted = joined.filter(
    (item): item is typeof item & { record: IndexerMainAcceptedRecord & { state: "accepted" } } =>
      item.record.state === "accepted",
  ).map(({ record }) => ({
    workset_digest: record.workset_digest,
    execution_request_digest: record.execution_request_digest,
    result_digest: record.result_digest,
    receipt_digest: record.receipt_digest,
    run_envelope_digest: record.run_envelope_digest,
    artifact_dependency_set_digest: record.artifact_dependency_set_digest,
  })).sort((left, right) => compareIndexerCanonicalText(
    left.workset_digest,
    right.workset_digest,
  ));
  const outcome = counts.failed > 0
    ? "index-main-workset-failed" as const
    : counts.stale > 0
    ? "index-main-workset-stale" as const
    : counts.pending > 0
    ? "index-main-workset-pending" as const
    : "complete" as const;
  const payload = {
    protocol: "context.indexer.main-workset-status/v1" as const,
    workset_set_digest: currentSet.workset_set_digest,
    total_count: currentSet.items.length,
    pending_count: counts.pending,
    accepted_count: counts.accepted,
    failed_count: counts.failed,
    stale_count: counts.stale,
    next_refs: nextRefs,
    accepted_result_set_digest: indexerProtocolDigest({
      protocol: "context.indexer.accepted-main-result-set/v1",
      results: accepted,
    }),
    outcome,
    can_advance: outcome === "complete",
  };
  return indexerMainWorksetStatusSchema.parse({
    ...payload,
    status_digest: indexerProtocolDigest(payload),
  });
}
