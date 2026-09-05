import { indexerProtocolDigest, loadIndexerRegistry } from "@c4a/context";
import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import type { JsonValue, Route } from "@c4a/agent-graph";
import { basename } from "node:path";
import {
  buildIndexerAgentStepRoute,
  buildIndexerPostAuthorAgentStepRoute,
} from "./indexerAgentStepRoute.js";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import {
  currentLedger,
  currentSpec,
} from "./indexerMainRunStoreRecords.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
  projectWorkflowRouteAction,
  projectWorkflowResourceLocation,
} from "./workflow/workflowProvider.js";
import { currentIndexerStructureReview } from "./indexerStructureReview.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
} from "./workflow/workflowTypes.js";
import { readCurrentIndexerFinalization } from "./indexerCurrentFinalization.js";
import { readCurrentIndexerComposerBatch } from "./indexerCurrentComposer.js";
import {
  buildCurrentIndexerProviderSelectionRoute,
  indexerRegistryNeedsProviderSelection,
} from "./indexerCurrentProviderSetup.js";
import { buildCurrentIndexerProviderContinuationRoute } from
  "./indexerCurrentProviderContinuation.js";
import { readProjectIndexerCandidateCompileStatus } from
  "./indexerCandidateCompileActions.js";
import { measureContextDebugOperation } from "./debugTrace.js";
import { ensureCurrentIndexerBatchDescriptor } from "./indexerCurrentBatch.js";
import { hasChangedIndexerWorksetAuthority } from "./indexerCurrentRegistryFreshness.js";

const OUTER_INDEXER_NODE = "run-indexer-lifecycle";
const INDEXER_GRAPH_ID = "indexer";
const CURRENT_INDEXER_ENTRY = "current-lifecycle";
const CURRENT_ACTION_OUTPUT_SCHEMA_FILE = "indexer-agent-step-result.schema.json";

function projectCurrentIndexerGateResolution(input: {
  resolved: Route;
  revision: string;
  authorities: readonly ContextWorkflowAuthority[];
  value: JsonValue;
}): NonNullable<
  NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
> {
  const source = input.resolved.gate?.resolutionAction?.action;
  if (source === undefined) {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} has no Graph-owned resolution Action`,
    );
  }
  if (source.runner !== "agent" || source.effect !== "write") {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} must resolve through an Agent write Action`,
    );
  }
  if (
    source.outputSchema === undefined ||
    !("filePath" in source.outputSchema) ||
    source.outputSchema.filePath === undefined ||
    basename(source.outputSchema.filePath) !== CURRENT_ACTION_OUTPUT_SCHEMA_FILE
  ) {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} must expose ${CURRENT_ACTION_OUTPUT_SCHEMA_FILE}`,
    );
  }
  const projected = projectWorkflowRouteAction({
    action: { ...source, input: input.value },
    revision: input.revision,
    authorities: input.authorities,
  });
  if (projected === undefined || projected.effect === "read") {
    throw new TypeError(
      `current Indexer Gate ${input.resolved.node} resolution Action is unavailable`,
    );
  }
  return { ...projected, effect: source.effect };
}

function projectCurrentIndexerGate(
  resolved: Route,
  resolutionAction: NonNullable<
    NonNullable<ContextResolvedWorkflowRoute["gate"]>["resolution_action"]
  >,
): NonNullable<ContextResolvedWorkflowRoute["gate"]> {
  if (resolved.gate === undefined) {
    throw new TypeError(`current Indexer node ${resolved.node} is not a Gate`);
  }
  return {
    id: resolved.gate.id,
    ...(resolved.gate.authority === undefined
      ? {}
      : { authority: resolved.gate.authority }),
    delegatable: resolved.gate.delegatable === true,
    resolution: resolved.gate.resolution,
    resolution_action: resolutionAction,
  };
}

async function resolveCurrentIndexerGraphNode(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
}) {
  const [ledger, finalization, structure, compile] = await Promise.all([
    currentLedger(input.projectRoot),
    readCurrentIndexerFinalization(input.projectRoot),
    currentIndexerStructureReview(input.projectRoot),
    readProjectIndexerCandidateCompileStatus(input.projectRoot),
  ]);
  const runningEntries = ledger?.entries.filter((entry) => entry.state === "running") ?? [];
  const composer = finalization?.state === "composer-required"
    ? await readCurrentIndexerComposerBatch(input.projectRoot)
    : undefined;
  const failedEntry = ledger?.entries.find((entry) => entry.state === "failed");
  const blocked = failedEntry !== undefined || finalization?.state === "blocked" ||
    (finalization?.state === "composer-required" && composer === undefined);
  const structureReviewRequired = structure !== undefined && !structure.approved;
  const layoutRequired = finalization?.state === "layout-confirmation-required";
  const candidateCurrent = compile.state === "current";
  const authorityChanged = await hasChangedIndexerWorksetAuthority(input.projectRoot, ledger);
  const advanceRequired = authorityChanged || (!blocked && runningEntries.length === 0 &&
    composer === undefined && !structureReviewRequired && !layoutRequired && !candidateCurrent);
  const facts = {
    indexer_current: {
      advance_complete: !advanceRequired,
      agent_complete: runningEntries.length === 0,
      structure_review_complete: !structureReviewRequired,
      composer_complete: composer === undefined,
      blockers_clear: !blocked,
      layout_confirmed: !layoutRequired,
    },
  };
  const provider = await loadContextWorkflowProvider();
  const evaluated = await measureContextDebugOperation({
    projectRoot: input.projectRoot,
    operation: "agent-graph.evaluate",
    counters: { graph_evaluate_count: 1 },
    data: { graph: INDEXER_GRAPH_ID },
  }, async () => evaluateGraph(provider, INDEXER_GRAPH_ID, CURRENT_INDEXER_ENTRY, {
      facts,
      authorities: [...input.authorities],
      workspace: input.projectRoot,
    }));
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    if (evaluated.evaluation.statusCode === "complete") {
      return {
        node: "current-indexer-ready",
        current: undefined,
        composer,
        finalization,
        structure,
        failedEntry,
      };
    }
    throw new TypeError("current Indexer graph has no resolvable Route");
  }
  const resolved = await resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    CURRENT_INDEXER_ENTRY,
    primary.routeId,
    { facts, authorities: [...input.authorities], workspace: input.projectRoot },
    evaluated.evaluation.revision,
  );
  const current = resolved.node === "run-current-indexer-agent"
    ? await resolveCurrentIndexerAgentContext(input.projectRoot)
    : undefined;
  return {
    node: resolved.node,
    resolved,
    current,
    composer,
    finalization,
    structure,
    failedEntry,
  };
}

export async function resolveCurrentIndexerAgentContext(projectRoot: string) {
  const ledger = await currentLedger(projectRoot);
  if (ledger === undefined) return undefined;
  const running = ledger.entries.filter((entry) => entry.state === "running");
  if (running.length === 0) return undefined;
  const descriptor = await ensureCurrentIndexerBatchDescriptor(projectRoot);
  if (descriptor === undefined) {
    throw new TypeError("Indexer lifecycle has running work without a current batch descriptor");
  }
  const specs = [];
  for (const task of descriptor.tasks) {
    specs.push(await currentSpec({
      projectRoot,
      request_digest: task.execution_request_digest,
    }));
  }
  const spec = specs[0]!;
  const loaded = await loadIndexerRegistry(projectRoot);
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({
    projectRoot,
    registry: loaded.registry,
    indexer_id: spec.request.workset.indexer_id,
  });
  const customization = await loadIndexerCustomization({
    workspaceRoot: projectRoot,
    projectRef: projectRoot,
    indexer: authority.indexer,
    manifest: authority.manifest,
    providerIntegrity: authority.provider.integrity,
  });
  return {
    descriptor,
    specs,
    authority,
    customization,
    instructionRequest: descriptor.instruction_request,
  };
}

/**
 * Replace the workspace's coarse Indexer placeholder with the current,
 * digest-bound Agent batch. Deterministic lifecycle setup remains owned by
 * the CLI and is advanced separately; this projection never invents work.
 */
export async function projectCurrentIndexerWorkflowRoute(input: {
  projectRoot: string;
  route: ContextResolvedWorkflowRoute | undefined;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  if (input.route?.node !== OUTER_INDEXER_NODE) return input.route;
  const providerContinuation = await buildCurrentIndexerProviderContinuationRoute({
    projectRoot: input.projectRoot,
    authorities: input.authorities,
    managed: input.managed,
  });
  if (providerContinuation !== undefined) return providerContinuation;
  let loadedRegistry: Awaited<ReturnType<typeof loadIndexerRegistry>>;
  try {
    loadedRegistry = await loadIndexerRegistry(input.projectRoot);
  } catch (error) {
    if (
      error !== null && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) {
      // The outer Graph owns initial requirements. Expose its project edit
      // explicitly so both run entrypoints stop before preparing any workset.
      return {
        ...input.route,
        configuration: {
          file: "src/indexers.yaml",
          action: "Declare the confirmed knowledge requirements for the registered sources, with indexers: []. Then re-evaluate the workflow for Provider selection.",
        },
      };
    }
    throw error;
  }
  if (await indexerRegistryNeedsProviderSelection(input.projectRoot, loadedRegistry.registry)) {
    return buildCurrentIndexerProviderSelectionRoute({
      projectRoot: input.projectRoot,
      registry: loadedRegistry.registry,
      authorities: input.authorities,
      managed: input.managed,
    });
  }
  const selected = await resolveCurrentIndexerGraphNode({
    projectRoot: input.projectRoot,
    authorities: input.authorities,
  });
  if (selected.node === "run-current-indexer-agent") {
    if (selected.current === undefined) {
      throw new TypeError("current Indexer graph selected an unavailable Agent workset");
    }
    return (await buildIndexerAgentStepRoute({
      run_requests: selected.current.specs.map((spec) => spec.request),
      instruction_request: selected.current.instructionRequest,
      workset_view_requests: selected.current.descriptor.tasks.map((task) =>
        task.view_request
      ),
      ready_instruction: {
        path: selected.current.descriptor.instruction_path,
        digest: selected.current.descriptor.instruction_payload_digest,
      },
      ready_workset_views: selected.current.descriptor.tasks.map((task) => ({
        resource_id: task.view_request.resource_id,
        path: task.view_path,
        digest: task.view_request.payload_digest,
      })),
      workspaceRoot: input.projectRoot,
      authorities: input.authorities,
      managed: input.managed,
    })).route;
  }
  if (selected.node === "run-current-indexer-composer") {
    const composer = selected.composer;
    if (
      composer === undefined || selected.finalization?.state !== "composer-required" ||
      composer.batch_digest !== selected.finalization.revision
    ) {
      throw new TypeError("current Indexer graph selected an unavailable Composer workset");
    }
      return (await buildIndexerPostAuthorAgentStepRoute({
        fragment_requests: composer.tasks.map((task) => task.context.request),
        instruction_request: composer.instruction_request,
        ready_instruction: {
          path: composer.instruction_path,
          digest: composer.instruction_payload_digest,
        },
        ready_workset_views: composer.tasks.map((task) => ({
          resource_id: `authorized-indexer-workset-view/${task.task_key}`,
          path: task.view_path,
          digest: task.context.request.primary_result_view.view_digest,
        })),
        workspaceRoot: input.projectRoot,
        authorities: input.authorities,
        managed: input.managed,
      })).route;
  }
  if (selected.node === "confirm-current-indexer-layout") {
      const finalization = selected.finalization;
      const resolved = selected.resolved;
      if (
        finalization?.state !== "layout-confirmation-required" ||
        resolved === undefined
      ) {
        throw new TypeError("current Indexer graph selected a stale layout Gate");
      }
      const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
      const completion = `context${authorityOptions} action complete-current --revision '${finalization.revision}'${input.managed ? " --managed" : ""} --input - --format json`;
      const resolutionAction = projectCurrentIndexerGateResolution({
        resolved,
        revision: finalization.revision,
        authorities: input.authorities,
        value: {
          stage: "layout-confirmation",
          change_reports: finalization.layout_transition?.change_reports ?? [],
          ...(finalization.path_preparation === undefined ? {} : {
            path_conflicts: finalization.path_preparation.conflicts,
            path_selection: "Ask the user for distinct readable filenames. Submit paths with artifact_ref and output_path for every conflicting page (including any name kept unchanged). Do not rename unrelated pages.",
          }),
        },
      });
      return {
        protocol: "context.workflow.route.v1",
        id: resolved.routeId,
        revision: finalization.revision,
        node: resolved.node,
        reason_code: resolved.reasonCode,
        availability: resolved.availability,
        commands: [{
          command: completion,
          effect: "write",
          availability: "after-human-confirmation",
          managed_execution: "agent-required",
        }],
        resources: { required: [], recommended: [] },
        gate: projectCurrentIndexerGate(resolved, resolutionAction),
        after_action: { evaluate: true },
      };
  }
  if (selected.node === "review-current-indexer-structure") {
      const structure = selected.structure;
      const resolved = selected.resolved;
      if (structure === undefined || structure.approved || resolved === undefined) {
        throw new TypeError("current Indexer graph selected a stale semantic structure Gate");
      }
      const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
      const completion = `context${authorityOptions} action complete-current --revision '${structure.revision}'${input.managed ? " --managed" : ""} --input - --format json`;
      const location = projectWorkflowResourceLocation({
        schema: "agent-graph.resource-location.host-action.v1",
        id: "indexer-semantic-structure-preview",
        kind: "procedure",
        mediaType: "application/json",
        revision: structure.revision,
        materialize: {
          handler: "context.materialize-indexer-structure-preview/v1",
          input: {
            schema: "context.indexer.semantic-structure-preview-request/v1",
            value: { revision: structure.revision },
          },
          output_schema: "context.indexer.semantic-structure-preview/v1",
        },
      }, structure.revision, input.authorities);
      const resolutionAction = projectCurrentIndexerGateResolution({
        resolved,
        revision: structure.revision,
        authorities: input.authorities,
        value: {
          stage: "structure-review",
          preview_digest: structure.preview.preview_digest,
        },
      });
      return {
        protocol: "context.workflow.route.v1",
        id: resolved.routeId,
        revision: structure.revision,
        node: resolved.node,
        reason_code: resolved.reasonCode,
        availability: resolved.availability,
        commands: [{
          command: completion,
          effect: "write",
          availability: resolved.availability === "requires-user"
            ? "after-human-confirmation"
            : "immediate",
          managed_execution: "agent-required",
        }],
        resources: { required: [location], recommended: [] },
        gate: projectCurrentIndexerGate(resolved, resolutionAction),
        after_action: { evaluate: true },
      };
  }
  if (selected.node === "resolve-current-indexer-block") {
    const revision = selected.finalization?.revision ??
      selected.failedEntry?.execution_request_digest ?? input.route.revision;
    const diagnostic = selected.finalization?.diagnostic ??
      (selected.failedEntry === undefined
        ? "The current Composer failed and must be retried or revised."
        : `${selected.failedEntry.reason_code}: update the source or retry the failed workset.`);
    const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
    return {
      protocol: "context.workflow.route.v1",
      id: "resolve-current-indexer-block",
      revision,
      node: "resolve-current-indexer-block",
      reason_code: "route.indexer.recovery-required",
      summary: diagnostic,
      availability: "requires-user",
      commands: [{
        command: `context${authorityOptions} run${input.managed ? " --managed" : ""} --format json`,
        effect: "write",
        availability: "after-human-confirmation",
        managed_execution: "automatic",
      }],
      resources: { required: [], recommended: [] },
      gate: {
        id: "indexer-recovery",
        delegatable: false,
        resolution: "user",
      },
      after_action: { evaluate: true },
    };
  }
  if (selected.node === "advance-current-indexer-lifecycle") {
    const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
    return {
      protocol: "context.workflow.route.v1",
      id: "advance-current-indexer-lifecycle",
      revision: input.route.revision,
      node: "advance-current-indexer-lifecycle",
      reason_code: "route.indexer.lifecycle-advance",
      availability: "immediate",
      commands: [{
        command: `context --workflow-revision '${input.route.revision}'${authorityOptions} run${input.managed ? " --managed" : ""} --format json`,
        effect: "write",
        availability: "immediate",
        managed_execution: "automatic",
      }],
      resources: { required: [], recommended: [] },
      after_action: { evaluate: true },
    };
  }
  return input.route;
}

/**
 * Resolve only the current Indexer subgraph. This is the hot-path projection
 * used after a batch commit; it deliberately avoids rebuilding the outer
 * workspace status. Returning undefined means the Indexer subgraph reached a
 * stage boundary and the caller may perform one full workspace observation.
 */
export async function resolveCurrentIndexerWorkflowRoute(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  const triggerRevision = indexerProtocolDigest({
    purpose: "current-indexer-route-trigger",
    authorities: [...input.authorities].sort(),
    managed: input.managed,
  });
  const trigger: ContextResolvedWorkflowRoute = {
    protocol: "context.workflow.route.v1",
    id: OUTER_INDEXER_NODE,
    revision: triggerRevision,
    node: OUTER_INDEXER_NODE,
    reason_code: "route.indexer.lifecycle",
    availability: "immediate",
    commands: [],
    resources: { required: [], recommended: [] },
    after_action: { evaluate: true },
  };
  const route = await projectCurrentIndexerWorkflowRoute({ ...input, route: trigger });
  if (
    route === undefined ||
    route.node === OUTER_INDEXER_NODE ||
    route.node === "advance-current-indexer-lifecycle"
  ) return undefined;
  return route;
}
