import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateGraph,
  loadProvider,
  locateCode,
  resolveRoute,
  validateSchema,
  type Diagnostic,
  type LoadedProvider,
  type ResourceReadReceiptSet,
  type Route,
  type ResourceLocation,
} from "@c4a/agent-graph";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  CONTEXT_WORKFLOW_ENTRY,
  CONTEXT_WORKFLOW_GRAPH_ID,
  CONTEXT_WORKFLOW_PROVIDER_ID,
  type ContextResolvedWorkflowRoute,
  type ContextWorkflowAuthority,
  type ContextWorkflowCommand,
  type ContextWorkflowDiagnostic,
  type ContextWorkflowObservation,
  type ContextWorkflowResource,
  type ContextWorkflowResourceLocation,
  type ContextWorkflowRouteActionSource,
  type ContextWorkflowSnapshot,
  type ContextWorkflowStatus,
} from "./workflowTypes.js";
import {
  contextWorkflowAuthorities,
  createContextWorkflowFacts,
} from "./workflowFacts.js";
import { planForResolvedCommandPlan } from "./workflowHostPlans.js";
import { currentSourceBodyResources } from "./workflowEvidenceResources.js";

let providerPromise: Promise<LoadedProvider> | undefined;

function providerCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    ...(process.env.C4A_CONTEXT_WORKFLOW_PROVIDER
      ? [resolve(process.env.C4A_CONTEXT_WORKFLOW_PROVIDER)]
      : []),
    resolve(moduleDir, "providers", "context", "manifest.json"),
    resolve(moduleDir, "../../../context-workflow/provider.yaml"),
  ];
}

export function contextWorkflowProviderPath(): string {
  const candidate = providerCandidates().find((path) => existsSync(path));
  if (candidate === undefined) {
    throw new Error(
      "Context workflow Provider is missing. Rebuild @c4a/context-cli or reinstall the published package.",
    );
  }
  return candidate;
}

export function loadContextWorkflowProvider(): Promise<LoadedProvider> {
  providerPromise ??= loadProvider(contextWorkflowProviderPath()).then((provider) => {
    if (provider.manifest.id !== CONTEXT_WORKFLOW_PROVIDER_ID) {
      throw new Error(
        `Expected Context workflow Provider ${CONTEXT_WORKFLOW_PROVIDER_ID}, got ${provider.manifest.id}`,
      );
    }
    return provider;
  });
  return providerPromise;
}

function rootDiagnostics(
  observation: ContextWorkflowObservation,
): ContextWorkflowDiagnostic[] {
  const diagnostics: ContextWorkflowDiagnostic[] = [];
  if (!observation.projectEntryValid) {
    diagnostics.push({
      code: "diagnostic.project-entry-invalid",
      severity: "error",
      message: "The Context project entry could not be loaded.",
      count: observation.stateDiagnostics.length,
    });
  } else if (observation.stateDiagnostics.length > 0) {
    diagnostics.push({
      code: "diagnostic.workspace-state-invalid",
      severity: "error",
      message: observation.stateDiagnostics[0] ??
        "Context could not establish a valid workspace state.",
      count: observation.stateDiagnostics.length,
    });
  }
  if (observation.activeStructures.state === "invalid") {
    diagnostics.push({
      code: "diagnostic.structure-snapshot-invalid",
      severity: "error",
      message: observation.activeStructures.diagnostics[0] ??
        "An active structure snapshot is invalid.",
      count: observation.activeStructures.diagnostics.length,
    });
  }
  if (observation.projectionRefreshIssues > 0) {
    diagnostics.push({
      code: "diagnostic.projection-stale",
      severity: "info",
      message:
        "Approved knowledge changed and its deterministic structure projection must be refreshed.",
      count: observation.projectionRefreshIssues,
    });
  } else if (
    observation.verifyErrors > 0 &&
    observation.capturedDocumentSources === observation.documentSources.length
  ) {
    diagnostics.push({
      code: "diagnostic.verify-failed",
      severity: "error",
      message: observation.verifyIssues.find((issue) => issue.severity === "error")?.message ??
        "Context verification found blocking issues.",
      count: observation.verifyErrors,
    });
  } else if (observation.evidenceWarnings !== "none") {
    diagnostics.push({
      code: `diagnostic.evidence-${observation.evidenceWarnings}`,
      severity: "warning",
      message: "Approved knowledge has an evidence warning; inspect the current verification detail.",
    });
  }
  return diagnostics;
}

function agentGraphDiagnostics(
  diagnostics: readonly ContextWorkflowDiagnostic[],
): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.details_resource === undefined
      ? {}
      : { documentRef: diagnostic.details_resource.id }),
    ...(diagnostic.count === undefined
      ? {}
      : { detail: { count: diagnostic.count } }),
  }));
}

async function attachDiagnosticResources(
  provider: LoadedProvider,
  diagnostics: readonly ContextWorkflowDiagnostic[],
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): Promise<ContextWorkflowDiagnostic[]> {
  return Promise.all(diagnostics.map(async (diagnostic) => {
    try {
      const located = await locateCode(provider, diagnostic.code);
      if (located.document === undefined) return diagnostic;
      return {
        ...diagnostic,
        details_resource: projectWorkflowResourceLocation(
          located.document,
          revision,
          authorities,
          resourceReceiptsReference,
        ),
      };
    } catch {
      return diagnostic;
    }
  }));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function authorityCommandOptions(
  authorities: readonly ContextWorkflowAuthority[],
  kind: "workflow" | "resource",
): string {
  const managedAuthorities = contextWorkflowAuthorities({ managed: true });
  const managed = managedAuthorities.every((authority) =>
    authorities.includes(authority)
  );
  const explicitAuthorities = managed
    ? authorities.filter((authority) => !managedAuthorities.includes(authority))
    : authorities;
  const managedOption = managed
    ? kind === "workflow" ? " --workflow-managed" : " --managed"
    : "";
  const authorityFlag = kind === "workflow"
    ? "--workflow-authority"
    : "--authority";
  return `${managedOption}${explicitAuthorities
    .map((authority) => ` ${authorityFlag} ${shellQuote(authority)}`)
    .join("")}`;
}

function bindCommandToRevision(
  item: ContextWorkflowCommand,
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): ContextWorkflowCommand {
  if (!item.command.startsWith("context ")) {
    throw new Error(
      `Context workflow write command must use the Context CLI: ${item.command}`,
    );
  }
  const authorityOptions = authorityCommandOptions(authorities, "workflow");
  const receiptOption = resourceReceiptsReference === undefined
    ? ""
    : ` --workflow-resource-receipts ${shellQuote(resourceReceiptsReference)}`;
  return {
    ...item,
    command: `context --workflow-revision ${shellQuote(revision)}${authorityOptions}${receiptOption} ${item.command.slice("context ".length)}`,
  };
}

function projectCommandExecution(
  item: ContextWorkflowCommand,
): ContextWorkflowCommand {
  return item.effect === "external"
    ? { ...item, execution: { ...item.execution, target: "agent-host" } }
    : item;
}

function resourceMaterializeCommand(
  resourceId: string,
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): string {
  const authorityOptions = authorityCommandOptions(authorities, "resource");
  const receiptOption = resourceReceiptsReference === undefined
    ? ""
    : ` --resource-receipts ${shellQuote(resourceReceiptsReference)}`;
  return `context resource materialize ${shellQuote(resourceId)} --revision ${shellQuote(revision)}${authorityOptions}${receiptOption} --format json`;
}

function resourceAcknowledgeCommand(
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): string {
  const authorityOptions = authorityCommandOptions(authorities, "resource");
  const receiptOption = resourceReceiptsReference === undefined
    ? ""
    : ` --resource-receipts ${shellQuote(resourceReceiptsReference)}`;
  return `context resource acknowledge-current --revision ${shellQuote(revision)}${authorityOptions}${receiptOption} --format json`;
}

function sourceReadResumeCommand(
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): ContextWorkflowCommand {
  const managedAuthorities = contextWorkflowAuthorities({ managed: true });
  const managed = managedAuthorities.every((authority) =>
    authorities.includes(authority)
  );
  const resumedAuthorities = contextWorkflowAuthorities({
    authorities: [...authorities, CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
  });
  return {
    command: managed
      ? `context${resourceReceiptsReference === undefined ? "" : ` --workflow-resource-receipts ${shellQuote(resourceReceiptsReference)}`} run${authorityCommandOptions(resumedAuthorities, "resource")} --until blocked-or-complete --format json`
      : `context status${authorityCommandOptions(resumedAuthorities, "resource")}${resourceReceiptsReference === undefined ? "" : ` --resource-receipts ${shellQuote(resourceReceiptsReference)}`} --format json`,
    effect: managed ? "external" : "read",
    availability: "after-human-confirmation",
    managed_execution: "agent-required",
  };
}

export function projectWorkflowResourceLocation(
  location: ContextWorkflowResourceLocation,
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): ContextResolvedWorkflowRoute["resources"]["required"][number] {
  const projected = {
    id: location.id,
    kind: location.kind,
    media_type: location.mediaType,
    ...(location.revision === undefined ? {} : { revision: location.revision }),
    read_state: location.readState ?? "read-required",
  };
  if (location.schema === "agent-graph.resource-location.host-action.v1") {
    return {
      ...projected,
      materialize: {
        handler: location.materialize.handler,
        input: {
          schema: location.materialize.input.schema,
          value: location.materialize.input.value,
        },
        output_schema: location.materialize.output_schema,
      },
    };
  }
  return {
    ...projected,
    ...(location.digest === undefined ? {} : { digest: location.digest }),
    ...(location.filePath === undefined ? {} : { path: location.filePath }),
    ...(!("materialize" in location)
      ? {}
      : {
          command: resourceMaterializeCommand(
            location.materialize.resourceId,
            revision,
            authorities,
            resourceReceiptsReference,
          ),
        }),
  };
}

function projectActionResources(
  action: ContextWorkflowRouteActionSource,
  revision: string,
  authorities: readonly ContextWorkflowAuthority[],
  resourceReceiptsReference?: string,
): {
  skill?: ContextWorkflowResource;
  input_schema?: ContextWorkflowResource;
  output_schema?: ContextWorkflowResource;
} {
  return {
    ...(action.skill === undefined
      ? {}
      : {
          skill: projectWorkflowResourceLocation(
            action.skill,
            revision,
            authorities,
            resourceReceiptsReference,
          ),
        }),
    ...(action.inputSchema === undefined
      ? {}
      : {
          input_schema: projectWorkflowResourceLocation(
            action.inputSchema,
            revision,
            authorities,
            resourceReceiptsReference,
          ),
        }),
    ...(action.outputSchema === undefined
      ? {}
      : {
          output_schema: projectWorkflowResourceLocation(
            action.outputSchema,
            revision,
            authorities,
            resourceReceiptsReference,
          ),
        }),
  };
}

function projectStructureBatch(input: {
  node: string;
  revision: string;
  authorities: readonly ContextWorkflowAuthority[];
  observation: ContextWorkflowObservation;
  inputSchema: ResourceLocation | undefined;
  resourceReceiptsReference?: string;
}): ContextResolvedWorkflowRoute["batch"] | undefined {
  if (
    input.node !== "align-next" ||
    input.inputSchema === undefined ||
    input.observation.pendingStructureTargets.length <= 1 ||
    input.observation.pendingStructureTargets.some((target) => target.configurationGaps.length > 0)
  ) {
    return undefined;
  }
  const managedAuthorities = contextWorkflowAuthorities({ managed: true });
  const managed = managedAuthorities.every((authority) => input.authorities.includes(authority));
  return {
    kind: "prose-structure",
    schema: "context.prose.structure-batch.v1",
    input_schema: projectWorkflowResourceLocation(
      input.inputSchema,
      input.revision,
      input.authorities,
      input.resourceReceiptsReference,
    ),
    input: ".tmp/agent-payloads/prose-structure-batch.yaml",
    targets: input.observation.pendingStructureTargets.map((target) => ({
      phase_id: target.alignPhaseId,
      source_key: target.sourceKey,
      collection: target.collection,
      input: target.payloadTarget,
    })),
    validate: bindCommandToRevision({
      command: "context run --batch-input .tmp/agent-payloads/prose-structure-batch.yaml --validate --format json",
      effect: "read",
      availability: "immediate",
      managed_execution: "agent-required",
    }, input.revision, input.authorities, input.resourceReceiptsReference),
    stage: bindCommandToRevision({
      command: `context run --batch-input .tmp/agent-payloads/prose-structure-batch.yaml --stage${managed ? " --managed" : ""} --format json`,
      effect: "write",
      availability: "immediate",
      managed_execution: "agent-required",
    }, input.revision, input.authorities, input.resourceReceiptsReference),
  };
}

export function projectWorkflowRouteAction(input: {
  action: ContextWorkflowRouteActionSource | undefined;
  node: string;
  hasStructureBatch: boolean;
  revision: string;
  authorities: readonly ContextWorkflowAuthority[];
  resourceReceiptsReference?: string;
}): ContextResolvedWorkflowRoute["action"] | undefined {
  if (input.action === undefined) return undefined;
  const resources = projectActionResources(
    input.action,
    input.revision,
    input.authorities,
    input.resourceReceiptsReference,
  );
  if (input.node === "align-next" && !input.hasStructureBatch) {
    delete resources.input_schema;
  }
  return {
    id: input.action.id,
    runner: input.action.runner,
    effect: input.action.effect,
    ...(input.action.handler === undefined ? {} : { handler: input.action.handler }),
    ...(input.action.input === undefined ? {} : { input: input.action.input }),
    ...resources,
  };
}

function requireAgentPayload(
  plan: ReturnType<typeof planForResolvedCommandPlan>,
  inputSchema: ResourceLocation | undefined,
): ReturnType<typeof planForResolvedCommandPlan> {
  if (inputSchema === undefined) return plan;
  return {
    ...plan,
    commands: plan.commands.map((item) => ({
      ...item,
      managed_execution: "agent-required" as const,
    })),
  };
}

function optionalActionPlan(
  action: {
    commandPlan: Route["commandPlan"];
    action: { inputSchema?: ResourceLocation };
  } | undefined,
  observation: ContextWorkflowObservation,
): ReturnType<typeof planForResolvedCommandPlan> {
  if (action === undefined) return { commands: [] };
  return requireAgentPayload(
    planForResolvedCommandPlan(action.commandPlan, observation),
    action.action.inputSchema,
  );
}

async function resolveContextRoute(
  provider: LoadedProvider,
  evaluation: ReturnType<typeof evaluateGraph>["evaluation"],
  facts: ContextWorkflowSnapshot["facts"],
  authorities: readonly ContextWorkflowAuthority[],
  observation: ContextWorkflowObservation,
  resourceReceipts?: ResourceReadReceiptSet,
  resourceReceiptsReference?: string,
): Promise<ContextResolvedWorkflowRoute | undefined> {
  const summary = evaluation.primaryRoute;
  if (summary === undefined) return undefined;
  const route = await resolveRoute(
    provider,
    CONTEXT_WORKFLOW_GRAPH_ID,
    CONTEXT_WORKFLOW_ENTRY,
    summary.routeId,
    {
      facts,
      authorities: [...authorities],
      workspace: observation.projectRoot,
      ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
    },
    evaluation.revision,
  );
  const hostPlan = requireAgentPayload(
    planForResolvedCommandPlan(route.commandPlan, observation),
    route.action?.inputSchema,
  );
  const inspectionAction = route.gate?.inspectionAction;
  const inspectionRouteAction = inspectionAction?.action as
    | ContextWorkflowRouteActionSource
    | undefined;
  if (
    inspectionAction !== undefined &&
    inspectionAction.action.effect !== "read"
  ) {
    throw new Error(
      `Context Gate inspection Action must be read-only: ${inspectionAction.action.id}`,
    );
  }
  const inspectionPlan = optionalActionPlan(inspectionAction, observation);
  const resolutionAction = route.gate?.resolutionAction;
  const resolutionRouteAction = resolutionAction?.action as
    | ContextWorkflowRouteActionSource
    | undefined;
  if (resolutionAction?.action.effect === "read") {
    throw new Error(
      `Context Gate resolution Action must mutate observable state: ${resolutionAction.action.id}`,
    );
  }
  const resolutionPlan = optionalActionPlan(resolutionAction, observation);
  const resolutionAvailability: ContextWorkflowCommand["availability"] =
    route.availability === "requires-user"
      ? "after-human-confirmation"
      : "immediate";
  const routeCommands = [
    ...hostPlan.commands,
    ...inspectionPlan.commands,
    ...resolutionPlan.commands.map((item) => ({
      ...item,
      availability: resolutionAvailability,
    })),
  ];
  const commands = routeCommands.map((item) =>
    bindCommandToRevision(
      item,
      route.revision,
      authorities,
      resourceReceiptsReference,
    )
  );
  const structureBatch = projectStructureBatch({
    node: route.node,
    revision: route.revision,
    authorities,
    observation,
    inputSchema: route.action?.inputSchema,
    ...(resourceReceiptsReference === undefined ? {} : { resourceReceiptsReference }),
  });
  if (
    route.node === "authorize-document-capture" &&
    route.availability === "requires-user" &&
    route.gate?.authority === CONTEXT_WORKFLOW_AUTHORITIES.sourceRead &&
    commands.length === 0
  ) {
    commands.push(sourceReadResumeCommand(
      authorities,
      resourceReceiptsReference,
    ));
  }
  const projectedCommands = commands.map(projectCommandExecution);
  const requiredResources = [...new Map(
    route.resources.required.map((location) => [location.id, location]),
  ).values()].map((location) =>
    projectWorkflowResourceLocation(
      location,
      route.revision,
      authorities,
      resourceReceiptsReference,
    )
  );
  const sourceBodyResources = await currentSourceBodyResources({
    node: route.node,
    observation,
    ...(resourceReceipts === undefined
      ? {}
      : { receipts: resourceReceipts }),
  });
  const projectedRequiredResources = [
    ...requiredResources,
    ...sourceBodyResources,
  ];
  const directReadCount = projectedRequiredResources.filter((resource) =>
    resource.read_state === "read-required" &&
    resource.path !== undefined &&
    resource.digest !== undefined
  ).length;
  const projectedAction = projectWorkflowRouteAction({
    action: route.action,
    node: route.node,
    hasStructureBatch: structureBatch !== undefined,
    revision: route.revision,
    authorities,
    ...(resourceReceiptsReference === undefined ? {} : { resourceReceiptsReference }),
  });
  const projected: ContextResolvedWorkflowRoute = {
    protocol: "context.workflow.route.v1",
    id: route.routeId,
    revision: route.revision,
    node: route.node,
    reason_code: route.reasonCode,
    ...(route.hint === undefined ? {} : { summary: route.hint }),
    availability: route.availability,
    commands: projectedCommands,
    ...(projectedAction === undefined
      ? {}
      : { action: projectedAction }),
    ...(structureBatch === undefined ? {} : { batch: structureBatch }),
    ...(hostPlan.configuration === undefined
      ? {}
      : { configuration: hostPlan.configuration }),
    resources: {
      required: projectedRequiredResources,
      recommended: route.resources.recommended.map((location) =>
        projectWorkflowResourceLocation(
          location,
          route.revision,
          authorities,
          resourceReceiptsReference,
        )
      ),
      ...(directReadCount === 0
        ? {}
        : {
            after_read: {
              required_count: directReadCount,
              command: resourceAcknowledgeCommand(
                route.revision,
                authorities,
                resourceReceiptsReference,
              ),
            },
          }),
    },
    ...(route.gate === undefined
      ? {}
      : {
          gate: {
            id: route.gate.id,
            ...(route.gate.authority === undefined
              ? {}
              : { authority: route.gate.authority }),
            delegatable: route.gate.delegatable === true,
            resolution: route.gate.resolution,
            ...(inspectionRouteAction === undefined
              ? {}
              : {
                  inspection_action: {
                    id: inspectionRouteAction.id,
                    runner: inspectionRouteAction.runner,
                    effect: "read" as const,
                    ...(inspectionRouteAction.handler === undefined
                      ? {}
                      : { handler: inspectionRouteAction.handler }),
                    ...projectActionResources(
                      inspectionRouteAction,
                      route.revision,
                      authorities,
                      resourceReceiptsReference,
                    ),
                  },
                }),
            ...(resolutionRouteAction === undefined
              ? {}
              : {
                  resolution_action: {
                    id: resolutionRouteAction.id,
                    runner: resolutionRouteAction.runner,
                    effect: resolutionRouteAction.effect as "write" | "external",
                    ...(resolutionRouteAction.handler === undefined
                      ? {}
                      : { handler: resolutionRouteAction.handler }),
                    ...projectActionResources(
                      resolutionRouteAction,
                      route.revision,
                      authorities,
                      resourceReceiptsReference,
                    ),
                  },
                }),
          },
        }),
    after_action: { evaluate: true },
  };
  return projected;
}

export async function evaluateContextWorkflow(input: {
  observation: ContextWorkflowObservation;
  authorities: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
}): Promise<ContextWorkflowSnapshot> {
  const provider = await loadContextWorkflowProvider();
  const facts = createContextWorkflowFacts(input.observation, input.authorities);
  const evaluated = evaluateGraph(
    provider,
    CONTEXT_WORKFLOW_GRAPH_ID,
    CONTEXT_WORKFLOW_ENTRY,
    {
      facts,
      authorities: [...input.authorities],
      workspace: input.observation.projectRoot,
      ...(input.resourceReceipts === undefined
        ? {}
        : { resourceReceipts: input.resourceReceipts }),
    },
  );
  const root = await attachDiagnosticResources(
    provider,
    rootDiagnostics(input.observation),
    evaluated.evaluation.revision,
    input.authorities,
    input.resourceReceiptsReference,
  );
  const evaluation = {
    ...evaluated.evaluation,
    diagnostics: [
      ...evaluated.evaluation.diagnostics,
      ...agentGraphDiagnostics(root),
    ],
  };
  await validateSchema("evaluation", evaluation, "context workflow evaluation");
  const route = await resolveContextRoute(
    provider,
    evaluation,
    facts,
    input.authorities,
    input.observation,
    input.resourceReceipts,
    input.resourceReceiptsReference,
  );
  return {
    observation: input.observation,
    authorities: [...input.authorities],
    facts,
    evaluation,
    ...(route === undefined ? {} : { route }),
    rootDiagnostics: root,
    ...(input.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: input.resourceReceipts }),
  };
}

export function projectContextWorkflowStatus(
  snapshot: ContextWorkflowSnapshot,
): ContextWorkflowStatus {
  return {
    protocol: "context.workflow.status.v1",
    revision: snapshot.evaluation.revision,
    status: snapshot.evaluation.statusCode,
    ...(snapshot.route === undefined ? {} : { current: snapshot.route }),
    alternatives: snapshot.evaluation.alternativeRoutes.map((route) => ({
      id: route.routeId,
      node: route.node,
      reason_code: route.reasonCode,
      availability: route.availability,
    })),
    diagnostics: snapshot.rootDiagnostics,
  };
}
