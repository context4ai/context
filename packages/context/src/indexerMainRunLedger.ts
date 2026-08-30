import { z } from "zod";
import {
  indexerMainAcceptedRecordSchema,
  observeIndexerMainWorksetState,
  validateIndexerMainAcceptedRecord,
  type IndexerMainAcceptedRecord,
  type IndexerMainWorksetStatus,
} from "./indexerMainLifecycle.js";
import {
  indexerMainWorksetSetSchema,
  validateIndexerMainWorksetSet,
  type IndexerMainWorksetSet,
} from "./indexerMainWorkset.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const mainRunLedgerEntryBase = {
  item_ref: indexerDigestSchema,
  run_identity_digest: indexerDigestSchema,
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  stage: z.enum(["partition", "author"]),
  indexer_id: indexerIdSchema,
  owner_cohort_ref: indexerDigestSchema,
  group_key: z.string().min(1).optional(),
};

const pendingEntrySchema = z.object({
  ...mainRunLedgerEntryBase,
  state: z.literal("pending"),
}).strict();

const runningEntrySchema = z.object({
  ...mainRunLedgerEntryBase,
  state: z.literal("running"),
}).strict();

const acceptedEntrySchema = z.object({
  ...mainRunLedgerEntryBase,
  state: z.literal("accepted"),
  accepted_record: indexerMainAcceptedRecordSchema,
}).strict();

const failedEntrySchema = z.object({
  ...mainRunLedgerEntryBase,
  state: z.literal("failed"),
  reason_code: indexerIdSchema,
  dependency_digests: z.array(indexerDigestSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.dependency_digests, context, "dependency_digests");
});

const staleEntrySchema = z.object({
  ...mainRunLedgerEntryBase,
  state: z.literal("stale"),
  previous_workset_digest: indexerDigestSchema,
  previous_execution_request_digest: indexerDigestSchema,
}).strict();

export const indexerMainRunLedgerEntrySchema = z.union([
  pendingEntrySchema,
  runningEntrySchema,
  acceptedEntrySchema,
  failedEntrySchema,
  staleEntrySchema,
]);

export type IndexerMainRunLedgerEntry = z.infer<
  typeof indexerMainRunLedgerEntrySchema
>;

export const indexerMainRunLedgerSchema = z.object({
  protocol: z.literal("context.indexer.main-index-run-ledger/v1"),
  workset_set: indexerMainWorksetSetSchema,
  entries: z.array(indexerMainRunLedgerEntrySchema),
  ledger_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.entries.map((entry) => entry.item_ref), context, "entries.item_ref");
  addDuplicateIssues(
    value.entries.map((entry) => entry.run_identity_digest),
    context,
    "entries.run_identity_digest",
  );
});

export type IndexerMainRunLedger = z.infer<typeof indexerMainRunLedgerSchema>;

export interface IndexerMainRunIdentity {
  workset_digest: string;
  execution_request_digest: string;
}

type MainRunLedgerPayload = Omit<IndexerMainRunLedger, "ledger_digest">;

export function indexerMainRunIdentityDigest(input: IndexerMainRunIdentity): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.main-run-identity/v1",
    workset_digest: input.workset_digest,
    execution_request_digest: input.execution_request_digest,
  });
}

function itemRef(item: IndexerMainWorksetSet["items"][number]): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.main-run-item/v1",
    stage: item.stage,
    indexer_id: item.indexer_id,
    owner_cohort_ref: item.owner_cohort_ref,
    ...(item.group_key === undefined ? {} : { group_key: item.group_key }),
  });
}

function entryBase(input: {
  item: IndexerMainWorksetSet["items"][number];
  execution_request_digest: string;
}) {
  return {
    item_ref: itemRef(input.item),
    run_identity_digest: indexerMainRunIdentityDigest({
      workset_digest: input.item.workset_digest,
      execution_request_digest: input.execution_request_digest,
    }),
    workset_digest: input.item.workset_digest,
    execution_request_digest: input.execution_request_digest,
    stage: input.item.stage,
    indexer_id: input.item.indexer_id,
    owner_cohort_ref: input.item.owner_cohort_ref,
    ...(input.item.group_key === undefined ? {} : { group_key: input.item.group_key }),
  };
}

function canonicalDependencies(values: readonly string[]): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError("main run failure dependencies must be unique");
  }
  return sorted;
}

function ledgerDigest(value: MainRunLedgerPayload): string {
  return indexerProtocolDigest(value);
}

function buildLedger(input: {
  workset_set: IndexerMainWorksetSet;
  entries: readonly IndexerMainRunLedgerEntry[];
}): IndexerMainRunLedger {
  const worksetSet = validateIndexerMainWorksetSet(input.workset_set);
  const entries = input.entries.map((entry) =>
    indexerMainRunLedgerEntrySchema.parse(entry)
  );
  const payload: MainRunLedgerPayload = {
    protocol: "context.indexer.main-index-run-ledger/v1",
    workset_set: worksetSet,
    entries,
  };
  return indexerMainRunLedgerSchema.parse({
    ...payload,
    ledger_digest: ledgerDigest(payload),
  });
}

function requestByWorkset(input: {
  workset_set: IndexerMainWorksetSet;
  run_identities: readonly IndexerMainRunIdentity[];
}): Map<string, string> {
  const byWorkset = new Map<string, string>();
  for (const identity of input.run_identities) {
    if (byWorkset.has(identity.workset_digest)) {
      throw new TypeError("main run identities must contain one request per workset");
    }
    byWorkset.set(identity.workset_digest, indexerDigestSchema.parse(
      identity.execution_request_digest,
    ));
  }
  if (
    byWorkset.size !== input.workset_set.items.length ||
    input.workset_set.items.some((item) => !byWorkset.has(item.workset_digest))
  ) {
    throw new TypeError("main run identities must exactly cover the current workset set");
  }
  return byWorkset;
}

function assertAcceptedRecord(input: {
  record: IndexerMainAcceptedRecord;
  base: {
    workset_digest: string;
    execution_request_digest: string;
    stage: "partition" | "author";
  };
}): void {
  const expectedAcceptance = indexerProtocolDigest({
    protocol: input.record.protocol,
    workset_digest: input.record.workset_digest,
    stage: input.record.stage,
    execution_request_digest: input.record.execution_request_digest,
    result_digest: input.record.result_digest,
    receipt_digest: input.record.receipt_digest,
    run_envelope_digest: input.record.run_envelope_digest,
    artifact_dependency_set_digest: input.record.artifact_dependency_set_digest,
  });
  validateIndexerMainAcceptedRecord(input.record);
  if (
    input.record.workset_digest !== input.base.workset_digest ||
    input.record.execution_request_digest !== input.base.execution_request_digest ||
    input.record.stage !== input.base.stage ||
    input.record.acceptance_digest !== expectedAcceptance
  ) {
    throw new TypeError("accepted main run record does not match its run identity");
  }
}

export function validateIndexerMainRunLedger(value: unknown): IndexerMainRunLedger {
  const ledger = indexerMainRunLedgerSchema.parse(value);
  validateIndexerMainWorksetSet(ledger.workset_set);
  const payload: MainRunLedgerPayload = {
    protocol: ledger.protocol,
    workset_set: ledger.workset_set,
    entries: ledger.entries,
  };
  if (ledgerDigest(payload) !== ledger.ledger_digest) {
    throw new TypeError("main index run ledger digest is invalid");
  }
  if (ledger.entries.length !== ledger.workset_set.items.length) {
    throw new TypeError("main index run ledger must exactly cover its workset set");
  }
  ledger.entries.forEach((entry, index) => {
    const item = ledger.workset_set.items[index];
    if (item === undefined) throw new TypeError("main index run ledger item is missing");
    const expectedBase = entryBase({
      item,
      execution_request_digest: entry.execution_request_digest,
    });
    for (const [key, expected] of Object.entries(expectedBase)) {
      if (entry[key as keyof typeof entry] !== expected) {
        throw new TypeError("main index run ledger entry does not match its workset item");
      }
    }
    if (entry.state === "accepted") {
      assertAcceptedRecord({ record: entry.accepted_record, base: expectedBase });
    }
    if (entry.state === "failed") {
      const canonical = canonicalDependencies(entry.dependency_digests);
      if (canonical.some((digest, offset) => digest !== entry.dependency_digests[offset])) {
        throw new TypeError("main run failure dependencies must use canonical ordering");
      }
    }
  });
  return ledger;
}

export function initializeIndexerMainRunLedger(input: {
  workset_set: unknown;
  run_identities: readonly IndexerMainRunIdentity[];
}): IndexerMainRunLedger {
  const worksetSet = validateIndexerMainWorksetSet(input.workset_set);
  const requests = requestByWorkset({
    workset_set: worksetSet,
    run_identities: input.run_identities,
  });
  return buildLedger({
    workset_set: worksetSet,
    entries: worksetSet.items.map((item) => ({
      ...entryBase({
        item,
        execution_request_digest: requests.get(item.workset_digest)!,
      }),
      state: "pending" as const,
    })),
  });
}

export function recoverIndexerMainRunLedger(input: {
  workset_set: unknown;
  run_identities: readonly IndexerMainRunIdentity[];
  previous_ledger?: unknown;
  accepted_records?: readonly unknown[];
}): IndexerMainRunLedger {
  const initialized = initializeIndexerMainRunLedger(input);
  const previous = input.previous_ledger === undefined
    ? undefined
    : validateIndexerMainRunLedger(input.previous_ledger);
  const previousByIdentity = new Map(previous?.entries.map((entry) => [
    entry.run_identity_digest,
    entry,
  ]));
  const previousByItem = new Map(previous?.entries.map((entry) => [entry.item_ref, entry]));
  const acceptedByIdentity = new Map((input.accepted_records ?? []).map((candidate) => {
    const record = validateIndexerMainAcceptedRecord(candidate);
    return [indexerMainRunIdentityDigest(record), record] as const;
  }));
  if (acceptedByIdentity.size !== (input.accepted_records ?? []).length) {
    throw new TypeError("accepted main run cache contains duplicate identities");
  }
  const entries = initialized.entries.map((pending): IndexerMainRunLedgerEntry => {
    const accepted = acceptedByIdentity.get(pending.run_identity_digest);
    if (accepted !== undefined) {
      assertAcceptedRecord({ record: accepted, base: pending });
      return { ...pending, state: "accepted", accepted_record: accepted };
    }
    const exact = previousByIdentity.get(pending.run_identity_digest);
    if (exact !== undefined) {
      if (exact.state === "failed") return exact;
      if (exact.state === "stale") return exact;
      return { ...pending, state: "pending" };
    }
    const old = previousByItem.get(pending.item_ref);
    if (old !== undefined) {
      return {
        ...pending,
        state: "stale",
        previous_workset_digest: old.workset_digest,
        previous_execution_request_digest: old.execution_request_digest,
      };
    }
    return pending;
  });
  return buildLedger({ workset_set: initialized.workset_set, entries });
}

function replaceEntry(input: {
  ledger: IndexerMainRunLedger;
  workset_digest: string;
  replace: (entry: IndexerMainRunLedgerEntry) => IndexerMainRunLedgerEntry;
}): IndexerMainRunLedger {
  let found = false;
  const entries = input.ledger.entries.map((entry) => {
    if (entry.workset_digest !== input.workset_digest) return entry;
    found = true;
    return input.replace(entry);
  });
  if (!found) throw new TypeError("main run ledger has no requested workset");
  return buildLedger({ workset_set: input.ledger.workset_set, entries });
}

export function startIndexerMainRun(input: {
  ledger: unknown;
  workset_digest: string;
}): IndexerMainRunLedger {
  const ledger = validateIndexerMainRunLedger(input.ledger);
  return replaceEntry({
    ledger,
    workset_digest: input.workset_digest,
    replace: (entry) => {
      if (entry.state !== "pending" && entry.state !== "stale") {
        throw new TypeError("only pending or stale main work may start");
      }
      const clean = Object.fromEntries(Object.entries(entry).filter(([key]) =>
        key !== "state" &&
        key !== "previous_workset_digest" &&
        key !== "previous_execution_request_digest"
      ));
      return { ...clean, state: "running" } as IndexerMainRunLedgerEntry;
    },
  });
}

export function acceptIndexerMainRun(input: {
  ledger: unknown;
  accepted_record: unknown;
}): IndexerMainRunLedger {
  const ledger = validateIndexerMainRunLedger(input.ledger);
  const record = validateIndexerMainAcceptedRecord(input.accepted_record);
  return replaceEntry({
    ledger,
    workset_digest: record.workset_digest,
    replace: (entry) => {
      if (entry.state !== "running") {
        throw new TypeError("main result requires a running ledger entry");
      }
      assertAcceptedRecord({ record, base: entry });
      return { ...entry, state: "accepted", accepted_record: record };
    },
  });
}

export function retryIndexerMainPartitionRun(input: {
  ledger: unknown;
  workset_digest: string;
  previous_execution_request_digest: string;
  next_execution_request_digest: string;
}): IndexerMainRunLedger {
  const ledger = validateIndexerMainRunLedger(input.ledger);
  const item = ledger.workset_set.items.find((candidate) =>
    candidate.workset_digest === input.workset_digest
  );
  if (item === undefined) throw new TypeError("main run ledger has no requested workset");
  if (item.stage !== "partition") {
    throw new TypeError("only a partition main run can retry another strategy");
  }
  const nextDigest = indexerDigestSchema.parse(input.next_execution_request_digest);
  if (nextDigest === input.previous_execution_request_digest) {
    throw new TypeError("partition strategy retry must change the execution request identity");
  }
  return replaceEntry({
    ledger,
    workset_digest: input.workset_digest,
    replace: (entry) => {
      if (
        entry.state !== "running" ||
        entry.execution_request_digest !== input.previous_execution_request_digest
      ) {
        throw new TypeError("partition strategy retry requires the current running request");
      }
      return {
        ...entryBase({ item, execution_request_digest: nextDigest }),
        state: "pending",
      };
    },
  });
}

export function failIndexerMainRun(input: {
  ledger: unknown;
  workset_digest: string;
  reason_code: string;
  dependency_digests: readonly string[];
}): IndexerMainRunLedger {
  const ledger = validateIndexerMainRunLedger(input.ledger);
  return replaceEntry({
    ledger,
    workset_digest: input.workset_digest,
    replace: (entry) => {
      if (entry.state !== "running") {
        throw new TypeError("main failure requires a running ledger entry");
      }
      return {
        ...entry,
        state: "failed",
        reason_code: indexerIdSchema.parse(input.reason_code),
        dependency_digests: canonicalDependencies(input.dependency_digests),
      };
    },
  });
}

export function observeIndexerMainRunLedger(value: unknown): IndexerMainWorksetStatus {
  const ledger = validateIndexerMainRunLedger(value);
  const records = ledger.entries.map((entry) => {
    if (entry.state === "accepted") {
      return { ...entry.accepted_record, state: "accepted" as const };
    }
    if (entry.state === "failed") {
      return {
        workset_digest: entry.workset_digest,
        state: "failed" as const,
        execution_request_digest: entry.execution_request_digest,
        reason_code: entry.reason_code,
        dependency_digests: entry.dependency_digests,
      };
    }
    if (entry.state === "stale") {
      return {
        workset_digest: entry.workset_digest,
        state: "stale" as const,
        previous_workset_digest: entry.previous_workset_digest,
      };
    }
    return {
      workset_digest: entry.workset_digest,
      state: entry.state,
      ...(entry.state === "running"
        ? { execution_request_digest: entry.execution_request_digest }
        : {}),
    };
  });
  return observeIndexerMainWorksetState({
    workset_set: ledger.workset_set,
    records,
  });
}
