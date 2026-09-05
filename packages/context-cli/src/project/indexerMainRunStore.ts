import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  acceptIndexerMainRun,
  buildIndexerMainRunRequest,
  canonicalIndexerJson,
  failIndexerMainRun,
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
  observeIndexerMainRunLedger,
  recoverIndexerMainRunLedger,
  retryIndexerMainPartitionRun,
  retryFailedIndexerMainRuns,
  startIndexerMainRun,
  startIndexerMainRuns,
  validateAndRecordIndexerMainRun,
  validateIndexerMainWorksetSet,
  type IndexerMainRunLedger,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  type DurableMultiFileFailureInjector,
} from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  convergeStoredIndexerPartition,
  readStoredIndexerPartitionConvergence,
} from "./indexerPartitionConvergenceStore.js";
import {
  INDEXER_MAIN_RUN_STORE_ROOT,
  acceptedCachePath,
  acceptedCacheRecord,
  currentLedger,
  currentSpec,
  normalizeRunSpec,
  partitionConvergencePath,
  persistLedger,
  readJsonMaybe,
  runSpecPath,
  validateAcceptedCache,
  validateAcceptedCacheEnvelope,
  type MainRunSpec,
} from "./indexerMainRunStoreRecords.js";
export {
  INDEXER_MAIN_RUN_CURRENT_PATH,
  INDEXER_MAIN_RUN_STORE_ROOT,
} from "./indexerMainRunStoreRecords.js";
export type { IndexerMainRunStoreReceipt } from "./indexerMainRunStoreRecords.js";
export {
  acceptIndexerMainAuthorRunsStore,
  acceptIndexerMainPartitionRunsStore,
} from "./indexerMainRunBatchStore.js";

const PREPARE_TRANSACTION = "prepare-main-index-run-ledger";
const START_TRANSACTION = "start-main-index-run";
const ACCEPT_TRANSACTION = "accept-main-index-run";
const FAIL_TRANSACTION = "fail-main-index-run";
const CONVERGE_PARTITION_TRANSACTION = "converge-main-index-partition-run";


async function runningMainSpec(input: {
  projectRoot: string;
  workset_digest: string;
}) {
  const current = await currentLedger(input.projectRoot);
  if (current === undefined) throw new TypeError("main run ledger is not prepared");
  const entry = current.entries.find((item) => item.workset_digest === input.workset_digest);
  if (entry?.state !== "running") {
    throw new TypeError("main result requires a running persisted ledger entry");
  }
  const spec = await currentSpec({
    projectRoot: input.projectRoot,
    request_digest: entry.execution_request_digest,
  });
  return { current, entry, spec };
}

async function acceptValidatedMainRun(input: {
  projectRoot: string;
  current: IndexerMainRunLedger;
  validated: ReturnType<typeof validateAndRecordIndexerMainRun>;
  immutable_records?: readonly { path: string; value: unknown }[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  const cache = acceptedCacheRecord(input);
  const ledger = acceptIndexerMainRun({
    ledger: input.current,
    accepted_record: input.validated.accepted_record,
  });
  const receipt = await persistLedger({
    projectRoot: input.projectRoot,
    operation: "accept",
    transaction_kind: ACCEPT_TRANSACTION,
    ledger,
    immutable_records: [{
      path: acceptedCachePath(input.validated.request.execution_request_digest),
      value: cache,
    }, ...(input.immutable_records ?? [])],
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  return { ledger, status: observeIndexerMainRunLedger(ledger), receipt };
}

async function prepareUnlocked(input: {
  projectRoot: string;
  workset_set: unknown;
  run_specs: readonly unknown[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  await recoverDurableMultiFileTransactions(input.projectRoot);
  // Older builds wrote three unread audit-copy trees. The accepted cache is
  // the sole recovery authority, so keeping those copies only multiplies I/O
  // and local disk usage.
  await Promise.all(["ledgers", "results", "receipts"].map((directory) =>
    rm(join(input.projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, directory), {
      recursive: true,
      force: true,
    })
  ));
  const worksetSet = validateIndexerMainWorksetSet(input.workset_set);
  const previousLedger = await currentLedger(input.projectRoot);
  const suppliedSpecs = input.run_specs.map(normalizeRunSpec);
  const specs: MainRunSpec[] = [];
  for (const supplied of suppliedSpecs) {
    const previousEntry = previousLedger?.entries.find((entry) =>
      entry.workset_digest === supplied.request.workset.workset_digest
    );
    if (
      previousEntry === undefined ||
      previousEntry.execution_request_digest === supplied.request.execution_request_digest ||
      supplied.request.workset.stage !== "partition"
    ) {
      specs.push(supplied);
      continue;
    }
    const current = await currentSpec({
      projectRoot: input.projectRoot,
      request_digest: previousEntry.execution_request_digest,
    });
    const suppliedBase = {
      workset: supplied.request.workset,
      composition_input: supplied.request.composition_input,
      final_authority: supplied.request.final_authority,
    };
    const currentBase = {
      workset: current.request.workset,
      composition_input: current.request.composition_input,
      final_authority: current.request.final_authority,
    };
    const suppliedOrder = supplied.request.partition_strategy_attempt?.strategy_order ?? -1;
    const currentOrder = current.request.partition_strategy_attempt?.strategy_order ?? -1;
    if (
      currentOrder > suppliedOrder &&
      canonicalIndexerJson(suppliedBase) === canonicalIndexerJson(currentBase) &&
      canonicalIndexerJson(supplied.validation) === canonicalIndexerJson(current.validation)
    ) {
      specs.push(current);
    } else {
      specs.push(supplied);
    }
  }
  const acceptedRecords = [];
  for (const spec of specs) {
    const cached = await readJsonMaybe(
      input.projectRoot,
      acceptedCachePath(spec.request.execution_request_digest),
    );
    if (cached !== undefined) {
      acceptedRecords.push(validateAcceptedCacheEnvelope({ cache: cached, spec }).accepted_record);
    }
  }
  const ledger = recoverIndexerMainRunLedger({
    workset_set: worksetSet,
    run_identities: specs.map((spec) => ({
      workset_digest: spec.request.workset.workset_digest,
      execution_request_digest: spec.request.execution_request_digest,
    })),
    previous_ledger: previousLedger,
    accepted_records: acceptedRecords,
  });
  const receipt = await persistLedger({
    projectRoot: input.projectRoot,
    operation: "prepare",
    transaction_kind: PREPARE_TRANSACTION,
    ledger,
    immutable_records: specs.map((spec) => ({
      path: runSpecPath(spec.request.execution_request_digest),
      value: spec,
    })),
    ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
  });
  return { ledger, status: observeIndexerMainRunLedger(ledger), receipt };
}

export async function prepareIndexerMainRunStore(input: {
  projectRoot: string;
  workset_set: unknown;
  run_specs: readonly unknown[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, PREPARE_TRANSACTION, () =>
    prepareUnlocked(input)
  );
}

export async function startIndexerMainRunStore(input: {
  projectRoot: string;
  workset_digest: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, START_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await currentLedger(input.projectRoot);
    if (current === undefined) throw new TypeError("main run ledger is not prepared");
    const entry = current.entries.find((item) => item.workset_digest === input.workset_digest);
    if (entry === undefined) throw new TypeError("main run ledger has no requested workset");
    const spec = await currentSpec({
      projectRoot: input.projectRoot,
      request_digest: entry.execution_request_digest,
    });
    const ledger = startIndexerMainRun({
      ledger: current,
      workset_digest: input.workset_digest,
    });
    const receipt = await persistLedger({
      projectRoot: input.projectRoot,
      operation: "start",
      transaction_kind: START_TRANSACTION,
      ledger,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ledger, request: spec.request, status: observeIndexerMainRunLedger(ledger), receipt };
  });
}

export async function startIndexerMainRunsStore(input: {
  projectRoot: string;
  workset_digests: readonly string[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, START_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await currentLedger(input.projectRoot);
    if (current === undefined) throw new TypeError("main run ledger is not prepared");
    const requestByWorkset = new Map<string, MainRunSpec["request"]>();
    for (const worksetDigest of input.workset_digests) {
      const entry = current.entries.find((item) => item.workset_digest === worksetDigest);
      if (entry === undefined) throw new TypeError("main run ledger has no requested workset");
      const spec = await currentSpec({
        projectRoot: input.projectRoot,
        request_digest: entry.execution_request_digest,
      });
      requestByWorkset.set(worksetDigest, spec.request);
    }
    const ledger = startIndexerMainRuns({
      ledger: current,
      workset_digests: input.workset_digests,
    });
    const receipt = await persistLedger({
      projectRoot: input.projectRoot,
      operation: "start",
      transaction_kind: START_TRANSACTION,
      ledger,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      ledger,
      requests: input.workset_digests.map((digest) => requestByWorkset.get(digest)!),
      status: observeIndexerMainRunLedger(ledger),
      receipt,
    };
  });
}

export async function acceptIndexerMainRunStore(input: {
  projectRoot: string;
  workset_digest: string;
  result: unknown;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const { current, spec } = await runningMainSpec(input);
    const validated = validateAndRecordIndexerMainRun({
      request: spec.request,
      result: input.result,
      validation: spec.validation as unknown as Parameters<
        typeof validateAndRecordIndexerMainRun
      >[0]["validation"],
    });
    const isCatalogFallback = spec.request.workset.stage === "partition" &&
      spec.request.partition_strategy_attempt?.strategy_ref.strategy_id ===
        INDEXER_CATALOG_FALLBACK_STRATEGY_ID;
    if (isCatalogFallback) {
      const predecessor = await readStoredIndexerPartitionConvergence({
        request: spec.request,
        expected_decision: "catalog-fallback-required",
        read_previous_record: (attemptDigest) => readJsonMaybe(
          input.projectRoot,
          partitionConvergencePath(attemptDigest),
        ),
      });
      if (predecessor === undefined) {
        throw new TypeError("catalog fallback requires persisted exhausted convergence");
      }
    }
    const convergence = spec.request.workset.stage === "partition" && !isCatalogFallback
      ? await convergeStoredIndexerPartition({
          request: spec.request,
          validation: spec.validation,
          operation_result: validated.operation_result,
          read_previous_record: (attemptDigest) => readJsonMaybe(
            input.projectRoot,
            partitionConvergencePath(attemptDigest),
          ),
        })
      : undefined;
    if (convergence !== undefined && convergence.decision !== "accepted") {
      throw new TypeError(
        `partition result requires automatic convergence: ${convergence.decision}`,
      );
    }
    return acceptValidatedMainRun({
      projectRoot: input.projectRoot,
      current,
      validated,
      ...(convergence === undefined
        ? {}
        : {
            immutable_records: [{
              path: partitionConvergencePath(
                convergence.attempts.at(-1)!.attempt_digest,
              ),
              value: convergence,
            }],
          }),
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
  });
}

export async function convergeIndexerMainPartitionRunStore(input: {
  projectRoot: string;
  workset_digest: string;
  result: unknown;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(
    input.projectRoot,
    CONVERGE_PARTITION_TRANSACTION,
    async () => {
      await recoverDurableMultiFileTransactions(input.projectRoot);
      const { current, spec } = await runningMainSpec(input);
      if (spec.request.workset.stage !== "partition") {
        throw new TypeError("partition convergence cannot consume an author run");
      }
      const validated = validateAndRecordIndexerMainRun({
        request: spec.request,
        result: input.result,
        validation: spec.validation as unknown as Parameters<
          typeof validateAndRecordIndexerMainRun
        >[0]["validation"],
      });
      const convergence = await convergeStoredIndexerPartition({
        request: spec.request,
        validation: spec.validation,
        operation_result: validated.operation_result,
        read_previous_record: (attemptDigest) => readJsonMaybe(
          input.projectRoot,
          partitionConvergencePath(attemptDigest),
        ),
      });
      const convergenceRecord = {
        path: partitionConvergencePath(convergence.attempts.at(-1)!.attempt_digest),
        value: convergence,
      };
      if (convergence.decision === "accepted") {
        return {
          convergence,
          next_request: null,
          ...await acceptValidatedMainRun({
            projectRoot: input.projectRoot,
            current,
            validated,
            immutable_records: [convergenceRecord],
            ...(input.inject_failure === undefined
              ? {}
              : { inject_failure: input.inject_failure }),
          }),
        };
      }
      if (
        convergence.decision === "retry-required" ||
        convergence.decision === "catalog-fallback-required"
      ) {
        const nextRequest = buildIndexerMainRunRequest({
          workset: spec.request.workset,
          composition_input: spec.request.composition_input,
          final_authority: spec.request.final_authority,
          run_environment: spec.request.run_environment,
          partition_strategy_attempt: convergence.next_strategy_attempt!,
        });
        const nextSpec = normalizeRunSpec({
          protocol: "context.indexer.main-run-spec/v1",
          request: nextRequest,
          validation: spec.validation,
        });
        const ledger = retryIndexerMainPartitionRun({
          ledger: current,
          workset_digest: input.workset_digest,
          previous_execution_request_digest: spec.request.execution_request_digest,
          next_execution_request_digest: nextRequest.execution_request_digest,
        });
        const receipt = await persistLedger({
          projectRoot: input.projectRoot,
          operation: "converge-partition",
          transaction_kind: CONVERGE_PARTITION_TRANSACTION,
          ledger,
          immutable_records: [convergenceRecord, {
            path: runSpecPath(nextRequest.execution_request_digest),
            value: nextSpec,
          }],
          ...(input.inject_failure === undefined
            ? {}
            : { inject_failure: input.inject_failure }),
        });
        return {
          convergence,
          next_request: nextRequest,
          ledger,
          status: observeIndexerMainRunLedger(ledger),
          receipt,
        };
      }
      const ledger = failIndexerMainRun({
        ledger: current,
        workset_digest: input.workset_digest,
        reason_code: "partition-input-damaged",
        dependency_digests: [
          convergence.convergence_digest,
          validated.accepted_record.result_digest,
        ],
      });
      const receipt = await persistLedger({
        projectRoot: input.projectRoot,
        operation: "converge-partition",
        transaction_kind: CONVERGE_PARTITION_TRANSACTION,
        ledger,
        immutable_records: [convergenceRecord],
        ...(input.inject_failure === undefined
          ? {}
          : { inject_failure: input.inject_failure }),
      });
      return {
        convergence,
        next_request: null,
        ledger,
        status: observeIndexerMainRunLedger(ledger),
        receipt,
      };
    },
  );
}

export async function failIndexerMainRunStore(input: {
  projectRoot: string;
  workset_digest: string;
  reason_code: string;
  dependency_digests: readonly string[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, FAIL_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await currentLedger(input.projectRoot);
    if (current === undefined) throw new TypeError("main run ledger is not prepared");
    const ledger = failIndexerMainRun({ ledger: current, ...input });
    const receipt = await persistLedger({
      projectRoot: input.projectRoot,
      operation: "fail",
      transaction_kind: FAIL_TRANSACTION,
      ledger,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ledger, status: observeIndexerMainRunLedger(ledger), receipt };
  });
}

export async function retryFailedIndexerMainRunStore(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "retry-main-index-run", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    const current = await currentLedger(projectRoot);
    if (current === undefined) throw new TypeError("main run ledger is not prepared");
    const ledger = retryFailedIndexerMainRuns(current);
    const receipt = await persistLedger({
      projectRoot,
      operation: "retry",
      transaction_kind: "retry-main-index-run",
      ledger,
    });
    return { ledger, status: observeIndexerMainRunLedger(ledger), receipt };
  });
}

export async function observeIndexerMainRunStore(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "observe-main-index-run-ledger", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    const ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    return { ledger, status: observeIndexerMainRunLedger(ledger) };
  });
}

async function readAcceptedMainResultRecordsUnlocked(
  projectRoot: string,
  stage: "partition" | "author",
) {
    await recoverDurableMultiFileTransactions(projectRoot);
    const ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    if (ledger.entries.some((entry) => entry.stage !== stage)) {
      throw new TypeError(`current main run ledger is not the ${stage} stage`);
    }
    if (ledger.entries.some((entry) => entry.state !== "accepted")) {
      throw new TypeError(`main ${stage} results require every run to be accepted`);
    }
    const records = [];
    for (const entry of ledger.entries) {
      if (entry.state !== "accepted") continue;
      const spec = await currentSpec({
        projectRoot,
        request_digest: entry.execution_request_digest,
      });
      const cached = await readJsonMaybe(
        projectRoot,
        acceptedCachePath(entry.execution_request_digest),
      );
      if (cached === undefined) {
        throw new TypeError(`accepted main ${stage} result cache is missing`);
      }
      const validated = validateAcceptedCache({ cache: cached, spec });
      if (canonicalIndexerJson(validated.accepted_record) !==
        canonicalIndexerJson(entry.accepted_record)) {
        throw new TypeError(`accepted main ${stage} cache does not match the current ledger`);
      }
      records.push({
        request: spec.request,
        run_result: validated.result,
        accepted_record: validated.accepted_record,
        artifact_result: validated.operation_result,
        run_envelope: validated.run_envelope,
        dependency_view: spec.validation.dependency_view,
        artifact_dependency_set: validated.artifact_dependency_set,
        validation: spec.validation,
      });
    }
    return records;
}

export async function readAcceptedIndexerMainPartitionResultRecords(projectRoot: string) {
  return withProjectWriteLock(
    projectRoot,
    "read-accepted-main-partition-result-records",
    () => readAcceptedMainResultRecordsUnlocked(projectRoot, "partition"),
  );
}

export async function readAcceptedIndexerMainAuthorResultRecords(projectRoot: string) {
  return withProjectWriteLock(
    projectRoot,
    "read-accepted-main-author-result-records",
    () => readAcceptedMainResultRecordsUnlocked(projectRoot, "author"),
  );
}

export async function readAcceptedIndexerMainAuthorResults(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "read-accepted-main-author-results", async () => {
    const records = await readAcceptedMainResultRecordsUnlocked(projectRoot, "author");
    return records.map((record) => record.artifact_result);
  });
}
