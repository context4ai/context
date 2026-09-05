import { Buffer } from "node:buffer";
import { join } from "node:path";
import {
  buildIndexerPostAuthorFragmentRequest,
  canonicalIndexerJson,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  indexerRegistryDigests,
  loadIndexerRegistry,
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
  prepareIndexerPostAuthorRunStore,
  retryFailedIndexerPostAuthorRunStore,
  startIndexerPostAuthorRunsStore,
} from "./indexerPostAuthorRunStore.js";
import { readPostAuthorCurrentState } from "./indexerPostAuthorStorePersistence.js";
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
}

async function describeRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}) {
  const result = indexerArtifactResultSchema.parse(input.record.artifact_result);
  const indexer = input.registry.indexers.find((item) => item.id === result.indexer_id);
  if (indexer === undefined) throw new TypeError(`unknown accepted Indexer ${result.indexer_id}`);
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
    projectRoot: input.projectRoot,
    registry: input.registry,
    indexer_id: indexer.id,
  });
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
  const primaryView = materializeIndexerPrimaryResultViewFromArtifactResult({
    artifact_result: result,
    primary_result_digest: accepted.result_digest,
    validator_contract_digest: validatorContractDigest,
  });
  const plan = planIndexerPostAuthorComposition({
    effective_composer_set: effective,
    author_workset_digest: accepted.workset_digest,
    primary_result_digest: accepted.result_digest,
    primary_facts: primaryView.facts,
    primary_artifacts: primaryView.artifacts,
    validator_contract_digest: validatorContractDigest,
    current_profile_binding_digest: indexerProtocolDigest(indexer.profile),
    allowed_target_refs: [result.logical_unit.logical_unit_ref],
  });
  return {
    result,
    authority,
    effective,
    plan,
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
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}): Promise<CurrentIndexerComposerContext | undefined> {
  const described = await describeRecord(input);
  const {
    authority,
    effective,
    plan,
    validatorContractDigest,
    acceptedInputViewDigest,
    requirementSetDigest,
  } = described;
  const observed = await prepareIndexerPostAuthorRunStore({
    projectRoot: input.projectRoot,
    requirement_set_digest: requirementSetDigest,
    plan,
    effective_composer_set: effective,
    validator_contract_digest: validatorContractDigest,
    accepted_input_view_digest: acceptedInputViewDigest,
  });
  if (plan.state === "not-required") return undefined;
  if (observed.status.can_reconcile) {
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
  return {
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
}

async function readRecord(input: {
  projectRoot: string;
  record: AcceptedAuthorRecord;
  registry: Awaited<ReturnType<typeof loadIndexerRegistry>>["registry"];
}): Promise<CurrentIndexerComposerContext | undefined> {
  const described = await describeRecord(input);
  if (described.plan.state === "not-required") return undefined;
  const state = await readPostAuthorCurrentState(
    input.projectRoot,
    described.plan.workset_set.author_workset_digest,
  );
  const running = state?.ledger.entries.find((entry) => entry.state === "running");
  if (state === undefined || running === undefined) return undefined;
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
    input_bytes: Buffer.byteLength(canonicalIndexerJson(view), "utf8"),
    output_reserve_bytes: 32 * 1024 + view.artifacts.length * 16 * 1024,
    view_item_count: view.facts.length + view.artifacts.length,
  };
}

async function materializeComposerBatch(input: {
  projectRoot: string;
  contexts: readonly CurrentIndexerComposerContext[];
  instruction: Awaited<ReturnType<typeof instructionContext>>;
}): Promise<CurrentIndexerComposerBatchContext> {
  const materialized = await materializeCurrentIndexerInstructions({
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
    input_bytes: tasks.reduce((total, task) => total + task.input_bytes, 0),
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
}) {
  const first = input.contexts[0];
  if (first === undefined) return undefined;
  const firstInstruction = await instructionContext({
    projectRoot: input.projectRoot,
    context: first,
  });
  const policy = indexerBatchStagePolicy("post-author");
  const selected: CurrentIndexerComposerContext[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  let viewItems = 0;
  for (const context of input.contexts) {
    const candidateInstruction = context === first
      ? firstInstruction
      : await instructionContext({ projectRoot: input.projectRoot, context });
    if (candidateInstruction.request.request_digest !== firstInstruction.request.request_digest) {
      continue;
    }
    const cost = composerTaskCost(context);
    const fits = selected.length < policy.max_tasks &&
      inputBytes + cost.input_bytes <= policy.max_input_bytes &&
      outputBytes + cost.output_reserve_bytes <= policy.max_output_reserve_bytes &&
      viewItems + cost.view_item_count <= policy.max_view_items;
    if (selected.length > 0 && !fits) break;
    selected.push(context);
    inputBytes += cost.input_bytes;
    outputBytes += cost.output_reserve_bytes;
    viewItems += cost.view_item_count;
    if (!fits) break;
  }
  if (
    selected.length === 1 &&
    (inputBytes > policy.max_input_bytes ||
      outputBytes > policy.max_output_reserve_bytes ||
      viewItems > policy.max_view_items)
  ) {
    throw new TypeError(
      `current Composer workset exceeds ${INDEXER_BATCH_POLICY_VERSION} without a semantic split`,
    );
  }
  return { contexts: selected, instruction: firstInstruction };
}

export async function resolveCurrentIndexerComposerBatch(
  projectRoot: string,
): Promise<CurrentIndexerComposerBatchContext | undefined> {
  const [loaded, records] = await Promise.all([
    loadIndexerRegistry(projectRoot),
    readAcceptedIndexerMainAuthorResultRecords(projectRoot),
  ]);
  const ordered = [...records].sort((left, right) =>
    left.accepted_record.workset_digest.localeCompare(right.accepted_record.workset_digest)
  );
  const candidates: CurrentIndexerComposerContext[] = [];
  for (const record of ordered) {
    const current = await prepareRecord({
      projectRoot,
      record,
      registry: loaded.registry,
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
    });
    if (
      selectedRunning === undefined ||
      selectedRunning.contexts.length !== alreadyRunning.length
    ) {
      throw new TypeError("running Composer tasks do not form one authorized batch");
    }
    return materializeComposerBatch({
      projectRoot,
      contexts: selectedRunning.contexts,
      instruction: selectedRunning.instruction,
    });
  }
  const selected = await selectComposerBatch({ projectRoot, contexts: candidates });
  if (selected === undefined) return undefined;
  const started = await startIndexerPostAuthorRunsStore({
    projectRoot,
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
  return materializeComposerBatch({
    projectRoot,
    contexts,
    instruction: selected.instruction,
  });
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
  for (const record of ordered) {
    const current = await readRecord({
      projectRoot,
      record,
      registry: loaded.registry,
    });
    if (current !== undefined) running.push(current);
  }
  const selected = await selectComposerBatch({ projectRoot, contexts: running });
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
