import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  validateAndRecordIndexerMainRun,
  validateIndexerMainAcceptedRecord,
  validateIndexerMainRunLedger,
  validateIndexerMainRunRequest,
  type IndexerMainAcceptedRecord,
  type IndexerMainRunLedger,
  type IndexerMainRunRequest,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import {
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";

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

export interface MainRunSpec {
  protocol: "context.indexer.main-run-spec/v1";
  request: IndexerMainRunRequest;
  validation: Record<string, unknown>;
  spec_digest: string;
}

interface MainAcceptedCacheRecord {
  protocol: "context.indexer.main-accepted-cache-record/v1";
  result: unknown;
  workset_read_receipts: unknown[];
  accepted_record: IndexerMainAcceptedRecord;
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

export function runSpecPath(requestDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "requests", `${digestName(requestDigest)}.json`);
}

export function acceptedCachePath(requestDigest: string): string {
  return join(INDEXER_MAIN_RUN_STORE_ROOT, "accepted", `${digestName(requestDigest)}.json`);
}

export function partitionConvergencePath(attemptDigest: string): string {
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

export async function readJsonMaybe(
  projectRoot: string,
  path: string,
): Promise<unknown | undefined> {
  const raw = await readMaybe(projectRoot, path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(`Indexer runtime record is invalid JSON: ${path}`);
  }
}

export function normalizeRunSpec(value: unknown): MainRunSpec {
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

export function validateAcceptedCacheEnvelope(input: {
  cache: unknown;
  spec: MainRunSpec;
}): MainAcceptedCacheRecord {
  if (!isRecord(input.cache) || input.cache.protocol !== "context.indexer.main-accepted-cache-record/v1") {
    throw new TypeError("main accepted cache record has an invalid protocol");
  }
  if (!Array.isArray(input.cache.workset_read_receipts)) {
    throw new TypeError("main accepted cache record is missing read receipts");
  }
  const acceptedRecord = validateIndexerMainAcceptedRecord(input.cache.accepted_record);
  const payload = {
    protocol: "context.indexer.main-accepted-cache-record/v1" as const,
    result: input.cache.result,
    workset_read_receipts: input.cache.workset_read_receipts,
    accepted_record: acceptedRecord,
  };
  const cacheDigest = indexerProtocolDigest(payload);
  if (input.cache.cache_digest !== cacheDigest) {
    throw new TypeError("main accepted cache record failed integrity validation");
  }
  const expectedAcceptanceDigest = indexerProtocolDigest({
    protocol: acceptedRecord.protocol,
    workset_digest: acceptedRecord.workset_digest,
    stage: acceptedRecord.stage,
    execution_request_digest: acceptedRecord.execution_request_digest,
    result_digest: acceptedRecord.result_digest,
    receipt_digest: acceptedRecord.receipt_digest,
    run_envelope_digest: acceptedRecord.run_envelope_digest,
    artifact_dependency_set_digest: acceptedRecord.artifact_dependency_set_digest,
  });
  if (
    acceptedRecord.workset_digest !== input.spec.request.workset.workset_digest ||
    acceptedRecord.execution_request_digest !== input.spec.request.execution_request_digest ||
    acceptedRecord.stage !== input.spec.request.workset.stage ||
    acceptedRecord.acceptance_digest !== expectedAcceptanceDigest
  ) {
    throw new TypeError("main accepted cache record does not match its run identity");
  }
  return { ...payload, cache_digest: cacheDigest };
}

export function validateAcceptedCache(input: {
  cache: unknown;
  spec: MainRunSpec;
}): ReturnType<typeof validateAndRecordIndexerMainRun> {
  const cached = validateAcceptedCacheEnvelope(input);
  const validated = validateAndRecordIndexerMainRun({
    request: input.spec.request,
    result: cached.result,
    workset_read_receipts: cached.workset_read_receipts,
    validation: input.spec.validation as unknown as Parameters<
      typeof validateAndRecordIndexerMainRun
    >[0]["validation"],
  });
  if (
    canonicalIndexerJson(validated.accepted_record) !==
      canonicalIndexerJson(cached.accepted_record)
  ) {
    throw new TypeError("main accepted cache record does not match its validated result");
  }
  return validated;
}

export async function currentLedger(
  projectRoot: string,
): Promise<IndexerMainRunLedger | undefined> {
  const value = await readJsonMaybe(projectRoot, INDEXER_MAIN_RUN_CURRENT_PATH);
  return value === undefined ? undefined : validateIndexerMainRunLedger(value);
}

export async function currentSpec(input: {
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

export async function persistLedger(input: {
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

export function acceptedCacheRecord(input: {
  validated: ReturnType<typeof validateAndRecordIndexerMainRun>;
  workset_read_receipts: readonly unknown[];
}): MainAcceptedCacheRecord {
  const payload = {
    protocol: "context.indexer.main-accepted-cache-record/v1" as const,
    result: input.validated.result,
    workset_read_receipts: [...input.workset_read_receipts],
    accepted_record: input.validated.accepted_record,
  };
  return { ...payload, cache_digest: indexerProtocolDigest(payload) };
}
