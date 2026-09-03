import { loadIndexerRegistry } from "@c4a/context";
import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import {
  buildIndexerAgentStepRoute,
  buildIndexerPostAuthorAgentStepRoute,
} from "./indexerAgentStepRoute.js";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import {
  buildCurrentIndexerInstructionMaterializationRequest,
} from "./indexerCurrentInstructionMaterialization.js";
import {
  currentLedger,
  currentSpec,
} from "./indexerMainRunStoreRecords.js";
import { prepareProjectIndexerWorksetViewMaterialization } from "./indexerWorksetViewMaterialization.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
} from "./workflow/workflowProvider.js";
import {
  currentIndexerStructureReview,
  readPendingIndexerStructureFeedback,
} from "./indexerStructureReview.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "./workflow/workflowTypes.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
} from "./workflow/workflowTypes.js";
import { readCurrentIndexerFinalization } from "./indexerCurrentFinalization.js";
import { readCurrentIndexerComposerContext } from "./indexerCurrentComposer.js";
import {
  buildCurrentIndexerProviderSelectionRoute,
  indexerRegistryNeedsProviderSelection,
} from "./indexerCurrentProviderSetup.js";
import { buildCurrentIndexerProviderContinuationRoute } from
  "./indexerCurrentProviderContinuation.js";
import { readProjectIndexerCandidateCompileStatus } from
  "./indexerCandidateCompileActions.js";

const OUTER_INDEXER_NODE = "run-indexer-lifecycle";
const INDEXER_GRAPH_ID = "indexer";
const CURRENT_INDEXER_ENTRY = "current-lifecycle";

async function resolveCurrentIndexerGraphNode(input: {
  projectRoot: string;
  authorities: readonly ContextWorkflowAuthority[];
}) {
  const [ledger, current, finalization, structure, compile] = await Promise.all([
    currentLedger(input.projectRoot),
    resolveCurrentIndexerAgentContext(input.projectRoot),
    readCurrentIndexerFinalization(input.projectRoot),
    currentIndexerStructureReview(input.projectRoot),
    readProjectIndexerCandidateCompileStatus(input.projectRoot),
  ]);
  const composer = finalization?.state === "composer-required"
    ? await readCurrentIndexerComposerContext(input.projectRoot)
    : undefined;
  const failedEntry = ledger?.entries.find((entry) => entry.state === "failed");
  const blocked = failedEntry !== undefined || finalization?.state === "blocked" ||
    (finalization?.state === "composer-required" && composer === undefined);
  const structureReviewRequired = structure !== undefined && !structure.approved;
  const layoutRequired = finalization?.state === "layout-confirmation-required";
  const candidateCurrent = compile.state === "current";
  const advanceRequired = !blocked && current === undefined && composer === undefined &&
    !structureReviewRequired && !layoutRequired && !candidateCurrent;
  const facts = {
    indexer_current: {
      advance_complete: !advanceRequired,
      agent_complete: current === undefined,
      structure_review_complete: !structureReviewRequired,
      composer_complete: composer === undefined,
      blockers_clear: !blocked,
      layout_confirmed: !layoutRequired,
    },
  };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, INDEXER_GRAPH_ID, CURRENT_INDEXER_ENTRY, {
    facts,
    authorities: [...input.authorities],
    workspace: input.projectRoot,
  });
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) {
    if (evaluated.evaluation.statusCode === "complete") {
      return { node: "current-indexer-ready", current, composer, finalization, structure, failedEntry };
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
  return { node: resolved.node, current, composer, finalization, structure, failedEntry };
}

export async function resolveCurrentIndexerAgentContext(projectRoot: string) {
  const ledger = await currentLedger(projectRoot);
  if (ledger === undefined) return undefined;
  const running = ledger.entries.filter((entry) => entry.state === "running");
  if (running.length === 0) return undefined;
  if (running.length !== 1) {
    throw new TypeError("Indexer lifecycle must expose exactly one current Agent workset");
  }
  const entry = running[0]!;
  const spec = await currentSpec({
    projectRoot,
    request_digest: entry.execution_request_digest,
  });
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
  const instructionRequest = buildCurrentIndexerInstructionMaterializationRequest({
    authority,
    customization,
    requirementSetDigest: spec.request.workset.requirement_set_digest,
    worksetDigest: spec.request.workset.workset_digest,
  });
  const structureFeedback = spec.request.workset.stage === "partition"
    ? await readPendingIndexerStructureFeedback({
        projectRoot,
        request: spec.request,
      })
    : undefined;
  const worksetView = await prepareProjectIndexerWorksetViewMaterialization({
    projectRoot,
    run_spec: spec,
    ...(structureFeedback === undefined
      ? {}
      : { additional_projection_sources: [structureFeedback] }),
  });
  return {
    spec,
    authority,
    customization,
    instructionRequest,
    worksetView,
  };
}

/**
 * Replace the workspace's coarse Indexer placeholder with the one current,
 * digest-bound Agent workset. Deterministic lifecycle setup remains owned by
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
      // The outer workspace graph owns initial Indexer configuration. Until
      // that source file exists, keep its coarse lifecycle route instead of
      // attempting to specialize a current workset from absent state.
      return input.route;
    }
    throw error;
  }
  if (indexerRegistryNeedsProviderSelection(loadedRegistry.registry)) {
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
      run_request: selected.current.spec.request,
      instruction_request: selected.current.instructionRequest,
      workset_view_request: selected.current.worksetView.request,
      workspaceRoot: input.projectRoot,
      authorities: input.authorities,
      managed: input.managed,
    })).route;
  }
  if (selected.node === "run-current-indexer-composer") {
    const composer = selected.composer;
    if (
      composer === undefined || selected.finalization?.state !== "composer-required" ||
      composer.request.request_digest !== selected.finalization.revision
    ) {
      throw new TypeError("current Indexer graph selected an unavailable Composer workset");
    }
      const customization = await loadIndexerCustomization({
        workspaceRoot: input.projectRoot,
        projectRef: input.projectRoot,
        indexer: composer.authority.indexer,
        manifest: composer.authority.manifest,
        providerIntegrity: composer.authority.provider.integrity,
      });
      const instructionRequest = buildCurrentIndexerInstructionMaterializationRequest({
        authority: composer.authority,
        customization,
        requirementSetDigest: composer.requirement_set_digest,
        worksetDigest: composer.request.workset.workset_digest,
        composerId: composer.composer.id,
      });
      return (await buildIndexerPostAuthorAgentStepRoute({
        fragment_request: composer.request,
        instruction_request: instructionRequest,
        workspaceRoot: input.projectRoot,
        authorities: input.authorities,
        managed: input.managed,
      })).route;
  }
  if (selected.node === "confirm-current-indexer-layout") {
      const finalization = selected.finalization;
      if (finalization?.state !== "layout-confirmation-required") {
        throw new TypeError("current Indexer graph selected a stale layout Gate");
      }
      const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
      const completion = `context${authorityOptions} action complete-current --revision '${finalization.revision}'${input.managed ? " --managed" : ""} --input - --format json`;
      return {
        protocol: "context.workflow.route.v1",
        id: "confirm-indexer-layout-change",
        revision: finalization.revision,
        node: "confirm-indexer-layout-change",
        reason_code: "route.indexer.layout-confirmation-required",
        availability: "requires-user",
        commands: [{
          command: completion,
          effect: "write",
          availability: "after-human-confirmation",
          managed_execution: "agent-required",
        }],
        action: {
          id: "confirm-indexer-layout-change",
          runner: "command",
          effect: "write",
          handler: "context.confirm-indexer-layout-change/v1",
          input: {
            stage: "layout-confirmation",
            change_reports: finalization.layout_transition?.change_reports ?? [],
          },
        },
        resources: { required: [], recommended: [] },
        gate: {
          id: "confirm-layout-change",
          authority: "human",
          delegatable: false,
          resolution: "user",
        },
        after_action: { evaluate: true },
      };
  }
  if (selected.node === "review-current-indexer-structure") {
      const structure = selected.structure;
      if (structure === undefined || structure.approved) {
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
      return {
        protocol: "context.workflow.route.v1",
        id: "review-indexer-semantic-structure",
        revision: structure.revision,
        node: "review-indexer-semantic-structure",
        reason_code: "route.indexer.semantic-structure-review",
        availability: input.managed ? "immediate" : "requires-user",
        commands: [{
          command: completion,
          effect: "write",
          availability: input.managed ? "immediate" : "after-human-confirmation",
          managed_execution: "agent-required",
        }],
        action: {
          id: "review-indexer-semantic-structure",
          runner: "agent",
          effect: "write",
          handler: "context.review-indexer-semantic-structure/v1",
          input: {
            stage: "structure-review",
            preview_digest: structure.preview.preview_digest,
          },
        },
        resources: { required: [location], recommended: [] },
        gate: {
          id: "indexer-semantic-structure-review",
          authority: CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview,
          delegatable: true,
          resolution: input.managed ? "session-authority" : "user",
        },
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
      ...input.route,
      id: "advance-current-indexer-lifecycle",
      node: "advance-current-indexer-lifecycle",
      reason_code: "route.indexer.lifecycle-advance",
      commands: [{
        command: `context --workflow-revision '${input.route.revision}'${authorityOptions} run${input.managed ? " --managed" : ""} --format json`,
        effect: "write",
        availability: "immediate",
        managed_execution: "automatic",
      }],
    };
  }
  return input.route;
}
