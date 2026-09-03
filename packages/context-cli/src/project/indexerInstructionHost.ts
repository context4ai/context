import {
  hostActionInputDigest,
  hostActionOutputDigest,
  validateHostActionResult,
  type HostActionResult,
  type JsonValue,
  type HostActionResourceLocation,
} from "@c4a/agent-graph";
import type { ResolvedProviderBundle } from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import type { StagedIndexerProviderBundle } from "./indexerProviderStage.js";
import {
  assertCurrentMaterializationAuthority,
  materializeIndexerInstructions,
  validateIndexerInstructionMaterializationRequest,
  validateMaterializedIndexerInstructions,
  type IndexerInstructionMaterializationAuthority,
  type MaterializedIndexerInstructions,
} from "./indexerInstructionMaterialization.js";

export interface IndexerInstructionHostManagedOutput {
  ref: string;
  digest: string;
  value: unknown;
}

export function indexerInstructionHostLocation(
  value: unknown,
): HostActionResourceLocation {
  const request = validateIndexerInstructionMaterializationRequest(value);
  return {
    schema: "agent-graph.resource-location.host-action.v1",
    id: request.resource_id,
    kind: "procedure",
    mediaType: "text/markdown",
    revision: request.request_digest,
    materialize: {
      handler: request.handler,
      input: {
        schema: request.protocol,
        value: request as unknown as JsonValue,
      },
      output_schema: "context.indexer.materialized-resource/v1",
    },
  };
}

export async function materializeIndexerInstructionHostAction(input: {
  request: unknown;
  currentAuthority: IndexerInstructionMaterializationAuthority;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
  adapter: string;
  adapterVersion: string;
}): Promise<{ result: HostActionResult; materialized: MaterializedIndexerInstructions }> {
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  const location = indexerInstructionHostLocation(request);
  const materialized = await materializeIndexerInstructions({
    request,
    currentAuthority: input.currentAuthority,
    bundle: input.bundle,
    staged: input.staged,
    customization: input.customization,
    workspaceRoot: input.workspaceRoot,
  });
  const result: HostActionResult = {
    schema: "agent-graph.host-action-result.v1",
    handler: location.materialize.handler,
    input_digest: hostActionInputDigest(location),
    output: {
      schema: location.materialize.output_schema,
      inline: materialized as unknown as JsonValue,
    },
    receipt: {
      adapter: input.adapter,
      adapter_version: input.adapterVersion,
    },
  };
  await validateHostActionResult(location, result);
  return { result, materialized };
}

function materializedHostOutput(input: {
  result: HostActionResult;
  managed_output?: IndexerInstructionHostManagedOutput;
}): unknown {
  if ("inline" in input.result.output) return input.result.output.inline;
  if (input.managed_output === undefined) {
    throw new TypeError("Indexer instruction Host result requires its managed resource output");
  }
  if (
    input.managed_output.ref !== input.result.output.resource.ref ||
    input.managed_output.digest !== input.result.output.resource.digest
  ) {
    throw new TypeError("Indexer instruction managed resource does not match the Host result");
  }
  return input.managed_output.value;
}

export async function consumeIndexerInstructionHostResult(input: {
  request: unknown;
  currentAuthority: IndexerInstructionMaterializationAuthority;
  result: HostActionResult;
  managed_output?: IndexerInstructionHostManagedOutput;
}): Promise<{
  materialized: MaterializedIndexerInstructions;
  input_digest: string;
  output_digest: string;
  host_receipt: HostActionResult["receipt"];
}> {
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  assertCurrentMaterializationAuthority({
    request,
    current: input.currentAuthority,
  });
  const location = indexerInstructionHostLocation(request);
  await validateHostActionResult(location, input.result);
  const materialized = materializedHostOutput({
    result: input.result,
    ...(input.managed_output === undefined ? {} : { managed_output: input.managed_output }),
  }) as MaterializedIndexerInstructions;
  validateMaterializedIndexerInstructions(materialized, request);
  return {
    materialized,
    input_digest: input.result.input_digest,
    output_digest: hostActionOutputDigest(input.result),
    host_receipt: input.result.receipt,
  };
}
