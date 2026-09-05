import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerComposedResultEnvelopeSchema,
  indexerProtocolDigest,
  initializeIndexerPostAuthorRunLedger,
  observeIndexerPostAuthorState,
  validateIndexerEffectiveComposerSet,
  validateIndexerPostAuthorRunLedger,
  type IndexerEffectiveComposerSet,
  type IndexerPostAuthorPlan,
  type IndexerPostAuthorRunLedger,
  type IndexerProjectFileTarget,
} from "@c4a/context";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import {
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
  type DurableMultiFileTransactionReceipt,
} from "./durableMultiFileTransaction.js";

export const INDEXER_POST_AUTHOR_RUN_STORE_ROOT = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "post-author",
);
export function postAuthorCurrentStatePath(authorWorksetDigest: string): string {
  return join(
    INDEXER_POST_AUTHOR_RUN_STORE_ROOT,
    "current",
    `${digestName(authorWorksetDigest)}.json`,
  );
}

export function postAuthorCurrentEnvelopePath(authorWorksetDigest: string): string {
  return join(
    INDEXER_POST_AUTHOR_RUN_STORE_ROOT,
    "current-envelopes",
    `${digestName(authorWorksetDigest)}.json`,
  );
}

export interface PostAuthorRunSpec {
  protocol: "context.indexer.post-author-run-spec/v1";
  requirement_set_digest: string;
  plan: IndexerPostAuthorPlan;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  spec_digest: string;
}

export interface PostAuthorRuntimeState {
  protocol: "context.indexer.post-author-runtime-state/v1";
  spec: PostAuthorRunSpec;
  ledger: IndexerPostAuthorRunLedger;
  state_digest: string;
}

export interface PostAuthorEnvelopeRecord {
  protocol: "context.indexer.post-author-envelope-record/v1";
  workset_set_digest: string;
  ledger_digest: string;
  envelope: unknown;
  record_digest: string;
}

export interface IndexerPostAuthorStoreReceipt {
  protocol: "context.indexer.post-author-store-receipt/v1";
  operation: "prepare" | "start" | "accept" | "fail" | "retry" | "compose";
  state_digest: string;
  transaction: DurableMultiFileTransactionReceipt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digestName(digest: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError("post-author runtime path requires a sha256 digest");
  }
  return digest.slice("sha256:".length);
}

function specPath(digest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "specs", `${digestName(digest)}.json`);
}

function ledgerPath(digest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "ledgers", `${digestName(digest)}.json`);
}

export function postAuthorAcceptedPath(requestDigest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "accepted", `${digestName(requestDigest)}.json`);
}

export function postAuthorResultPath(resultDigest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "results", `${digestName(resultDigest)}.json`);
}

export function postAuthorReceiptPath(receiptDigest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "receipts", `${digestName(receiptDigest)}.json`);
}

function envelopePath(envelopeDigest: string): string {
  return join(INDEXER_POST_AUTHOR_RUN_STORE_ROOT, "envelopes", `${digestName(envelopeDigest)}.json`);
}

function jsonContent(value: unknown): string {
  const canonical = canonicalIndexerJson(value);
  if (typeof canonical !== "string") throw new TypeError("post-author record is not JSON serializable");
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

export async function readPostAuthorJsonMaybe(
  projectRoot: string,
  path: string,
): Promise<unknown | undefined> {
  const raw = await readMaybe(projectRoot, path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(`post-author runtime record is invalid JSON: ${path}`);
  }
}

export function normalizePostAuthorRunSpec(input: {
  requirement_set_digest: string;
  plan: IndexerPostAuthorPlan;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
}): PostAuthorRunSpec {
  const effectiveSet = validateIndexerEffectiveComposerSet(input.effective_composer_set);
  const initialLedger = initializeIndexerPostAuthorRunLedger(input.plan);
  observeIndexerPostAuthorState({
    plan: input.plan,
    ledger: initialLedger,
    effective_composer_set: effectiveSet,
    validator_contract_digest: input.validator_contract_digest,
    accepted_input_view_digest: input.accepted_input_view_digest,
  });
  const payload = {
    protocol: "context.indexer.post-author-run-spec/v1" as const,
    requirement_set_digest: input.requirement_set_digest,
    plan: input.plan,
    effective_composer_set: effectiveSet,
    validator_contract_digest: input.validator_contract_digest,
    accepted_input_view_digest: input.accepted_input_view_digest,
  };
  return { ...payload, spec_digest: indexerProtocolDigest(payload) };
}

export function buildPostAuthorRuntimeState(input: {
  spec: PostAuthorRunSpec;
  ledger: IndexerPostAuthorRunLedger;
}): PostAuthorRuntimeState {
  const payload = {
    protocol: "context.indexer.post-author-runtime-state/v1" as const,
    spec: input.spec,
    ledger: validateIndexerPostAuthorRunLedger(input.ledger),
  };
  return { ...payload, state_digest: indexerProtocolDigest(payload) };
}

function validateState(value: unknown): PostAuthorRuntimeState {
  if (!isRecord(value) || value.protocol !== "context.indexer.post-author-runtime-state/v1") {
    throw new TypeError("post-author runtime state has an invalid protocol");
  }
  if (!isRecord(value.spec)) throw new TypeError("post-author runtime state is missing its spec");
  const spec = normalizePostAuthorRunSpec({
    requirement_set_digest: String(value.spec.requirement_set_digest ?? ""),
    plan: value.spec.plan as IndexerPostAuthorPlan,
    effective_composer_set: value.spec.effective_composer_set as IndexerEffectiveComposerSet,
    validator_contract_digest: String(value.spec.validator_contract_digest ?? ""),
    accepted_input_view_digest: String(value.spec.accepted_input_view_digest ?? ""),
  });
  if (value.spec.spec_digest !== spec.spec_digest) {
    throw new TypeError("post-author runtime spec digest is invalid");
  }
  const state = buildPostAuthorRuntimeState({
    spec,
    ledger: validateIndexerPostAuthorRunLedger(value.ledger),
  });
  if (value.state_digest !== state.state_digest) {
    throw new TypeError("post-author runtime state digest is invalid");
  }
  return state;
}

export async function readPostAuthorCurrentState(
  projectRoot: string,
  authorWorksetDigest: string,
): Promise<PostAuthorRuntimeState | undefined> {
  const value = await readPostAuthorJsonMaybe(
    projectRoot,
    postAuthorCurrentStatePath(authorWorksetDigest),
  );
  return value === undefined ? undefined : validateState(value);
}

function validateEnvelopeRecord(value: unknown): PostAuthorEnvelopeRecord {
  if (!isRecord(value) || value.protocol !== "context.indexer.post-author-envelope-record/v1") {
    throw new TypeError("post-author envelope record has an invalid protocol");
  }
  const envelope = indexerComposedResultEnvelopeSchema.parse(value.envelope);
  const payload = {
    protocol: "context.indexer.post-author-envelope-record/v1" as const,
    workset_set_digest: String(value.workset_set_digest ?? ""),
    ledger_digest: String(value.ledger_digest ?? ""),
    envelope,
  };
  const record = { ...payload, record_digest: indexerProtocolDigest(payload) };
  if (record.record_digest !== value.record_digest) {
    throw new TypeError("post-author envelope record digest is invalid");
  }
  return record;
}

export async function readPostAuthorCurrentEnvelope(
  projectRoot: string,
  authorWorksetDigest: string,
): Promise<PostAuthorEnvelopeRecord | undefined> {
  const value = await readPostAuthorJsonMaybe(
    projectRoot,
    postAuthorCurrentEnvelopePath(authorWorksetDigest),
  );
  return value === undefined ? undefined : validateEnvelopeRecord(value);
}

async function writeTarget(input: {
  projectRoot: string;
  path: string;
  value?: unknown;
  immutable?: boolean;
  remove?: boolean;
}): Promise<IndexerProjectFileTarget | undefined> {
  const existing = await readMaybe(input.projectRoot, input.path);
  if (input.remove === true) {
    if (existing === undefined) return undefined;
    return {
      path: input.path,
      operation: "delete",
      base_digest: durableContentDigest(existing),
      target_digest: null,
    };
  }
  const content = jsonContent(input.value);
  if (existing === content) return undefined;
  if (input.immutable === true && existing !== undefined) {
    throw new TypeError(`content-addressed post-author record is immutable: ${input.path}`);
  }
  return {
    path: input.path,
    operation: "write",
    base_digest: existing === undefined ? null : durableContentDigest(existing),
    target_digest: durableContentDigest(content),
    content,
  };
}

interface PostAuthorStatePersistenceInput {
  state: PostAuthorRuntimeState;
  immutable_records?: readonly { path: string; value: unknown }[];
  envelope_record?: PostAuthorEnvelopeRecord;
  clear_envelope?: boolean;
}

async function postAuthorStateTargets(input: {
  projectRoot: string;
} & PostAuthorStatePersistenceInput): Promise<IndexerProjectFileTarget[]> {
  const authorWorksetDigest = input.state.spec.plan.workset_set.author_workset_digest;
  const writes = [
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
      path: ledgerPath(input.state.ledger.ledger_digest),
      value: input.state.ledger,
      immutable: true,
    }),
    writeTarget({
      projectRoot: input.projectRoot,
      path: postAuthorCurrentStatePath(authorWorksetDigest),
      value: input.state,
    }),
  ];
  if (input.envelope_record !== undefined) {
    writes.push(writeTarget({
      projectRoot: input.projectRoot,
      path: envelopePath(
        indexerComposedResultEnvelopeSchema.parse(input.envelope_record.envelope)
          .composition_fingerprint,
      ),
      value: input.envelope_record,
      immutable: true,
    }));
    writes.push(writeTarget({
      projectRoot: input.projectRoot,
      path: postAuthorCurrentEnvelopePath(authorWorksetDigest),
      value: input.envelope_record,
    }));
  } else if (input.clear_envelope === true) {
    writes.push(writeTarget({
      projectRoot: input.projectRoot,
      path: postAuthorCurrentEnvelopePath(authorWorksetDigest),
      remove: true,
    }));
  }
  return (await Promise.all(writes)).filter(
    (target): target is IndexerProjectFileTarget => target !== undefined,
  );
}

function canonicalTargets(values: readonly IndexerProjectFileTarget[]) {
  const targets = new Map<string, IndexerProjectFileTarget>();
  for (const value of values) {
    const previous = targets.get(value.path);
    if (previous !== undefined && indexerProtocolDigest(previous) !== indexerProtocolDigest(value)) {
      throw new TypeError(`post-author batch produced conflicting target ${value.path}`);
    }
    targets.set(value.path, value);
  }
  return [...targets.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

export async function persistPostAuthorStates(input: {
  projectRoot: string;
  operation: IndexerPostAuthorStoreReceipt["operation"];
  transaction_kind: string;
  states: readonly PostAuthorStatePersistenceInput[];
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<DurableMultiFileTransactionReceipt | null> {
  if (input.states.length === 0) return null;
  const targets = canonicalTargets((await Promise.all(input.states.map((state) =>
    postAuthorStateTargets({ projectRoot: input.projectRoot, ...state })
  ))).flat());
  if (targets.length === 0) return null;
  return runDurableMultiFileTransaction({
    projectRoot: input.projectRoot,
    kind: input.transaction_kind,
    proposal_digest: indexerProtocolDigest({
      protocol: "context.indexer.post-author-store-proposal/v1",
      operation: input.operation,
      state_digests: input.states.map((state) => state.state.state_digest).sort(),
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
}

export async function persistPostAuthorState(input: {
  projectRoot: string;
  operation: IndexerPostAuthorStoreReceipt["operation"];
  transaction_kind: string;
  state: PostAuthorRuntimeState;
  immutable_records?: readonly { path: string; value: unknown }[];
  envelope_record?: PostAuthorEnvelopeRecord;
  clear_envelope?: boolean;
  inject_failure?: DurableMultiFileFailureInjector;
}): Promise<IndexerPostAuthorStoreReceipt> {
  const transaction = await persistPostAuthorStates({
    projectRoot: input.projectRoot,
    operation: input.operation,
    transaction_kind: input.transaction_kind,
    states: [{
      state: input.state,
      ...(input.immutable_records === undefined
        ? {}
        : { immutable_records: input.immutable_records }),
      ...(input.envelope_record === undefined
        ? {}
        : { envelope_record: input.envelope_record }),
      ...(input.clear_envelope === undefined
        ? {}
        : { clear_envelope: input.clear_envelope }),
    }],
    ...(input.inject_failure === undefined
      ? {}
      : { inject_failure: input.inject_failure }),
  });
  return {
    protocol: "context.indexer.post-author-store-receipt/v1",
    operation: input.operation,
    state_digest: input.state.state_digest,
    transaction,
  };
}
