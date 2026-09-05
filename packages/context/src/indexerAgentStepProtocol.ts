import { z } from "zod";
import {
  buildIndexerMainTransportBatch,
  indexerMainTransportBatchSchema,
} from "./indexerMainWorkset.js";
import { validateIndexerProgramRunRequest } from "./indexerProgramRunProtocol.js";
import { indexerDigestSchema, indexerProtocolDigest } from "./indexerProtocolCommon.js";
import {
  validateIndexerPostAuthorFragmentRequest,
  type IndexerPostAuthorFragmentRequest,
} from "./indexerPostAuthorComposition.js";

const indexerAgentStepTaskSchema = z.object({
  task_key: z.string().regex(/^task-[0-9]{3}$/u),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  consumed_input_view_digest: indexerDigestSchema,
  workset_view_resource_id: z.string().regex(
    /^authorized-indexer-workset-view\/task-[0-9]{3}$/u,
  ),
  workset_view_request_digest: indexerDigestSchema,
}).strict();

const indexerMainAgentStepInputSchema = z.object({
  protocol: z.literal("context.indexer.agent-step-input/v2"),
  stage: z.enum(["partition", "author"]),
  transport: indexerMainTransportBatchSchema,
  instruction_request_digest: indexerDigestSchema,
  tasks: z.array(indexerAgentStepTaskSchema).min(1),
  input_digest: indexerDigestSchema,
}).strict();

const indexerPostAuthorAgentStepTaskSchema = z.object({
  task_key: z.string().regex(/^task-[0-9]{3}$/u),
  workset_digest: indexerDigestSchema,
  request_digest: indexerDigestSchema,
  primary_result_view_digest: indexerDigestSchema,
  workset_view_resource_id: z.string().regex(
    /^authorized-indexer-workset-view\/task-[0-9]{3}$/u,
  ),
}).strict();

const indexerPostAuthorAgentStepInputSchema = z.object({
  protocol: z.literal("context.indexer.agent-step-input/v2"),
  stage: z.literal("post-author"),
  instruction_request_digest: indexerDigestSchema,
  tasks: z.array(indexerPostAuthorAgentStepTaskSchema).min(1),
  input_digest: indexerDigestSchema,
}).strict();

export const indexerAgentStepInputSchema = z.discriminatedUnion("stage", [
  indexerMainAgentStepInputSchema,
  indexerPostAuthorAgentStepInputSchema,
]);

export type IndexerMainAgentStepInput = z.infer<typeof indexerMainAgentStepInputSchema>;
export type IndexerPostAuthorAgentStepInput = z.infer<
  typeof indexerPostAuthorAgentStepInputSchema
>;
export type IndexerAgentStepInput = IndexerMainAgentStepInput |
  IndexerPostAuthorAgentStepInput;

export function indexerAgentStepInputDigest(
  value: Omit<IndexerAgentStepInput, "input_digest"> | IndexerAgentStepInput,
): string {
  const { input_digest: _digest, ...payload } = value as IndexerAgentStepInput;
  void _digest;
  return indexerProtocolDigest(payload);
}

export function buildIndexerAgentStepInput(input: {
  run_requests: readonly unknown[];
  instruction_request_digest: string;
  workset_view_requests: readonly {
    resource_id: string;
    workset_digest: string;
    request_digest: string;
  }[];
}): IndexerMainAgentStepInput {
  if (input.run_requests.length === 0) {
    throw new TypeError("Indexer Agent step requires at least one run request");
  }
  const runRequests = input.run_requests.map(validateIndexerProgramRunRequest);
  if (input.workset_view_requests.length !== runRequests.length) {
    throw new TypeError("Indexer Agent step must have one View per run request");
  }
  const stage = runRequests[0]!.workset.stage;
  if (runRequests.some((request) => request.workset.stage !== stage)) {
    throw new TypeError("Indexer Agent step batch must contain one stage");
  }
  const transport = buildIndexerMainTransportBatch(
    runRequests.map((request) => request.workset),
  );
  const tasks = runRequests.map((request, index) => {
    const taskKey = `task-${String(index + 1).padStart(3, "0")}`;
    const view = input.workset_view_requests[index]!;
    if (
      view.workset_digest !== request.workset.workset_digest ||
      view.resource_id !== `authorized-indexer-workset-view/${taskKey}`
    ) {
      throw new TypeError("Indexer Agent step View mapping does not match its workset");
    }
    return {
      task_key: taskKey,
      workset_digest: request.workset.workset_digest,
      execution_request_digest: request.execution_request_digest,
      consumed_input_view_digest: request.composition_input.view_digest,
      workset_view_resource_id: view.resource_id,
      workset_view_request_digest: view.request_digest,
    };
  });
  const payload = {
    protocol: "context.indexer.agent-step-input/v2",
    stage,
    transport,
    instruction_request_digest: indexerDigestSchema.parse(input.instruction_request_digest),
    tasks,
  } as const;
  return indexerMainAgentStepInputSchema.parse({
    ...payload,
    input_digest: indexerAgentStepInputDigest(payload),
  });
}

export function buildIndexerPostAuthorAgentStepInput(input: {
  fragment_requests: readonly IndexerPostAuthorFragmentRequest[];
  instruction_request_digest: string;
}): IndexerPostAuthorAgentStepInput {
  if (input.fragment_requests.length === 0) {
    throw new TypeError("post-author Agent step requires at least one fragment request");
  }
  const requests = input.fragment_requests.map(validateIndexerPostAuthorFragmentRequest);
  const tasks = requests.map((request, index) => {
    const taskKey = `task-${String(index + 1).padStart(3, "0")}`;
    return {
      task_key: taskKey,
      workset_digest: request.workset.workset_digest,
      request_digest: request.request_digest,
      primary_result_view_digest: request.primary_result_view.view_digest,
      workset_view_resource_id: `authorized-indexer-workset-view/${taskKey}`,
    };
  });
  const payload = {
    protocol: "context.indexer.agent-step-input/v2" as const,
    stage: "post-author" as const,
    instruction_request_digest: indexerDigestSchema.parse(
      input.instruction_request_digest,
    ),
    tasks,
  };
  return indexerPostAuthorAgentStepInputSchema.parse({
    ...payload,
    input_digest: indexerAgentStepInputDigest(payload as IndexerAgentStepInput),
  });
}

export function validateIndexerAgentStepInput(
  value: unknown,
): IndexerAgentStepInput {
  const input = indexerAgentStepInputSchema.parse(value);
  if (input.input_digest !== indexerAgentStepInputDigest(input)) {
    throw new TypeError("Indexer Agent step input digest is invalid");
  }
  if (input.stage === "post-author") {
    if (new Set(input.tasks.map((task) => task.task_key)).size !== input.tasks.length) {
      throw new TypeError("post-author Agent step task keys must be unique");
    }
    return input;
  }
  if (
    input.transport.worksets.length !== input.tasks.length ||
    input.transport.worksets.some((workset, index) =>
      workset.stage !== input.stage ||
      workset.workset_digest !== input.tasks[index]!.workset_digest
    )
  ) {
    throw new TypeError("Indexer Agent step transport does not match its task manifest");
  }
  return input;
}
