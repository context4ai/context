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
import { legacyCodeIndexMigrationRequired } from "./codeIndexMigration.js";
import { readProjectIndexerCandidateCompileStatus } from "./indexerCandidateCompileActions.js";
import {
  pendingDocumentCaptureCommands,
  readIndexerWorkflowRegistryStatus,
  resourcePlaceholderRepairTargets,
} from "./statusRouting.js";
import { projectCurrentIndexerWorkflowRoute } from "./indexerCurrentWorkflowRoute.js";
import { currentIndexerProgress } from "./indexerCurrentProgress.js";

export {
  pendingDocumentCaptureCommands,
  resourcePlaceholderRepairTargets,
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
  const approvedPages = await countFiles(
    join(projectRoot, "knowledge"),
    (rel) => isApprovedKnowledgeMarkdownPath(rel) && !rel.startsWith("assets/"),
  );
  const approvedCollections = (await Promise.all(
    KNOWLEDGE_COLLECTIONS.map(async (collection) => ({
      collection,
      count: await countFiles(
        join(projectRoot, "knowledge", collection),
        (rel) => isApprovedKnowledgeMarkdownPath(rel),
      ),
    })),
  )).filter((item) => item.count > 0).map((item) => item.collection);
  const closeStatus = await readCloseStatus(projectRoot);
  const distFiles = await countFiles(join(projectRoot, "dist"), () => true);
  const verifyStatus = draftStatus.diagnostics.length === 0
    ? await readVerifyStatus(projectRoot)
    : { issues: [], diagnostics: [] };
  const resourceRepair = resourcePlaceholderRepairTargets(verifyStatus.issues);
  const pendingCapture = pendingDocumentCaptureCommands({
    phases,
    documentSources,
    recaptureSourceKeys: resourceRepair.sourceKeys,
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
  const indexerRegistry = await readIndexerWorkflowRegistryStatus(projectRoot);
  const indexerCandidateCompile = await readProjectIndexerCandidateCompileStatus(projectRoot);
  const indexerDrafts = indexerCandidateCompile.state === "current"
    ? indexerCandidateCompile.candidates.filter((candidate) => candidate.status === "draft")
    : [];
  const indexerRejected = indexerCandidateCompile.state === "current"
    ? indexerCandidateCompile.candidates.filter((candidate) => candidate.status === "rejected")
    : [];
  const draftCollections = [...new Set(indexerDrafts.map((candidate) => candidate.collection))].sort();
  const codeIndexMigrationRequired = phaseStatus.projectEntryValid
    ? await legacyCodeIndexMigrationRequired(projectRoot)
    : false;
  const observation: ContextWorkflowObservation = {
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
    indexerCandidateCompile: { state: indexerCandidateCompile.state },
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
  };
  const indexerProgress = await currentIndexerProgress({
    projectRoot,
    ...(currentRoute === undefined ? {} : { route: currentRoute }),
  });
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
    codeIndexMigrationRequired,
    indexerRegistry: { state: indexerRegistry.state },
    indexerCandidateCompile: { state: indexerCandidateCompile.state },
    ...(indexerProgress === undefined ? {} : { indexerProgress }),
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
      ...(indexerRegistry.diagnostic === undefined ? [] : [indexerRegistry.diagnostic]),
      ...(indexerCandidateCompile.state === "invalid" &&
          indexerCandidateCompile.diagnostic !== undefined
        ? [`Indexer Candidate compile invalid: ${indexerCandidateCompile.diagnostic}`]
        : []),
      ...verifyStatus.diagnostics,
      ...(codeIndexMigrationRequired
        ? ["Legacy code-index state is present; use the explicit context migrate codeindex command before authoring new knowledge."]
        : []),
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
  return measureContextDebugOperation({
    projectRoot,
    operation: "status.snapshot-build",
    counters: { status_rebuild_count: 1 },
  }, () => collectProjectStatusSnapshotInternal(projectRoot, options));
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
