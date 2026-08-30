import {
  acceptIndexerMaterialAnswerRun,
  buildIndexerMaterialAnswerAcceptedRunRecord,
  failIndexerMaterialAnswerRun,
  indexerProtocolDigest,
  observeIndexerMaterialAnswerRuns,
  prepareIndexerMaterialAnswerRunLedger,
  startIndexerMaterialAnswerRun,
  validateIndexerMaterialAnswerAcceptedRunRecord,
  validateIndexerMaterialAnswerExecutionPlan,
  validateIndexerMaterialAnswerRunResult,
  type IndexerCurrentEvidenceSource,
  type IndexerSourceSpanRef,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  type DurableMultiFileFailureInjector,
} from "./durableMultiFileTransaction.js";
import {
  buildMaterialAnswerRuntimeState,
  materialAnswerAcceptedPath,
  materialAnswerReceiptPath,
  materialAnswerResultPath,
  normalizeMaterialAnswerRunSpec,
  persistMaterialAnswerState,
  readMaterialAnswerCurrentState,
  readMaterialAnswerJsonMaybe,
  type MaterialAnswerRuntimeState,
} from "./indexerMaterialAnswerStorePersistence.js";
import { withProjectWriteLock } from "./writeLock.js";

export {
  INDEXER_MATERIAL_ANSWER_CURRENT_PATH,
  INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
} from "./indexerMaterialAnswerStorePersistence.js";

const PREPARE_TRANSACTION = "prepare-material-answer-runs";
const START_TRANSACTION = "start-material-answer-run";
const ACCEPT_TRANSACTION = "accept-material-answer-run";
const FAIL_TRANSACTION = "fail-material-answer-run";

function assertExpected(input: {
  state: MaterialAnswerRuntimeState;
  plan_digest: string;
  expected_revision: string;
}): void {
  if (
    input.state.spec.plan.plan_digest !== input.plan_digest ||
    input.state.ledger.revision !== input.expected_revision
  ) {
    throw new TypeError("material-answer persisted state CAS mismatch");
  }
}

async function acceptedRecords(input: {
  projectRoot: string;
  plan: ReturnType<typeof validateIndexerMaterialAnswerExecutionPlan>;
}) {
  const records = [];
  for (const run of input.plan.runs) {
    const raw = await readMaterialAnswerJsonMaybe(
      input.projectRoot,
      materialAnswerAcceptedPath(run.request.execution_request_digest),
    );
    if (raw === undefined) continue;
    const record = validateIndexerMaterialAnswerAcceptedRunRecord({
      plan: input.plan,
      record: raw,
    });
    if (
      record.run_ref !== run.run_ref ||
      record.execution_request_digest !== run.request.execution_request_digest
    ) {
      throw new TypeError("material-answer accepted cache path is stale");
    }
    records.push(record);
  }
  return records;
}

export async function prepareIndexerMaterialAnswerRunStore(input: {
  projectRoot: string;
  requirement_set_digest: string;
  registry_digest: string;
  plan: unknown;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, PREPARE_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const spec = normalizeMaterialAnswerRunSpec(input);
    const previous = await readMaterialAnswerCurrentState(input.projectRoot);
    const ledger = prepareIndexerMaterialAnswerRunLedger({
      plan: spec.plan,
      ...(previous === undefined ? {} : { previous_ledger: previous.ledger }),
      accepted_records: await acceptedRecords({
        projectRoot: input.projectRoot,
        plan: spec.plan,
      }),
    });
    const state = buildMaterialAnswerRuntimeState({ spec, ledger });
    const receipt = await persistMaterialAnswerState({
      projectRoot: input.projectRoot,
      operation: "prepare",
      transaction_kind: PREPARE_TRANSACTION,
      state,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      plan: spec.plan,
      ledger,
      observation: observeIndexerMaterialAnswerRuns({ plan: spec.plan, ledger }),
      receipt,
    };
  });
}

export async function startIndexerMaterialAnswerRunStore(input: {
  projectRoot: string;
  plan_digest: string;
  expected_revision: string;
  run_ref: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, START_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readMaterialAnswerCurrentState(input.projectRoot);
    if (current === undefined) throw new TypeError("material-answer run ledger is not prepared");
    assertExpected({ state: current, ...input });
    const ledger = startIndexerMaterialAnswerRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      expected_revision: input.expected_revision,
      run_ref: input.run_ref,
    });
    const run = current.spec.plan.runs.find((candidate) =>
      candidate.run_ref === input.run_ref
    );
    if (run === undefined) throw new TypeError("material-answer run is outside the plan");
    const state = buildMaterialAnswerRuntimeState({ spec: current.spec, ledger });
    const receipt = await persistMaterialAnswerState({
      projectRoot: input.projectRoot,
      operation: "start",
      transaction_kind: START_TRANSACTION,
      state,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      request: run.request,
      ledger,
      observation: observeIndexerMaterialAnswerRuns({ plan: current.spec.plan, ledger }),
      receipt,
    };
  });
}

export async function acceptIndexerMaterialAnswerRunStore(input: {
  projectRoot: string;
  plan_digest: string;
  expected_revision: string;
  run_ref: string;
  result: unknown;
  current_sources: readonly IndexerCurrentEvidenceSource[];
  resolve_evidence_digest: (input: {
    source: IndexerCurrentEvidenceSource;
    source_spans: readonly IndexerSourceSpanRef[];
  }) => string;
  assert_evidence_reads_consumed?: () => void;
  read_receipt_set_digest: string;
  read_receipt_record?: unknown;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readMaterialAnswerCurrentState(input.projectRoot);
    if (current === undefined) throw new TypeError("material-answer run ledger is not prepared");
    assertExpected({ state: current, ...input });
    const run = current.spec.plan.runs.find((candidate) =>
      candidate.run_ref === input.run_ref
    );
    if (run === undefined) throw new TypeError("material-answer run is outside the plan");
    const entry = current.ledger.entries.find((candidate) =>
      candidate.run_ref === input.run_ref
    );
    if (entry?.state !== "running") {
      throw new TypeError("material-answer result requires a running persisted entry");
    }
    const validated = validateIndexerMaterialAnswerRunResult({
      request: run.request,
      result: input.result,
      current_sources: input.current_sources,
      resolve_evidence_digest: input.resolve_evidence_digest,
    });
    input.assert_evidence_reads_consumed?.();
    const record = buildIndexerMaterialAnswerAcceptedRunRecord({
      plan: current.spec.plan,
      run_ref: run.run_ref,
      run_result: validated.result,
      candidate_set: validated.candidate_set,
      read_receipt_set_digest: input.read_receipt_set_digest,
    });
    const ledger = acceptIndexerMaterialAnswerRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      expected_revision: input.expected_revision,
      record,
    });
    const state = buildMaterialAnswerRuntimeState({ spec: current.spec, ledger });
    const immutableRecords: Array<{ path: string; value: unknown }> = [{
      path: materialAnswerAcceptedPath(run.request.execution_request_digest),
      value: record,
    }, {
      path: materialAnswerResultPath(validated.result.result.result_digest),
      value: validated.result,
    }];
    if (input.read_receipt_record !== undefined) {
      immutableRecords.push({
        path: materialAnswerReceiptPath(input.read_receipt_set_digest),
        value: input.read_receipt_record,
      });
    }
    const receipt = await persistMaterialAnswerState({
      projectRoot: input.projectRoot,
      operation: "accept",
      transaction_kind: ACCEPT_TRANSACTION,
      state,
      immutable_records: immutableRecords,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      accepted_record: record,
      candidate_set: validated.candidate_set,
      ledger,
      observation: observeIndexerMaterialAnswerRuns({ plan: current.spec.plan, ledger }),
      receipt,
    };
  });
}

export async function failIndexerMaterialAnswerRunStore(input: {
  projectRoot: string;
  plan_digest: string;
  expected_revision: string;
  run_ref: string;
  reason_code: string;
  dependency_digests: readonly string[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, FAIL_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readMaterialAnswerCurrentState(input.projectRoot);
    if (current === undefined) throw new TypeError("material-answer run ledger is not prepared");
    assertExpected({ state: current, ...input });
    const failureDigest = indexerProtocolDigest({
      protocol: "context.indexer.material-answer-run-failure/v1",
      plan_digest: input.plan_digest,
      ledger_revision: input.expected_revision,
      run_ref: input.run_ref,
      reason_code: input.reason_code,
      dependency_digests: [...input.dependency_digests].sort(),
    });
    const ledger = failIndexerMaterialAnswerRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      expected_revision: input.expected_revision,
      run_ref: input.run_ref,
      failure_digest: failureDigest,
    });
    const state = buildMaterialAnswerRuntimeState({ spec: current.spec, ledger });
    const receipt = await persistMaterialAnswerState({
      projectRoot: input.projectRoot,
      operation: "fail",
      transaction_kind: FAIL_TRANSACTION,
      state,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      failure_digest: failureDigest,
      ledger,
      observation: observeIndexerMaterialAnswerRuns({ plan: current.spec.plan, ledger }),
      receipt,
    };
  });
}

export async function observeIndexerMaterialAnswerRunStore(input: {
  projectRoot: string;
  plan_digest: string;
  expected_revision: string;
}) {
  return withProjectWriteLock(input.projectRoot, "observe-material-answer-runs", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readMaterialAnswerCurrentState(input.projectRoot);
    if (current === undefined) throw new TypeError("material-answer run ledger is not prepared");
    assertExpected({ state: current, ...input });
    return {
      plan: current.spec.plan,
      ledger: current.ledger,
      observation: observeIndexerMaterialAnswerRuns({
        plan: current.spec.plan,
        ledger: current.ledger,
      }),
    };
  });
}
