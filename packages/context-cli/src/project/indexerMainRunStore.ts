import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acceptIndexerMainRun,
  buildIndexerMainRunRequest,
  canonicalIndexerJson,
  failIndexerMainRun,
  INDEXER_CATALOG_FALLBACK_STRATEGY_ID,
  indexerProtocolDigest,
  observeIndexerMainRunLedger,
  recoverIndexerMainRunLedger,
  retryIndexerMainPartitionRun,
  startIndexerMainRun,
  validateAndRecordIndexerMainRun,
  validateIndexerMainRunLedger,
  validateIndexerMainRunRequest,
  validateIndexerMainWorksetSet,
  type IndexerMainRunLedger,
  type IndexerMainRunRequest,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import {
  durableContentDigest,
} from "./durableSingleFileTransaction.js";
import {
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  convergeStoredIndexerPartition,
  readStoredIndexerPartitionConvergence,
} from "./indexerPartitionConvergenceStore.js";

export const INDEXER_MAIN_RUN_STORE_ROOT = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "main-index",
);
export const INDEXER_MAIN_RUN_CURRENT_PATH = join(
  INDEXER_MAIN_RUN_STORE_ROOT,
  "current.json",
);

const PREPARE_TRANSACTION = "prepare-main-index-run-ledger";
const START_TRANSACTION = "start-main-index-run";
const ACCEPT_TRANSACTION = "accept-main-index-run";
const FAIL_TRANSACTION = "fail-main-index-run";
const CONVERGE_PARTITION_TRANSACTION = "converge-main-index-partition-run";

interface MainRunSpec {
  protocol: "context.indexer.main-run-spec/v1";
  request: IndexerMainRunRequest;
  validation: Record<string, unknown>;
  spec_digest: string;
}

interface MainAcceptedCacheRecord {
  protocol: "context.indexer.main-accepted-cache-record/v1";
  request: IndexerMainRunRequest;
  result: unknown;
  workset_read_receipts: unknown[];
  operation_result: unknown;
  authoring_audit: unknown;
  run_envelope: unknown;
  artifact_dependency_set: unknown;
  accepted_record: ReturnType<typeof validateAndRecordIndexerMainRun>["accepted_record"];
  cache_digest: string;
}

export interface IndexerMainRunStoreReceipt {
  protocol: "context.indexer.main-run-store-receipt/v1";
  operation: "prepare" | "start" | "accept" | "fail" | "converge-partition";
  ledger_digest: string;
  transaction: DurableMultiFileTransactionReceipt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digestName(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("content-addressed Indexer runtime path requires a sha256 digest");
  }
  return digest.slice("sha256:".length);
}

function ledgerSnapshotPath(digest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "ledgers", `${digestName(digest)}.json`);
}

function runSpecPath(requestDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "requests", `${digestName(requestDigest)}.json`);
}

function acceptedCachePath(requestDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "accepted", `${digestName(requestDigest)}.json`);
}

function resultCachePath(resultDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "results", `${digestName(resultDigest)}.json`);
}

function receiptCachePath(receiptDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "receipts", `${digestName(receiptDigest)}.json`);
}

function partitionConvergencePath(attemptDigest: string): string {
  return join(
    INDEXER_MAIN_RUN_STORE_ROOT,
    "partition-convergence",
    `${digestName(attemptDigest)}.json`,
  );
}

function jsonContent(value: unknown): string {
  const canonical = canonicalIndexerJson(value);
  if (typeof canonical !== "string") throw new TypeError("runtime record is not JSON serializable");
  return `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`;
}

async function readMaybe(projectRoot: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(projectRoot, path), "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readJsonMaybe(projectRoot: string, path: string): Promise<unknown | undefined> {
  const raw = await readMaybe(projectRoot, path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(`Indexer runtime record is invalid JSON: ${path}`);
  }
}

function normalizeRunSpec(value: unknown): MainRunSpec {
  if (!isRecord(value) || value.protocol !== "context.indexer.main-run-spec/v1") {
    throw new TypeError("main run spec must use context.indexer.main-run-spec/v1");
  }
  const request = validateIndexerMainRunRequest(value.request);
  if (!isRecord(value.validation) || value.validation.stage !== request.workset.stage) {
    throw new TypeError("main run spec validation must match the request stage");
  }
  const payload = {
    protocol: "context.indexer.main-run-spec/v1" as const,
    request,
    validation: value.validation,
  };
  const specDigest = indexerProtocolDigest(payload);
  if (value.spec_digest !== undefined && value.spec_digest !== specDigest) {
    throw new TypeError("main run spec digest is invalid");
  }
  return { ...payload, spec_digest: specDigest };
}

function validateAcceptedCache(input: {
  cache: unknown;
  spec: MainRunSpec;
}): MainAcceptedCacheRecord {
  if (!isRecord(input.cache) || input.cache.protocol !== "context.indexer.main-accepted-cache-record/v1") {
    throw new TypeError("main accepted cache record has an invalid protocol");
  }
  if (!Array.isArray(input.cache.workset_read_receipts)) {
    throw new TypeError("main accepted cache record is missing read receipts");
  }
  const validated = validateAndRecordIndexerMainRun({
    request: input.spec.request,
    result: input.cache.result,
    workset_read_receipts: input.cache.workset_read_receipts,
    validation: input.spec.validation as unknown as Parameters<
      typeof validateAndRecordIndexerMainRun
    >[0]["validation"],
  });
  const payload = {
    protocol: "context.indexer.main-accepted-cache-record/v1" as const,
    request: validated.request,
    result: validated.result,
    workset_read_receipts: input.cache.workset_read_receipts,
    operation_result: validated.operation_result,
    authoring_audit: validated.authoring_audit,
    run_envelope: validated.run_envelope,
    artifact_dependency_set: validated.artifact_dependency_set,
    accepted_record: validated.accepted_record,
  };
  const cacheDigest = indexerProtocolDigest(payload);
  if (
    input.cache.cache_digest !== cacheDigest ||
    indexerProtocolDigest(input.cache.request) !== indexerProtocolDigest(payload.request) ||
    indexerProtocolDigest(input.cache.operation_result) !==
      indexerProtocolDigest(payload.operation_result) ||
    indexerProtocolDigest(input.cache.authoring_audit) !==
      indexerProtocolDigest(payload.authoring_audit) ||
    indexerProtocolDigest(input.cache.run_envelope) !==
      indexerProtocolDigest(payload.run_envelope) ||
    indexerProtocolDigest(input.cache.artifact_dependency_set) !==
      indexerProtocolDigest(payload.artifact_dependency_set) ||
    indexerProtocolDigest(input.cache.accepted_record) !==
      indexerProtocolDigest(payload.accepted_record)
  ) {
    throw new TypeError("main accepted cache record failed integrity validation");
  }
  return { ...payload, cache_digest: cacheDigest };
}

async function currentLedger(projectRoot: string): Promise<IndexerMainRunLedger | undefined> {
  const value = await readJsonMaybe(projectRoot, INDEXER_MAIN_RUN_CURRENT_PATH);
  return value === undefined ? undefined : validateIndexerMainRunLedger(value);
}

async function currentSpec(input: {
  projectRoot: string;
  request_digest: string;
}): Promise<MainRunSpec> {
  const value = await readJsonMaybe(input.projectRoot, runSpecPath(input.request_digest));
  if (value === undefined) throw new TypeError("main run request cache is missing");
  const spec = normalizeRunSpec(value);
  if (spec.request.execution_request_digest !== input.request_digest) {
    throw new TypeError("main run request cache path does not match its request digest");
  }
  return spec;
}

async function writeTarget(input: {
  projectRoot: string;
  path: string;
  value: unknown;
  immutable?: boolean;
}): Promise<IndexerProjectFileTarget | undefined> {
  const content = jsonContent(input.value);
  const existing = await readMaybe(input.projectRoot, input.path);
  if (existing === content) return undefined;
  if (input.immutable === true && existing !== undefined) {
    throw new TypeError(`content-addressed Indexer runtime record is immutable: ${input.path}`);
  }
  return {
    path: input.path,
    operation: "write",
    base_digest: existing === undefined ? null : durableContentDigest(existing),
    target_digest: durableContentDigest(content),
    content,
  };
}

async function persistLedger(input: {
  projectRoot: string;
  operation: IndexerMainRunStoreReceipt["operation"];
  transaction_kind: string;
  ledger: IndexerMainRunLedger;
  immutable_records?: readonly { path: string; value: unknown }[];
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerMainRunStoreReceipt> {
  const candidates = await Promise.all([
    ...(input.immutable_records ?? []).map((record) => writeTarget({
      projectRoot: input.projectRoot,
      path: record.path,
      value: record.value,
      immutable: true,
    })),
    writeTarget({
      projectRoot: input.projectRoot,
      path: ledgerSnapshotPath(input.ledger.ledger_digest),
      value: input.ledger,
      immutable: true,
    }),
    writeTarget({
      projectRoot: input.projectRoot,
      path: INDEXER_MAIN_RUN_CURRENT_PATH,
      value: input.ledger,
    }),
  ]);
  const targets = candidates.filter(
    (target): target is IndexerProjectFileTarget => target !== undefined,
  ).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const transaction = targets.length === 0
    ? null
    : await runDurableMultiFileTransaction({
        projectRoot: input.projectRoot,
        kind: input.transaction_kind,
        proposal_digest: indexerProtocolDigest({
          protocol: "context.indexer.main-run-store-proposal/v1",
          operation: input.operation,
          ledger_digest: input.ledger.ledger_digest,
          targets: targets.map((target) => ({
            path: target.path,
            target_digest: target.target_digest,
          })),
        }),
        targets,
        ...(input.inject_failure === undefined
          ? {}
          : { inject_failure: input.inject_failure }),
      });
  return {
    protocol: "context.indexer.main-run-store-receipt/v1",
    operation: input.operation,
    ledger_digest: input.ledger.ledger_digest,
    transaction,
  };
}

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
  workset_read_receipts: readonly unknown[];
  immutable_records?: readonly { path: string; value: unknown }[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  const cachePayload = {
    protocol: "context.indexer.main-accepted-cache-record/v1" as const,
    request: input.validated.request,
    result: input.validated.result,
    workset_read_receipts: [...input.workset_read_receipts],
    operation_result: input.validated.operation_result,
    authoring_audit: input.validated.authoring_audit,
    run_envelope: input.validated.run_envelope,
    artifact_dependency_set: input.validated.artifact_dependency_set,
    accepted_record: input.validated.accepted_record,
  };
  const cache: MainAcceptedCacheRecord = {
    ...cachePayload,
    cache_digest: indexerProtocolDigest(cachePayload),
  };
  const receiptRecord = {
    protocol: "context.indexer.main-run-receipt-cache/v1",
    workset_digest: input.validated.request.workset.workset_digest,
    execution_request_digest: input.validated.request.execution_request_digest,
    consumed_input_view_digest: input.validated.result.consumed_input_view_digest,
    workset_read_receipt_digests: input.validated.result.workset_read_receipt_digests,
    workset_read_receipts: input.workset_read_receipts,
    receipt_digest: input.validated.accepted_record.receipt_digest,
  };
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
      path: resultCachePath(input.validated.accepted_record.result_digest),
      value: input.validated.operation_result,
    }, {
      path: receiptCachePath(input.validated.accepted_record.receipt_digest),
      value: receiptRecord,
    }, {
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
      acceptedRecords.push(validateAcceptedCache({ cache: cached, spec }).accepted_record);
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

export async function acceptIndexerMainRunStore(input: {
  projectRoot: string;
  workset_digest: string;
  result: unknown;
  workset_read_receipts: readonly unknown[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const { current, spec } = await runningMainSpec(input);
    const validated = validateAndRecordIndexerMainRun({
      request: spec.request,
      result: input.result,
      workset_read_receipts: input.workset_read_receipts,
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
      workset_read_receipts: input.workset_read_receipts,
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
  workset_read_receipts: readonly unknown[];
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
        workset_read_receipts: input.workset_read_receipts,
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
            workset_read_receipts: input.workset_read_receipts,
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

export async function observeIndexerMainRunStore(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "observe-main-index-run-ledger", async () => {
    await recoverDurableMultiFileTransactions(projectRoot);
    const ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    return { ledger, status: observeIndexerMainRunLedger(ledger) };
  });
}

async function readAcceptedMainAuthorResultRecordsUnlocked(projectRoot: string) {
    await recoverDurableMultiFileTransactions(projectRoot);
    const ledger = await currentLedger(projectRoot);
    if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
    if (ledger.entries.some((entry) => entry.stage !== "author")) {
      throw new TypeError("current main run ledger is not the author stage");
    }
    if (ledger.entries.some((entry) => entry.state !== "accepted")) {
      throw new TypeError("main author results cannot reconcile before every run is accepted");
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
        throw new TypeError("accepted main author result cache is missing");
      }
      const validated = validateAcceptedCache({ cache: cached, spec });
      if (canonicalIndexerJson(validated.accepted_record) !==
        canonicalIndexerJson(entry.accepted_record)) {
        throw new TypeError("accepted main author cache does not match the current ledger");
      }
      records.push({
        run_result: validated.result,
        accepted_record: validated.accepted_record,
        artifact_result: validated.operation_result,
        run_envelope: validated.run_envelope,
        dependency_view: spec.validation.dependency_view,
        artifact_dependency_set: validated.artifact_dependency_set,
      });
    }
    return records;
}

export async function readAcceptedIndexerMainAuthorResultRecords(projectRoot: string) {
  return withProjectWriteLock(
    projectRoot,
    "read-accepted-main-author-result-records",
    () => readAcceptedMainAuthorResultRecordsUnlocked(projectRoot),
  );
}

export async function readAcceptedIndexerMainAuthorResults(projectRoot: string) {
  return withProjectWriteLock(projectRoot, "read-accepted-main-author-results", async () => {
    const records = await readAcceptedMainAuthorResultRecordsUnlocked(projectRoot);
    return records.map((record) => record.artifact_result);
  });
}
