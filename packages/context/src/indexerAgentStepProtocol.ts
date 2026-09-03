import { z } from "zod";
import {
  indexerProgramRunRequestSchema,
  validateIndexerProgramRunRequest,
} from "./indexerProgramRunProtocol.js";
import { indexerDigestSchema, indexerProtocolDigest } from "./indexerProtocolCommon.js";

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
