import { productionRequirementsAreCurrent } from "./productionPlanning.js";
import { readTaskPreparation } from "./taskResumption.js";
import { readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { observeApprovedRevisionBatch } from "./approvedRevisionBatch.js";
import { readRevisionDelivery } from "./revisionDelivery.js";
import { assertPreparationComplete } from "./workspacePreparation.js";
import { join } from "node:path";
import type { ResourceReadReceiptSet } from "@c4a/agent-graph";
import { KNOWLEDGE_COLLECTIONS } from "@c4a/context";
import {
  countFiles,
  loadStatusPhases,
  readCloseStatus,
  readDraftCandidateStatus,
  readPackageFreshnessStatus,
  readSourceStatus,
  readVerifyStatus,
} from "./statusReaders.js";
import { evidenceStatusForStatus, evidenceWarningState } from "./statusEvidence.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { inspectPackageTemplateReviews } from "./packageTemplateReview.js";
import type { ProjectStatus } from "./statusTypes.js";
import {
  evaluateContextWorkflow,
  projectContextWorkflowStatus,
} from "./workflow/workflowProvider.js";
import { contextWorkflowAuthorities } from "./workflow/workflowFacts.js";
import { withContentAddressedWorkflowResources } from "./workflow/workflowResourceFreshness.js";
import type {
  ContextWorkflowAuthority,
  ContextWorkflowObservation,
} from "./workflow/workflowTypes.js";
import { verifyErrorsAreCloseRepairable } from "./workflow/verifyFacts.js";
import { projectWorkflowRoute } from "./workflow/workflowStatusProjection.js";
import { compactProjectVerifyDiagnostics } from "./verifyDiagnostics.js";
import {
  measureContextDebugOperation,
  recordAgentGraphEvaluation,
  recordContextDebugPerformance,
} from "./debugTrace.js";
import { observeContextRuntimeEventDelivery } from "../runtimeEvents.js";
import { inspectWorkspaceVersion } from "./workspaceChangelog.js";
import {
  pendingDocumentCaptureCommands,
} from "./statusRouting.js";
import { projectCurrentIndexerWorkflowRoute } from "./indexerCurrentWorkflowRoute.js";
import { readProductionStage } from "./productionStageStore.js";
import { dispatchProductionStage, productionCapabilitiesSchema } from "./productionStage.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";

export {
  pendingDocumentCaptureCommands,
} from "./statusRouting.js";

export type {
  DocumentSourceStatus,
  EvidenceStatus,
  EvidenceWarningState,
  HumanGateKind,
  ProjectRouting,
  ProjectRoutingCommand,
  ProjectStatus,
} from "./statusTypes.js";

export interface ProjectStatusSnapshot {
  status: ProjectStatus;
  observation: ContextWorkflowObservation;
  authorities: ContextWorkflowAuthority[];
}

type CollectProjectStatusOptions = {
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
};

async function recordWorkflowEvaluation(
  projectRoot: string,
  workflow: ProjectStatus["workflow"],
): Promise<void> {
  const current = workflow.current;
  await recordAgentGraphEvaluation({
    projectRoot,
    revision: workflow.revision,
    status: workflow.status,
    ...(current === undefined
      ? {}
      : {
          route: {
            id: current.id,
            node: current.node,
            reasonCode: current.reason_code,
            availability: current.availability,
            ...(current.commands[0] === undefined
              ? {}
              : { command: current.commands[0].command }),
          },
        }),
    alternatives: workflow.alternatives.map((route) => ({
      id: route.id,
      node: route.node,
      reasonCode: route.reason_code,
      availability: route.availability,
    })),
  });
}

async function collectProjectStatusSnapshotInternal(
  projectRoot: string,
  options: CollectProjectStatusOptions = {},
): Promise<ProjectStatusSnapshot> {
  await assertPreparationComplete(projectRoot);
  const authorities = contextWorkflowAuthorities({
    managed: options.managed === true,
    ...(options.authorities === undefined ? {} : { authorities: options.authorities }),
  });
  const sourceStatus = await readSourceStatus(projectRoot);
  const { sources, sourceStatuses, documentSources } = sourceStatus;
  const phaseStatus = await loadStatusPhases(projectRoot);
  const { phases, packages } = phaseStatus;
  const readyRepoSources = sourceStatuses.filter((source) => source.ready).length;
  const capturedDocumentSources = documentSources.filter((source) => source.snapshotReady).length;
  const readySources = readyRepoSources + capturedDocumentSources;
  const draftStatus = await readDraftCandidateStatus(projectRoot);
  const collectionsWithPages = new Set<string>();
  const approvedPages = await countFiles(
    join(projectRoot, "knowledge"),
    (rel) => {
      if (!isApprovedKnowledgeMarkdownPath(rel) || rel.startsWith("assets/")) return false;
      collectionsWithPages.add(rel.split("/")[0]!);
      return true;
    },
  );
  const approvedCollections = KNOWLEDGE_COLLECTIONS.filter((collection) => collectionsWithPages.has(collection));
  const closeStatus = await readCloseStatus(projectRoot);
  const distFiles = await countFiles(join(projectRoot, "dist"), () => true);
  const verifyStatus = draftStatus.diagnostics.length === 0
    ? await readVerifyStatus(projectRoot)
    : { issues: [], diagnostics: [] };
  const pendingCapture = pendingDocumentCaptureCommands({
    phases,
    documentSources,
  });
  const packageFreshnessStatus = phaseStatus.projectEntryValid
    ? await readPackageFreshnessStatus(projectRoot, packages)
    : { packages: [], diagnostics: [] };
  const packageFreshness = packageFreshnessStatus.packages;
  const packageTemplateReviews = phaseStatus.projectEntryValid
    ? await inspectPackageTemplateReviews(projectRoot, packages)
    : [];
  const rawVerifyErrors = verifyStatus.issues.filter((issue) => issue.severity === "error").length;
  const projectionRefreshIssues = closeStatus.state === "stale" &&
      verifyErrorsAreCloseRepairable(verifyStatus.issues)
    ? rawVerifyErrors
    : 0;
  const verifyErrors = rawVerifyErrors - projectionRefreshIssues;
  const verifyWarnings = verifyStatus.issues.filter((issue) => issue.severity === "warning").length;
  const evidenceStatus = evidenceStatusForStatus({ verifyErrors, verifyWarnings });
  const evidenceWarnings = evidenceWarningState(verifyStatus.issues);
  const runtimeEvents = observeContextRuntimeEventDelivery(projectRoot);
  const production = await readProductionStage(projectRoot);
  // There is only one production protocol. Missing current state never
  // falls back to a Provider registry or a retired production ledger.
  const indexerRegistry: ContextWorkflowObservation["indexerRegistry"] = { state: "missing", sourceRefs: [] };
  const localRevision = await readApprovedRevision(projectRoot);
  const localUpdate = localRevision ? undefined : await readKnowledgeUpdate(projectRoot);
  const { readTaskRollback } = await import("./taskRollback.js");
  const localRollback = await readTaskRollback(projectRoot);
  const indexerCandidateCompile: {
    state: "missing" | "current" | "stale" | "invalid";
    candidates: CandidateRecord[];
    rollback_pending?: boolean;
    revision_pending?: boolean;
    diagnostic?: string;
  } = localRevision
    ? await observeApprovedRevisionBatch(projectRoot, localRevision)
    : localRollback ? { state: "current", candidates: [], rollback_pending: true }
    : localUpdate ? { state: "missing", candidates: [], revision_pending: true }
    : { state: "missing", candidates: [] };
  const productionCandidates = await readCandidateRecords(projectRoot);
  // Revision delivery remains a temporary checkpoint even with the new
  // requirements protocol. It must not be hidden by the absence of a stage.
  const indexerDelivery = production || !localRevision
    ? undefined : await readRevisionDelivery(projectRoot);
  const indexerDrafts = productionCandidates.filter(candidate => candidate.status === "draft");
  const indexerRejected = productionCandidates.filter(candidate => candidate.status === "rejected");
  const draftCollections = [...new Set(indexerDrafts.map((candidate) => candidate.collection))].sort();
  const { readMaintenance } = await import("./maintenanceStorage.js");
  const maintenance = (await readMaintenance(projectRoot)).active;
  // Output-only maintenance owns this evaluation; an unfinished production
  // ledger must not hide package configuration/Review recovery gates.
  const maintenanceOutputOnly = maintenance?.input.operation === "rebuild" || maintenance?.phase === "finishing" ||
    (maintenance?.phase === "cancelling" && indexerDrafts.length === 0);
  // An explicitly prepared revision/update is a new task, not a request to
  // restore the production that previously cleared its temporary workspace.
  const taskPreparation = localRevision || localUpdate ? undefined : await readTaskPreparation(projectRoot);
  const observation: ContextWorkflowObservation = {
    versionCurrent: phaseStatus.projectEntryValid ? (await inspectWorkspaceVersion(projectRoot)).current : false,
    taskPreparation,
    localRevisionActive: !!localRevision || !!localUpdate,
    unfinishedIndexerTasks: false,
    ...(production ? { productionState: await productionRequirementsAreCurrent(projectRoot, production)
      ? dispatchProductionStage(production, productionCapabilitiesSchema.parse({})).state : "active" as const,
      productionDelivery: !!production.delivery && await productionRequirementsAreCurrent(projectRoot, production) } : {}),
    projectRoot,
    projectEntryValid: phaseStatus.projectEntryValid,
    stateDiagnostics: [
      ...sourceStatus.diagnostics,
      ...packageFreshnessStatus.diagnostics,
      ...packageTemplateReviews.flatMap((review) =>
        review.diagnostic === undefined ? [] : [review.diagnostic]
      ),
      ...draftStatus.diagnostics,
      ...verifyStatus.diagnostics,
    ],
    sourceCount: sources.length + documentSources.length,
    repoSources: sources.map((source) => ({ id: source.id ?? source.name, name: source.name })),
    readyRepoSources,
    documentSources,
    capturedDocumentSources,
    phases,
    packages,
    packageFreshness,
    packageTemplateReviews,
    runtimeEvents,
    pendingCaptureCommands: pendingCapture.commands,
    missingCaptureSources: pendingCapture.missingSources,
    evidenceWarnings,
    verifyErrors,
    projectionRefreshIssues,
    verifyIssues: verifyStatus.issues,
    draftCandidates: indexerDrafts.length,
    rejectedCandidates: indexerRejected.length,
    draftCollections,
    ...(draftStatus.candidateSetDigest === undefined || indexerDrafts.length === 0
      ? {}
      : { candidateSetDigest: draftStatus.candidateSetDigest }),
    approvedPages,
    close: closeStatus,
    indexerRegistry,
    indexerCandidateCompile: { partial_delivery: indexerDelivery?.partial !== undefined, state: maintenanceOutputOnly ? "current" : indexerCandidateCompile.state,
      delivery_ready: !maintenanceOutputOnly && indexerDelivery?.partial !== undefined,
      maintenance_output_only: maintenanceOutputOnly,
      ...(indexerCandidateCompile.rollback_pending ? { rollback_pending: true } : {}),
      ...(!maintenanceOutputOnly && indexerCandidateCompile.revision_pending ? { revision_pending: true } : {}),
      ...(maintenanceOutputOnly || indexerDelivery === undefined ? {} : { delivery_pending: true }) },
  };
  const workflowSnapshot = await evaluateContextWorkflow({
    observation,
    authorities,
    ...(options.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: options.resourceReceipts }),
    ...(options.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: options.resourceReceiptsReference }),
  });
  const statusProjectionStarted = performance.now();
  const baseWorkflow = projectContextWorkflowStatus(workflowSnapshot);
  const currentRoute = await projectCurrentIndexerWorkflowRoute({
      projectRoot,
      route: baseWorkflow.current,
      authorities,
      managed: options.managed === true,
    });
  const workflow = {
    ...baseWorkflow,
    ...(currentRoute === undefined ? {} : { current: currentRoute }),
    ...(currentRoute === undefined ? {} : { revision: currentRoute.revision }),
    ...(currentRoute?.node === "advance-knowledge-maintenance" ? { status: "actionable" as const } : {}),
    ...(currentRoute?.reason_code.startsWith("route.production.") ? { status: currentRoute.availability === "requires-user"
      ? "waiting-user" as const : currentRoute.availability === "blocked" ? "blocked" as const : "actionable" as const } : {}),
  };
  await recordWorkflowEvaluation(projectRoot, workflow);
  const routeProjection = projectWorkflowRoute({
    workflow,
    observation: workflowSnapshot.observation,
  });
  const status: ProjectStatus = {
    projectRoot,
    sourceCount: observation.sourceCount,
    readySources,
    draftCandidates: indexerDrafts.length,
    approvedPages,
    approvedCollections,
    distFiles,
    ...routeProjection,
    ...(options.managed === true
      ? { executionMode: { mode: "managed" as const, scope: "current-conversation" as const } }
      : {}),
    workflow,
    sourceSummary: {
      repo: { total: sourceStatuses.length, ready: readyRepoSources },
      document: { total: documentSources.length, captured: capturedDocumentSources },
      total: observation.sourceCount,
      ready: readySources,
    },
    sources: sourceStatuses,
    documentSources,
    phases: phases.map((phase) => phase.id),
    packages: packageFreshness,
    packageTemplateReviews,
    pendingCapturePhases: pendingCapture.phaseIds,
    evidenceStatus,
    evidenceWarnings,
    close: closeStatus,
    indexerRegistry: { state: indexerRegistry.state },
    indexerCandidateCompile: { state: indexerCandidateCompile.state,
      ...(indexerCandidateCompile.rollback_pending ? { rollback_pending: true } : {}),
      ...(indexerCandidateCompile.revision_pending ? { revision_pending: true } : {}),
      ...(indexerDelivery === undefined ? {} : { delivery_pending: true }) },
    packageCount: packages.length,
    verifyErrors,
    verifyWarnings,
    projectionRefreshIssues,
    diagnostics: [
      ...phaseStatus.diagnostics,
      ...sourceStatus.diagnostics,
      ...packageFreshnessStatus.diagnostics,
      ...closeStatus.diagnostics,
      ...draftStatus.diagnostics,
      ...(indexerCandidateCompile.state === "invalid" &&
          indexerCandidateCompile.diagnostic !== undefined
        ? [`Indexer Candidate compile invalid: ${indexerCandidateCompile.diagnostic}`]
        : []),
      ...verifyStatus.diagnostics,
      ...(projectionRefreshIssues > 0
        ? [`verify info approved-projection-stale: ${projectionRefreshIssues} derived projection issue(s) will be rebuilt by context close`]
        : compactProjectVerifyDiagnostics(verifyStatus.issues)),
    ],
  };
  const projectedStatus = withContentAddressedWorkflowResources(
    status,
    options.resourceReceipts,
  );
  await recordContextDebugPerformance({
    projectRoot,
    operation: "status.projection",
    durationMs: performance.now() - statusProjectionStarted,
    outcome: "success",
    counters: { status_projection_count: 1 },
  });
  return {
    status: projectedStatus,
    observation,
    authorities,
  };
}

export async function collectProjectStatusSnapshot(
  projectRoot: string,
  options: CollectProjectStatusOptions = {},
): Promise<ProjectStatusSnapshot> {
  return withCommandReadCache(() => measureContextDebugOperation({
    projectRoot,
    operation: "status.snapshot-build",
    counters: { status_rebuild_count: 1 },
  }, () => collectProjectStatusSnapshotInternal(projectRoot, options)));
}

export async function reevaluateProjectStatusWorkflow(input: {
  snapshot: ProjectStatusSnapshot;
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
}): Promise<ProjectStatus> {
  const workflowSnapshot = await evaluateContextWorkflow({
    observation: input.snapshot.observation,
    authorities: input.snapshot.authorities,
    ...(input.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: input.resourceReceipts }),
    ...(input.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: input.resourceReceiptsReference }),
  });
  const statusProjectionStarted = performance.now();
  const baseWorkflow = projectContextWorkflowStatus(workflowSnapshot);
  const currentRoute = await projectCurrentIndexerWorkflowRoute({
      projectRoot: input.snapshot.observation.projectRoot,
      route: baseWorkflow.current,
      authorities: input.snapshot.authorities,
      managed: contextWorkflowAuthorities({ managed: true }).every((authority) =>
        input.snapshot.authorities.includes(authority)
      ),
    });
  const workflow = {
    ...baseWorkflow,
    ...(currentRoute === undefined ? {} : { current: currentRoute }),
    ...(currentRoute === undefined ? {} : { revision: currentRoute.revision }),
    ...(currentRoute?.node === "advance-knowledge-maintenance" ? { status: "actionable" as const } : {}),
    ...(currentRoute?.reason_code.startsWith("route.production.") ? { status: currentRoute.availability === "requires-user"
      ? "waiting-user" as const : currentRoute.availability === "blocked" ? "blocked" as const : "actionable" as const } : {}),
  };
  await recordWorkflowEvaluation(input.snapshot.observation.projectRoot, workflow);
  const routeProjection = projectWorkflowRoute({
    workflow,
    observation: input.snapshot.observation,
  });
  const status = withContentAddressedWorkflowResources({
    ...input.snapshot.status,
    ...routeProjection,
    workflow,
  }, input.resourceReceipts);
  await recordContextDebugPerformance({
    projectRoot: input.snapshot.observation.projectRoot,
    operation: "status.projection",
    durationMs: performance.now() - statusProjectionStarted,
    outcome: "success",
    counters: { status_projection_count: 1 },
    data: { reuse_observation: true },
  });
  return status;
}

export async function collectProjectStatus(
  projectRoot: string,
  options: CollectProjectStatusOptions = {},
): Promise<ProjectStatus> {
  return (await collectProjectStatusSnapshot(projectRoot, options)).status;
}
import { withCommandReadCache } from "./commandReadCache.js";
