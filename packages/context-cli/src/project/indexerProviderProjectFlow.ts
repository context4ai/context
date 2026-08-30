import { join } from "node:path";
import {
  canonicalIndexerJson,
  expectedProviderResolutionFromAction,
  indexerProtocolDigest,
  validateIndexerProviderResolutionActionInput,
  validateIndexerProviderResolutionActionOutput,
  type IndexerProviderResolutionActionInput,
  type IndexerProviderResolutionActionOutput,
} from "@c4a/context";
import type { HostActionResult } from "@c4a/agent-graph";
import {
  dispatchIndexerProviderResolution,
  type IndexerProviderHostManagedOutput,
  type IndexerProviderResolutionDispatch,
} from "./indexerProviderDispatcher.js";
import { stageIndexerProviderBundle } from "./indexerProviderStage.js";
import { validateProjectIndexerSelectionProposal } from "./indexerSelectionProposal.js";

async function authorizedRequest(input: {
  projectRoot: string;
  selection: unknown;
  request: unknown;
}): Promise<IndexerProviderResolutionActionInput> {
  const validation = await validateProjectIndexerSelectionProposal({
    projectRoot: input.projectRoot,
    value: input.selection,
  });
  const request = validateIndexerProviderResolutionActionInput(input.request);
  const authorized = validation.resolution_requests.find((candidate) =>
    canonicalIndexerJson(candidate) === canonicalIndexerJson(request)
  );
  if (authorized === undefined) {
    throw new TypeError(
      "Provider resolution request is not authorized by the current static selection report",
    );
  }
  return authorized;
}

export async function dispatchProjectIndexerProviderResolution(input: {
  projectRoot: string;
  selection: unknown;
  request: unknown;
  assetsRoot?: string;
  host_result?: HostActionResult;
  managed_output?: IndexerProviderHostManagedOutput;
  now?: Date;
}): Promise<IndexerProviderResolutionDispatch> {
  const request = await authorizedRequest(input);
  return dispatchIndexerProviderResolution({
    request,
    runtimeRoot: join(input.projectRoot, ".tmp", "context-runtime"),
    ...(input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot }),
    ...(input.host_result === undefined ? {} : { host_result: input.host_result }),
    ...(input.managed_output === undefined
      ? {}
      : { managed_output: input.managed_output }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

function resolutionOutput(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { protocol?: unknown }).protocol ===
      "context.indexer.provider-resolution-dispatch/v1"
  ) {
    const dispatch = value as { state?: unknown; output?: unknown };
    if (dispatch.state !== "resolved" || dispatch.output === undefined) {
      throw new TypeError("Provider resolution dispatch is not complete");
    }
    return dispatch.output;
  }
  return value;
}

export async function stageProjectIndexerProviderResolution(input: {
  projectRoot: string;
  selection: unknown;
  request: unknown;
  resolution: unknown;
  now?: Date;
}): Promise<{
  protocol: "context.indexer.provider-stage-action-receipt/v1";
  request_digest: string;
  resolution_output_digest: string;
  staged: Awaited<ReturnType<typeof stageIndexerProviderBundle>>;
  receipt_digest: string;
}> {
  const request = await authorizedRequest(input);
  const output: IndexerProviderResolutionActionOutput =
    validateIndexerProviderResolutionActionOutput({
      request,
      output: resolutionOutput(input.resolution),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  const staged = await stageIndexerProviderBundle({
    envelope: output.envelope,
    expected: expectedProviderResolutionFromAction(request),
    runtimeRoot: join(input.projectRoot, ".tmp", "context-runtime"),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const payload = {
    protocol: "context.indexer.provider-stage-action-receipt/v1" as const,
    request_digest: request.request_digest,
    resolution_output_digest: output.output_digest,
    staged,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}
