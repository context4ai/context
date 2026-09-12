import {
  acceptIndexerMainRun,
  buildIndexerMainRunRequest,
  failIndexerMainRun,
  observeIndexerMainRunLedger,
  retryIndexerMainPartitionRun,
  validateAndRecordIndexerMainRun,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  type DurableMultiFileFailureInjector,
} from "./durableMultiFileTransaction.js";
import {
  convergeStoredIndexerPartition,
} from "./indexerPartitionConvergenceStore.js";
import {
  acceptedCachePath,
  acceptedCacheRecord,
  currentLedger,
  currentSpec,
  normalizeRunSpec,
  partitionConvergencePath,
  persistLedger,
  readJsonMaybe,
  runSpecPath,
} from "./indexerMainRunStoreRecords.js";
import { withProjectWriteLock } from "./writeLock.js";

const ACCEPT_TRANSACTION = "accept-main-index-run";
const CONVERGE_PARTITION_TRANSACTION = "converge-main-index-partition-run";

export async function acceptIndexerMainAuthorRunsStore(input: {
  projectRoot: string;
  runs: readonly {
    workset_digest: string;
    result: unknown;
  }[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  if (input.runs.length === 0) {
    throw new TypeError("main author batch acceptance requires at least one run");
  }
  if (new Set(input.runs.map((run) => run.workset_digest)).size !== input.runs.length) {
    throw new TypeError("main author batch acceptance contains duplicate worksets");
  }
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    let ledger = await currentLedger(input.projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    const immutableRecords: Array<{ path: string; value: unknown }> = [];
    const outcomes: Array<{
      workset_digest: string;
      outcome: "accepted" | "conflict" | "failed";
      committed: boolean;
      message?: string;
    }> = [];
    for (const run of input.runs) {
      const entry = ledger.entries.find((item) => item.workset_digest === run.workset_digest);
      if (entry?.state !== "running") {
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "conflict",
          committed: false,
          message: "main Author task is no longer running",
        });
        continue;
      }
      const spec = await currentSpec({
        projectRoot: input.projectRoot,
        request_digest: entry.execution_request_digest,
      });
      if (spec.request.workset.stage !== "author") {
        throw new TypeError("main author batch acceptance cannot consume partition worksets");
      }
      try {
        const validated = validateAndRecordIndexerMainRun({
          request: spec.request,
          result: run.result,
          validation: spec.validation as unknown as Parameters<
            typeof validateAndRecordIndexerMainRun
          >[0]["validation"],
        });
        ledger = acceptIndexerMainRun({
          ledger,
          accepted_record: validated.accepted_record,
        });
        immutableRecords.push({
          path: acceptedCachePath(validated.request.execution_request_digest),
          value: acceptedCacheRecord({ validated }),
        });
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "accepted",
          committed: true,
        });
      } catch (error) {
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "failed",
          committed: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const receipt = await persistLedger({
      projectRoot: input.projectRoot,
      operation: "accept",
      transaction_kind: ACCEPT_TRANSACTION,
      ledger,
      immutable_records: immutableRecords,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { outcomes, ledger, status: observeIndexerMainRunLedger(ledger), receipt };
  });
}

export async function acceptIndexerMainPartitionRunsStore(input: {
  projectRoot: string;
  runs: readonly {
    workset_digest: string;
    result: unknown;
  }[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  if (input.runs.length === 0) {
    throw new TypeError("main partition batch acceptance requires at least one run");
  }
  if (new Set(input.runs.map((run) => run.workset_digest)).size !== input.runs.length) {
    throw new TypeError("main partition batch acceptance contains duplicate worksets");
  }
  return withProjectWriteLock(input.projectRoot, CONVERGE_PARTITION_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    let ledger = await currentLedger(input.projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    const immutableRecords: Array<{ path: string; value: unknown }> = [];
    const outcomes: Array<{
      workset_digest: string;
      outcome:
        | "accepted"
        | "retry-required"
        | "catalog-fallback-required"
        | "rejected"
        | "conflict"
        | "failed";
      next_request: ReturnType<typeof buildIndexerMainRunRequest> | null;
      committed: boolean;
      message?: string;
    }> = [];
    for (const run of input.runs) {
      const entry = ledger.entries.find((item) => item.workset_digest === run.workset_digest);
      if (entry?.state !== "running") {
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "conflict",
          next_request: null,
          committed: false,
          message: "main Partition task is no longer running",
        });
        continue;
      }
      const spec = await currentSpec({
        projectRoot: input.projectRoot,
        request_digest: entry.execution_request_digest,
      });
      if (spec.request.workset.stage !== "partition") {
        throw new TypeError("main partition batch acceptance cannot consume author worksets");
      }
      let validated: ReturnType<typeof validateAndRecordIndexerMainRun>;
      let convergence: Awaited<ReturnType<typeof convergeStoredIndexerPartition>>;
      try {
        validated = validateAndRecordIndexerMainRun({
          request: spec.request,
          result: run.result,
          validation: spec.validation as unknown as Parameters<
            typeof validateAndRecordIndexerMainRun
          >[0]["validation"],
        });
        convergence = await convergeStoredIndexerPartition({
          request: spec.request,
          validation: spec.validation,
          operation_result: validated.operation_result,
          read_previous_record: (attemptDigest) => readJsonMaybe(
            input.projectRoot,
            partitionConvergencePath(attemptDigest),
          ),
        });
      } catch (error) {
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "failed",
          next_request: null,
          committed: false,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      immutableRecords.push({
        path: partitionConvergencePath(convergence.attempts.at(-1)!.attempt_digest),
        value: convergence,
      });
      if (convergence.decision === "accepted") {
        ledger = acceptIndexerMainRun({
          ledger,
          accepted_record: validated.accepted_record,
        });
        immutableRecords.push({
          path: acceptedCachePath(validated.request.execution_request_digest),
          value: acceptedCacheRecord({ validated }),
        });
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: "accepted",
          next_request: null,
          committed: true,
        });
        continue;
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
        ledger = retryIndexerMainPartitionRun({
          ledger,
          workset_digest: run.workset_digest,
          previous_execution_request_digest: spec.request.execution_request_digest,
          next_execution_request_digest: nextRequest.execution_request_digest,
        });
        immutableRecords.push({
          path: runSpecPath(nextRequest.execution_request_digest),
          value: nextSpec,
        });
        outcomes.push({
          workset_digest: run.workset_digest,
          outcome: convergence.decision,
          next_request: nextRequest,
          committed: true,
        });
        continue;
      }
      ledger = failIndexerMainRun({
        ledger,
        workset_digest: run.workset_digest,
        reason_code: "partition-input-damaged",
        dependency_digests: [
          convergence.convergence_digest,
          validated.accepted_record.result_digest,
        ],
      });
      outcomes.push({
        workset_digest: run.workset_digest,
        outcome: "rejected",
        next_request: null,
        committed: true,
      });
    }
    const receipt = await persistLedger({
      projectRoot: input.projectRoot,
      operation: "converge-partition",
      transaction_kind: CONVERGE_PARTITION_TRANSACTION,
      ledger,
      immutable_records: immutableRecords,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return {
      outcomes,
      ledger,
      status: observeIndexerMainRunLedger(ledger),
      receipt,
    };
  });
}
