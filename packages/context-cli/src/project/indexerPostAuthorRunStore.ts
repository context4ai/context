import {
  acceptIndexerPostAuthorRun,
  buildIndexerPostAuthorFragmentRequest,
  failIndexerPostAuthorRun,
  retryFailedIndexerPostAuthorRuns,
  indexerProtocolDigest,
  observeIndexerPostAuthorState,
  recoverIndexerPostAuthorRunLedger,
  startIndexerPostAuthorRun,
  validateIndexerEffectiveComposerSet,
  validateIndexerPostAuthorRunLedger,
  type IndexerEffectiveComposerSet,
  type IndexerPostAuthorPlan,
} from "@c4a/context";
import {
  recoverDurableMultiFileTransactions,
  type DurableMultiFileFailureInjector,
} from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  buildPostAuthorRuntimeState,
  normalizePostAuthorRunSpec,
  persistPostAuthorState,
  persistPostAuthorStates,
  postAuthorAcceptedPath,
  postAuthorReceiptPath,
  postAuthorResultPath,
  readPostAuthorCurrentEnvelope,
  readPostAuthorCurrentState,
  readPostAuthorJsonMaybe,
  type PostAuthorEnvelopeRecord,
  type PostAuthorRuntimeState,
} from "./indexerPostAuthorStorePersistence.js";
export {
  INDEXER_POST_AUTHOR_RUN_STORE_ROOT,
  postAuthorCurrentEnvelopePath,
  postAuthorCurrentStatePath,
} from "./indexerPostAuthorStorePersistence.js";

const PREPARE_TRANSACTION = "prepare-post-author-run-ledger";
const START_TRANSACTION = "start-post-author-run";
const ACCEPT_TRANSACTION = "accept-post-author-run";
const FAIL_TRANSACTION = "fail-post-author-run";
const COMPOSE_TRANSACTION = "compose-post-author-envelope";

interface PostAuthorAcceptedCacheRecord {
  protocol: "context.indexer.post-author-accepted-cache-record/v1";
  composer_ref: string;
  workset_digest: string;
  request_digest: string;
  result: unknown;
  receipt: unknown;
  fragments: unknown[];
  cache_digest: string;
}

function authorWorksetDigest(plan: IndexerPostAuthorPlan): string {
  return plan.workset_set.author_workset_digest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExpected(input: {
  state: PostAuthorRuntimeState;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
}): void {
  const ledger = validateIndexerPostAuthorRunLedger(input.ledger);
  if (
    indexerProtocolDigest(input.plan) !== indexerProtocolDigest(input.state.spec.plan) ||
    ledger.ledger_digest !== input.state.ledger.ledger_digest
  ) {
    throw new TypeError("post-author persisted state CAS mismatch");
  }
}

function assertObservationSpec(input: {
  state: PostAuthorRuntimeState;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
}): void {
  const effectiveSet = validateIndexerEffectiveComposerSet(input.effective_composer_set);
  if (
    effectiveSet.effective_composer_set_digest !==
      input.state.spec.effective_composer_set.effective_composer_set_digest ||
    input.validator_contract_digest !== input.state.spec.validator_contract_digest ||
    input.accepted_input_view_digest !== input.state.spec.accepted_input_view_digest
  ) {
    throw new TypeError("post-author observation targets stale persisted inputs");
  }
}

function observation(state: PostAuthorRuntimeState, envelope?: PostAuthorEnvelopeRecord) {
  const currentEnvelope = envelope !== undefined &&
      envelope.workset_set_digest === state.spec.plan.workset_set.workset_set_digest &&
      envelope.ledger_digest === state.ledger.ledger_digest
    ? envelope.envelope
    : undefined;
  return observeIndexerPostAuthorState({
    plan: state.spec.plan,
    ledger: state.ledger,
    effective_composer_set: state.spec.effective_composer_set,
    validator_contract_digest: state.spec.validator_contract_digest,
    accepted_input_view_digest: state.spec.accepted_input_view_digest,
    ...(currentEnvelope === undefined ? {} : { current_envelope: currentEnvelope }),
  });
}

function validateAcceptedCache(input: {
  cache: unknown;
  composer_ref: string;
}): PostAuthorAcceptedCacheRecord {
  if (!isRecord(input.cache) || input.cache.protocol !== "context.indexer.post-author-accepted-cache-record/v1") {
    throw new TypeError("post-author accepted cache record has an invalid protocol");
  }
  const payload = {
    protocol: "context.indexer.post-author-accepted-cache-record/v1" as const,
    composer_ref: String(input.cache.composer_ref ?? ""),
    workset_digest: String(input.cache.workset_digest ?? ""),
    request_digest: String(input.cache.request_digest ?? ""),
    result: input.cache.result,
    receipt: input.cache.receipt,
    fragments: Array.isArray(input.cache.fragments) ? input.cache.fragments : [],
  };
  const cache = { ...payload, cache_digest: indexerProtocolDigest(payload) };
  if (cache.cache_digest !== input.cache.cache_digest || cache.composer_ref !== input.composer_ref) {
    throw new TypeError("post-author accepted cache record failed integrity validation");
  }
  return cache;
}

async function applyAcceptedCaches(input: {
  projectRoot: string;
  state: PostAuthorRuntimeState;
}): Promise<PostAuthorRuntimeState> {
  if (input.state.spec.plan.state === "not-required") return input.state;
  let ledger = input.state.ledger;
  for (const workset of input.state.spec.plan.worksets) {
    const request = buildIndexerPostAuthorFragmentRequest({
      workset,
      primary_result_view: input.state.spec.plan.primary_result_view,
    });
    const raw = await readPostAuthorJsonMaybe(
      input.projectRoot,
      postAuthorAcceptedPath(request.request_digest),
    );
    if (raw === undefined) continue;
    const cache = validateAcceptedCache({
      cache: raw,
      composer_ref: workset.composer_ref,
    });
    if (cache.workset_digest !== workset.workset_digest) {
      throw new TypeError("post-author accepted cache workset is stale");
    }
    const existing = ledger.entries.find((entry) => entry.composer_ref === workset.composer_ref);
    if (existing?.state === "accepted") {
      if (
        indexerProtocolDigest(existing.receipt) !== indexerProtocolDigest(cache.receipt) ||
        indexerProtocolDigest(existing.fragments) !== indexerProtocolDigest(cache.fragments) ||
        indexerProtocolDigest(existing.result) !== indexerProtocolDigest(cache.result)
      ) {
        throw new TypeError("post-author accepted ledger/cache records disagree");
      }
      continue;
    }
    if (existing?.state !== "pending" && existing?.state !== "stale") continue;
    const started = startIndexerPostAuthorRun({
      plan: input.state.spec.plan,
      ledger,
      composer_ref: workset.composer_ref,
    });
    if (started.request.request_digest !== cache.request_digest) {
      throw new TypeError("post-author accepted cache request is stale");
    }
    ledger = acceptIndexerPostAuthorRun({
      plan: input.state.spec.plan,
      ledger: started.ledger,
      composer_ref: workset.composer_ref,
      result: cache.result,
      validator_contract_digest: input.state.spec.validator_contract_digest,
    });
    const restored = ledger.entries.find((entry) => entry.composer_ref === workset.composer_ref);
    if (
      restored?.state !== "accepted" ||
      indexerProtocolDigest(restored.receipt) !== indexerProtocolDigest(cache.receipt) ||
      indexerProtocolDigest(restored.fragments) !== indexerProtocolDigest(cache.fragments)
    ) {
      throw new TypeError("post-author accepted cache could not be revalidated");
    }
  }
  return buildPostAuthorRuntimeState({ spec: input.state.spec, ledger });
}

export async function prepareIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  requirement_set_digest: string;
  plan: IndexerPostAuthorPlan;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, PREPARE_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const spec = normalizePostAuthorRunSpec(input);
    const digest = authorWorksetDigest(spec.plan);
    const previous = await readPostAuthorCurrentState(input.projectRoot, digest);
    const ledger = recoverIndexerPostAuthorRunLedger({
      plan: spec.plan,
      ...(previous === undefined ? {} : { previous_ledger: previous.ledger }),
      validator_contract_digest: spec.validator_contract_digest,
    });
    const state = await applyAcceptedCaches({
      projectRoot: input.projectRoot,
      state: buildPostAuthorRuntimeState({ spec, ledger }),
    });
    const envelope = spec.plan.state === "not-required"
      ? undefined
      : await readPostAuthorCurrentEnvelope(input.projectRoot, digest);
    const observed = observation(state, envelope);
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "prepare",
      transaction_kind: PREPARE_TRANSACTION,
      state,
      clear_envelope: spec.plan.state === "not-required",
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ...observed, receipt };
  });
}

export async function startIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, START_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readPostAuthorCurrentState(
      input.projectRoot,
      authorWorksetDigest(input.plan),
    );
    if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
    assertExpected({ state: current, plan: input.plan, ledger: input.ledger });
    const started = startIndexerPostAuthorRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      composer_ref: input.composer_ref,
    });
    const state = buildPostAuthorRuntimeState({ spec: current.spec, ledger: started.ledger });
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "start",
      transaction_kind: START_TRANSACTION,
      state,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ...started, receipt };
  });
}

export async function startIndexerPostAuthorRunsStore(input: {
  projectRoot: string;
  runs: readonly {
    plan: IndexerPostAuthorPlan;
    ledger: unknown;
    composer_ref: string;
  }[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  if (input.runs.length === 0) {
    throw new TypeError("post-author batch start requires at least one run");
  }
  const authorDigests = input.runs.map((run) => authorWorksetDigest(run.plan));
  if (new Set(authorDigests).size !== authorDigests.length) {
    throw new TypeError("post-author batch start contains duplicate Author worksets");
  }
  return withProjectWriteLock(input.projectRoot, START_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const tasks = [];
    const states = [];
    for (const run of input.runs) {
      const current = await readPostAuthorCurrentState(
        input.projectRoot,
        authorWorksetDigest(run.plan),
      );
      if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
      assertExpected({ state: current, plan: run.plan, ledger: run.ledger });
      const started = startIndexerPostAuthorRun({
        plan: current.spec.plan,
        ledger: current.ledger,
        composer_ref: run.composer_ref,
      });
      const state = buildPostAuthorRuntimeState({
        spec: current.spec,
        ledger: started.ledger,
      });
      states.push({ state });
      tasks.push({
        author_workset_digest: authorWorksetDigest(run.plan),
        ...started,
      });
    }
    const transaction = await persistPostAuthorStates({
      projectRoot: input.projectRoot,
      operation: "start",
      transaction_kind: START_TRANSACTION,
      states,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { tasks, transaction };
  });
}

export async function acceptIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
  result: unknown;
  validator_contract_digest: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readPostAuthorCurrentState(
      input.projectRoot,
      authorWorksetDigest(input.plan),
    );
    if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
    assertExpected({ state: current, plan: input.plan, ledger: input.ledger });
    if (input.validator_contract_digest !== current.spec.validator_contract_digest) {
      throw new TypeError("post-author validator contract is stale");
    }
    const ledger = acceptIndexerPostAuthorRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      composer_ref: input.composer_ref,
      result: input.result,
      validator_contract_digest: current.spec.validator_contract_digest,
    });
    const accepted = ledger.entries.find((entry) => entry.composer_ref === input.composer_ref);
    if (accepted?.state !== "accepted") throw new TypeError("post-author result was not accepted");
    const cachePayload = {
      protocol: "context.indexer.post-author-accepted-cache-record/v1" as const,
      composer_ref: accepted.composer_ref,
      workset_digest: accepted.workset_digest,
      request_digest: accepted.request_digest,
      result: accepted.result,
      receipt: accepted.receipt,
      fragments: accepted.fragments,
    };
    const cache = { ...cachePayload, cache_digest: indexerProtocolDigest(cachePayload) };
    const state = buildPostAuthorRuntimeState({ spec: current.spec, ledger });
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "accept",
      transaction_kind: ACCEPT_TRANSACTION,
      state,
      immutable_records: [{
        path: postAuthorAcceptedPath(accepted.request_digest),
        value: cache,
      }, {
        path: postAuthorResultPath(accepted.result.result_digest),
        value: accepted.result,
      }, {
        path: postAuthorReceiptPath(indexerProtocolDigest(accepted.receipt)),
        value: accepted.receipt,
      }],
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ledger, receipt };
  });
}

type PostAuthorBatchCompletion = {
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
} & ({
  outcome: "accept";
  result: unknown;
  validator_contract_digest: string;
} | {
  outcome: "fail";
  reason_code: string;
  dependency_digests: readonly string[];
});

export async function completeIndexerPostAuthorRunsStore(input: {
  projectRoot: string;
  runs: readonly PostAuthorBatchCompletion[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  if (input.runs.length === 0) {
    throw new TypeError("post-author batch completion requires at least one run");
  }
  const authorDigests = input.runs.map((run) => authorWorksetDigest(run.plan));
  if (new Set(authorDigests).size !== authorDigests.length) {
    throw new TypeError("post-author batch completion contains duplicate Author worksets");
  }
  return withProjectWriteLock(input.projectRoot, ACCEPT_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const states: Array<{
      state: PostAuthorRuntimeState;
      immutable_records?: readonly { path: string; value: unknown }[];
    }> = [];
    const outcomes: Array<{
      author_workset_digest: string;
      composer_ref: string;
      outcome: "accepted" | "failed";
      committed: boolean;
      ledger?: unknown;
      message?: string;
    }> = [];
    for (const run of input.runs) {
      const authorDigest = authorWorksetDigest(run.plan);
      try {
        const current = await readPostAuthorCurrentState(input.projectRoot, authorDigest);
        if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
        assertExpected({ state: current, plan: run.plan, ledger: run.ledger });
        if (run.outcome === "fail") {
          const ledger = failIndexerPostAuthorRun({
            plan: current.spec.plan,
            ledger: current.ledger,
            composer_ref: run.composer_ref,
            reason_code: run.reason_code,
            dependency_digests: run.dependency_digests,
          });
          states.push({
            state: buildPostAuthorRuntimeState({ spec: current.spec, ledger }),
          });
          outcomes.push({
            author_workset_digest: authorDigest,
            composer_ref: run.composer_ref,
            outcome: "failed",
            committed: true,
            ledger,
          });
          continue;
        }
        if (run.validator_contract_digest !== current.spec.validator_contract_digest) {
          throw new TypeError("post-author validator contract is stale");
        }
        const ledger = acceptIndexerPostAuthorRun({
          plan: current.spec.plan,
          ledger: current.ledger,
          composer_ref: run.composer_ref,
          result: run.result,
          validator_contract_digest: current.spec.validator_contract_digest,
        });
        const accepted = ledger.entries.find((entry) =>
          entry.composer_ref === run.composer_ref
        );
        if (accepted?.state !== "accepted") {
          throw new TypeError("post-author result was not accepted");
        }
        const cachePayload = {
          protocol: "context.indexer.post-author-accepted-cache-record/v1" as const,
          composer_ref: accepted.composer_ref,
          workset_digest: accepted.workset_digest,
          request_digest: accepted.request_digest,
          result: accepted.result,
          receipt: accepted.receipt,
          fragments: accepted.fragments,
        };
        const cache = { ...cachePayload, cache_digest: indexerProtocolDigest(cachePayload) };
        states.push({
          state: buildPostAuthorRuntimeState({ spec: current.spec, ledger }),
          immutable_records: [{
            path: postAuthorAcceptedPath(accepted.request_digest),
            value: cache,
          }, {
            path: postAuthorResultPath(accepted.result.result_digest),
            value: accepted.result,
          }, {
            path: postAuthorReceiptPath(indexerProtocolDigest(accepted.receipt)),
            value: accepted.receipt,
          }],
        });
        outcomes.push({
          author_workset_digest: authorDigest,
          composer_ref: run.composer_ref,
          outcome: "accepted",
          committed: true,
          ledger,
        });
      } catch (error) {
        outcomes.push({
          author_workset_digest: authorDigest,
          composer_ref: run.composer_ref,
          outcome: "failed",
          committed: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const transaction = await persistPostAuthorStates({
      projectRoot: input.projectRoot,
      operation: "accept",
      transaction_kind: ACCEPT_TRANSACTION,
      states,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { outcomes, transaction };
  });
}

export async function failIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  composer_ref: string;
  reason_code: string;
  dependency_digests: readonly string[];
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, FAIL_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readPostAuthorCurrentState(
      input.projectRoot,
      authorWorksetDigest(input.plan),
    );
    if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
    assertExpected({ state: current, plan: input.plan, ledger: input.ledger });
    const ledger = failIndexerPostAuthorRun({
      plan: current.spec.plan,
      ledger: current.ledger,
      composer_ref: input.composer_ref,
      reason_code: input.reason_code,
      dependency_digests: input.dependency_digests,
    });
    const state = buildPostAuthorRuntimeState({ spec: current.spec, ledger });
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "fail",
      transaction_kind: FAIL_TRANSACTION,
      state,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    return { ledger, receipt };
  });
}

export async function retryFailedIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
}) {
  return withProjectWriteLock(input.projectRoot, "retry-post-author-run", async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const current = await readPostAuthorCurrentState(
      input.projectRoot,
      authorWorksetDigest(input.plan),
    );
    if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
    const ledger = retryFailedIndexerPostAuthorRuns({
      plan: current.spec.plan,
      ledger: current.ledger,
    });
    const state = buildPostAuthorRuntimeState({ spec: current.spec, ledger });
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "retry",
      transaction_kind: "retry-post-author-run",
      state,
    });
    return { ledger, receipt };
  });
}

export async function observeIndexerPostAuthorRunStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
}) {
  return withProjectWriteLock(
    input.projectRoot,
    "observe-post-author-run-ledger",
    async () => {
      await recoverDurableMultiFileTransactions(input.projectRoot);
      const digest = authorWorksetDigest(input.plan);
      const current = await readPostAuthorCurrentState(input.projectRoot, digest);
      if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
      assertExpected({ state: current, plan: input.plan, ledger: input.ledger });
      assertObservationSpec({ state: current, ...input });
      return observation(
        current,
        await readPostAuthorCurrentEnvelope(input.projectRoot, digest),
      );
    },
  );
}

export async function composeIndexerPostAuthorEnvelopeStore(input: {
  projectRoot: string;
  plan: IndexerPostAuthorPlan;
  ledger: unknown;
  effective_composer_set: IndexerEffectiveComposerSet;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  return withProjectWriteLock(input.projectRoot, COMPOSE_TRANSACTION, async () => {
    await recoverDurableMultiFileTransactions(input.projectRoot);
    const digest = authorWorksetDigest(input.plan);
    const current = await readPostAuthorCurrentState(input.projectRoot, digest);
    if (current === undefined) throw new TypeError("post-author run ledger is not prepared");
    assertExpected({ state: current, plan: input.plan, ledger: input.ledger });
    assertObservationSpec({ state: current, ...input });
    const observed = observation(
      current,
      await readPostAuthorCurrentEnvelope(input.projectRoot, digest),
    );
    if (observed.expected_envelope === null) {
      throw new TypeError("post-author envelope requires every current composer run to be accepted");
    }
    const envelopePayload = {
      protocol: "context.indexer.post-author-envelope-record/v1" as const,
      workset_set_digest: current.spec.plan.workset_set.workset_set_digest,
      ledger_digest: current.ledger.ledger_digest,
      envelope: observed.expected_envelope,
    };
    const envelopeRecord: PostAuthorEnvelopeRecord = {
      ...envelopePayload,
      record_digest: indexerProtocolDigest(envelopePayload),
    };
    const receipt = await persistPostAuthorState({
      projectRoot: input.projectRoot,
      operation: "compose",
      transaction_kind: COMPOSE_TRANSACTION,
      state: current,
      envelope_record: envelopeRecord,
      ...(input.inject_failure === undefined ? {} : { inject_failure: input.inject_failure }),
    });
    const complete = observation(current, envelopeRecord);
    if (!complete.status.can_reconcile) {
      throw new TypeError("post-author envelope did not become current");
    }
    return { envelope: observed.expected_envelope, ...complete, receipt };
  });
}

export async function readCurrentIndexerPostAuthorEnvelopeForResult(input: {
  projectRoot: string;
  author_workset_digest: string;
  primary_result_digest: string;
}) {
  return withProjectWriteLock(
    input.projectRoot,
    "read-current-post-author-result",
    async () => {
      await recoverDurableMultiFileTransactions(input.projectRoot);
      const state = await readPostAuthorCurrentState(
        input.projectRoot,
        input.author_workset_digest,
      );
      if (state === undefined) {
        throw new TypeError("post-author state is missing for an accepted author Result");
      }
      if (
        state.spec.plan.workset_set.author_workset_digest !==
          input.author_workset_digest ||
        state.spec.plan.workset_set.primary_result_digest !== input.primary_result_digest
      ) {
        throw new TypeError("post-author state is stale for the accepted author Result");
      }
      const envelopeRecord = state.spec.plan.state === "not-required"
        ? undefined
        : await readPostAuthorCurrentEnvelope(
            input.projectRoot,
            input.author_workset_digest,
          );
      const observed = observation(state, envelopeRecord);
      if (!observed.status.can_reconcile) {
        throw new TypeError("post-author state is pending, failed, stale, or incomplete");
      }
      if (state.spec.plan.state === "not-required") return null;
      if (envelopeRecord === undefined) {
        throw new TypeError("post-author current envelope is missing");
      }
      return envelopeRecord.envelope;
    },
  );
}
