import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { INDEXER_CURRENT_FINALIZATION_PATH, composerFinalizationState } from
  "./indexerComposerFinalization.js";
import { withProjectWriteLock } from "./writeLock.js";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import {
  buildIndexerPostAuthorFragmentRequest,
  canonicalIndexerJson,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  indexerRegistryDigests,
  materializeIndexerPrimaryResultViewFromArtifactResult,
  planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers,
  type IndexerComposerDeclaration,
  type IndexerPostAuthorFragmentRequest,
  type IndexerPostAuthorPlan,
  type IndexerPostAuthorRunLedger,
} from "@c4a/context";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import {
  composeIndexerPostAuthorEnvelopeStore,
  prepareIndexerPostAuthorRunsStore,
  retryFailedIndexerPostAuthorRunStore,
  startIndexerPostAuthorRunsStore,
} from "./indexerPostAuthorRunStore.js";
import { normalizePostAuthorRunSpec, readPostAuthorCurrentState } from "./indexerPostAuthorStorePersistence.js";
import { createPostAuthorContinuationResolver } from "./indexerPostAuthorContinuation.js";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import {
  buildCurrentIndexerInstructionMaterializationRequest,
  materializeCurrentIndexerInstructions,
} from "./indexerCurrentInstructionMaterialization.js";
import type { IndexerInstructionMaterializationRequest } from
  "./indexerInstructionMaterialization.js";
import {
  INDEXER_BATCH_POLICY_VERSION,
  indexerBatchPolicyDigest,
  indexerBatchStagePolicy,
} from "./indexerCurrentBatchPlanner.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { renderIndexerPostAuthorReading } from "./indexerPostAuthorReading.js";
import { missingComposerInputs, settleInapplicableComposer } from "./indexerComposerApplicability.js";
import { observeIndexerPostAuthorRunStore } from "./indexerPostAuthorRunStore.js";

type AcceptedAuthorRecord = Awaited<ReturnType<
  typeof readAcceptedIndexerMainAuthorResultRecords
>>[number];

export interface CurrentIndexerComposerContext {
  request: IndexerPostAuthorFragmentRequest;
  record: AcceptedAuthorRecord;
  authority: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>;
  composer: IndexerComposerDeclaration;
  plan: IndexerPostAuthorPlan;
  ledger: IndexerPostAuthorRunLedger;
  validator_contract_digest: string;
  accepted_input_view_digest: string;
  requirement_set_digest: string;
}

export interface CurrentIndexerComposerBatchTask {
  task_key: string;
  context: CurrentIndexerComposerContext;
  view_path: string;
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
}

export interface CurrentIndexerComposerBatchContext {
  stage: "post-author";
  policy_version: typeof INDEXER_BATCH_POLICY_VERSION;
  policy_digest: string;
  instruction_request: IndexerInstructionMaterializationRequest;
  instruction_path: string;
  instruction_payload_digest: string;
  tasks: readonly CurrentIndexerComposerBatchTask[];
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
  batch_digest: string;
  packing_limits?: string[];
  shared_instruction_bytes?: number;
}

async function describeRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
  authorities: Map<string, Promise<CurrentIndexerComposerContext["authority"]>>;
  continuation: ReturnType<typeof createPostAuthorContinuationResolver>;
}) {
  const result = indexerArtifactResultSchema.parse(input.record.artifact_result);
  const indexer = input.registry.indexers.find((item) => item.id === result.indexer_id);
  if (indexer === undefined) throw new TypeError(`unknown accepted Indexer ${result.indexer_id}`);
  let pendingAuthority = input.authorities.get(indexer.id);
  if (pendingAuthority === undefined) {
    pendingAuthority = resolveCurrentProjectIndexerPrimaryAuthority({
      projectRoot: input.projectRoot, registry: input.registry, indexer_id: indexer.id,
    });
    input.authorities.set(indexer.id, pendingAuthority);
  }
  const authority = await pendingAuthority;
  const selected = indexer.profile.composers ?? [];
  const effective = resolveEffectiveIndexerComposers({
    selections: selected.map((composer) => ({
      id: composer.id,
      provider: composer.provider,
      composer_selection_entry_digest: indexerProtocolDigest({
        indexer_id: indexer.id,
        composer,
      }),
    })),
    manifest_layers: authority.layers.map((layer) => ({
      provider: layer.layer.id,
      layer_ref: `provider:${layer.layer.id}#layer:${layer.layer.role}`,
      layer_integrity: layer.layer.integrity,
      bundle_digest: layer.layer.integrity,
      composers: layer.manifest.provides.composers ?? [],
    })),
    current_profiles: [
      indexer.profile.primary.id,
      ...(indexer.profile.additional ?? []).map((profile) => profile.id),
    ],
  });
  const accepted = acceptedIdentity(input.record);
  const validatorContractDigest = authority.profile_contract.contract_digest;
  // The SDK's empty-selection plan has no PrimaryResultView. Avoid building
  // and validating that unused deep projection for every accepted article.
  // The accepted ArtifactResult is still validated by the store above.
  const primaryView = effective.entries.length === 0 ? undefined : materializeIndexerPrimaryResultViewFromArtifactResult({
    artifact_result: result,
    primary_result_digest: accepted.result_digest,
    validator_contract_digest: validatorContractDigest,
  });
  const plan = planIndexerPostAuthorComposition({
    effective_composer_set: effective,
    author_workset_digest: accepted.workset_digest,
    primary_result_digest: accepted.result_digest,
    primary_facts: primaryView?.facts ?? [],
    primary_artifacts: primaryView?.artifacts ?? [],
    validator_contract_digest: validatorContractDigest,
    current_profile_binding_digest: indexerProtocolDigest(indexer.profile),
    allowed_target_refs: [result.logical_unit.logical_unit_ref],
  });
  const requested = normalizePostAuthorRunSpec({
    requirement_set_digest: indexerRegistryDigests(input.registry).requirementSetDigest,
    plan, effective_composer_set: effective,
    validator_contract_digest: validatorContractDigest,
    accepted_input_view_digest: input.record.run_result.consumed_input_view_digest,
  });
  const instructionLayers = new Set(authority.layers.filter((layer) =>
    layer.layer.distribution.kind === "cli-bundled" &&
    layer.manifest.provider.program === undefined &&
    Object.keys(layer.layer.config ?? {}).length === 0 &&
    (indexer.customization?.mode ?? "none") === "none"
  ).map((layer) => `provider:${layer.layer.id}#layer:${layer.layer.role}`));
  const continued = await input.continuation(requested, instructionLayers);
  return {
    result,
    authority,
    effective: continued.effective_composer_set,
    plan: continued.plan,
    validatorContractDigest,
    acceptedInputViewDigest: input.record.run_result.consumed_input_view_digest,
    requirementSetDigest: indexerRegistryDigests(input.registry).requirementSetDigest,
  };
}

function acceptedIdentity(record: AcceptedAuthorRecord): {
  workset_digest: string;
  result_digest: string;
} {
  const value = record.accepted_record;
  return {
    workset_digest: value.workset_digest,
    result_digest: value.result_digest,
  };
}

async function prepareRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  described: Awaited<ReturnType<typeof describeRecord>>;
  observed: Awaited<ReturnType<typeof observeIndexerPostAuthorRunStore>>;
}): Promise<CurrentIndexerComposerContext | undefined> {
  const {
    authority,
    effective,
    plan,
    validatorContractDigest,
    acceptedInputViewDigest,
    requirementSetDigest,
  } = input.described;
  const observed = input.observed;
  if (plan.state === "not-required") return undefined;
  if (observed.status.post_author_envelope.state === "current") return undefined;
  if (observed.expected_envelope !== null) {
    await composeIndexerPostAuthorEnvelopeStore({
      projectRoot: input.projectRoot,
      plan,
      ledger: observed.ledger,
      effective_composer_set: effective,
      validator_contract_digest: validatorContractDigest,
      accepted_input_view_digest: acceptedInputViewDigest,
    });
    return undefined;
  }
  if (observed.ledger.entries.some((entry) => entry.state === "failed")) {
    const retried = await retryFailedIndexerPostAuthorRunStore({
      projectRoot: input.projectRoot,
      plan,
    });
    observed.ledger = retried.ledger;
  }
  const running = observed.ledger.entries.find((entry) => entry.state === "running");
  const next = running ?? observed.ledger.entries.find((entry) =>
    entry.state === "pending" || entry.state === "stale"
  );
  if (next === undefined) {
    throw new TypeError("post-author composer state cannot advance");
  }
  const workset = plan.worksets.find((candidate) =>
    candidate.composer_ref === next.composer_ref
  );
  if (workset === undefined) throw new TypeError("current Composer workset is stale");
  const request = buildIndexerPostAuthorFragmentRequest({
    workset,
    primary_result_view: plan.primary_result_view,
  });
  const composerId = request.composer_ref.slice(
    request.composer_ref.lastIndexOf("#composer:") + "#composer:".length,
  );
  const effectiveComposer = effective.entries.find((item) =>
    item.composer_ref === request.composer_ref
  );
  const composerLayer = authority.layers.find((item) =>
    item.layer.id === effectiveComposer?.provider
  );
  const composer = (composerLayer?.manifest.provides.composers ?? []).find((item) =>
    item.id === composerId
  );
  if (composer === undefined) throw new TypeError(`current Composer ${composerId} is unavailable`);
  const context: CurrentIndexerComposerContext = {
    request,
    record: input.record,
    authority,
    composer,
    plan,
    ledger: observed.ledger,
    validator_contract_digest: validatorContractDigest,
    accepted_input_view_digest: acceptedInputViewDigest,
    requirement_set_digest: requirementSetDigest,
  };
  if (missingComposerInputs(composer, request.primary_result_view).length > 0) {
    const accepted = await settleInapplicableComposer(input.projectRoot, context);
    const refreshed = await observeIndexerPostAuthorRunStore({ projectRoot: input.projectRoot,
      plan, ledger: accepted.ledger, effective_composer_set: effective,
      validator_contract_digest: validatorContractDigest, accepted_input_view_digest: acceptedInputViewDigest });
    return prepareRecord({ ...input, observed: refreshed });
  }
  return context;
}

async function readRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
  authorities: Map<string, Promise<CurrentIndexerComposerContext["authority"]>>;
  continuation: ReturnType<typeof createPostAuthorContinuationResolver>;
}): Promise<CurrentIndexerComposerContext | undefined> {
  const described = await describeRecord(input);
  if (described.plan.state === "not-required") return undefined;
  const state = await readPostAuthorCurrentState(
    input.projectRoot,
    described.plan.workset_set.author_workset_digest,
  );
  const running = state?.ledger.entries.find((entry) => entry.state === "running");
  if (state === undefined || running === undefined) return undefined;
  // Observation must not publish a request under a different ledger authority.
  // The deterministic lifecycle first restores compatible accepted receipts.
  if (indexerProtocolDigest(state.spec.plan) !== indexerProtocolDigest(described.plan)) return undefined;
  const workset = described.plan.worksets.find((item) =>
    item.composer_ref === running.composer_ref
  );
  if (workset === undefined) throw new TypeError("current Composer workset is stale");
  const request = buildIndexerPostAuthorFragmentRequest({
    workset,
    primary_result_view: described.plan.primary_result_view,
  });
  const composerId = request.composer_ref.slice(
    request.composer_ref.lastIndexOf("#composer:") + "#composer:".length,
  );
  const effectiveComposer = described.effective.entries.find((item) =>
    item.composer_ref === request.composer_ref
  );
  const composerLayer = described.authority.layers.find((item) =>
    item.layer.id === effectiveComposer?.provider
  );
  const composer = (composerLayer?.manifest.provides.composers ?? []).find((item) =>
    item.id === composerId
  );
  if (composer === undefined) throw new TypeError(`current Composer ${composerId} is unavailable`);
  return {
    request,
    record: input.record,
    authority: described.authority,
    composer,
    plan: described.plan,
    ledger: state.ledger,
    validator_contract_digest: described.validatorContractDigest,
    accepted_input_view_digest: described.acceptedInputViewDigest,
    requirement_set_digest: described.requirementSetDigest,
  };
}

async function instructionContext(input: {
  projectRoot: string;
  context: CurrentIndexerComposerContext;
}) {
  const customization = await loadIndexerCustomization({
    workspaceRoot: input.projectRoot,
    projectRef: input.projectRoot,
    indexer: input.context.authority.indexer,
    manifest: input.context.authority.manifest,
    providerIntegrity: input.context.authority.provider.integrity,
  });
  const request = buildCurrentIndexerInstructionMaterializationRequest({
    authority: input.context.authority,
    customization,
    stage: "post-author",
    composerId: input.context.composer.id,
  });
  return { customization, request };
}

function composerTaskCost(context: CurrentIndexerComposerContext) {
  const view = context.request.primary_result_view;
  return {
    input_bytes: Buffer.byteLength(renderIndexerPostAuthorReading(view), "utf8"),
    output_reserve_bytes: 32 * 1024 + view.artifacts.length * 16 * 1024,
    view_item_count: view.facts.length + view.artifacts.length,
  };
}

async function materializeComposerBatch(input: {
  projectRoot: string;
  contexts: readonly CurrentIndexerComposerContext[];
  instruction: Awaited<ReturnType<typeof instructionContext>>;
  materialized_instruction?: Awaited<ReturnType<typeof materializeCurrentIndexerInstructions>>;
  packing_limits?: string[];
}): Promise<CurrentIndexerComposerBatchContext> {
  const materialized = input.materialized_instruction ?? await materializeCurrentIndexerInstructions({
    request: input.instruction.request,
    authority: input.contexts[0]!.authority,
    customization: input.instruction.customization,
    workspaceRoot: input.projectRoot,
  });
  const instructionPath = join(
    input.projectRoot,
    ".tmp",
    "context-runtime",
    "indexer",
    "instructions",
    `${materialized.payload_digest.slice("sha256:".length)}.json`,
  );
  await atomicWriteFile(instructionPath, `${canonicalIndexerJson(materialized)}\n`);
  const tasks: CurrentIndexerComposerBatchTask[] = [];
  for (const [index, context] of input.contexts.entries()) {
    const taskKey = `task-${String(index + 1).padStart(3, "0")}`;
    const viewPath = join(
      input.projectRoot,
      ".tmp",
      "context-runtime",
      "indexer",
      "views",
      `${context.request.primary_result_view.view_digest.slice("sha256:".length)}.json`,
    );
    await atomicWriteFile(
      viewPath,
      `${canonicalIndexerJson(context.request.primary_result_view)}\n`,
    );
    tasks.push({
      task_key: taskKey,
      context,
      view_path: viewPath,
      ...composerTaskCost(context),
    });
  }
  const policyDigest = indexerBatchPolicyDigest("post-author");
  const payload = {
    stage: "post-author" as const,
    policy_version: INDEXER_BATCH_POLICY_VERSION,
    policy_digest: policyDigest,
    instruction_request_digest: input.instruction.request.request_digest,
    task_requests: tasks.map((task) => ({
      task_key: task.task_key,
      request_digest: task.context.request.request_digest,
      primary_result_view_digest: task.context.request.primary_result_view.view_digest,
    })),
  };
  return {
    stage: "post-author",
    policy_version: INDEXER_BATCH_POLICY_VERSION,
    policy_digest: policyDigest,
    instruction_request: input.instruction.request,
    instruction_path: instructionPath,
    instruction_payload_digest: materialized.payload_digest,
    tasks,
    input_bytes: Buffer.byteLength(canonicalIndexerJson(materialized), "utf8") + tasks.reduce((total, task) => total + task.input_bytes, 0),
    shared_instruction_bytes: Buffer.byteLength(canonicalIndexerJson(materialized), "utf8"),
    packing_limits: input.packing_limits ?? [],
    output_reserve_bytes: tasks.reduce(
      (total, task) => total + task.output_reserve_bytes,
      0,
    ),
    view_item_count: tasks.reduce((total, task) => total + task.view_item_count, 0),
    batch_digest: indexerProtocolDigest(payload),
  };
}

async function selectComposerBatch(input: {
  projectRoot: string;
  contexts: readonly CurrentIndexerComposerContext[];
  resume?: boolean;
}) {
  const first = input.contexts[0];
  if (first === undefined) return undefined;
  const firstInstruction = await instructionContext({
    projectRoot: input.projectRoot,
    context: first,
  });
  const policy = indexerBatchStagePolicy("post-author");
  const limits = new Set<string>();
  const selected: CurrentIndexerComposerContext[] = [];
  const materialized = await materializeCurrentIndexerInstructions({
    request: firstInstruction.request, authority: first.authority,
    customization: firstInstruction.customization, workspaceRoot: input.projectRoot,
  });
  let inputBytes = Buffer.byteLength(canonicalIndexerJson(materialized), "utf8");
  let outputBytes = 0;
  let viewItems = 0;
  for (const context of input.contexts) {
    if (!input.resume && selected.length >= policy.max_tasks) { limits.add("task-limit"); break; }
    const candidateInstruction = context === first
      ? firstInstruction
      : await instructionContext({ projectRoot: input.projectRoot, context });
    if (candidateInstruction.request.request_digest !== firstInstruction.request.request_digest) {
      limits.add("instruction-boundary");
      continue;
    }
    const cost = composerTaskCost(context);
    if (inputBytes + cost.input_bytes > policy.max_input_bytes) limits.add("input-budget");
    if (outputBytes + cost.output_reserve_bytes > policy.max_output_reserve_bytes) limits.add("output-budget");
    if (viewItems + cost.view_item_count > policy.max_view_items) limits.add("view-budget");
    const fits = selected.length < policy.max_tasks &&
      inputBytes + cost.input_bytes <= policy.max_input_bytes &&
      outputBytes + cost.output_reserve_bytes <= policy.max_output_reserve_bytes &&
      viewItems + cost.view_item_count <= policy.max_view_items;
    if (!input.resume && selected.length > 0 && !fits) continue;
    selected.push(context);
    inputBytes += cost.input_bytes;
    outputBytes += cost.output_reserve_bytes;
    viewItems += cost.view_item_count;
    if (!input.resume && !fits) break;
  }
  // The first task runs alone when it exceeds packing targets. Existing running
  // tasks retain their ledger identity even if delivery costs have changed.
  if (selected.length >= policy.max_tasks) limits.add("task-limit");
  return { contexts: selected, instruction: firstInstruction, materialized_instruction: materialized, packing_limits: [...limits] };
}

async function resolveCurrentIndexerComposerBatchInternal(
  projectRoot: string,
  authorWorksets?: ReadonlySet<string>,
): Promise<CurrentIndexerComposerBatchContext | undefined> {
  const [loaded, records] = await Promise.all([
    loadIndexerRegistry(projectRoot),
    readAcceptedIndexerMainAuthorResultRecords(projectRoot),
  ]);
  const ordered = records.filter((record) => authorWorksets === undefined || authorWorksets.has(record.accepted_record.workset_digest)).sort((left, right) =>
    left.accepted_record.workset_digest.localeCompare(right.accepted_record.workset_digest)
  );
  const candidates: CurrentIndexerComposerContext[] = [];
  const authorities = new Map<string, Promise<CurrentIndexerComposerContext["authority"]>>();
  const descriptions = [];
  const continuation = createPostAuthorContinuationResolver(projectRoot);
  for (const record of ordered) descriptions.push(await describeRecord({
    projectRoot, record, registry: loaded.registry, authorities, continuation,
  }));
  const prepared = await prepareIndexerPostAuthorRunsStore({
    projectRoot,
    runs: descriptions.map((item) => ({
      requirement_set_digest: item.requirementSetDigest,
      plan: item.plan,
      effective_composer_set: item.effective,
      validator_contract_digest: item.validatorContractDigest,
      accepted_input_view_digest: item.acceptedInputViewDigest,
    })),
  });
  for (const [index, record] of ordered.entries()) {
    const current = await prepareRecord({
      projectRoot,
      record,
      described: descriptions[index]!,
      observed: prepared.observations[index]!,
    });
    if (current !== undefined) candidates.push(current);
  }
  const alreadyRunning = candidates.filter((context) =>
    context.ledger.entries.some((entry) =>
      entry.composer_ref === context.request.composer_ref && entry.state === "running"
    )
  );
  if (alreadyRunning.length > 0) {
    const selectedRunning = await selectComposerBatch({
      projectRoot,
      contexts: alreadyRunning,
      resume: true,
    });
    if (
      selectedRunning === undefined ||
      selectedRunning.contexts.length !== alreadyRunning.length
    ) {
      throw new TypeError("running Composer tasks do not form one authorized batch");
    }
    const batch = await materializeComposerBatch({
      projectRoot,
      contexts: selectedRunning.contexts,
      instruction: selectedRunning.instruction,
    });
    // Resume also repairs workspaces started before batch/state publication was paired.
    await atomicWriteFile(join(projectRoot, INDEXER_CURRENT_FINALIZATION_PATH),
      JSON.stringify(composerFinalizationState({
        batch_digest: batch.batch_digest, task_count: batch.tasks.length,
      }), null, 2) + "\n");
    return batch;
  }
  const selected = await selectComposerBatch({ projectRoot, contexts: candidates });
  if (selected === undefined) return undefined;
  // The digest uses requests and instructions, not mutable ledger states. Prepare
  // resources first so starting tasks and publishing their route share one transaction.
  const batch = { ...await materializeComposerBatch({ projectRoot, ...selected }), packing_limits: selected.packing_limits };
  const started = await startIndexerPostAuthorRunsStore({
    projectRoot,
    composer_batch: { batch_digest: batch.batch_digest, task_count: batch.tasks.length },
    runs: selected.contexts.map((context) => ({
      plan: context.plan,
      ledger: context.ledger,
      composer_ref: context.request.composer_ref,
    })),
  });
  const startedByAuthor = new Map(started.tasks.map((task) => [
    task.author_workset_digest,
    task,
  ]));
  const contexts = selected.contexts.map((context) => {
    const startedTask = startedByAuthor.get(
      context.plan.workset_set.author_workset_digest,
    );
    if (startedTask === undefined) {
      throw new TypeError("started Composer batch lost an Author workset");
    }
    return {
      ...context,
      request: startedTask.request,
      ledger: startedTask.ledger,
    };
  });
  return { ...batch, tasks: batch.tasks.map((task, index) => ({
    ...task, context: contexts[index]!,
  })) };
}

export async function resolveCurrentIndexerComposerBatch(
  projectRoot: string,
  authorWorksets?: ReadonlySet<string>,
): Promise<CurrentIndexerComposerBatchContext | undefined> {
  return withProjectWriteLock(projectRoot, "resolve-current-composer-batch", () =>
    resolveCurrentIndexerComposerBatchInternal(projectRoot, authorWorksets));
}

export async function readCurrentIndexerComposerBatch(
  projectRoot: string,
): Promise<CurrentIndexerComposerBatchContext | undefined> {
  const [loaded, records] = await Promise.all([
    loadIndexerRegistry(projectRoot),
    readAcceptedIndexerMainAuthorResultRecords(projectRoot),
  ]);
  const ordered = [...records].sort((left, right) =>
    left.accepted_record.workset_digest.localeCompare(right.accepted_record.workset_digest)
  );
  const running: CurrentIndexerComposerContext[] = [];
  const authorities = new Map<string, Promise<CurrentIndexerComposerContext["authority"]>>();
  const continuation = createPostAuthorContinuationResolver(projectRoot);
  for (const record of ordered) {
    const current = await readRecord({
      projectRoot,
      record,
      registry: loaded.registry,
      authorities,
      continuation,
    });
    if (current !== undefined) running.push(current);
  }
  const selected = await selectComposerBatch({ projectRoot, contexts: running, resume: true });
  if (selected === undefined) return undefined;
  if (selected.contexts.length !== running.length) {
    throw new TypeError("running Composer tasks do not form one authorized batch");
  }
  return materializeComposerBatch({
    projectRoot,
    contexts: selected.contexts,
    instruction: selected.instruction,
  });
}
