import {
  evaluateGraph,
  resolveRoute,
  type HostActionResult,
  type JsonValue,
  type Route,
} from "@c4a/agent-graph";
import {
  buildIndexerDependencyIntentSet,
  deriveIndexerProgramExecutionPolicy,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
} from "@c4a/context";
import {
  dispatchProjectIndexerProviderResolution,
} from "./indexerProviderProjectFlow.js";
import {
  indexerProviderResolutionHostLocation,
  type IndexerProviderHostManagedOutput,
} from "./indexerProviderDispatcher.js";
import {
  finalizeCurrentIndexerProviderSetup,
  stageCurrentIndexerProviderResolution,
} from "./indexerCurrentProviderSetup.js";
import {
  clearCurrentIndexerProviderSetup,
  persistCurrentIndexerProviderSetup,
  readCurrentIndexerProviderSetup,
  type CurrentIndexerProviderSetupState,
} from "./indexerCurrentProviderState.js";
import {
  authorizeProjectIndexerProgramExecution,
  buildIndexerProgramExecutionAuthorizationInput,
  buildProjectIndexerProgramExecutionAuthorizationReport,
} from "./indexerProgramExecutionAuthorization.js";
import { validateProjectIndexerSelectionProposal } from "./indexerSelectionProposal.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "./workflow/workflowProvider.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
} from "./workflow/workflowTypes.js";
import { readPackageVersion } from "../lib/packageVersion.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "./workflow/workflowTypes.js";

const INDEXER_GRAPH_ID = "indexer";
const PROVIDER_RESOLUTION_ENTRY = "current-provider-resolution";
const PROVIDER_PROGRAM_AUTHORIZATION_ENTRY =
  "current-provider-program-authorization";
const PROVIDER_FINALIZATION_ENTRY = "current-provider-finalization";

async function resolveProviderContinuationGraphRoute(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
  entry: string;
}): Promise<Route> {
  const provider = await loadContextWorkflowProvider();
  const context = {
    authorities: [...input.authorities],
    workspace: input.projectRoot,
  };
  const evaluated = evaluateGraph(
    provider,
    INDEXER_GRAPH_ID,
    input.entry,
    context,
  );
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    throw new TypeError(
      `Context Indexer Provider continuation ${input.entry} is unavailable`,
    );
  }
  return resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    input.entry,
    primary.routeId,
    context,
    evaluated.evaluation.revision,
  );
}

function selectionKey(indexerId: string, providerId: string): string {
  return `${indexerId}\u0000${providerId}`;
}

async function currentSetup(projectRoot: string) {
  const state = await readCurrentIndexerProviderSetup(projectRoot);
  if (state === undefined) return undefined;
  const validation = await validateProjectIndexerSelectionProposal({
    projectRoot,
    value: state.proposal,
  });
  const expected = new Set(validation.resolution_requests.map((request) =>
    selectionKey(request.provider.indexer_id, request.provider.provider_id)
  ));
  const actual = new Set(state.resolved.map((item) =>
    selectionKey(item.indexer_id, item.provider_id)
  ));
  if (actual.size !== state.resolved.length || [...actual].some((key) => !expected.has(key))) {
    throw new TypeError("current Indexer Provider setup contains an unexpected resolution");
  }
  const nextRequest = validation.resolution_requests.find((request) =>
    !actual.has(selectionKey(request.provider.indexer_id, request.provider.provider_id))
  );
  let pendingProgramAuthorization: {
    resolvedIndex: number;
    report: Awaited<ReturnType<typeof buildProjectIndexerProgramExecutionAuthorizationReport>>;
    authorityScopeDigest: string;
  } | undefined;
  for (const [resolvedIndex, resolved] of state.resolved.entries()) {
    if (resolved.execution_policy_digest !== null) continue;
    const manifest = await loadIndexerProviderManifest(resolved.staged.stage_path);
    if (manifest.provider.program === undefined) continue;
    const indexer = validation.proposal.registry.indexers.find((candidate) =>
      candidate.id === resolved.indexer_id
    );
    if (indexer === undefined) {
      throw new TypeError("current Provider program has no selected Indexer");
    }
    const authorityScopeDigest = indexerProtocolDigest({
      protocol: "context.indexer.current-provider-program-authority-scope/v1",
      project_ref: validation.proposal.project_ref,
      indexer_id: indexer.id,
      provider_id: resolved.provider_id,
      read_scope: indexer.read_scope,
    });
    pendingProgramAuthorization = {
      resolvedIndex,
      authorityScopeDigest,
      report: await buildProjectIndexerProgramExecutionAuthorizationReport({
        project_ref: validation.proposal.project_ref,
        bundle: resolved.bundle,
        staged: resolved.staged,
        dependency_set_digest: buildIndexerDependencyIntentSet([]).intent_set_digest,
        scope_digest: indexerProtocolDigest(indexer.read_scope),
        limits: {
          timeout_ms: 30_000,
          max_stdin_bytes: 16 * 1024 * 1024,
          max_stdout_bytes: 16 * 1024 * 1024,
          max_stderr_bytes: 1024 * 1024,
        },
      }),
    };
    break;
  }
  return { state, validation, nextRequest, pendingProgramAuthorization };
}

function completionCommand(input: {
  revision: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
}): string {
  const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
  return `context${authorityOptions} action complete-current --revision '${input.revision}'${input.managed ? " --managed" : ""} --input - --format json`;
}

export async function buildCurrentIndexerProviderContinuationRoute(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  const current = await currentSetup(input.projectRoot);
  if (current === undefined) return undefined;
  if (current.pendingProgramAuthorization !== undefined) {
    const pending = current.pendingProgramAuthorization;
    const resolved = await resolveProviderContinuationGraphRoute({
      ...input,
      entry: PROVIDER_PROGRAM_AUTHORIZATION_ENTRY,
    });
    const gate = resolved.gate;
    const source = gate?.resolutionAction?.action;
    if (
      gate === undefined ||
      source === undefined ||
      source.runner !== "agent" ||
      source.effect !== "external" ||
      source.skill === undefined ||
      source.outputSchema === undefined
    ) {
      throw new TypeError(
        "Context current Provider program authorization Gate contract is incomplete",
      );
    }
    const revision = indexerProtocolDigest({
      protocol: "context.indexer.current-provider-program-authorization-revision/v1",
      state_digest: current.state.state_digest,
      report_digest: pending.report.report_digest,
      authority_scope_digest: pending.authorityScopeDigest,
    });
    const resolutionAction = projectWorkflowRouteAction({
      action: {
        ...source,
        input: {
          stage: "provider-program-authorization",
          report: pending.report,
        } as unknown as JsonValue,
      },
      revision,
      authorities: input.authorities,
    });
    if (resolutionAction === undefined || resolutionAction.effect === "read") {
      throw new TypeError(
        "Context current Provider program authorization resolution is unavailable",
      );
    }
    return {
      protocol: "context.workflow.route.v1",
      id: resolved.routeId,
      revision,
      node: resolved.node,
      reason_code: resolved.reasonCode,
      availability: resolved.availability,
      commands: [{
        command: completionCommand({ ...input, revision }),
        effect: "external",
        availability: gate.resolution === "session-authority"
          ? "immediate"
          : "after-human-confirmation",
        managed_execution: "agent-required",
      }],
      resources: { required: [], recommended: [] },
      gate: {
        id: gate.id,
        ...(gate.authority === undefined
          ? {}
          : { authority: gate.authority }),
        delegatable: gate.delegatable === true,
        resolution: gate.resolution,
        resolution_action: {
          ...resolutionAction,
          effect: source.effect,
        },
      },
      after_action: { evaluate: true },
    };
  }
  if (current.nextRequest === undefined) {
    const resolved = await resolveProviderContinuationGraphRoute({
      ...input,
      entry: PROVIDER_FINALIZATION_ENTRY,
    });
    if (
      resolved.action?.runner !== "command" ||
      resolved.action.effect !== "write" ||
      resolved.action.skill !== undefined ||
      resolved.action.outputSchema !== undefined
    ) {
      throw new TypeError(
        "Context current Provider finalization Action contract is incomplete",
      );
    }
    const revision = indexerProtocolDigest({
      protocol: "context.indexer.current-provider-finalization-revision/v1",
      state_digest: current.state.state_digest,
      validation_digest: current.validation.validation_digest,
    });
    return {
      protocol: "context.workflow.route.v1",
      id: resolved.routeId,
      revision,
      node: resolved.node,
      reason_code: resolved.reasonCode,
      availability: resolved.availability,
      commands: [{
        command: `context --workflow-revision '${revision}'${authorityCommandOptions(input.authorities, "workflow")} run${input.managed ? " --managed" : ""} --format json`,
        effect: "write",
        availability: "immediate",
        managed_execution: "automatic",
      }],
      resources: { required: [], recommended: [] },
      after_action: { evaluate: true },
    };
  }
  const dispatch = await dispatchProjectIndexerProviderResolution({
    projectRoot: input.projectRoot,
    selection: current.validation.proposal,
    request: current.nextRequest,
  });
  if (dispatch.state !== "host-action-required") {
    throw new TypeError("current Provider continuation points to a CLI-resolvable request");
  }
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.current-provider-resolution-revision/v1",
    state_digest: current.state.state_digest,
    validation_digest: current.validation.validation_digest,
    request_digest: dispatch.request.request_digest,
    input_digest: dispatch.input_digest,
  });
  const location = indexerProviderResolutionHostLocation(dispatch.request);
  const resolved = await resolveProviderContinuationGraphRoute({
    ...input,
    entry: PROVIDER_RESOLUTION_ENTRY,
  });
  if (
    resolved.action?.runner !== "agent" ||
    resolved.action.effect !== "external" ||
    resolved.action.skill === undefined ||
    resolved.action.outputSchema === undefined
  ) {
    throw new TypeError(
      "Context current Provider Host resolution Action contract is incomplete",
    );
  }
  const action = projectWorkflowRouteAction({
    action: {
      ...resolved.action,
      input: {
        stage: "provider-resolution",
        request: dispatch.request,
      } as unknown as JsonValue,
    },
    revision,
    authorities: input.authorities,
  });
  if (action === undefined) {
    throw new TypeError("Context current Provider Host resolution Action is unavailable");
  }
  return {
    protocol: "context.workflow.route.v1",
    id: resolved.routeId,
    revision,
    node: resolved.node,
    reason_code: resolved.reasonCode,
    availability: resolved.availability,
    commands: [{
      command: completionCommand({ ...input, revision }),
      effect: "write",
      availability: "immediate",
      managed_execution: "agent-required",
    }],
    action,
    resources: {
      required: [projectWorkflowResourceLocation(
        location,
        revision,
        input.authorities,
      )],
      recommended: [],
    },
    after_action: { evaluate: true },
  };
}

async function persistAndContinue(input: {
  projectRoot: string;
  validation: Awaited<ReturnType<typeof validateProjectIndexerSelectionProposal>>;
  resolved: CurrentIndexerProviderSetupState["resolved"];
}): Promise<
  "provider-resolution-required" | "provider-authorization-required" | "selection-applied"
> {
  const resolved = [...input.resolved];
  for (const request of input.validation.resolution_requests) {
    if (resolved.some((item) =>
      item.indexer_id === request.provider.indexer_id &&
      item.provider_id === request.provider.provider_id
    )) continue;
    const dispatch = await dispatchProjectIndexerProviderResolution({
      projectRoot: input.projectRoot,
      selection: input.validation.proposal,
      request,
    });
    if (dispatch.state === "host-action-required") {
      await persistCurrentIndexerProviderSetup({
        projectRoot: input.projectRoot,
        proposal: input.validation.proposal,
        resolved,
      });
      return "provider-resolution-required";
    }
    const staged = await stageCurrentIndexerProviderResolution({
      projectRoot: input.projectRoot,
      projectRef: input.validation.proposal.project_ref,
      proposal: input.validation.proposal,
      request,
      resolution: dispatch,
    });
    resolved.push(staged.resolved);
    if (staged.authorization_required) {
      await persistCurrentIndexerProviderSetup({
        projectRoot: input.projectRoot,
        proposal: input.validation.proposal,
        resolved,
      });
      return "provider-authorization-required";
    }
  }
  await persistCurrentIndexerProviderSetup({
    projectRoot: input.projectRoot,
    proposal: input.validation.proposal,
    resolved,
  });
  await finalizeCurrentIndexerProviderSetup({
    projectRoot: input.projectRoot,
    proposal: input.validation.proposal,
    staticReport: input.validation.static_report,
    resolved,
  });
  return "selection-applied";
}

export async function completeCurrentIndexerProviderResolution(input: {
  projectRoot: string;
  hostResult: HostActionResult;
  managedOutput?: IndexerProviderHostManagedOutput;
}): Promise<
  "provider-resolution-required" | "provider-authorization-required" | "selection-applied"
> {
  const current = await currentSetup(input.projectRoot);
  if (current === undefined || current.nextRequest === undefined) {
    throw new TypeError("current Indexer Provider resolution is stale or unavailable");
  }
  const dispatch = await dispatchProjectIndexerProviderResolution({
    projectRoot: input.projectRoot,
    selection: current.validation.proposal,
    request: current.nextRequest,
    host_result: input.hostResult,
    ...(input.managedOutput === undefined ? {} : { managed_output: input.managedOutput }),
  });
  if (dispatch.state !== "resolved") {
    throw new TypeError("Host Provider resolution did not produce a resolved Bundle");
  }
  const staged = await stageCurrentIndexerProviderResolution({
    projectRoot: input.projectRoot,
    projectRef: current.validation.proposal.project_ref,
    proposal: current.validation.proposal,
    request: current.nextRequest,
    resolution: dispatch,
  });
  const resolved = [...current.state.resolved, staged.resolved];
  await persistCurrentIndexerProviderSetup({
    projectRoot: input.projectRoot,
    proposal: current.validation.proposal,
    resolved,
  });
  if (staged.authorization_required) return "provider-authorization-required";
  return persistAndContinue({
    projectRoot: input.projectRoot,
    validation: current.validation,
    resolved,
  });
}

export async function completeCurrentIndexerProviderProgramAuthorization(input: {
  projectRoot: string;
  decision: "approved" | "rejected";
}): Promise<
  "selection-rejected" | "provider-resolution-required" |
  "provider-authorization-required" | "selection-applied"
> {
  const current = await currentSetup(input.projectRoot);
  const pending = current?.pendingProgramAuthorization;
  if (current === undefined || pending === undefined) {
    throw new TypeError("current Indexer Provider program authorization is stale or unavailable");
  }
  if (input.decision === "rejected") {
    await clearCurrentIndexerProviderSetup(input.projectRoot);
    return "selection-rejected";
  }
  const authorizationInput = buildIndexerProgramExecutionAuthorizationInput({
    report: pending.report,
    authority_ref: CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution,
    authority_scope_digest: pending.authorityScopeDigest,
  });
  const authorization = authorizeProjectIndexerProgramExecution(authorizationInput);
  const selected = current.state.resolved[pending.resolvedIndex]!;
  const manifest = await loadIndexerProviderManifest(selected.staged.stage_path);
  const policy = deriveIndexerProgramExecutionPolicy({
    manifest,
    bundle: selected.bundle,
    host: {
      protocol: "context.indexer.host-execution-capabilities/v1",
      adapter: "context-cli",
      adapter_version: readPackageVersion(),
      sandboxed_program: false,
    },
    authorization: authorization.authorization,
    projectRef: current.validation.proposal.project_ref,
  });
  if (!policy.executable) {
    throw new TypeError("approved Provider program authorization did not produce an executable policy");
  }
  const resolved = current.state.resolved.map((item, index) =>
    index === pending.resolvedIndex
      ? { ...item, execution_policy_digest: indexerProtocolDigest(policy) }
      : item
  );
  await persistCurrentIndexerProviderSetup({
    projectRoot: input.projectRoot,
    proposal: current.validation.proposal,
    resolved,
  });
  return persistAndContinue({
    projectRoot: input.projectRoot,
    validation: current.validation,
    resolved,
  });
}

export async function advanceCurrentIndexerProviderFinalizationIfReady(
  projectRoot: string,
): Promise<boolean> {
  const current = await currentSetup(projectRoot);
  if (
    current === undefined ||
    current.nextRequest !== undefined ||
    current.pendingProgramAuthorization !== undefined
  ) return false;
  await finalizeCurrentIndexerProviderSetup({
    projectRoot,
    proposal: current.validation.proposal,
    staticReport: current.validation.static_report,
    resolved: current.state.resolved,
  });
  return true;
}
