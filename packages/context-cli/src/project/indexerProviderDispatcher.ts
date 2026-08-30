import { join } from "node:path";
import {
  hostActionInputDigest,
  hostActionOutputDigest,
  validateHostActionResult,
  type HostActionResult,
  type JsonValue,
  type ResourceLocation,
  type ResourceLocationV2,
} from "@c4a/agent-graph";
import {
  buildIndexerProviderResolutionActionOutput,
  expectedProviderResolutionFromAction,
  validateIndexerProviderResolutionActionInput,
  validateIndexerProviderResolutionActionOutput,
  type IndexerProviderResolutionActionInput,
  type IndexerProviderResolutionActionOutput,
} from "@c4a/context";
import { assertIndexerOutputSafe } from "@c4a/core";
import {
  loadCliIndexerReleaseManifest,
  resolveCliBundledIndexerProvider,
} from "./indexerCliBundledProvider.js";

export const INDEXER_PROVIDER_RESOLVER_HANDLER =
  "context.resolve-indexer-provider/v1";
export const INDEXER_PROVIDER_RESOLVER_OUTPUT_SCHEMA =
  "context.indexer.resolve-provider-output/v1";

export interface IndexerProviderHostManagedOutput {
  ref: string;
  digest: string;
  value: unknown;
}

export interface IndexerProviderHostActionRequired {
  protocol: "context.indexer.provider-resolution-dispatch/v1";
  state: "host-action-required";
  request: IndexerProviderResolutionActionInput;
  location: ResourceLocation;
  input_digest: string;
}

export interface IndexerProviderResolutionComplete {
  protocol: "context.indexer.provider-resolution-dispatch/v1";
  state: "resolved";
  resolver: "cli-bundled" | "host";
  request: IndexerProviderResolutionActionInput;
  output: IndexerProviderResolutionActionOutput;
  host_receipt?: HostActionResult["receipt"];
  host_result_digest?: string;
}

export type IndexerProviderResolutionDispatch =
  | IndexerProviderHostActionRequired
  | IndexerProviderResolutionComplete;

function locationId(input: IndexerProviderResolutionActionInput): string {
  return `resolved-provider-${input.provider.indexer_id}-${input.provider.provider_id}`;
}

export function indexerProviderResolutionHostLocation(
  value: unknown,
): ResourceLocationV2 {
  const input = validateIndexerProviderResolutionActionInput(value);
  return {
    schema: "agent-graph.resource-location.v2",
    id: locationId(input),
    kind: "procedure",
    mediaType: "application/json",
    revision: input.request_digest,
    materialize: {
      handler: INDEXER_PROVIDER_RESOLVER_HANDLER,
      input: {
        schema: "context.indexer.resolve-provider-input/v1",
        value: input as unknown as JsonValue,
      },
      output_schema: INDEXER_PROVIDER_RESOLVER_OUTPUT_SCHEMA,
    },
  };
}

function hostOutputValue(input: {
  result: HostActionResult;
  managed_output?: IndexerProviderHostManagedOutput;
}): unknown {
  if ("inline" in input.result.output) return input.result.output.inline;
  if (input.managed_output === undefined) {
    throw new TypeError("Host Provider result requires its managed resource output");
  }
  if (
    input.managed_output.ref !== input.result.output.resource.ref ||
    input.managed_output.digest !== input.result.output.resource.digest
  ) {
    throw new TypeError("Host Provider managed resource does not match the result envelope");
  }
  return input.managed_output.value;
}

async function consumeHostResult(input: {
  request: IndexerProviderResolutionActionInput;
  result: HostActionResult;
  managed_output?: IndexerProviderHostManagedOutput;
  now?: Date;
}): Promise<IndexerProviderResolutionComplete> {
  const location = indexerProviderResolutionHostLocation(input.request);
  assertIndexerOutputSafe({ channel: "ipc-envelope", value: input.result });
  if (input.managed_output !== undefined) {
    assertIndexerOutputSafe({ channel: "ipc-envelope", value: input.managed_output.value });
  }
  await validateHostActionResult(location, input.result);
  const output = validateIndexerProviderResolutionActionOutput({
    request: input.request,
    output: hostOutputValue({
      result: input.result,
      ...(input.managed_output === undefined
        ? {}
        : { managed_output: input.managed_output }),
    }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return {
    protocol: "context.indexer.provider-resolution-dispatch/v1",
    state: "resolved",
    resolver: "host",
    request: input.request,
    output,
    host_receipt: input.result.receipt,
    host_result_digest: hostActionOutputDigest(input.result),
  };
}

export async function dispatchIndexerProviderResolution(input: {
  request: unknown;
  runtimeRoot: string;
  assetsRoot?: string;
  host_result?: HostActionResult;
  managed_output?: IndexerProviderHostManagedOutput;
  now?: Date;
}): Promise<IndexerProviderResolutionDispatch> {
  const request = validateIndexerProviderResolutionActionInput(input.request);
  if (request.provider.distribution.kind !== "cli-bundled") {
    if (input.host_result !== undefined) {
      return consumeHostResult({
        request,
        result: input.host_result,
        ...(input.managed_output === undefined
          ? {}
          : { managed_output: input.managed_output }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
    }
    const location = indexerProviderResolutionHostLocation(request);
    return {
      protocol: "context.indexer.provider-resolution-dispatch/v1",
      state: "host-action-required",
      request,
      location,
      input_digest: hostActionInputDigest(location),
    };
  }
  if (input.host_result !== undefined || input.managed_output !== undefined) {
    throw new TypeError("cli-bundled Provider resolution does not accept a Host result");
  }
  const manifest = await loadCliIndexerReleaseManifest({
    ...(input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot }),
  });
  const envelope = await resolveCliBundledIndexerProvider({
    ...(input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot }),
    expectedPackageVersion: manifest.version,
    expected: expectedProviderResolutionFromAction(request),
    transportRoot: join(input.runtimeRoot, "indexer-resolver-transports"),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return {
    protocol: "context.indexer.provider-resolution-dispatch/v1",
    state: "resolved",
    resolver: "cli-bundled",
    request,
    output: buildIndexerProviderResolutionActionOutput({
      request,
      envelope,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  };
}
