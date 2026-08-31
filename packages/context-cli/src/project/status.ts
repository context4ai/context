import { join } from "node:path";
import type { ResourceReadReceiptSet } from "@c4a/agent-graph";
import { KNOWLEDGE_COLLECTIONS } from "@c4a/context";
import { inspectDeclarationGraph } from "./declarationGraph.js";
import {
  collectSourceFreshness,
  countFiles,
  loadStatusPhases,
  readCloseStatus,
  readDraftCandidateStatus,
  readPackageFreshnessStatus,
  readSourceStatus,
  readStructureDraftStatus,
  readVerifyStatus,
} from "./statusReaders.js";
import { evidenceStatusForStatus, evidenceWarningState } from "./statusEvidence.js";
import { readProseCompileBatchProgress } from "./proseCompileBatch.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { structureBatchStatus } from "./statusStructureBatch.js";
import {
  activeStructureGroups,
  readActiveStructuresStatus,
  stagedStructureGroups,
  structureTargets,
} from "./statusStructures.js";
import { inspectPackageTemplateReviews } from "./packageTemplateReview.js";
import type {
  PendingStructureTarget,
  ProjectStatus,
  UnclassifiedDocumentTarget,
} from "./statusTypes.js";
import {
  collectDocumentOptimizationStatus,
  disabledDocumentOptimizationStatus,
} from "./documentOptimization.js";
import { listApprovedKnowledge } from "./packageBuilder.js";
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
import { suggestedAlignPayloadPath } from "./proseAlignTypes.js";
import { readReviewPathIdentityConflicts } from "./reviewIdentityConflicts.js";
import {
  approvedStructureSourceInputKey,
  readApprovedStructureSourceInputs,
} from "./approvedStructureInputs.js";
import { compactProjectVerifyDiagnostics } from "./verifyDiagnostics.js";
import { recordAgentGraphEvaluation } from "./debugTrace.js";
import { observeContextRuntimeEventDelivery } from "../runtimeEvents.js";
import { readExtractionPreviewState } from "./extractionPreviewCache.js";
import { collectCodeIndexAuditStatus } from "./codeIndexAudit.js";
import { legacyCodeIndexMigrationRequired } from "./codeIndexMigration.js";
import { readProjectIndexerCandidateCompileStatus } from "./indexerCandidateCompileActions.js";
import { candidateSetHash } from "./reviewShared.js";
import { isIndexerApprovedKnowledgeMarkdown } from "./approvedKnowledgeMetadata.js";
import {
  alignStatusCommand,
  compileStatusRouting,
  pendingDocumentCaptureCommands,
  readIndexerWorkflowRegistryStatus,
  resolutionErrorMessage,
  resolveAlignPhaseRouting,
  resourcePlaceholderRepairTargets,
} from "./statusRouting.js";

export {
  pendingDocumentCaptureCommands,
  resourcePlaceholderRepairTargets,
} from "./statusRouting.js";

export type {
  ActiveStructuresStatus,
  AlignPhaseResolution,
  DocumentSourceStatus,
  EvidenceStatus,
  EvidenceWarningState,
  HumanGateKind,
  PendingStructureTarget,
  ProjectRouting,
  ProjectRoutingCommand,
  ProjectStatus,
  SourceFreshnessState,
  UnclassifiedDocumentTarget,
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

async function recordWorkflowEvaluation(projectRoot: string, workflow: ProjectStatus["workflow"]): Promise<void> {
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
            ...(current.commands[0] === undefined ? {} : { command: current.commands[0].command }),
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

export async function collectProjectStatusSnapshot(
  projectRoot: string,
  options: CollectProjectStatusOptions = {},
): Promise<ProjectStatusSnapshot> {
  const authorities = contextWorkflowAuthorities({
    managed: options.managed === true,
    ...(options.authorities === undefined
      ? {}
      : { authorities: options.authorities }),
  });
  const sourceStatus = await readSourceStatus(projectRoot);
  const sources = sourceStatus.sources;
  const sourceStatuses = sourceStatus.sourceStatuses;
  const documentSources = sourceStatus.documentSources;
  const phaseStatus = await loadStatusPhases(projectRoot);
  const phases = phaseStatus.phases;
  const packages = phaseStatus.packages;
  const readyRepoSources = sourceStatuses.filter((source) => source.ready).length;
  const capturedDocumentSources = documentSources.filter((source) => source.snapshotReady).length;
  const capturedSnapshotHashes = new Map<string, string>(documentSources.flatMap((source) =>
    source.snapshotReady && source.snapshotHash !== undefined
      ? [[`${source.type}:${source.name}`, source.snapshotHash] as const]
      : []
  ));
  const readySources = readyRepoSources + capturedDocumentSources;
  const draftStatus = await readDraftCandidateStatus(projectRoot);
  const stagedStructureStatus = readStructureDraftStatus(projectRoot);
  const activeStructures = await readActiveStructuresStatus(projectRoot, capturedSnapshotHashes);
  let approvedStructureInputDiagnostics: string[] = [];
  let approvedStructureInputs: Awaited<ReturnType<typeof readApprovedStructureSourceInputs>> = [];
  try {
    approvedStructureInputs = await readApprovedStructureSourceInputs(projectRoot);
  } catch (error) {
    approvedStructureInputDiagnostics = [resolutionErrorMessage(error)];
  }
  const declarationGraph = await inspectDeclarationGraph({ projectRoot, phases });
  const capturedSourceKeys = new Set(documentSources
    .filter((source) => source.snapshotReady)
    .map((source) => `${source.type}:${source.name}`));
  const alignedSourceKeys = new Set(declarationGraph.rows.map((row) => row.sourceKey));
  const unclassifiedDocumentTargets: UnclassifiedDocumentTarget[] = documentSources
    .filter((source) => source.snapshotReady)
    .map((source) => ({ sourceKey: `${source.type}:${source.name}`, source }))
    .filter(({ sourceKey }) => !alignedSourceKeys.has(sourceKey))
    .map(({ sourceKey, source }) => {
      const capturePhaseId = declarationGraph.resolvedPhases.find((phase) =>
        (phase.kind === "phase.capture.file" || phase.kind === "phase.capture.lark") && phase.sourceKey === sourceKey
      )?.phaseId ?? `capture:${source.type}:${source.name}`;
      return {
        sourceKey,
        capturePhaseId,
        command: `context run ${capturePhaseId} --view read-plan --format json`,
      };
    });
  const closedTargetKeys = approvedStructureInputs
    .filter((input) => capturedSnapshotHashes.get(input.source) === input.snapshot_hash)
    .map(approvedStructureSourceInputKey);
  const currentLifecycleTargetKeys = stagedStructureStatus.state === "confirmed" ||
      stagedStructureStatus.state === "frozen"
    ? structureTargets(stagedStructureStatus)
      .filter((target) =>
        stagedStructureStatus.evidenceSnapshotHash !== undefined &&
        capturedSnapshotHashes.get(target.sourceKey) === stagedStructureStatus.evidenceSnapshotHash
      )
      .map((target) => `${target.sourceKey}\u0000${target.collection}`)
    : [];
  const activeTargetKeys = new Set([
    ...activeStructures.slots
      .filter((slot) => slot.snapshotCurrent)
      .map((slot) => `${slot.sourceKey}\u0000${slot.collection}`),
    ...closedTargetKeys,
    ...currentLifecycleTargetKeys,
  ]);
  const stagedTargetKeys = new Set(stagedStructureStatus.state === "draft"
    ? structureTargets(stagedStructureStatus).map((target) => `${target.sourceKey}\u0000${target.collection}`)
    : []);
  const pendingStructureTargets: PendingStructureTarget[] = declarationGraph.rows
    .filter((row) => capturedSourceKeys.has(row.sourceKey))
    .filter((row) => !activeTargetKeys.has(`${row.sourceKey}\u0000${row.collection}`))
    .filter((row) => !stagedTargetKeys.has(`${row.sourceKey}\u0000${row.collection}`))
    .map((row) => {
      const alignPhase = declarationGraph.resolvedPhases.find((phase) =>
        phase.kind === "phase.align.prose" &&
        phase.sourceKey === row.sourceKey &&
        phase.collection === row.collection
      );
      return {
        sourceKey: row.sourceKey,
        collection: row.collection,
        alignPhaseId: alignPhase?.phaseId ?? `align:${row.sourceKey}:${row.collection}`,
        command: `context run ${alignPhase?.phaseId ?? `align:${row.sourceKey}:${row.collection}`} --view read-plan --format json`,
        payloadTarget: suggestedAlignPayloadPath(
          alignPhase?.phaseId ?? `align:${row.sourceKey}:${row.collection}`,
        ),
        configurationGaps: row.gaps.filter((gap): gap is "compile" | "review" => gap === "compile" || gap === "review"),
        suggestions: row.suggestions,
      };
    });
  const structureBatch = structureBatchStatus({
    activeStructures,
    unclassifiedTargets: unclassifiedDocumentTargets,
    pendingTargets: pendingStructureTargets,
  });
  const alignGroups = stagedStructureStatus.state === "draft"
    ? stagedStructureGroups(stagedStructureStatus)
    : [
        ...activeStructureGroups(activeStructures),
        ...pendingStructureTargets.map((target) => ({
          sourceKey: target.sourceKey,
          collections: [target.collection],
          phaseCollection: target.collection,
        })),
      ];
  const alignTargets = alignGroups.flatMap((group) =>
    (group.phaseCollection === undefined ? group.collections : [group.phaseCollection])
      .map((collection) => ({ sourceKey: group.sourceKey, collection }))
  );
  const alignPhaseResolution = await resolveAlignPhaseRouting({
    projectRoot,
    phases,
    requestedSourceKeys: [...new Set(alignTargets.map((target) => target.sourceKey))],
    requestedCollections: [...new Set(alignTargets.map((target) => target.collection))],
    requestedGroups: alignGroups,
  });
  const approvedPages = await countFiles(
    join(projectRoot, "knowledge"),
    (rel) => isApprovedKnowledgeMarkdownPath(rel) && !rel.startsWith("assets/"),
  );
  const approvedKnowledge = await listApprovedKnowledge(projectRoot);
  const approvedIndexerPages = approvedKnowledge.filter((file) =>
    isIndexerApprovedKnowledgeMarkdown(file.content)
  ).length;
  const approvedCollections = (await Promise.all(
    KNOWLEDGE_COLLECTIONS.map(async (collection) => ({
      collection,
      count: await countFiles(
        join(projectRoot, "knowledge", collection),
        (rel) => isApprovedKnowledgeMarkdownPath(rel),
      ),
    })),
  )).filter((item) => item.count > 0).map((item) => item.collection);
  const documentOptimization = phaseStatus.projectEntryValid
    ? await collectDocumentOptimizationStatus({
        projectRoot,
        files: approvedKnowledge,
      })
    : disabledDocumentOptimizationStatus();
  const closeStatus = await readCloseStatus(projectRoot);
  const distFiles = await countFiles(join(projectRoot, "dist"), () => true);
  const sourceFreshness = phaseStatus.projectEntryValid
    ? await collectSourceFreshness({
        projectRoot,
        phases,
        sources,
        sourceStatuses,
      })
    : { state: "ready" as const, stalePhases: [], pendingPhases: [], phaseFingerprints: {}, diagnostics: [], errorDiagnostics: [] };
  const extractionPreview = await readExtractionPreviewState({
    projectRoot,
    pendingPhaseIds: [...new Set([
      ...sourceFreshness.stalePhases,
      ...sourceFreshness.pendingPhases,
    ])],
    phases,
  });
  const codeIndexAudit = phaseStatus.projectEntryValid && draftStatus.diagnostics.length === 0
    ? await collectCodeIndexAuditStatus(projectRoot)
    : {
        applicable: false,
        current: true,
        resolved: true,
        revision_required: false,
        input_required: false,
        guidance_required: false,
        guidance_units: [],
        history: [],
      };
  const verifyStatus = draftStatus.diagnostics.length === 0
    ? await readVerifyStatus(
        projectRoot,
        phases
          .filter((phase) =>
            phase.kind === "phase.extract.ts" || phase.kind === "phase.extract.custom"
          )
          .map((phase) => phase.id),
      )
    : { issues: [], diagnostics: [] };
  const resourceRepair = resourcePlaceholderRepairTargets(verifyStatus.issues);
  const pendingCapture = pendingDocumentCaptureCommands({
    phases,
    documentSources,
    recaptureSourceKeys: resourceRepair.sourceKeys,
  });
  const compilePhases = phases.filter((phase) => phase.kind === "phase.compile.prose");
  const compileBatch = compilePhases.length === 0
    ? undefined
    : await readProseCompileBatchProgress({
        projectRoot,
        recompileViewRefs: new Set(resourceRepair.viewRefs),
        currentSnapshotHashes: capturedSnapshotHashes,
      });
  const reviewIdentityConflicts = draftStatus.diagnostics.length === 0
    ? await readReviewPathIdentityConflicts(projectRoot)
    : { count: 0, sourceKeys: [], conflicts: [] };
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
  const sourceCount = sources.length + documentSources.length;
  const capturedDocumentSourcesForCommands = documentSources.filter((source) => source.snapshotReady);
  const stagedAlignCommand = alignPhaseResolution?.state === "resolved"
    ? alignPhaseResolution.matches[0]?.command
    : undefined;
  const alignCommandInput = {
    hasCapturedSources: capturedDocumentSourcesForCommands.length > 0,
    ...(stagedAlignCommand !== undefined ? { stagedAlignCommand } : {}),
    phases,
    documentSources,
  };
  const alignDocumentStructureSummaryNext = alignStatusCommand({
    ...alignCommandInput,
    suffix: " --view structure-summary --input .tmp/context-runtime/lifecycle/structure.yaml --format json",
  });
  const alignDocumentValidateNext = alignStatusCommand({
    ...alignCommandInput,
    suffix: " --validate --input .tmp/context-runtime/lifecycle/structure.yaml --format json",
  });
  const alignDocumentConfirmNext = alignStatusCommand({
    ...alignCommandInput,
    suffix: " --confirm --input .tmp/context-runtime/lifecycle/structure.yaml --format json",
  });
  const compileRouting = compileStatusRouting({
    structure: stagedStructureStatus,
    activeStructures,
    graph: declarationGraph,
    ...(compileBatch !== undefined ? { compileBatch } : {}),
    hasCapturedSources: capturedDocumentSourcesForCommands.length > 0,
  });
  const compilePhaseResolution = compileRouting.resolution;
  const compileDocumentNext = compileRouting.command;
  const runtimeEvents = observeContextRuntimeEventDelivery(projectRoot);
  const indexerRegistry = await readIndexerWorkflowRegistryStatus(projectRoot);
  const indexerCandidateCompile = await readProjectIndexerCandidateCompileStatus(projectRoot);
  const indexerDrafts = indexerCandidateCompile.state === "current"
    ? indexerCandidateCompile.candidates.filter((candidate) => candidate.status === "draft")
    : [];
  const indexerRejected = indexerCandidateCompile.state === "current"
    ? indexerCandidateCompile.candidates.filter((candidate) => candidate.status === "rejected")
    : [];
  const workflowDraftStatus = {
    count: indexerDrafts.length,
    rejectedCount: indexerRejected.length,
    collections: [...new Set(indexerDrafts.map((candidate) => candidate.collection))].sort(),
    ...(indexerDrafts.length === 0
      ? {}
      : { candidateSetDigest: candidateSetHash(indexerDrafts) }),
  };
  const codeIndexMigrationRequired = phaseStatus.projectEntryValid
    ? await legacyCodeIndexMigrationRequired(projectRoot)
    : false;
  const observation: ContextWorkflowObservation = {
      projectRoot,
      projectEntryValid: phaseStatus.projectEntryValid,
      stateDiagnostics: [
        ...sourceStatus.diagnostics,
        ...sourceFreshness.errorDiagnostics,
        ...packageFreshnessStatus.diagnostics,
        ...packageTemplateReviews.flatMap((review) =>
          review.diagnostic === undefined ? [] : [review.diagnostic]
        ),
        ...draftStatus.diagnostics,
        ...stagedStructureStatus.diagnostics,
        ...approvedStructureInputDiagnostics,
        ...verifyStatus.diagnostics,
      ],
      sourceCount,
      repoSources: sources.map((source) => ({
        id: source.id ?? source.name,
        name: source.name,
      })),
      readyRepoSources,
      documentSources,
      capturedDocumentSources,
      phases,
      packages,
      packageFreshness,
      packageTemplateReviews,
      documentOptimization,
      runtimeEvents,
      sourceFreshness: sourceFreshness.state,
      staleSourcePhases: sourceFreshness.stalePhases,
      pendingExtractPhases: sourceFreshness.pendingPhases,
      extractionPreview,
      codeIndexAudit,
      codeIndexMigrationRequired,
      pendingCaptureCommands: pendingCapture.commands,
      missingCaptureSources: pendingCapture.missingSources,
      evidenceWarnings,
      verifyErrors,
      projectionRefreshIssues,
      verifyIssues: verifyStatus.issues,
      stagedStructure: stagedStructureStatus,
      activeStructures,
      declarationGraph,
      ...(alignPhaseResolution !== undefined ? { alignPhaseResolution } : {}),
      ...(compilePhaseResolution !== undefined ? { compilePhaseResolution } : {}),
      ...(compileBatch !== undefined ? { compileBatch } : {}),
      reviewIdentityConflicts,
      unclassifiedDocumentTargets,
      pendingStructureTargets,
      draftCandidates: workflowDraftStatus.count,
      rejectedCandidates: workflowDraftStatus.rejectedCount,
      draftCollections: workflowDraftStatus.collections,
      ...(workflowDraftStatus.candidateSetDigest !== undefined
        ? { candidateSetDigest: workflowDraftStatus.candidateSetDigest }
        : {}),
      approvedPages,
      approvedIndexerPages,
      close: closeStatus,
      indexerRegistry,
      indexerCandidateCompile: { state: indexerCandidateCompile.state },
      ...(alignDocumentStructureSummaryNext !== undefined
        ? { alignDocumentStructureSummaryNext }
        : {}),
      ...(alignDocumentValidateNext !== undefined
        ? { alignDocumentValidateNext }
        : {}),
      ...(alignDocumentConfirmNext !== undefined
        ? { alignDocumentConfirmNext }
        : {}),
      ...(compileDocumentNext !== undefined ? { compileDocumentNext } : {}),
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
  const workflow = projectContextWorkflowStatus(workflowSnapshot);
  await recordWorkflowEvaluation(projectRoot, workflow);
  const routeProjection = projectWorkflowRoute({
    workflow,
    observation: workflowSnapshot.observation,
  });
  const status: ProjectStatus = {
    projectRoot,
    sourceCount,
    readySources,
    draftCandidates: workflowDraftStatus.count,
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
      total: sourceCount,
      ready: readySources,
    },
    sources: sourceStatuses,
    documentSources,
    phases: phases.map((phase) => phase.id),
    packages: packageFreshness,
    packageTemplateReviews,
    documentOptimization,
    sourceFreshness: sourceFreshness.state,
    staleSourcePhases: sourceFreshness.stalePhases,
    pendingExtractPhases: sourceFreshness.pendingPhases,
    extractionPreview,
    codeIndexAudit,
    pendingCapturePhases: pendingCapture.phaseIds,
    evidenceStatus,
    evidenceWarnings,
    close: closeStatus,
    stagedStructure: stagedStructureStatus,
    activeStructures,
    structureBatch: workflow.status === "complete"
      ? { ...structureBatch, state: "complete" as const }
      : structureBatch,
    unclassifiedDocumentTargets,
    pendingStructureTargets,
    packageCount: packages.length,
    declarationGraph,
    configurationGaps: declarationGraph.gaps,
    ...(alignPhaseResolution !== undefined ? { alignPhaseResolution } : {}),
    ...(compilePhaseResolution !== undefined ? { compilePhaseResolution } : {}),
    ...(compileBatch !== undefined ? { compileBatch } : {}),
    reviewIdentityConflicts,
    verifyErrors,
    verifyWarnings,
    projectionRefreshIssues,
    diagnostics: [
      ...phaseStatus.diagnostics,
      ...sourceStatus.diagnostics,
      ...sourceFreshness.errorDiagnostics,
      ...sourceFreshness.diagnostics,
      ...packageFreshnessStatus.diagnostics,
      ...closeStatus.diagnostics,
      ...draftStatus.diagnostics,
      ...(indexerCandidateCompile.state === "invalid" &&
          indexerCandidateCompile.diagnostic !== undefined
        ? [`Indexer Candidate compile invalid: ${indexerCandidateCompile.diagnostic}`]
        : []),
      ...stagedStructureStatus.diagnostics,
      ...activeStructures.diagnostics,
      ...approvedStructureInputDiagnostics,
      ...verifyStatus.diagnostics,
      ...(projectionRefreshIssues > 0
        ? [`verify info approved-projection-stale: ${projectionRefreshIssues} derived projection issue(s) will be rebuilt by context close`]
        : compactProjectVerifyDiagnostics(verifyStatus.issues)),
    ],
  };
  return {
    status: withContentAddressedWorkflowResources(
      status,
      options.resourceReceipts,
    ),
    observation,
    authorities,
  };
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
  const workflow = projectContextWorkflowStatus(workflowSnapshot);
  await recordWorkflowEvaluation(input.snapshot.observation.projectRoot, workflow);
  const routeProjection = projectWorkflowRoute({
    workflow,
    observation: input.snapshot.observation,
  });
  const status: ProjectStatus = {
    ...input.snapshot.status,
    ...routeProjection,
    workflow,
    structureBatch: workflow.status === "complete"
      ? { ...input.snapshot.status.structureBatch, state: "complete" }
      : input.snapshot.status.structureBatch,
  };
  return withContentAddressedWorkflowResources(status, input.resourceReceipts);
}

export async function collectProjectStatus(
  projectRoot: string,
  options: CollectProjectStatusOptions = {},
): Promise<ProjectStatus> {
  return (await collectProjectStatusSnapshot(projectRoot, options)).status;
}
