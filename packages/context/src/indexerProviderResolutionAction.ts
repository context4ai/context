import { z } from "zod";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  providerResolutionRequestSchema,
  resolvedProviderBundleSchema,
  validateResolvedProviderBundle,
  type ExpectedProviderResolution,
} from "./indexerProviderResolution.js";

const providerRequestSchema = providerResolutionRequestSchema.extend({
  integrity: indexerDigestSchema,
}).strict();

const actionRequestSchema = z.object({
  protocol: z.literal("context.indexer.resolve-provider-input/v1"),
  project_ref: z.string().min(1),
  selection_proposal_digest: indexerDigestSchema,
  static_report_digest: indexerDigestSchema,
  provider: providerRequestSchema,
}).strict();

export const indexerProviderResolutionActionInputSchema = actionRequestSchema.extend({
  request_digest: indexerDigestSchema,
}).strict();

export const indexerProviderResolutionActionOutputSchema = z.object({
  protocol: z.literal("context.indexer.resolve-provider-output/v1"),
  request_digest: indexerDigestSchema,
  envelope: resolvedProviderBundleSchema,
  output_digest: indexerDigestSchema,
}).strict();

export type IndexerProviderResolutionActionInput = z.infer<
  typeof indexerProviderResolutionActionInputSchema
>;
export type IndexerProviderResolutionActionOutput = z.infer<
  typeof indexerProviderResolutionActionOutputSchema
>;

function requestPayload(
  value: IndexerProviderResolutionActionInput,
): z.infer<typeof actionRequestSchema> {
  const { request_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

function outputPayload(
  value: IndexerProviderResolutionActionOutput,
): Omit<IndexerProviderResolutionActionOutput, "output_digest"> {
  const { output_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function buildIndexerProviderResolutionActionInput(
  value: unknown,
): IndexerProviderResolutionActionInput {
  const request = actionRequestSchema.parse(value);
  return indexerProviderResolutionActionInputSchema.parse({
    ...request,
    request_digest: indexerProtocolDigest(request),
  });
}

export function validateIndexerProviderResolutionActionInput(
  value: unknown,
): IndexerProviderResolutionActionInput {
  const input = indexerProviderResolutionActionInputSchema.parse(value);
  const expected = buildIndexerProviderResolutionActionInput(requestPayload(input));
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(input)) {
    throw new TypeError("Provider resolution Action input is stale or invalid");
  }
  return input;
}

export function expectedProviderResolutionFromAction(
  value: IndexerProviderResolutionActionInput,
): ExpectedProviderResolution {
  const input = validateIndexerProviderResolutionActionInput(value);
  return {
    indexerId: input.provider.indexer_id,
    providerId: input.provider.provider_id,
    skill: input.provider.skill,
    version: input.provider.version,
    integrity: input.provider.integrity,
    distribution: input.provider.distribution,
  };
}

export function buildIndexerProviderResolutionActionOutput(input: {
  request: unknown;
  envelope: unknown;
  now?: Date;
}): IndexerProviderResolutionActionOutput {
  const request = validateIndexerProviderResolutionActionInput(input.request);
  const envelope = validateResolvedProviderBundle(
    input.envelope,
    expectedProviderResolutionFromAction(request),
    input.now,
  );
  const payload: Omit<IndexerProviderResolutionActionOutput, "output_digest"> = {
    protocol: "context.indexer.resolve-provider-output/v1",
    request_digest: request.request_digest,
    envelope,
  };
  return indexerProviderResolutionActionOutputSchema.parse({
    ...payload,
    output_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerProviderResolutionActionOutput(input: {
  request: unknown;
  output: unknown;
  now?: Date;
}): IndexerProviderResolutionActionOutput {
  const request = validateIndexerProviderResolutionActionInput(input.request);
  const output = indexerProviderResolutionActionOutputSchema.parse(input.output);
  const expected = buildIndexerProviderResolutionActionOutput({
    request,
    envelope: output.envelope,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (
    output.request_digest !== request.request_digest ||
    canonicalIndexerJson(outputPayload(expected)) !== canonicalIndexerJson(outputPayload(output)) ||
    expected.output_digest !== output.output_digest
  ) {
    throw new TypeError("Provider resolution Action output is stale or invalid");
  }
  return output;
}
