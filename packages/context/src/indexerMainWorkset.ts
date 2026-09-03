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
import { indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

const targetResolutionEntrySchema = z.union([
  z.object({
    query_ref: indexerDigestSchema,
    state: z.literal("resolved"),
    subject_key: indexerSubjectKeySchema,
    node_ref: indexerCanonicalRefSchema,
  }).strict(),
  z.object({
    query_ref: indexerDigestSchema,
    state: z.literal("absent"),
  }).strict(),
  z.object({
    query_ref: indexerDigestSchema,
    state: z.literal("ambiguous"),
    conflicting_node_refs: z.array(indexerCanonicalRefSchema).min(2),
  }).strict().superRefine((value, context) => {
    addDuplicateIssues(value.conflicting_node_refs, context, "conflicting_node_refs");
  }),
]);

export const indexerTargetResolutionViewSchema = z.object({
  protocol: z.literal("context.indexer.target-resolution-view/v1"),
  view_digest: indexerDigestSchema,
  requirement_ref: indexerCanonicalRefSchema,
  subject_key_schema_digest: indexerDigestSchema,
  query_digest: indexerDigestSchema,
  entries: z.array(targetResolutionEntrySchema).min(1),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.entries.map((item) => item.query_ref), context, "entries.query_ref");
});

export type IndexerTargetResolutionView = z.infer<
  typeof indexerTargetResolutionViewSchema
>;

export function indexerTargetResolutionViewDigest(
  value: Omit<IndexerTargetResolutionView, "view_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerTargetResolutionView(
  input: Omit<IndexerTargetResolutionView, "protocol" | "view_digest">,
): IndexerTargetResolutionView {
  const entries = [...input.entries].sort((left, right) =>
    compareIndexerCanonicalText(left.query_ref, right.query_ref)
  ).map((entry) =>
    entry.state === "ambiguous"
      ? { ...entry, conflicting_node_refs: [...entry.conflicting_node_refs].sort() }
      : entry
  );
  const payload: Omit<IndexerTargetResolutionView, "view_digest"> = {
    protocol: "context.indexer.target-resolution-view/v1",
    ...input,
    entries,
  };
  return indexerTargetResolutionViewSchema.parse({
    ...payload,
    view_digest: indexerTargetResolutionViewDigest(payload),
  });
}

export function validateIndexerTargetResolutionView(
  value: unknown,
): IndexerTargetResolutionView {
  const view = indexerTargetResolutionViewSchema.parse(value);
  const payload: Omit<IndexerTargetResolutionView, "view_digest"> = {
    protocol: view.protocol,
    requirement_ref: view.requirement_ref,
    subject_key_schema_digest: view.subject_key_schema_digest,
    query_digest: view.query_digest,
    entries: view.entries,
  };
  if (indexerTargetResolutionViewDigest(payload) !== view.view_digest) {
    throw new TypeError("TargetResolutionView digest is invalid");
  }
  const rebuilt = buildIndexerTargetResolutionView({
    requirement_ref: view.requirement_ref,
    subject_key_schema_digest: view.subject_key_schema_digest,
    query_digest: view.query_digest,
    entries: view.entries,
  });
  if (rebuilt.view_digest !== view.view_digest) {
    throw new TypeError("TargetResolutionView entries must use canonical ordering");
  }
  return view;
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
  subject_key_schema_digest: indexerDigestSchema,
  source_scope_digest: indexerDigestSchema,
  source_binding_digest: indexerDigestSchema,
  primary_resource_binding_digest: indexerDigestSchema,
  question_target_inventory_digest: indexerDigestSchema,
};

const partitionWorksetSchema = z.object({
  ...mainWorksetBaseFields,
  stage: z.literal("partition"),
  partition_subject_key: indexerSubjectKeySchema,
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
  target_resolution_view: indexerTargetResolutionViewSchema.optional(),
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
  if (
    normalized.stage === "author" &&
    normalized.target_resolution_view?.entries.some((entry) => entry.state === "ambiguous")
  ) {
    throw new TypeError("index-target-resolution-ambiguous");
  }
  if (normalized.stage === "author" && normalized.target_resolution_view !== undefined) {
    validateIndexerTargetResolutionView(normalized.target_resolution_view);
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
  const items = worksets.map((workset) => ({
    workset_digest: workset.workset_digest,
    stage: workset.stage,
    indexer_id: workset.indexer_id,
    owner_cohort_ref: indexerOwnerCohortRef(workset),
    ...(workset.stage === "author" ? { group_key: workset.group_key } : {}),
  })).sort((left, right) => {
    const leftKey = `${left.stage}\u0000${left.owner_cohort_ref}\u0000${left.group_key ?? ""}\u0000${left.workset_digest}`;
    const rightKey = `${right.stage}\u0000${right.owner_cohort_ref}\u0000${right.group_key ?? ""}\u0000${right.workset_digest}`;
    return compareIndexerCanonicalText(leftKey, rightKey);
  });
  if (new Set(items.map((item) => item.workset_digest)).size !== items.length) {
    throw new TypeError("main workset set contains duplicate workset identities");
  }
  const authorGroupIdentities = items
    .filter((item) => item.stage === "author")
    .map((item) =>
      `${item.indexer_id}\u0000${item.owner_cohort_ref}\u0000${item.group_key}`
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
    const leftKey = `${left.stage}\u0000${left.owner_cohort_ref}\u0000${left.group_key ?? ""}\u0000${left.workset_digest}`;
    const rightKey = `${right.stage}\u0000${right.owner_cohort_ref}\u0000${right.group_key ?? ""}\u0000${right.workset_digest}`;
    return compareIndexerCanonicalText(leftKey, rightKey);
  });
  if (
    new Set(set.items.map((item) => item.workset_digest)).size !== set.items.length ||
    indexerProtocolDigest(sorted) !== indexerProtocolDigest(set.items)
  ) {
    throw new TypeError("main workset set items must be unique and canonical");
  }
  const authorGroups = set.items.filter((item) => item.stage === "author").map((item) =>
    `${item.indexer_id}\u0000${item.owner_cohort_ref}\u0000${item.group_key}`
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
