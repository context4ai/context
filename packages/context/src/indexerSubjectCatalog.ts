import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  buildIndexerTargetResolutionView,
  type IndexerTargetResolutionView,
} from "./indexerMainWorkset.js";
import {
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { indexerSubjectKeySchema, type IndexerSubjectKey } from "./indexerSubjectIdentity.js";

const approvedSubjectSchema = z.object({
  node_ref: indexerCanonicalRefSchema,
  subject_key: indexerSubjectKeySchema,
}).strict();

const partitionSubjectSchema = z.object({
  partition_workset_digest: indexerDigestSchema,
  partition_plan_digest: indexerDigestSchema,
  group_key: z.string().min(1),
  node_ref: indexerCanonicalRefSchema,
  subject_key: indexerSubjectKeySchema,
}).strict();

const subjectCatalogEntrySchema = z.object({
  subject_key: indexerSubjectKeySchema,
  node_refs: z.array(indexerCanonicalRefSchema).min(1),
  origin_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerSubjectCatalogSchema = z.object({
  protocol: z.literal("context.indexer.subject-catalog/v1"),
  requirement_ref: indexerCanonicalRefSchema,
  subject_key_schema_digest: indexerDigestSchema,
  approved_subject_set_digest: indexerDigestSchema,
  partition_subject_set_digest: indexerDigestSchema,
  entries: z.array(subjectCatalogEntrySchema),
  catalog_digest: indexerDigestSchema,
}).strict();

export type IndexerApprovedSubject = z.infer<typeof approvedSubjectSchema>;
export type IndexerPartitionSubject = z.infer<typeof partitionSubjectSchema>;
export type IndexerSubjectCatalog = z.infer<typeof indexerSubjectCatalogSchema>;

type CatalogPayload = Omit<IndexerSubjectCatalog, "catalog_digest">;

export function indexerSubjectCatalogDigest(value: CatalogPayload): string {
  return indexerProtocolDigest(value);
}

function canonicalSubjectKey(value: IndexerSubjectKey): string {
  return JSON.stringify(value);
}

function canonicalApprovedSubjects(
  values: readonly unknown[],
): IndexerApprovedSubject[] {
  const subjects = values.map((value) => approvedSubjectSchema.parse(value)).sort(
    (left, right) => compareIndexerCanonicalText(
      `${canonicalSubjectKey(left.subject_key)}\u0000${left.node_ref}`,
      `${canonicalSubjectKey(right.subject_key)}\u0000${right.node_ref}`,
    ),
  );
  const pairs = subjects.map((item) => `${canonicalSubjectKey(item.subject_key)}\u0000${item.node_ref}`);
  if (new Set(pairs).size !== pairs.length) {
    throw new TypeError("approved subject catalog contains duplicate key/node pairs");
  }
  return subjects;
}

function canonicalPartitionSubjects(
  values: readonly unknown[],
): IndexerPartitionSubject[] {
  const subjects = values.map((value) => partitionSubjectSchema.parse(value)).sort(
    (left, right) => compareIndexerCanonicalText(
      `${left.partition_workset_digest}\u0000${left.group_key}`,
      `${right.partition_workset_digest}\u0000${right.group_key}`,
    ),
  );
  const identities = subjects.map((item) =>
    `${item.partition_workset_digest}\u0000${item.group_key}`
  );
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("partition subject set contains duplicate group identities");
  }
  return subjects;
}

export function buildIndexerSubjectCatalog(input: {
  requirement_ref: string;
  subject_key_schema_digest: string;
  approved_subjects: readonly unknown[];
  partition_subjects: readonly unknown[];
}): IndexerSubjectCatalog {
  const approved = canonicalApprovedSubjects(input.approved_subjects);
  const partition = canonicalPartitionSubjects(input.partition_subjects);
  const nodeToKey = new Map<string, string>();
  const grouped = new Map<string, {
    subject_key: IndexerSubjectKey;
    node_refs: Set<string>;
    origin_refs: Set<string>;
  }>();
  const add = (subjectKey: IndexerSubjectKey, nodeRef: string, originRef: string) => {
    const key = canonicalSubjectKey(subjectKey);
    const existingKey = nodeToKey.get(nodeRef);
    if (existingKey !== undefined && existingKey !== key) {
      throw new TypeError(`subject node ${nodeRef} is bound to multiple SubjectKeys`);
    }
    nodeToKey.set(nodeRef, key);
    const entry = grouped.get(key) ?? {
      subject_key: subjectKey,
      node_refs: new Set<string>(),
      origin_refs: new Set<string>(),
    };
    entry.node_refs.add(nodeRef);
    entry.origin_refs.add(originRef);
    grouped.set(key, entry);
  };
  for (const subject of approved) {
    add(subject.subject_key, subject.node_ref, subject.node_ref);
  }
  for (const subject of partition) {
    add(
      subject.subject_key,
      subject.node_ref,
      `partition-workset:${subject.partition_workset_digest}`,
    );
  }
  const entries = [...grouped.values()].map((entry) => ({
    subject_key: entry.subject_key,
    node_refs: [...entry.node_refs].sort(compareIndexerCanonicalText),
    origin_refs: [...entry.origin_refs].sort(compareIndexerCanonicalText),
  })).sort((left, right) => compareIndexerCanonicalText(
    canonicalSubjectKey(left.subject_key),
    canonicalSubjectKey(right.subject_key),
  ));
  const payload: CatalogPayload = {
    protocol: "context.indexer.subject-catalog/v1",
    requirement_ref: input.requirement_ref,
    subject_key_schema_digest: input.subject_key_schema_digest,
    approved_subject_set_digest: indexerProtocolDigest({ approved_subjects: approved }),
    partition_subject_set_digest: indexerProtocolDigest({ partition_subjects: partition }),
    entries,
  };
  return indexerSubjectCatalogSchema.parse({
    ...payload,
    catalog_digest: indexerSubjectCatalogDigest(payload),
  });
}

export function validateIndexerSubjectCatalog(value: unknown): IndexerSubjectCatalog {
  const catalog = indexerSubjectCatalogSchema.parse(value);
  const payload: CatalogPayload = {
    protocol: catalog.protocol,
    requirement_ref: catalog.requirement_ref,
    subject_key_schema_digest: catalog.subject_key_schema_digest,
    approved_subject_set_digest: catalog.approved_subject_set_digest,
    partition_subject_set_digest: catalog.partition_subject_set_digest,
    entries: catalog.entries,
  };
  if (indexerSubjectCatalogDigest(payload) !== catalog.catalog_digest) {
    throw new TypeError("subject catalog digest is invalid");
  }
  const entryKeys = catalog.entries.map((entry) => canonicalSubjectKey(entry.subject_key));
  if (
    new Set(entryKeys).size !== entryKeys.length ||
    entryKeys.some((key, index) =>
      [...entryKeys].sort(compareIndexerCanonicalText)[index] !== key
    )
  ) {
    throw new TypeError("subject catalog entries must use canonical unique ordering");
  }
  const nodeToKey = new Map<string, string>();
  for (const [index, entry] of catalog.entries.entries()) {
    for (const field of ["node_refs", "origin_refs"] as const) {
      const values = entry[field];
      if (
        new Set(values).size !== values.length ||
        values.some((item, itemIndex) =>
          [...values].sort(compareIndexerCanonicalText)[itemIndex] !== item
        )
      ) {
        throw new TypeError(`subject catalog entries[${index}].${field} must be unique and canonical`);
      }
    }
    for (const nodeRef of entry.node_refs) {
      const previous = nodeToKey.get(nodeRef);
      const key = entryKeys[index]!;
      if (previous !== undefined && previous !== key) {
        throw new TypeError(`subject node ${nodeRef} is bound to multiple SubjectKeys`);
      }
      nodeToKey.set(nodeRef, key);
    }
  }
  return catalog;
}

export function indexerTargetQueryRef(input: {
  subject_intent: "enrich-or-independent";
  subject_key: unknown;
  subject_key_schema_digest: string;
}): string {
  return indexerProtocolDigest({
    subject_intent: input.subject_intent,
    subject_key: indexerSubjectKeySchema.parse(input.subject_key),
    subject_key_schema_digest: input.subject_key_schema_digest,
  });
}

const targetResolutionViewSetItemSchema = z.object({
  group_ref: indexerCanonicalRefSchema,
  query_ref: indexerDigestSchema,
  view_digest: indexerDigestSchema,
}).strict();

export const indexerTargetResolutionViewSetSchema = z.object({
  protocol: z.literal("context.indexer.target-resolution-view-set/v1"),
  catalog_digest: indexerDigestSchema,
  items: z.array(targetResolutionViewSetItemSchema),
  view_set_digest: indexerDigestSchema,
}).strict();

export type IndexerTargetResolutionViewSet = z.infer<
  typeof indexerTargetResolutionViewSetSchema
>;

export function buildIndexerTargetResolutionViews(input: {
  catalog: unknown;
  queries: readonly {
    group_ref: string;
    subject_intent: "enrich-or-independent";
    subject_key: unknown;
  }[];
}): {
  views: Array<{ group_ref: string; view: IndexerTargetResolutionView }>;
  view_set: IndexerTargetResolutionViewSet;
} {
  const catalog = validateIndexerSubjectCatalog(input.catalog);
  const byKey = new Map(
    catalog.entries.map((entry) => [canonicalSubjectKey(entry.subject_key), entry]),
  );
  const views = input.queries.map((candidate) => {
    const subjectKey = indexerSubjectKeySchema.parse(candidate.subject_key);
    const queryRef = indexerTargetQueryRef({
      subject_intent: candidate.subject_intent,
      subject_key: subjectKey,
      subject_key_schema_digest: catalog.subject_key_schema_digest,
    });
    const match = byKey.get(canonicalSubjectKey(subjectKey));
    const entry = match === undefined
      ? { query_ref: queryRef, state: "absent" as const }
      : match.node_refs.length === 1
      ? {
          query_ref: queryRef,
          state: "resolved" as const,
          subject_key: subjectKey,
          node_ref: match.node_refs[0]!,
        }
      : {
          query_ref: queryRef,
          state: "ambiguous" as const,
          conflicting_node_refs: match.node_refs,
        };
    return {
      group_ref: indexerCanonicalRefSchema.parse(candidate.group_ref),
      view: buildIndexerTargetResolutionView({
        requirement_ref: catalog.requirement_ref,
        subject_key_schema_digest: catalog.subject_key_schema_digest,
        query_digest: indexerProtocolDigest({ query_refs: [queryRef] }),
        entries: [entry],
      }),
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.group_ref, right.group_ref));
  if (new Set(views.map((item) => item.group_ref)).size !== views.length) {
    throw new TypeError("target resolution queries must have unique group refs");
  }
  const payload = {
    protocol: "context.indexer.target-resolution-view-set/v1" as const,
    catalog_digest: catalog.catalog_digest,
    items: views.map((item) => ({
      group_ref: item.group_ref,
      query_ref: item.view.entries[0]!.query_ref,
      view_digest: item.view.view_digest,
    })),
  };
  return {
    views,
    view_set: indexerTargetResolutionViewSetSchema.parse({
      ...payload,
      view_set_digest: indexerProtocolDigest(payload),
    }),
  };
}
