import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  loadIndexerRegistry,
  validateIndexerAuthorizedWorksetProjection,
  type IndexerAuthorizedWorksetView,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import {
  buildCurrentIndexerInstructionMaterializationRequest,
  materializeCurrentIndexerInstructions,
} from "./indexerCurrentInstructionMaterialization.js";
import type { IndexerInstructionMaterializationRequest } from
  "./indexerInstructionMaterialization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import {
  INDEXER_BATCH_POLICY_VERSION,
  indexerBatchStagePolicy,
  planIndexerCurrentBatch,
  type PlannedIndexerCurrentBatch,
} from "./indexerCurrentBatchPlanner.js";
import {
  startIndexerMainRunsStore,
} from "./indexerMainRunStore.js";
import {
  currentLedger,
  currentSpec,
  type MainRunSpec,
} from "./indexerMainRunStoreRecords.js";
import {
  persistPreparedIndexerWorksetView,
  prepareProjectIndexerWorksetViewMaterialization,
  validateIndexerWorksetViewMaterializationRequest,
  type IndexerWorksetViewMaterializationRequest,
} from "./indexerWorksetViewMaterialization.js";
import { LIFECYCLE_ROOT } from "./lifecyclePaths.js";
import { readPendingIndexerStructureFeedback } from "./indexerStructureReview.js";
import { observeIndexerBatchStarted } from "./indexerBatchTiming.js";

const CURRENT_BATCH_DESCRIPTOR = join(
  LIFECYCLE_ROOT,
  "current-indexer-batch.json",
);

export interface CurrentIndexerBatchTaskDescriptor {
  task_key: string;
  indexer_id: string;
  source_ref: string;
  workset_digest: string;
  execution_request_digest: string;
  view_request: IndexerWorksetViewMaterializationRequest;
  view_path: string;
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
}

export interface CurrentIndexerBatchDescriptor {
  cache_format: 2;
  ledger_digest: string;
  stage: "partition" | "author";
  policy_version: typeof INDEXER_BATCH_POLICY_VERSION;
  policy_digest: string;
  instruction_request: IndexerInstructionMaterializationRequest;
  instruction_path: string;
  instruction_payload_digest: string;
  input_bytes: number;
  output_reserve_bytes: number;
  view_item_count: number;
  tasks: readonly CurrentIndexerBatchTaskDescriptor[];
  descriptor_digest: string;
}

export interface CurrentIndexerBatchTask {
  descriptor: CurrentIndexerBatchTaskDescriptor;
  spec: MainRunSpec;
  view: IndexerAuthorizedWorksetView;
}

function descriptorPayload(
  descriptor: CurrentIndexerBatchDescriptor,
): Omit<CurrentIndexerBatchDescriptor, "descriptor_digest"> {
  const { descriptor_digest: _digest, ...payload } = descriptor;
  void _digest;
  return payload;
}

function validateDescriptorShape(value: unknown): CurrentIndexerBatchDescriptor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("current Indexer batch descriptor must be an object");
  }
  const descriptor = value as CurrentIndexerBatchDescriptor;
  if (
    descriptor.cache_format !== 2 ||
    descriptor.policy_version !== INDEXER_BATCH_POLICY_VERSION ||
    (descriptor.stage !== "partition" && descriptor.stage !== "author") ||
    !Array.isArray(descriptor.tasks) ||
    descriptor.tasks.length === 0 ||
    typeof descriptor.descriptor_digest !== "string" ||
    typeof descriptor.instruction_path !== "string" ||
    typeof descriptor.instruction_payload_digest !== "string" ||
    indexerProtocolDigest(descriptorPayload(descriptor)) !== descriptor.descriptor_digest
  ) {
    throw new TypeError("current Indexer batch descriptor is invalid");
  }
  const taskKeys = descriptor.tasks.map((task) => task.task_key);
  const worksets = descriptor.tasks.map((task) => task.workset_digest);
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(descriptor.instruction_payload_digest) ||
    descriptor.instruction_path.length === 0 ||
    new Set(taskKeys).size !== taskKeys.length ||
    new Set(worksets).size !== worksets.length ||
    descriptor.tasks.some((task, index) =>
      task.task_key !== `task-${String(index + 1).padStart(3, "0")}` ||
      task.indexer_id.length === 0 ||
      task.source_ref.length === 0 ||
      task.view_path.length === 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(task.view_request.payload_digest) ||
      validateIndexerWorksetViewMaterializationRequest(task.view_request)
        .workset_digest !== task.workset_digest
    )
  ) {
    throw new TypeError("current Indexer batch task mapping is invalid");
  }
  return descriptor;
}

async function writeDescriptor(
  projectRoot: string,
  value: Omit<CurrentIndexerBatchDescriptor, "descriptor_digest">,
): Promise<CurrentIndexerBatchDescriptor> {
  const descriptor: CurrentIndexerBatchDescriptor = {
    ...value,
    descriptor_digest: indexerProtocolDigest(value),
  };
  await atomicWriteFile(
    join(projectRoot, CURRENT_BATCH_DESCRIPTOR),
    `${canonicalIndexerJson(descriptor)}\n`,
  );
  return descriptor;
}

function estimateOutputReserve(spec: MainRunSpec): number {
  const members = Array.isArray(spec.validation.canonical_inventory_members)
    ? spec.validation.canonical_inventory_members.length
    : 0;
  return spec.request.workset.stage === "partition"
    ? 16 * 1024 + members * 2 * 1024
    : 48 * 1024 + members * 8 * 1024;
}

async function sharedBatchAuthority(input: {
  projectRoot: string;
  spec: MainRunSpec;
}) {
  const loaded = await loadIndexerRegistry(input.projectRoot);
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
    projectRoot: input.projectRoot,
    registry: loaded.registry,
    indexer_id: input.spec.request.workset.indexer_id,
  });
  const customization = await loadIndexerCustomization({
    workspaceRoot: input.projectRoot,
    projectRef: input.projectRoot,
    indexer: authority.indexer,
    manifest: authority.manifest,
    providerIntegrity: authority.provider.integrity,
  });
  const instructionRequest = buildCurrentIndexerInstructionMaterializationRequest({
    authority,
    customization,
    stage: input.spec.request.workset.stage,
  });
  const instructions = await materializeCurrentIndexerInstructions({
    request: instructionRequest,
    authority,
    customization,
    workspaceRoot: input.projectRoot,
  });
  const instructionBytes = instructions.resources.reduce(
    (total, resource) => total + Buffer.byteLength(resource.content, "utf8"),
    0,
  );
  const instructionPath = join(
    input.projectRoot,
    ".tmp",
    "context-runtime",
    "indexer",
    "instructions",
    `${instructions.payload_digest.slice("sha256:".length)}.json`,
  );
  await atomicWriteFile(
    instructionPath,
    `${canonicalIndexerJson(instructions)}\n`,
  );
  return {
    instructionRequest,
    instructionBytes,
    instructionPath,
    instructionPayloadDigest: instructions.payload_digest,
  };
}

async function prepareCandidates(input: {
  projectRoot: string;
  specs: readonly MainRunSpec[];
  instructionRequest: IndexerInstructionMaterializationRequest;
}) {
  const prepared = [];
  for (const [index, spec] of input.specs.entries()) {
    const taskKey = `task-${String(index + 1).padStart(3, "0")}`;
    const structureFeedback = spec.request.workset.stage === "partition"
      ? await readPendingIndexerStructureFeedback({
          projectRoot: input.projectRoot,
          request: spec.request,
        })
      : undefined;
    const worksetView = await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: input.projectRoot,
      run_spec: spec,
      resource_id: `authorized-indexer-workset-view/${taskKey}`,
      ...(structureFeedback === undefined
        ? {}
        : { additional_projection_sources: [structureFeedback] }),
    });
    const viewText = canonicalIndexerJson(worksetView.projection.view);
    prepared.push({
      spec,
      taskKey,
      worksetView,
      candidate: {
        workset: spec.request.workset,
        instruction_identity: input.instructionRequest.request_digest,
        input_bytes: Buffer.byteLength(viewText, "utf8"),
        output_reserve_bytes: estimateOutputReserve(spec),
        view_item_count: worksetView.projection.view.items.length,
      },
    });
  }
  return prepared;
}

async function persistPlannedBatch(input: {
  projectRoot: string;
  planned: PlannedIndexerCurrentBatch;
  prepared: Awaited<ReturnType<typeof prepareCandidates>>;
  instructionRequest: IndexerInstructionMaterializationRequest;
  instructionPath: string;
  instructionPayloadDigest: string;
  ledgerDigest: string;
}): Promise<CurrentIndexerBatchDescriptor> {
  const selectedWorksets = new Set(
    input.planned.candidates.map((candidate) => candidate.workset.workset_digest),
  );
  const selected = input.prepared.filter((candidate) =>
    selectedWorksets.has(candidate.spec.request.workset.workset_digest)
  );
  const tasks: CurrentIndexerBatchTaskDescriptor[] = [];
  for (const candidate of selected) {
    const output = await persistPreparedIndexerWorksetView({
      workspaceRoot: input.projectRoot,
      prepared: candidate.worksetView,
    });
    tasks.push({
      task_key: candidate.taskKey,
      indexer_id: candidate.spec.request.workset.indexer_id,
      source_ref: candidate.spec.request.workset.source_ref,
      workset_digest: candidate.spec.request.workset.workset_digest,
      execution_request_digest: candidate.spec.request.execution_request_digest,
      view_request: candidate.worksetView.request,
      view_path: output.file_path,
      input_bytes: candidate.candidate.input_bytes,
      output_reserve_bytes: candidate.candidate.output_reserve_bytes,
      view_item_count: candidate.candidate.view_item_count,
    });
  }
  const descriptor = await writeDescriptor(input.projectRoot, {
    cache_format: 2,
    ledger_digest: input.ledgerDigest,
    stage: input.planned.stage,
    policy_version: input.planned.policy_version,
    policy_digest: input.planned.policy_digest,
    instruction_request: input.instructionRequest,
    instruction_path: input.instructionPath,
    instruction_payload_digest: input.instructionPayloadDigest,
    input_bytes: input.planned.input_bytes,
    output_reserve_bytes: input.planned.output_reserve_bytes,
    view_item_count: input.planned.view_item_count,
    tasks,
  });
  await observeIndexerBatchStarted({ projectRoot: input.projectRoot, descriptor });
  return descriptor;
}

export async function prepareAndStartNextIndexerBatch(
  projectRoot: string,
): Promise<CurrentIndexerBatchDescriptor> {
  const ledger = await currentLedger(projectRoot);
  if (ledger === undefined) throw new TypeError("main run ledger is not prepared");
  if (ledger.entries.some((entry) => entry.state === "running")) {
    throw new TypeError("cannot prepare a new Indexer batch while another batch is running");
  }
  const pending = ledger.entries.filter((entry) =>
    entry.state === "pending" || entry.state === "stale"
  );
  if (pending.length === 0) throw new TypeError("current Indexer stage has no pending work");
  const candidateLimit = indexerBatchStagePolicy(pending[0]!.stage).max_tasks;
  const specs: MainRunSpec[] = [];
  for (const entry of pending) {
    const spec = await currentSpec({
      projectRoot,
      request_digest: entry.execution_request_digest,
    });
    if (
      specs.length > 0 &&
      (spec.request.workset.stage !== specs[0]!.request.workset.stage ||
        spec.request.workset.indexer_id !== specs[0]!.request.workset.indexer_id ||
        spec.request.workset.source_ref !== specs[0]!.request.workset.source_ref)
    ) {
      continue;
    }
    specs.push(spec);
    if (specs.length === candidateLimit) break;
  }
  const shared = await sharedBatchAuthority({ projectRoot, spec: specs[0]! });
  const prepared = await prepareCandidates({
    projectRoot,
    specs,
    instructionRequest: shared.instructionRequest,
  });
  const planned = planIndexerCurrentBatch({
    candidates: prepared.map((candidate) => candidate.candidate),
    shared_instruction_bytes: shared.instructionBytes,
  });
  if (planned.oversized_single_task) {
    throw new TypeError(
      `current Indexer workset exceeds ${planned.policy_version} without a declared semantic split`,
    );
  }
  const started = await startIndexerMainRunsStore({
    projectRoot,
    workset_digests: planned.candidates.map((candidate) =>
      candidate.workset.workset_digest
    ),
  });
  return persistPlannedBatch({
    projectRoot,
    planned,
    prepared,
    instructionRequest: shared.instructionRequest,
    instructionPath: shared.instructionPath,
    instructionPayloadDigest: shared.instructionPayloadDigest,
    ledgerDigest: started.ledger.ledger_digest,
  });
}

export async function readCurrentIndexerBatchDescriptor(
  projectRoot: string,
): Promise<CurrentIndexerBatchDescriptor | undefined> {
  try {
    const descriptor = validateDescriptorShape(JSON.parse(await readFile(
      join(projectRoot, CURRENT_BATCH_DESCRIPTOR),
      "utf8",
    )));
    const ledger = await currentLedger(projectRoot);
    if (
      ledger === undefined ||
      ledger.ledger_digest !== descriptor.ledger_digest ||
      descriptor.tasks.length !== ledger.entries.filter((entry) => entry.state === "running").length ||
      descriptor.tasks.some((task) => !ledger.entries.some((entry) =>
        entry.state === "running" &&
        entry.workset_digest === task.workset_digest &&
        entry.execution_request_digest === task.execution_request_digest
      ))
    ) {
      return undefined;
    }
    return descriptor;
  } catch {
    return undefined;
  }
}

export async function ensureCurrentIndexerBatchDescriptor(
  projectRoot: string,
): Promise<CurrentIndexerBatchDescriptor | undefined> {
  const cached = await readCurrentIndexerBatchDescriptor(projectRoot);
  if (cached !== undefined) return cached;
  const ledger = await currentLedger(projectRoot);
  if (ledger === undefined) return undefined;
  const running = ledger.entries.filter((entry) => entry.state === "running");
  if (running.length === 0) return undefined;
  const specs: MainRunSpec[] = [];
  for (const entry of running) {
    specs.push(await currentSpec({
      projectRoot,
      request_digest: entry.execution_request_digest,
    }));
  }
  const shared = await sharedBatchAuthority({ projectRoot, spec: specs[0]! });
  const prepared = await prepareCandidates({
    projectRoot,
    specs,
    instructionRequest: shared.instructionRequest,
  });
  const planned = planIndexerCurrentBatch({
    candidates: prepared.map((candidate) => candidate.candidate),
    shared_instruction_bytes: shared.instructionBytes,
  });
  if (planned.candidates.length !== prepared.length || planned.oversized_single_task) {
    throw new TypeError("persisted running Indexer batch no longer satisfies its batch policy");
  }
  return persistPlannedBatch({
    projectRoot,
    planned,
    prepared,
    instructionRequest: shared.instructionRequest,
    instructionPath: shared.instructionPath,
    instructionPayloadDigest: shared.instructionPayloadDigest,
    ledgerDigest: ledger.ledger_digest,
  });
}

export async function loadCurrentIndexerBatchTask(input: {
  projectRoot: string;
  descriptor: CurrentIndexerBatchDescriptor;
  taskKey: string;
}): Promise<CurrentIndexerBatchTask> {
  const task = input.descriptor.tasks.find((candidate) =>
    candidate.task_key === input.taskKey
  );
  if (task === undefined) throw new TypeError(`current Indexer batch has no ${input.taskKey}`);
  const spec = await currentSpec({
    projectRoot: input.projectRoot,
    request_digest: task.execution_request_digest,
  });
  const view = JSON.parse(await readFile(task.view_path, "utf8"));
  const projection = validateIndexerAuthorizedWorksetProjection({
    request: spec.request,
    view,
  });
  if (
    spec.request.workset.indexer_id !== task.indexer_id ||
    spec.request.workset.source_ref !== task.source_ref ||
    spec.request.workset.workset_digest !== task.workset_digest ||
    spec.request.execution_request_digest !== task.execution_request_digest ||
    projection.view.view_digest !== task.view_request.view_digest ||
    indexerProtocolDigest(projection.view) !== task.view_request.payload_digest
  ) {
    throw new TypeError(`current Indexer batch View ${input.taskKey} is stale`);
  }
  return { descriptor: task, spec, view: projection.view };
}
