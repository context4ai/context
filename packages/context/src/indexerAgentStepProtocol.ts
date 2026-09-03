import { z } from "zod";
import {
  indexerProgramRunRequestSchema,
  indexerProgramRunResultSchema,
  validateIndexerProgramRunRequest,
  type IndexerProgramRunRequest,
  type IndexerProgramRunResult,
} from "./indexerProgramRunProtocol.js";
import { indexerDigestSchema, indexerProtocolDigest } from "./indexerProtocolCommon.js";
import {
  validateIndexerWorksetReadReceipt,
  type IndexerWorksetReadReceipt,
} from "./indexerWorksetRead.js";

export const indexerAgentStepInputSchema = z.object({
  protocol: z.literal("context.indexer.agent-step-input/v1"),
  run_request: indexerProgramRunRequestSchema,
  instruction_request_digest: indexerDigestSchema,
  input_digest: indexerDigestSchema,
}).strict();

export type IndexerAgentStepInput = z.infer<typeof indexerAgentStepInputSchema>;

export function indexerAgentStepInputDigest(
  value: Omit<IndexerAgentStepInput, "input_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerAgentStepInput(input: {
  run_request: unknown;
  instruction_request_digest: string;
}): IndexerAgentStepInput {
  const runRequest = validateIndexerProgramRunRequest(input.run_request);
  const payload: Omit<IndexerAgentStepInput, "input_digest"> = {
    protocol: "context.indexer.agent-step-input/v1",
    run_request: runRequest,
    instruction_request_digest: indexerDigestSchema.parse(input.instruction_request_digest),
  };
  return indexerAgentStepInputSchema.parse({
    ...payload,
    input_digest: indexerAgentStepInputDigest(payload),
  });
}

export function validateIndexerAgentStepInput(
  value: unknown,
): IndexerAgentStepInput {
  const input = indexerAgentStepInputSchema.parse(value);
  const rebuilt = buildIndexerAgentStepInput(input);
  if (rebuilt.input_digest !== input.input_digest) {
    throw new TypeError("Indexer Agent step input digest is invalid");
  }
  return input;
}

const executionReceiptSchema = z.object({
  adapter: z.string().min(1),
  adapter_version: z.string().min(1),
  model: z.string().min(1).optional(),
  execution_id: z.string().min(1),
  receipt_digest: indexerDigestSchema,
}).strict();

export const indexerAgentStepResultSchema = z.object({
  protocol: z.literal("context.indexer.agent-step-result/v1"),
  input_digest: indexerDigestSchema,
  instruction_payload_digest: indexerDigestSchema,
  run_result: indexerProgramRunResultSchema,
  execution_receipt: executionReceiptSchema,
  stable_result_digest: indexerDigestSchema,
}).strict();

export type IndexerAgentStepResult = z.infer<typeof indexerAgentStepResultSchema>;

function executionReceiptDigest(input: {
  input_digest: string;
  instruction_payload_digest: string;
  run_result: IndexerProgramRunResult;
  adapter: string;
  adapter_version: string;
  model?: string;
  execution_id: string;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.agent-step-execution-receipt/v1",
    ...input,
  });
}

function stableResultDigest(input: {
  input_digest: string;
  instruction_payload_digest: string;
  run_result: IndexerProgramRunResult;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.agent-step-stable-result/v1",
    ...input,
  });
}

function resultExecutionRequestDigest(result: IndexerProgramRunResult): string {
  return result.result.execution_request_digest;
}

function assertRunResultCorrelation(
  request: IndexerProgramRunRequest,
  result: IndexerProgramRunResult,
): void {
  if (
    result.operation !== request.operation ||
    resultExecutionRequestDigest(result) !== request.execution_request_digest
  ) {
    throw new TypeError("Indexer Agent step Result does not match its run request");
  }
}

export function buildIndexerAgentStepResult(input: {
  step_input: unknown;
  instruction_payload_digest: string;
  run_result: unknown;
  workset_read_receipts?: readonly unknown[];
  adapter: string;
  adapter_version: string;
  model?: string;
  execution_id: string;
}): IndexerAgentStepResult {
  const stepInput = validateIndexerAgentStepInput(input.step_input);
  const instructionPayloadDigest = indexerDigestSchema.parse(input.instruction_payload_digest);
  const runResult = input.workset_read_receipts === undefined
    ? indexerProgramRunResultSchema.parse(input.run_result)
    : bindIndexerProgramRunResultReadReceipts({
        run_request: stepInput.run_request,
        run_result: input.run_result,
        workset_read_receipts: input.workset_read_receipts,
      });
  assertRunResultCorrelation(stepInput.run_request, runResult);
  const receiptInput = {
    input_digest: stepInput.input_digest,
    instruction_payload_digest: instructionPayloadDigest,
    run_result: runResult,
    adapter: input.adapter,
    adapter_version: input.adapter_version,
    ...(input.model === undefined ? {} : { model: input.model }),
    execution_id: input.execution_id,
  };
  return indexerAgentStepResultSchema.parse({
    protocol: "context.indexer.agent-step-result/v1",
    input_digest: stepInput.input_digest,
    instruction_payload_digest: instructionPayloadDigest,
    run_result: runResult,
    execution_receipt: {
      adapter: input.adapter,
      adapter_version: input.adapter_version,
      ...(input.model === undefined ? {} : { model: input.model }),
      execution_id: input.execution_id,
      receipt_digest: executionReceiptDigest(receiptInput),
    },
    stable_result_digest: stableResultDigest({
      input_digest: stepInput.input_digest,
      instruction_payload_digest: instructionPayloadDigest,
      run_result: runResult,
    }),
  });
}

export function bindIndexerProgramRunResultReadReceipts(input: {
  run_request: unknown;
  run_result: unknown;
  workset_read_receipts: readonly unknown[];
}): IndexerProgramRunResult {
  const request = validateIndexerProgramRunRequest(input.run_request);
  const receipts: IndexerWorksetReadReceipt[] = input.workset_read_receipts.map(
    validateIndexerWorksetReadReceipt,
  );
  if (receipts.length === 0) {
    throw new TypeError("main-index Agent Result requires a CLI-issued workset read receipt");
  }
  const receiptDigests = receipts.map((receipt) => {
    if (receipt.workset_digest !== request.workset.workset_digest) {
      throw new TypeError("main-index workset read receipt belongs to another workset");
    }
    return receipt.receipt_digest;
  }).sort();
  if (new Set(receiptDigests).size !== receiptDigests.length) {
    throw new TypeError("main-index workset read receipts must be unique");
  }
  if (
    input.run_result === null ||
    typeof input.run_result !== "object" ||
    Array.isArray(input.run_result)
  ) {
    throw new TypeError("Indexer Agent run Result must be an object");
  }
  return indexerProgramRunResultSchema.parse({
    ...input.run_result,
    workset_read_receipt_digests: receiptDigests,
  });
}

export function validateIndexerAgentStepResult(input: {
  step_input: unknown;
  result: unknown;
  expected_instruction_payload_digest: string;
}): IndexerAgentStepResult {
  const stepInput = validateIndexerAgentStepInput(input.step_input);
  const result = indexerAgentStepResultSchema.parse(input.result);
  const expectedInstructionPayloadDigest = indexerDigestSchema.parse(
    input.expected_instruction_payload_digest,
  );
  if (
    result.input_digest !== stepInput.input_digest ||
    result.instruction_payload_digest !== expectedInstructionPayloadDigest
  ) {
    throw new TypeError("Indexer Agent step Result is stale");
  }
  assertRunResultCorrelation(stepInput.run_request, result.run_result);
  const receipt = result.execution_receipt;
  const expectedReceiptDigest = executionReceiptDigest({
    input_digest: result.input_digest,
    instruction_payload_digest: result.instruction_payload_digest,
    run_result: result.run_result,
    adapter: receipt.adapter,
    adapter_version: receipt.adapter_version,
    ...(receipt.model === undefined ? {} : { model: receipt.model }),
    execution_id: receipt.execution_id,
  });
  if (receipt.receipt_digest !== expectedReceiptDigest) {
    throw new TypeError("Indexer Agent step execution receipt is invalid");
  }
  const expectedStableDigest = stableResultDigest({
    input_digest: result.input_digest,
    instruction_payload_digest: result.instruction_payload_digest,
    run_result: result.run_result,
  });
  if (result.stable_result_digest !== expectedStableDigest) {
    throw new TypeError("Indexer Agent step stable Result digest is invalid");
  }
  return result;
}
