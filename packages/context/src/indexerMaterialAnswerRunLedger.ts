import { z } from "zod";
import {
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerCandidateSetSchema,
  validateIndexerMaterialAnswerCandidateSet,
} from "./indexerMaterialAnswer.js";
import {
  validateIndexerMaterialAnswerExecutionPlan,
  type IndexerMaterialAnswerExecutionPlan,
} from "./indexerMaterialAnswerExecutionPlan.js";
import {
  indexerMaterialAnswerRunResultSchema,
} from "./indexerMaterialAnswerRunProtocol.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";

const runEntryBaseSchema = z.object({
  run_ref: indexerCanonicalRefSchema,
  answer_indexer_id: indexerIdSchema,
  execution_request_digest: indexerDigestSchema,
});

const pendingEntrySchema = runEntryBaseSchema.extend({
  state: z.literal("pending"),
}).strict();

const runningEntrySchema = runEntryBaseSchema.extend({
  state: z.literal("running"),
  attempt_digest: indexerDigestSchema,
}).strict();

const staleEntrySchema = runEntryBaseSchema.extend({
  state: z.literal("stale"),
  previous_execution_request_digest: indexerDigestSchema,
}).strict();

const failedEntrySchema = runEntryBaseSchema.extend({
  state: z.literal("failed"),
  failure_digest: indexerDigestSchema,
}).strict();

const acceptedEntrySchema = runEntryBaseSchema.extend({
  state: z.literal("accepted"),
  accepted_record_digest: indexerDigestSchema,
  result_digest: indexerDigestSchema,
  candidate_set_digest: indexerDigestSchema,
  read_receipt_set_digest: indexerDigestSchema,
  candidate_question_keys: z.array(indexerCanonicalRefSchema),
  insufficient_question_keys: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerMaterialAnswerRunLedgerEntrySchema = z.discriminatedUnion(
  "state",
  [
    pendingEntrySchema,
    runningEntrySchema,
    staleEntrySchema,
    failedEntrySchema,
    acceptedEntrySchema,
  ],
);

const ledgerPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-run-ledger/v1"),
  plan_digest: indexerDigestSchema,
  workset_digest: indexerDigestSchema,
  predecessor_ledger_revision: indexerDigestSchema,
  entries: z.array(indexerMaterialAnswerRunLedgerEntrySchema),
}).strict();

export const indexerMaterialAnswerRunLedgerSchema = ledgerPayloadSchema.extend({
  revision: indexerDigestSchema,
}).strict();

const acceptedRecordPayloadSchema = z.object({
  protocol: z.literal("context.indexer.material-answer-accepted-run/v1"),
  plan_digest: indexerDigestSchema,
  run_ref: indexerCanonicalRefSchema,
  workset_digest: indexerDigestSchema,
  answer_indexer_id: indexerIdSchema,
  execution_request_digest: indexerDigestSchema,
  run_result: indexerMaterialAnswerRunResultSchema,
  candidate_set: indexerMaterialAnswerCandidateSetSchema,
  read_receipt_set_digest: indexerDigestSchema,
}).strict();

export const indexerMaterialAnswerAcceptedRunRecordSchema =
  acceptedRecordPayloadSchema.extend({
    record_digest: indexerDigestSchema,
  }).strict();

export type IndexerMaterialAnswerRunLedgerEntry = z.infer<
  typeof indexerMaterialAnswerRunLedgerEntrySchema
>;
export type IndexerMaterialAnswerRunLedger = z.infer<
  typeof indexerMaterialAnswerRunLedgerSchema
>;
export type IndexerMaterialAnswerAcceptedRunRecord = z.infer<
  typeof indexerMaterialAnswerAcceptedRunRecordSchema
>;

function canonicalUnique(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be unique`);
  }
  return sorted;
}

function ledgerRevision(
  payload: Omit<IndexerMaterialAnswerRunLedger, "revision">,
): string {
  return indexerProtocolDigest(payload);
}

function acceptedRecordDigest(
  payload: Omit<IndexerMaterialAnswerAcceptedRunRecord, "record_digest">,
): string {
  return indexerProtocolDigest(payload);
}

function planRun(plan: IndexerMaterialAnswerExecutionPlan, runRef: string) {
  const run = plan.runs.find((candidate) => candidate.run_ref === runRef);
  if (run === undefined) throw new TypeError("material-answer run is outside the current plan");
  return run;
}

export function buildIndexerMaterialAnswerAcceptedRunRecord(input: {
  plan: unknown;
  run_ref: string;
  run_result: unknown;
  candidate_set: unknown;
  read_receipt_set_digest: string;
}): IndexerMaterialAnswerAcceptedRunRecord {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const run = planRun(plan, input.run_ref);
  const runResult = indexerMaterialAnswerRunResultSchema.parse(input.run_result);
  const candidateSet = validateIndexerMaterialAnswerCandidateSet(input.candidate_set);
  const { result_digest: _resultDigest, ...resultPayload } = runResult.result;
  void _resultDigest;
  const bindingKeys = runResult.result.bindings.map((binding) => binding.question_key)
    .sort(compareIndexerCanonicalText);
  const evaluationKeys = candidateSet.evaluations.map((evaluation) =>
    evaluation.question_key
  ).sort(compareIndexerCanonicalText);
  if (
    runResult.consumed_input_view_digest !== run.request.composition_input.view_digest ||
    indexerMaterialAnswerResultDigest(resultPayload) !== runResult.result.result_digest ||
    runResult.result.workset_digest !== plan.workset_digest ||
    runResult.result.execution_request_digest !== run.request.execution_request_digest ||
    runResult.result.answer_indexer_id !== run.answer_indexer_id ||
    candidateSet.workset_digest !== plan.workset_digest ||
    candidateSet.answer_result_digest !== runResult.result.result_digest ||
    candidateSet.answer_indexer_id !== run.answer_indexer_id ||
    candidateSet.answer_provider_composition_fingerprint !==
      run.request.answer_provider_composition_fingerprint ||
    runResult.result.bindings.some((binding) =>
      !run.request.eligible_question_keys.includes(binding.question_key)
    ) ||
    canonicalIndexerJson(bindingKeys) !== canonicalIndexerJson(evaluationKeys)
  ) {
    throw new TypeError("material-answer accepted record is not bound to its run");
  }
  const payload = acceptedRecordPayloadSchema.parse({
    protocol: "context.indexer.material-answer-accepted-run/v1",
    plan_digest: plan.plan_digest,
    run_ref: run.run_ref,
    workset_digest: plan.workset_digest,
    answer_indexer_id: run.answer_indexer_id,
    execution_request_digest: run.request.execution_request_digest,
    run_result: runResult,
    candidate_set: candidateSet,
    read_receipt_set_digest: input.read_receipt_set_digest,
  });
  return indexerMaterialAnswerAcceptedRunRecordSchema.parse({
    ...payload,
    record_digest: acceptedRecordDigest(payload),
  });
}

export function validateIndexerMaterialAnswerAcceptedRunRecord(input: {
  plan: unknown;
  record: unknown;
}): IndexerMaterialAnswerAcceptedRunRecord {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const record = indexerMaterialAnswerAcceptedRunRecordSchema.parse(input.record);
  const { record_digest: _digest, ...payload } = record;
  void _digest;
  if (acceptedRecordDigest(payload) !== record.record_digest) {
    throw new TypeError("material-answer accepted record digest is invalid");
  }
  const rebuilt = buildIndexerMaterialAnswerAcceptedRunRecord({
    plan,
    run_ref: record.run_ref,
    run_result: record.run_result,
    candidate_set: record.candidate_set,
    read_receipt_set_digest: record.read_receipt_set_digest,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(record)) {
    throw new TypeError("material-answer accepted record is stale or invalid");
  }
  return record;
}

function acceptedEntry(
  record: IndexerMaterialAnswerAcceptedRunRecord,
): Extract<IndexerMaterialAnswerRunLedgerEntry, { state: "accepted" }> {
  const candidateQuestionKeys = canonicalUnique(record.candidate_set.evaluations
    .filter((item) => item.state === "candidate")
    .map((item) => item.question_key), "candidate question keys");
  const insufficientQuestionKeys = canonicalUnique(record.candidate_set.evaluations
    .filter((item) => item.state === "material-answer-evidence-insufficient")
    .map((item) => item.question_key), "insufficient question keys");
  return acceptedEntrySchema.parse({
    run_ref: record.run_ref,
    answer_indexer_id: record.answer_indexer_id,
    execution_request_digest: record.execution_request_digest,
    state: "accepted",
    accepted_record_digest: record.record_digest,
    result_digest: record.run_result.result.result_digest,
    candidate_set_digest: record.candidate_set.candidate_set_digest,
    read_receipt_set_digest: record.read_receipt_set_digest,
    candidate_question_keys: candidateQuestionKeys,
    insufficient_question_keys: insufficientQuestionKeys,
  });
}

function buildLedger(
  plan: IndexerMaterialAnswerExecutionPlan,
  entries: readonly IndexerMaterialAnswerRunLedgerEntry[],
): IndexerMaterialAnswerRunLedger {
  const sorted = [...entries].sort((left, right) =>
    compareIndexerCanonicalText(left.run_ref, right.run_ref)
  );
  const payload = ledgerPayloadSchema.parse({
    protocol: "context.indexer.material-answer-run-ledger/v1",
    plan_digest: plan.plan_digest,
    workset_digest: plan.workset_digest,
    predecessor_ledger_revision: plan.predecessor_ledger_revision,
    entries: sorted,
  });
  return indexerMaterialAnswerRunLedgerSchema.parse({
    ...payload,
    revision: ledgerRevision(payload),
  });
}

export function prepareIndexerMaterialAnswerRunLedger(input: {
  plan: unknown;
  previous_ledger?: unknown;
  accepted_records?: readonly unknown[];
}): IndexerMaterialAnswerRunLedger {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const previous = input.previous_ledger === undefined
    ? undefined
    : validateIndexerMaterialAnswerRunLedger(input.previous_ledger);
  const records = (input.accepted_records ?? []).map((record) =>
    validateIndexerMaterialAnswerAcceptedRunRecord({ plan, record })
  );
  const recordByRun = new Map(records.map((record) => [record.run_ref, record]));
  if (recordByRun.size !== records.length) {
    throw new TypeError("material-answer accepted records must be unique by run");
  }
  const entries = plan.runs.map((run): IndexerMaterialAnswerRunLedgerEntry => {
    const record = recordByRun.get(run.run_ref);
    if (record !== undefined) return acceptedEntry(record);
    const exact = previous?.entries.find((entry) =>
      entry.run_ref === run.run_ref &&
      entry.execution_request_digest === run.request.execution_request_digest
    );
    if (exact?.state === "failed") return exact;
    if (exact?.state === "stale") return exact;
    const priorIndexer = previous?.entries.find((entry) =>
      entry.answer_indexer_id === run.answer_indexer_id &&
      entry.execution_request_digest !== run.request.execution_request_digest
    );
    if (priorIndexer !== undefined) {
      return staleEntrySchema.parse({
        run_ref: run.run_ref,
        answer_indexer_id: run.answer_indexer_id,
        execution_request_digest: run.request.execution_request_digest,
        state: "stale",
        previous_execution_request_digest: priorIndexer.execution_request_digest,
      });
    }
    return pendingEntrySchema.parse({
      run_ref: run.run_ref,
      answer_indexer_id: run.answer_indexer_id,
      execution_request_digest: run.request.execution_request_digest,
      state: "pending",
    });
  });
  return buildLedger(plan, entries);
}

export function validateIndexerMaterialAnswerRunLedger(
  value: unknown,
): IndexerMaterialAnswerRunLedger {
  const ledger = indexerMaterialAnswerRunLedgerSchema.parse(value);
  const { revision: _revision, ...payload } = ledger;
  void _revision;
  if (ledgerRevision(payload) !== ledger.revision) {
    throw new TypeError("material-answer run ledger revision is invalid");
  }
  const refs = canonicalUnique(ledger.entries.map((entry) => entry.run_ref), "ledger run refs");
  if (canonicalIndexerJson(refs) !== canonicalIndexerJson(ledger.entries.map((entry) =>
    entry.run_ref
  ))) {
    throw new TypeError("material-answer run ledger entries are not canonical");
  }
  return ledger;
}

function transition(input: {
  plan: unknown;
  ledger: unknown;
  expected_revision: string;
  run_ref: string;
  replace: (
    entry: IndexerMaterialAnswerRunLedgerEntry,
  ) => IndexerMaterialAnswerRunLedgerEntry;
}): IndexerMaterialAnswerRunLedger {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const ledger = validateIndexerMaterialAnswerRunLedger(input.ledger);
  if (
    ledger.revision !== input.expected_revision ||
    ledger.plan_digest !== plan.plan_digest
  ) {
    throw new TypeError("material-answer run ledger CAS is stale");
  }
  let found = false;
  const entries = ledger.entries.map((entry) => {
    if (entry.run_ref !== input.run_ref) return entry;
    found = true;
    return input.replace(entry);
  });
  if (!found) throw new TypeError("material-answer run is outside the ledger");
  return buildLedger(plan, entries);
}

export function startIndexerMaterialAnswerRun(input: {
  plan: unknown;
  ledger: unknown;
  expected_revision: string;
  run_ref: string;
}): IndexerMaterialAnswerRunLedger {
  return transition({
    ...input,
    replace: (entry) => {
      if (entry.state !== "pending" && entry.state !== "stale") {
        throw new TypeError("only pending or stale material-answer work can start");
      }
      return runningEntrySchema.parse({
        run_ref: entry.run_ref,
        answer_indexer_id: entry.answer_indexer_id,
        execution_request_digest: entry.execution_request_digest,
        state: "running",
        attempt_digest: indexerProtocolDigest({
          ledger_revision: input.expected_revision,
          run_ref: entry.run_ref,
          execution_request_digest: entry.execution_request_digest,
        }),
      });
    },
  });
}

export function acceptIndexerMaterialAnswerRun(input: {
  plan: unknown;
  ledger: unknown;
  expected_revision: string;
  record: unknown;
}): IndexerMaterialAnswerRunLedger {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const record = validateIndexerMaterialAnswerAcceptedRunRecord({
    plan,
    record: input.record,
  });
  return transition({
    plan,
    ledger: input.ledger,
    expected_revision: input.expected_revision,
    run_ref: record.run_ref,
    replace: (entry) => {
      if (entry.state !== "running") {
        throw new TypeError("only a running material-answer run can be accepted");
      }
      return acceptedEntry(record);
    },
  });
}

export function failIndexerMaterialAnswerRun(input: {
  plan: unknown;
  ledger: unknown;
  expected_revision: string;
  run_ref: string;
  failure_digest: string;
}): IndexerMaterialAnswerRunLedger {
  return transition({
    ...input,
    replace: (entry) => {
      if (entry.state !== "running") {
        throw new TypeError("only a running material-answer run can fail");
      }
      return failedEntrySchema.parse({
        run_ref: entry.run_ref,
        answer_indexer_id: entry.answer_indexer_id,
        execution_request_digest: entry.execution_request_digest,
        state: "failed",
        failure_digest: input.failure_digest,
      });
    },
  });
}

export function observeIndexerMaterialAnswerRuns(input: {
  plan: unknown;
  ledger: unknown;
}) {
  const plan = validateIndexerMaterialAnswerExecutionPlan(input.plan);
  const ledger = validateIndexerMaterialAnswerRunLedger(input.ledger);
  if (ledger.plan_digest !== plan.plan_digest) {
    throw new TypeError("material-answer run observation is stale");
  }
  const count = (state: IndexerMaterialAnswerRunLedgerEntry["state"]) =>
    ledger.entries.filter((entry) => entry.state === state).length;
  const candidateQuestionKeys = [...new Set(ledger.entries.flatMap((entry) =>
    entry.state === "accepted" ? entry.candidate_question_keys : []
  ))].sort(compareIndexerCanonicalText);
  const allQuestionKeys = plan.runs[0]?.request.workset.items.map((item) =>
    item.question_key
  ) ?? plan.unresolved_question_keys;
  const unresolvedQuestionKeys = [...new Set(allQuestionKeys.filter((key) =>
    !candidateQuestionKeys.includes(key)
  ))].sort(compareIndexerCanonicalText);
  const pending = count("pending");
  const running = count("running");
  const stale = count("stale");
  const failed = count("failed");
  const accepted = count("accepted");
  const nextRefs = ledger.entries.filter((entry) =>
    entry.state === "pending" || entry.state === "stale"
  ).map((entry) => entry.run_ref).sort(compareIndexerCanonicalText);
  const state = failed > 0
    ? "failed" as const
    : pending + running + stale > 0
    ? "pending" as const
    : candidateQuestionKeys.length > 0
    ? "candidates-ready" as const
    : unresolvedQuestionKeys.length > 0
    ? "material-required" as const
    : "complete" as const;
  return {
    protocol: "context.indexer.material-answer-run-observation/v1" as const,
    plan_digest: plan.plan_digest,
    ledger_revision: ledger.revision,
    total: ledger.entries.length,
    pending,
    running,
    accepted,
    failed,
    stale,
    next_refs: nextRefs,
    candidate_question_keys: candidateQuestionKeys,
    unresolved_question_keys: unresolvedQuestionKeys,
    accepted_record_set_digest: indexerProtocolDigest({
      records: ledger.entries.filter((entry) => entry.state === "accepted")
        .map((entry) => entry.accepted_record_digest)
        .sort(compareIndexerCanonicalText),
    }),
    state,
    graph_outcome: state === "failed"
      ? "failed" as const
      : state === "pending"
      ? "partial" as const
      : state === "candidates-ready"
      ? "unverified" as const
      : state === "material-required"
      ? "blocked" as const
      : "completed" as const,
  };
}
