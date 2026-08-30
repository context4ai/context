import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  validateIndexerMaterialAnswerExecutionPlan,
  validateIndexerMaterialAnswerRunLedger,
  type IndexerMaterialAnswerExecutionPlan,
  type IndexerMaterialAnswerRunLedger,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import {
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";

export const INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "material-answer",
);
export const INDEXER_MATERIAL_ANSWER_CURRENT_PATH = join(
  INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
  "current.json",
);

export interface MaterialAnswerRunSpec {
  protocol: "context.indexer.material-answer-run-spec/v1";
  requirement_set_digest: string;
  registry_digest: string;
  plan: IndexerMaterialAnswerExecutionPlan;
  spec_digest: string;
}

export interface MaterialAnswerRuntimeState {
  protocol: "context.indexer.material-answer-runtime-state/v1";
  spec: MaterialAnswerRunSpec;
  ledger: IndexerMaterialAnswerRunLedger;
  state_digest: string;
}

export interface IndexerMaterialAnswerStoreReceipt {
  protocol: "context.indexer.material-answer-store-receipt/v1";
  operation: "prepare" | "start" | "accept" | "fail";
  state_digest: string;
  transaction: DurableMultiFileTransactionReceipt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digestName(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("material-answer runtime path requires a sha256 digest");
  }
  return digest.slice("sha256:".length);
}

function specPath(digest: string): string {
  return join(INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT, "specs", `${digestName(digest)}.json`);
}

function ledgerPath(digest: string): string {
  return join(INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT, "ledgers", `${digestName(digest)}.json`);
}

export function materialAnswerAcceptedPath(requestDigest: string): string {
  return join(
    INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
    "accepted",
    `${digestName(requestDigest)}.json`,
  );
}

export function materialAnswerResultPath(resultDigest: string): string {
  return join(
    INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
    "results",
    `${digestName(resultDigest)}.json`,
  );
}

export function materialAnswerReceiptPath(receiptDigest: string): string {
  return join(
    INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
    "receipts",
    `${digestName(receiptDigest)}.json`,
  );
}

function jsonContent(value: unknown): string {
  const canonical = canonicalIndexerJson(value);
  if (typeof canonical !== "string") {
    throw new TypeError("material-answer runtime record is not JSON serializable");
  }
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

export async function readMaterialAnswerJsonMaybe(
  projectRoot: string,
  path: string,
): Promise<unknown | undefined> {
  const raw = await readMaybe(projectRoot, path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(`material-answer runtime record is invalid JSON: ${path}`);
  }
}

export function normalizeMaterialAnswerRunSpec(input: {
  requirement_set_digest: string;
  registry_digest: string;
  plan: unknown;
}): MaterialAnswerRunSpec {
  const payload = {
    protocol: "context.indexer.material-answer-run-spec/v1" as const,
    requirement_set_digest: input.requirement_set_digest,
    registry_digest: input.registry_digest,
    plan: validateIndexerMaterialAnswerExecutionPlan(input.plan),
  };
  return { ...payload, spec_digest: indexerProtocolDigest(payload) };
}

export function buildMaterialAnswerRuntimeState(input: {
  spec: MaterialAnswerRunSpec;
  ledger: unknown;
}): MaterialAnswerRuntimeState {
  const ledger = validateIndexerMaterialAnswerRunLedger(input.ledger);
  if (ledger.plan_digest !== input.spec.plan.plan_digest) {
    throw new TypeError("material-answer runtime ledger targets a different plan");
  }
  const payload = {
    protocol: "context.indexer.material-answer-runtime-state/v1" as const,
    spec: input.spec,
    ledger,
  };
  return { ...payload, state_digest: indexerProtocolDigest(payload) };
}

function validateState(value: unknown): MaterialAnswerRuntimeState {
  if (!isRecord(value) || value.protocol !== "context.indexer.material-answer-runtime-state/v1") {
    throw new TypeError("material-answer runtime state has an invalid protocol");
  }
  if (!isRecord(value.spec)) {
    throw new TypeError("material-answer runtime state is missing its spec");
  }
  const spec = normalizeMaterialAnswerRunSpec({
    requirement_set_digest: String(value.spec.requirement_set_digest ?? ""),
    registry_digest: String(value.spec.registry_digest ?? ""),
    plan: value.spec.plan,
  });
  if (value.spec.spec_digest !== spec.spec_digest) {
    throw new TypeError("material-answer runtime spec digest is invalid");
  }
  const state = buildMaterialAnswerRuntimeState({ spec, ledger: value.ledger });
  if (value.state_digest !== state.state_digest) {
    throw new TypeError("material-answer runtime state digest is invalid");
  }
  return state;
}

export async function readMaterialAnswerCurrentState(
  projectRoot: string,
): Promise<MaterialAnswerRuntimeState | undefined> {
  const value = await readMaterialAnswerJsonMaybe(
    projectRoot,
    INDEXER_MATERIAL_ANSWER_CURRENT_PATH,
  );
  return value === undefined ? undefined : validateState(value);
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
    throw new TypeError(`content-addressed material-answer record is immutable: ${input.path}`);
  }
  return {
    path: input.path,
    operation: "write",
    base_digest: existing === undefined ? null : durableContentDigest(existing),
    target_digest: durableContentDigest(content),
    content,
  };
}

export async function persistMaterialAnswerState(input: {
  projectRoot: string;
  operation: IndexerMaterialAnswerStoreReceipt["operation"];
  transaction_kind: string;
  state: MaterialAnswerRuntimeState;
  immutable_records?: readonly { path: string; value: unknown }[];
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerMaterialAnswerStoreReceipt> {
  const candidates = await Promise.all([
    ...(input.immutable_records ?? []).map((record) => writeTarget({
      projectRoot: input.projectRoot,
      path: record.path,
      value: record.value,
      immutable: true,
    })),
    writeTarget({
      projectRoot: input.projectRoot,
      path: specPath(input.state.spec.spec_digest),
      value: input.state.spec,
      immutable: true,
    }),
    writeTarget({
      projectRoot: input.projectRoot,
      path: ledgerPath(input.state.ledger.revision),
      value: input.state.ledger,
      immutable: true,
    }),
    writeTarget({
      projectRoot: input.projectRoot,
      path: INDEXER_MATERIAL_ANSWER_CURRENT_PATH,
      value: input.state,
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
          protocol: "context.indexer.material-answer-store-proposal/v1",
          operation: input.operation,
          state_digest: input.state.state_digest,
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
    protocol: "context.indexer.material-answer-store-receipt/v1",
    operation: input.operation,
    state_digest: input.state.state_digest,
    transaction,
  };
}
