import { z } from "zod";
import {
  indexerCanonicalRefSchema,
} from "./indexerLayerComposition.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const indexerRepairIntentPayloadSchema = z.object({
  target_ref: z.string().min(1),
  instruction: z.string().trim().min(1),
  current_markdown: z.string().optional(),
}).strict();

export const indexerRepairIntentSchema = indexerRepairIntentPayloadSchema.extend({
  intent_digest: indexerDigestSchema,
}).strict();

export type IndexerRepairIntent = z.infer<typeof indexerRepairIntentSchema>;

export function buildIndexerRepairIntent(input: {
  target_ref: string;
  instruction: string;
  current_markdown?: string;
}): IndexerRepairIntent {
  const payload = indexerRepairIntentPayloadSchema.parse(input);
  return indexerRepairIntentSchema.parse({
    ...payload,
    intent_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerRepairIntent(value: unknown): IndexerRepairIntent {
  const intent = indexerRepairIntentSchema.parse(value);
  const { intent_digest: _digest, ...payload } = intent;
  void _digest;
  if (indexerProtocolDigest(payload) !== intent.intent_digest) {
    throw new TypeError("Indexer repair intent digest is invalid");
  }
  return intent;
}

const mainWorksetBaseFields = {
  protocol: z.literal("context.indexer.main-workset/v2"),
  workset_digest: indexerDigestSchema,
  operation: z.literal("main-index"),
  indexer_id: indexerIdSchema,
  requirement_ref: indexerCanonicalRefSchema,
  owner_cell_refs: z.array(indexerCanonicalRefSchema).min(1),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  primary_registry_projection_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  primary_execution_fingerprint: indexerDigestSchema,
  profile_contract_digest: indexerDigestSchema,
  source_scope_digest: indexerDigestSchema,
  source_binding_digest: indexerDigestSchema,
  primary_resource_binding_digest: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
  repair_intent: indexerRepairIntentSchema.optional(),
};

const partitionWorksetSchema = z.object({
  ...mainWorksetBaseFields,
  stage: z.literal("partition"),
  strategy_set_digest: indexerDigestSchema,
  reader_question_refs: z.array(indexerCanonicalRefSchema),
  partition_input_digests: z.array(indexerDigestSchema).min(1),
  partition_inventory_digest: indexerDigestSchema,
  allowed_question_target_refs: z.array(indexerCanonicalRefSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.owner_cell_refs, context, "owner_cell_refs");
  addDuplicateIssues(value.reader_question_refs, context, "reader_question_refs");
  addDuplicateIssues(value.partition_input_digests, context, "partition_input_digests");
  addDuplicateIssues(
    value.allowed_question_target_refs,
    context,
    "allowed_question_target_refs",
  );
});

const authorWorksetSchema = z.object({
  ...mainWorksetBaseFields,
  stage: z.literal("author"),
  partition_plan_binding_digest: indexerDigestSchema,
  group_key: z.string().min(1),
  logical_unit_ref: indexerCanonicalRefSchema,
  member_ids_digest: indexerDigestSchema,
  member_inventory_digest: indexerDigestSchema,
  group_projection_digest: indexerDigestSchema,
  group_dependency_view_digest: indexerDigestSchema,
  allowed_artifact_policy_variants: z.array(indexerIdSchema).min(1),
  artifact_policy_eligibility_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.owner_cell_refs, context, "owner_cell_refs");
  addDuplicateIssues(
    value.allowed_artifact_policy_variants,
    context,
    "allowed_artifact_policy_variants",
  );
});

export const indexerMainWorksetSchema = z.union([
  partitionWorksetSchema,
  authorWorksetSchema,
]);

export type IndexerMainPartitionWorkset = z.infer<typeof partitionWorksetSchema>;
export type IndexerMainAuthorWorkset = z.infer<typeof authorWorksetSchema>;
export type IndexerMainWorkset = z.infer<typeof indexerMainWorksetSchema>;

type MainWorksetPayload =
  | Omit<IndexerMainPartitionWorkset, "workset_digest">
  | Omit<IndexerMainAuthorWorkset, "workset_digest">;

export function indexerMainWorksetDigest(value: MainWorksetPayload): string {
  return indexerProtocolDigest(value);
}

type MainWorksetInput =
  | Omit<
      IndexerMainPartitionWorkset,
      "protocol" | "operation" | "workset_digest"
    >
  | Omit<
      IndexerMainAuthorWorkset,
      "protocol" | "operation" | "workset_digest"
    >;

function sortedUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate values`);
  }
  return sorted;
}

export function buildIndexerMainWorkset(input: MainWorksetInput): IndexerMainWorkset {
  const common = {
    ...input,
    protocol: "context.indexer.main-workset/v2" as const,
    operation: "main-index" as const,
    owner_cell_refs: sortedUnique(input.owner_cell_refs, "owner_cell_refs"),
  };
  const normalized = input.stage === "partition"
    ? {
        ...common,
        reader_question_refs: sortedUnique(
          input.reader_question_refs,
          "reader_question_refs",
        ),
        partition_input_digests: sortedUnique(
          input.partition_input_digests,
          "partition_input_digests",
        ),
        allowed_question_target_refs: sortedUnique(
          input.allowed_question_target_refs,
          "allowed_question_target_refs",
        ),
      }
    : {
        ...common,
        allowed_artifact_policy_variants: sortedUnique(
          input.allowed_artifact_policy_variants,
          "allowed_artifact_policy_variants",
        ),
      };
  if (normalized.repair_intent !== undefined) {
    validateIndexerRepairIntent(normalized.repair_intent);
  }
  const payload = { ...normalized } as MainWorksetPayload;
  return indexerMainWorksetSchema.parse({
    ...payload,
    workset_digest: indexerMainWorksetDigest(payload),
  });
}

export function validateIndexerMainWorkset(value: unknown): IndexerMainWorkset {
  const workset = indexerMainWorksetSchema.parse(value);
  const payload = Object.fromEntries(
    Object.entries(workset).filter(([key]) => key !== "workset_digest"),
  ) as MainWorksetPayload;
  if (indexerMainWorksetDigest(payload) !== workset.workset_digest) {
    throw new TypeError("main Indexer workset digest is invalid");
  }
  const rebuilt = buildIndexerMainWorkset(payload as MainWorksetInput);
  if (rebuilt.workset_digest !== workset.workset_digest) {
    throw new TypeError("main Indexer workset arrays must use canonical ordering");
  }
  return workset;
}

export function indexerOwnerCohortRef(input: {
  requirement_ref: string;
  indexer_id: string;
  source_ref: string;
  module_ref: string | null;
  owner_cell_refs: readonly string[];
}): string {
  return indexerProtocolDigest({
    requirement_ref: input.requirement_ref,
    indexer_id: input.indexer_id,
    source_ref: input.source_ref,
    module_ref: input.module_ref,
    owner_cell_refs: sortedUnique(input.owner_cell_refs, "owner_cell_refs"),
  });
}

export const indexerMainWorksetSetSchema = z.object({
  protocol: z.literal("context.indexer.main-workset-set/v2"),
  workset_set_digest: indexerDigestSchema,
  items: z.array(z.object({
    workset_digest: indexerDigestSchema,
    stage: z.enum(["partition", "author"]),
    indexer_id: indexerIdSchema,
    owner_cohort_ref: indexerDigestSchema,
    partition_key: indexerDigestSchema.optional(),
    partition_binding_digest: indexerDigestSchema.optional(),
    group_key: z.string().min(1).optional(),
  }).strict()),
}).strict();

export type IndexerMainWorksetSet = z.infer<typeof indexerMainWorksetSetSchema>;

export function indexerMainWorksetSetDigest(
  value: Omit<IndexerMainWorksetSet, "workset_set_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerMainWorksetSet(
  values: readonly IndexerMainWorkset[],
): IndexerMainWorksetSet {
  const worksets = values.map(validateIndexerMainWorkset);
  const items = worksets.map((workset): IndexerMainWorksetSet["items"][number] => ({
    workset_digest: workset.workset_digest,
    stage: workset.stage,
    indexer_id: workset.indexer_id,
    owner_cohort_ref: indexerOwnerCohortRef(workset),
    ...(workset.stage === "partition"
      ? { partition_key: indexerProtocolDigest({
          partition_inventory_digest: workset.partition_inventory_digest,
        }) }
      : {
          partition_binding_digest: workset.partition_plan_binding_digest,
          group_key: workset.group_key,
        }),
  })).sort((left, right) => {
    const leftKey = `${left.stage}\u0000${left.owner_cohort_ref}\u0000${left.partition_key ?? left.partition_binding_digest ?? ""}\u0000${left.group_key ?? ""}\u0000${left.workset_digest}`;
    const rightKey = `${right.stage}\u0000${right.owner_cohort_ref}\u0000${right.partition_key ?? right.partition_binding_digest ?? ""}\u0000${right.group_key ?? ""}\u0000${right.workset_digest}`;
    return compareIndexerCanonicalText(leftKey, rightKey);
  });
  if (new Set(items.map((item) => item.workset_digest)).size !== items.length) {
    throw new TypeError("main workset set contains duplicate workset identities");
  }
  const authorGroupIdentities = items
    .filter((item) => item.stage === "author")
    .map((item) =>
      `${item.indexer_id}\u0000${item.owner_cohort_ref}\u0000${item.partition_binding_digest}\u0000${item.group_key}`
    );
  if (new Set(authorGroupIdentities).size !== authorGroupIdentities.length) {
    throw new TypeError("main workset set contains more than one author workset for a group");
  }
  const payload: Omit<IndexerMainWorksetSet, "workset_set_digest"> = {
    protocol: "context.indexer.main-workset-set/v2",
    items,
  };
  return indexerMainWorksetSetSchema.parse({
    ...payload,
    workset_set_digest: indexerMainWorksetSetDigest(payload),
  });
}

export function validateIndexerMainWorksetSet(
  value: unknown,
): IndexerMainWorksetSet {
  const set = indexerMainWorksetSetSchema.parse(value);
  const payload: Omit<IndexerMainWorksetSet, "workset_set_digest"> = {
    protocol: set.protocol,
    items: set.items,
  };
  if (indexerMainWorksetSetDigest(payload) !== set.workset_set_digest) {
    throw new TypeError("main workset set digest is invalid");
  }
  const sorted = [...set.items].sort((left, right) => {
    const leftKey = `${left.stage}\u0000${left.owner_cohort_ref}\u0000${left.partition_key ?? left.partition_binding_digest ?? ""}\u0000${left.group_key ?? ""}\u0000${left.workset_digest}`;
    const rightKey = `${right.stage}\u0000${right.owner_cohort_ref}\u0000${right.partition_key ?? right.partition_binding_digest ?? ""}\u0000${right.group_key ?? ""}\u0000${right.workset_digest}`;
    return compareIndexerCanonicalText(leftKey, rightKey);
  });
  if (
    new Set(set.items.map((item) => item.workset_digest)).size !== set.items.length ||
    indexerProtocolDigest(sorted) !== indexerProtocolDigest(set.items)
  ) {
    throw new TypeError("main workset set items must be unique and canonical");
  }
  if (set.items.some((item) =>
    item.stage === "partition"
      ? item.partition_key === undefined ||
        item.partition_binding_digest !== undefined ||
        item.group_key !== undefined
      : item.partition_key !== undefined ||
        item.partition_binding_digest === undefined ||
        item.group_key === undefined
  )) {
    throw new TypeError("main workset set items must carry exactly one stage identity");
  }
  const authorGroups = set.items.filter((item) => item.stage === "author").map((item) =>
    `${item.indexer_id}\u0000${item.owner_cohort_ref}\u0000${item.partition_binding_digest}\u0000${item.group_key}`
  );
  if (new Set(authorGroups).size !== authorGroups.length) {
    throw new TypeError("main workset set contains more than one author workset for a group");
  }
  return set;
}

export const indexerMainTransportBatchSchema = z.object({
  protocol: z.literal("context.indexer.main-transport-batch/v2"),
  worksets: z.array(indexerMainWorksetSchema).min(1),
}).strict();

export type IndexerMainTransportBatch = z.infer<
  typeof indexerMainTransportBatchSchema
>;

export function buildIndexerMainTransportBatch(
  values: readonly IndexerMainWorkset[],
): IndexerMainTransportBatch {
  const worksets = values.map(validateIndexerMainWorkset);
  buildIndexerMainWorksetSet(worksets);
  return indexerMainTransportBatchSchema.parse({
    protocol: "context.indexer.main-transport-batch/v2",
    worksets,
  });
}
