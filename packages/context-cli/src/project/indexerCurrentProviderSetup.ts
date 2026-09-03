import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import {
  buildIndexerDependencyIntentSet,
  buildIndexerProjectProposal,
  buildIndexerProviderRouteInput,
  canonicalIndexerJson,
  deriveIndexerProgramExecutionPolicy,
  indexerProjectContentDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateFinalizedIndexerRegistry,
  type IndexerProviderSelectionSemanticInput,
  type IndexerRegistry,
} from "@c4a/context";
import {
  evaluateGraph,
  resolveRoute,
  type JsonValue,
} from "@c4a/agent-graph";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import {
  listCliBundledIndexers,
  loadCliIndexerBaseContracts,
} from "./indexerCliBundledProvider.js";
import { loadIndexerProviderManifest } from "@c4a/context";
import {
  dispatchProjectIndexerProviderResolution,
  stageProjectIndexerProviderResolution,
} from "./indexerProviderProjectFlow.js";
import type { IndexerProviderResolutionComplete } from "./indexerProviderDispatcher.js";
import { routeProjectIndexerProviderSelection } from "./indexerProviderRouting.js";
import { validateProjectIndexerSelectionProposal } from "./indexerSelectionProposal.js";
import {
  validateIndexerSelectionFinal,
  type IndexerResolvedSelectionInput,
} from "./indexerSelectionValidation.js";
import {
  applyProjectIndexerProposal,
  type IndexerProjectStagingValidationInput,
} from "./indexerProjectFlow.js";
import { stageIndexerProjectProposal } from "./indexerProjectApply.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "./workflow/workflowProvider.js";
import type {
  ContextResolvedWorkflowRoute,
  ContextWorkflowAuthority,
  ContextWorkflowRouteActionSource,
} from "./workflow/workflowTypes.js";
import {
  clearCurrentIndexerProviderSetup,
  persistCurrentIndexerProviderSetup,
} from "./indexerCurrentProviderState.js";
import { readPackageVersion } from "../lib/packageVersion.js";

const INDEXER_GRAPH_ID = "indexer";
const PROVIDER_SELECTION_ENTRY = "provider-selection";
const PROVIDER_SELECTION_ACTION = "configure-indexer-providers";

function projectRef(projectRoot: string): string {
  const slug = basename(projectRoot).toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "workspace";
  return `project:${slug}`;
}

function registrySnapshot(content: string) {
  const registry = parseIndexerRegistry(content);
  const digests = indexerRegistryDigests(registry);
  return {
    registry,
    snapshot: {
      document_digest: indexerProjectContentDigest(content),
      requirement_set_digest: digests.requirementSetDigest,
      indexer_selection_digest: digests.indexerSelectionDigest,
      registry_digest: digests.registryDigest,
    },
  };
}

export function indexerRegistryNeedsProviderSelection(registry: IndexerRegistry): boolean {
  try {
    validateFinalizedIndexerRegistry(registry);
    return false;
  } catch {
    return true;
  }
}

export async function buildCurrentIndexerProviderSelectionRoute(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  authorities: readonly ContextWorkflowAuthority[];
  managed: boolean;
}): Promise<ContextResolvedWorkflowRoute> {
  const catalog = await listCliBundledIndexers();
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, INDEXER_GRAPH_ID, PROVIDER_SELECTION_ENTRY);
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) throw new TypeError("Context Indexer Provider selection Route is unavailable");
  const resolved = await resolveRoute(
    provider,
    INDEXER_GRAPH_ID,
    PROVIDER_SELECTION_ENTRY,
    primary.routeId,
    { workspace: input.projectRoot },
    evaluated.evaluation.revision,
  );
  if (
    resolved.action?.id !== PROVIDER_SELECTION_ACTION ||
    resolved.action.runner !== "agent" ||
    resolved.action.skill === undefined ||
    resolved.action.outputSchema === undefined
  ) {
    throw new TypeError("Context Indexer Provider selection Action contract is incomplete");
  }
  const graphDigest = provider.graphDigests.get(INDEXER_GRAPH_ID);
  if (graphDigest === undefined) throw new TypeError("Context Indexer graph digest is unavailable");
  const requirementSetDigest = indexerRegistryDigests(input.registry).requirementSetDigest;
  const revision = indexerProtocolDigest({
    protocol: "context.indexer.current-provider-selection-revision/v1",
    graph_digest: graphDigest,
    requirement_set_digest: requirementSetDigest,
    bundled_catalog: catalog,
  });
  const actionSource: ContextWorkflowRouteActionSource = {
    ...resolved.action,
    input: {
      stage: "provider-selection",
      requirements: input.registry.requirements,
      cli_bundled_providers: catalog.bundles,
    } as unknown as JsonValue,
  };
  const action = projectWorkflowRouteAction({
    action: actionSource,
    revision,
    authorities: input.authorities,
  });
  const required = resolved.resources.required.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, input.authorities)
  );
  const recommended = resolved.resources.recommended.map((resource) =>
    projectWorkflowResourceLocation(resource, revision, input.authorities)
  );
  const authorityOptions = authorityCommandOptions(input.authorities, "workflow");
  return {
    protocol: "context.workflow.route.v1",
    id: resolved.routeId,
    revision,
    node: resolved.node,
    reason_code: resolved.reasonCode,
    availability: resolved.availability,
    commands: [{
      command: `context${authorityOptions} action complete-current --revision '${revision}'${input.managed ? " --managed" : ""} --input - --format json`,
      effect: "write",
      availability: "immediate",
      managed_execution: "agent-required",
    }],
    ...(action === undefined ? {} : { action }),
    resources: { required, recommended },
    after_action: { evaluate: true },
  };
}

export async function stageCurrentIndexerProviderResolution(input: {
  projectRoot: string;
  projectRef: string;
  proposal: Parameters<typeof stageProjectIndexerProviderResolution>[0]["selection"];
  request: Parameters<typeof stageProjectIndexerProviderResolution>[0]["request"];
  resolution: IndexerProviderResolutionComplete;
}): Promise<{
  resolved: IndexerResolvedSelectionInput;
  authorization_required: boolean;
}> {
  const staged = await stageProjectIndexerProviderResolution({
    projectRoot: input.projectRoot,
    selection: input.proposal,
    request: input.request,
    resolution: input.resolution,
  });
  const manifest = await loadIndexerProviderManifest(staged.staged.stage_path);
  const hasExecutable = manifest.provider.program !== undefined ||
    manifest.activation.detector !== undefined ||
    manifest.authoring_inspector !== undefined;
  const policy = deriveIndexerProgramExecutionPolicy({
    manifest,
    bundle: input.resolution.output.envelope,
    host: {
      protocol: "context.indexer.host-execution-capabilities/v1",
      adapter: "context-cli",
      adapter_version: readPackageVersion(),
      sandboxed_program: false,
    },
    projectRef: input.projectRef,
  });
  return {
    resolved: {
      indexer_id: input.resolution.request.provider.indexer_id,
      provider_id: input.resolution.request.provider.provider_id,
      bundle: input.resolution.output.envelope,
      staged: staged.staged,
      execution_policy_digest: hasExecutable && policy.executable
        ? indexerProtocolDigest(policy)
        : null,
    },
    authorization_required: manifest.provider.program !== undefined && !policy.executable,
  };
}

export async function finalizeCurrentIndexerProviderSetup(input: {
  projectRoot: string;
  proposal: Awaited<ReturnType<typeof validateProjectIndexerSelectionProposal>>["proposal"];
  staticReport: Awaited<ReturnType<typeof validateProjectIndexerSelectionProposal>>["static_report"];
  resolved: readonly IndexerResolvedSelectionInput[];
}): Promise<void> {
  const resolved = [...input.resolved];
  const customizations = await Promise.all(input.proposal.registry.indexers.map(
    async (indexer) => {
      const primary = indexer.providers.find((provider) => provider.role === "primary");
      if (primary === undefined) throw new TypeError(`Indexer ${indexer.id} has no primary Provider`);
      const authority = resolved.find((item) =>
        item.indexer_id === indexer.id && item.provider_id === primary.id
      );
      if (authority === undefined) throw new TypeError(`Indexer ${indexer.id} primary Provider is unresolved`);
      return loadIndexerCustomization({
        workspaceRoot: input.projectRoot,
        projectRef: input.proposal.project_ref,
        indexer,
        manifest: await loadIndexerProviderManifest(authority.staged.stage_path),
        providerIntegrity: primary.integrity,
      });
    },
  ));
  const contracts = await loadCliIndexerBaseContracts();
  const finalReport = await validateIndexerSelectionFinal({
    registry: input.proposal.registry,
    static_report: input.staticReport,
    resolved,
    customizations,
    operator_contract: contracts.operators,
    profile_contract: contracts.profiles,
  });
  const baseContent = await readFile(join(input.projectRoot, "src", "indexers.yaml"), "utf8");
  const base = registrySnapshot(baseContent);
  const targetContent = YAML.stringify(input.proposal.registry);
  const target = registrySnapshot(targetContent);
  const proposal = buildIndexerProjectProposal({
    protocol: "context.indexer.project-proposal/v1",
    project_ref: input.proposal.project_ref,
    mode: "registry-only",
    requirement_set_digest: base.snapshot.requirement_set_digest,
    base_registry: base.snapshot,
    target_registry: target.snapshot,
    target_document: target.registry,
    targets: [{
      path: "src/indexers.yaml",
      operation: "write",
      base_digest: base.snapshot.document_digest,
      target_digest: target.snapshot.document_digest,
      content: targetContent,
    }],
    dependencies: buildIndexerDependencyIntentSet([]),
    capability_gap_digest: null,
    finalized_validation_report_digests: [finalReport.report_digest],
    program_execution_policy_digest: null,
  });
  await stageIndexerProjectProposal({ projectRoot: input.projectRoot, proposal });
  const stagingValidation: IndexerProjectStagingValidationInput = {
    protocol: "context.indexer.project-staging-validation-input/v1",
    static_report: input.staticReport,
    resolved,
    customizations,
    operator_contract: contracts.operators,
    profile_contract: contracts.profiles,
  };
  await applyProjectIndexerProposal({
    projectRoot: input.projectRoot,
    proposal_digest: proposal.proposal_digest,
    validation: stagingValidation,
  });
  await clearCurrentIndexerProviderSetup(input.projectRoot);
}

export async function completeCurrentIndexerProviderSelection(input: {
  projectRoot: string;
  currentRegistry: IndexerRegistry;
  semantic: IndexerProviderSelectionSemanticInput;
}): Promise<
  "selection-applied" | "provider-resolution-required" | "provider-authorization-required"
> {
  const catalog = await listCliBundledIndexers();
  const registry = parseIndexerRegistry(canonicalIndexerJson({
    protocol: "context.indexer.registry/v1",
    requirements: input.currentRegistry.requirements,
    indexers: input.semantic.indexers,
  }));
  const routeInput = buildIndexerProviderRouteInput({
    project_ref: projectRef(input.projectRoot),
    registry,
    visible_skills: [
      ...catalog.bundles.map(({ skill, version, source_type }) => ({
        skill,
        version,
        source_type,
      })),
      ...input.semantic.host_visible_skills,
    ],
    community_fallback_attempted: true,
  });
  const route = await routeProjectIndexerProviderSelection({
    projectRoot: input.projectRoot,
    value: routeInput,
  });
  if (route.route.graph_outcome !== "completed" || route.selection_proposal_input === null) {
    throw new TypeError(
      `Indexer Provider selection is not applicable: ${route.route.outcome}; revise the current selection`,
    );
  }
  const validation = await validateProjectIndexerSelectionProposal({
    projectRoot: input.projectRoot,
    value: route.selection_proposal_input,
  });
  const resolved: IndexerResolvedSelectionInput[] = [];
  for (const request of validation.resolution_requests) {
    const dispatch = await dispatchProjectIndexerProviderResolution({
      projectRoot: input.projectRoot,
      selection: validation.proposal,
      request,
    });
    if (dispatch.state === "host-action-required") {
      await persistCurrentIndexerProviderSetup({
        projectRoot: input.projectRoot,
        proposal: validation.proposal,
        resolved,
      });
      return "provider-resolution-required";
    }
    const staged = await stageCurrentIndexerProviderResolution({
      projectRoot: input.projectRoot,
      projectRef: validation.proposal.project_ref,
      proposal: validation.proposal,
      request,
      resolution: dispatch,
    });
    resolved.push(staged.resolved);
    if (staged.authorization_required) {
      await persistCurrentIndexerProviderSetup({
        projectRoot: input.projectRoot,
        proposal: validation.proposal,
        resolved,
      });
      return "provider-authorization-required";
    }
  }
  await finalizeCurrentIndexerProviderSetup({
    projectRoot: input.projectRoot,
    proposal: validation.proposal,
    staticReport: validation.static_report,
    resolved,
  });
  return "selection-applied";
}
