import type {
  ExtractCustomPhaseDefinition,
  ExtractTsPhaseDefinition,
  RepoProjectSourceDefinition,
} from "@c4a/context";
import { verifyErrorsAreCloseRepairable } from "./verifyFacts.js";
import type { ProjectVerifyIssue } from "../verify.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  type ContextWorkflowAuthority,
  type ContextWorkflowFacts,
  type ContextWorkflowObservation,
} from "./workflowTypes.js";

function hasAuthority(
  authorities: readonly ContextWorkflowAuthority[],
  authority: ContextWorkflowAuthority,
): boolean {
  return authorities.includes(authority);
}

function onlySourceDriftErrors(issues: readonly ProjectVerifyIssue[]): boolean {
  const errors = issues.filter((issue) => issue.severity === "error");
  return errors.length > 0 && errors.every((issue) =>
    issue.code === "approved-source-ref-stale" ||
    issue.code === "source-document-missing"
  );
}

function activeProseRefreshRepairsVerification(
  observation: ContextWorkflowObservation,
): boolean {
  const targetSourceKeys = new Set(
    observation.pendingStructureTargets.map((target) => target.sourceKey),
  );
  for (const sourceKey of observation.compileBatch?.replacementSourceKeys ?? []) {
    targetSourceKeys.add(sourceKey);
  }
  for (const sourceKey of observation.compileBatch?.nextSourceKeys ?? []) {
    targetSourceKeys.add(sourceKey);
  }
  const draftViewRefs = new Set(
    observation.compileBatch?.draftViewRefs ?? [],
  );
  const refreshViewRefs = new Set([
    ...draftViewRefs,
    ...(observation.compileBatch?.staleViewRefs ?? []),
    ...(observation.compileBatch?.remainingViewRefs ?? []),
  ]);
  const replacementSourceKeys = new Set(
    observation.compileBatch?.replacementSourceKeys ?? [],
  );
  if (targetSourceKeys.size === 0 && draftViewRefs.size === 0) return false;
  const errors = observation.verifyIssues.filter((issue) =>
    issue.severity === "error"
  );
  let hasRefreshIssue = false;
  const fullyCovered = errors.length > 0 && errors.every((issue) => {
    if (verifyErrorsAreCloseRepairable([issue])) return true;
    if (
      issue.code !== "approved-source-ref-stale" &&
      issue.code !== "approved-verbatim-body-hash-mismatch" &&
      issue.code !== "approved-resource-placeholder-unresolved" &&
      issue.code !== "entity-id-duplicate"
    ) {
      return false;
    }
    const covered = issue.view_ref !== undefined
      ? refreshViewRefs.has(issue.view_ref) ||
        (issue.source_keys !== undefined &&
          issue.source_keys.length > 0 &&
          issue.source_keys.every((sourceKey) => replacementSourceKeys.has(sourceKey)))
      : (issue.source_keys !== undefined &&
      issue.source_keys.length > 0 &&
      issue.source_keys.every((sourceKey) => targetSourceKeys.has(sourceKey)));
    if (covered) hasRefreshIssue = true;
    return covered;
  });
  return fullyCovered && hasRefreshIssue;
}

function phaseCoversRepo(
  phase: ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition,
  source: { id: string; name: string },
): boolean {
  const definitions: readonly RepoProjectSourceDefinition[] = phase.kind === "phase.extract.ts"
    ? [phase.source]
    : phase.sources;
  return definitions.some((definition) => {
    if (definition.kind === "source.collection") return definition.type === "repo";
    if (definition.kind === "source.repo") {
      return definition.id === source.id || definition.name === source.name;
    }
    return definition.name === source.id || definition.name === source.name;
  });
}

function extractionDeclarationsComplete(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.repoSources.length === 0) return true;
  const phases = observation.phases.filter(
    (phase): phase is ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition =>
      phase.kind === "phase.extract.ts" || phase.kind === "phase.extract.custom",
  );
  return observation.repoSources.every((source) =>
    phases.some((phase) => phaseCoversRepo(phase, source))
  );
}

function extractionCapabilityClear(
  observation: ContextWorkflowObservation,
): boolean {
  const pending = new Set([
    ...observation.pendingExtractPhases,
    ...observation.staleSourcePhases,
  ]);
  return observation.phases.every((phase) =>
    !pending.has(phase.id) ||
    (phase.kind !== "phase.extract.ts" && phase.kind !== "phase.extract.custom") ||
    (phase.indexUnits ?? []).every((unit) => unit.capability !== "material-required")
  );
}

function extractionPlansComplete(
  observation: ContextWorkflowObservation,
): boolean {
  const pending = new Set([
    ...observation.pendingExtractPhases,
    ...observation.staleSourcePhases,
  ]);
  if (pending.size === 0) return true;
  return observation.phases.every((phase) => {
    if (!pending.has(phase.id)) return true;
    if (phase.kind !== "phase.extract.ts" && phase.kind !== "phase.extract.custom") return true;
    return (phase.indexPlan ?? "inferred") === "declared" &&
      (phase.indexUnits ?? []).length > 0 &&
      (phase.indexUnits ?? []).every((unit) =>
        unit.moduleType !== "unknown" &&
        !(unit.moduleTypes ?? [unit.moduleType]).includes("unknown") &&
        (unit.moduleTypeEvidence?.length ?? 0) > 0
      );
  });
}

function workspaceStateValid(observation: ContextWorkflowObservation): boolean {
  if (observation.stateDiagnostics.length > 0) return false;
  if (observation.activeStructures.state === "invalid") return false;
  if (observation.declarationGraph.unresolvedPhases.length > 0) return false;
  if (
    observation.alignPhaseResolution?.state === "ambiguous" ||
    observation.alignPhaseResolution?.state === "unresolved"
  ) return false;
  if (observation.compilePhaseResolution?.state === "ambiguous") return false;
  if ((observation.compileBatch?.missingStructureDigests.length ?? 0) > 0) return false;
  return true;
}

function blockingVerificationClear(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.capturedDocumentSources < observation.documentSources.length) return true;
  if (observation.verifyErrors === 0) return true;
  if (verifyErrorsAreCloseRepairable(observation.verifyIssues)) return true;
  if (activeProseRefreshRepairsVerification(observation)) return true;
  const blockingIssues = observation.verifyIssues.filter((issue) => issue.severity === "error");
  const replacementBatchReadyForReview = observation.pendingCaptureCommands.length === 0 &&
    observation.draftCandidates > 0 &&
    observation.compileBatch?.readyForReview === true &&
    blockingIssues.length > 0 &&
    blockingIssues.every((issue) =>
      issue.code === "entity-id-duplicate" ||
      issue.code === "approved-resource-placeholder-unresolved" ||
      issue.code === "approved-source-ref-stale" ||
      verifyErrorsAreCloseRepairable([issue])
    );
  if (replacementBatchReadyForReview) return true;
  const resourceRepairReadyForReview = observation.pendingCaptureCommands.length === 0 &&
    observation.compileBatch?.readyForReview === true &&
    blockingIssues.some((issue) => issue.code === "approved-resource-placeholder-unresolved") &&
    blockingIssues.every((issue) =>
      issue.code === "approved-resource-placeholder-unresolved" ||
      issue.code === "approved-source-ref-stale" ||
      verifyErrorsAreCloseRepairable([issue])
    );
  if (resourceRepairReadyForReview) return true;
  return onlySourceDriftErrors(observation.verifyIssues);
}

function evidenceMaintenanceClear(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.capturedDocumentSources < observation.documentSources.length) return true;
  if (activeProseRefreshRepairsVerification(observation)) return true;
  if (verifyErrorsAreCloseRepairable(observation.verifyIssues)) return true;
  const staleEvidenceIssues = observation.verifyIssues.filter((issue) =>
    issue.severity === "error" && issue.code === "approved-source-ref-stale"
  );
  const pendingExtractionRepairsCodeEvidence = observation.pendingExtractPhases.length > 0 &&
    staleEvidenceIssues.length > 0 &&
    staleEvidenceIssues.every((issue) =>
      issue.source_keys !== undefined &&
      issue.source_keys.length > 0 &&
      issue.source_keys.every((sourceKey) => sourceKey.startsWith("repo:"))
    );
  if (pendingExtractionRepairsCodeEvidence) return true;
  return observation.evidenceWarnings !== "orphaned" &&
    observation.evidenceWarnings !== "stale";
}

function proseDeclarationsComplete(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.documentSources.length === 0) return true;
  if (observation.unclassifiedDocumentTargets.length > 0) return false;
  if (observation.declarationGraph.unresolvedPhases.length > 0) return false;
  if (observation.pendingStructureTargets.some((target) => target.configurationGaps.length > 0)) {
    return false;
  }
  if ((observation.compilePhaseResolution?.missingCollections.length ?? 0) > 0) {
    return false;
  }
  if ((observation.compilePhaseResolution?.ambiguousCollections.length ?? 0) > 0) {
    return false;
  }
  return true;
}

function activeRoundDeclarationsComplete(
  observation: ContextWorkflowObservation,
): boolean {
  const groups = observation.stagedStructure.state === "draft" ||
      observation.stagedStructure.state === "confirmed" ||
      observation.stagedStructure.state === "frozen"
    ? (observation.stagedStructure.sourceKeys ?? []).flatMap((sourceKey) =>
        [{
          sourceKey,
          collections: observation.stagedStructure.collections ?? [],
          ...(observation.stagedStructure.phaseCollection === undefined
            ? {}
            : { phaseCollection: observation.stagedStructure.phaseCollection }),
        }]
      )
    : [...observation.activeStructures.slots.reduce((grouped, slot) => {
        const key = `${slot.sourceKey}\u0000${slot.structureDigest}`;
        const group = grouped.get(key) ?? {
          sourceKey: slot.sourceKey,
          collections: [] as string[],
          ...(slot.phaseCollection === undefined
            ? {}
            : { phaseCollection: slot.phaseCollection }),
        };
        if (!group.collections.includes(slot.collection)) group.collections.push(slot.collection);
        if (group.phaseCollection === undefined && slot.phaseCollection !== undefined) {
          group.phaseCollection = slot.phaseCollection;
        }
        grouped.set(key, group);
        return grouped;
      }, new Map<string, {
        sourceKey: string;
        collections: string[];
        phaseCollection?: string;
      }>()).values()];
  if (groups.length === 0) return proseDeclarationsComplete(observation);
  if (
    observation.alignPhaseResolution?.state === "unresolved" ||
    observation.alignPhaseResolution?.state === "ambiguous"
  ) {
    return false;
  }
  return groups.every((group) => {
    const ownerRows = observation.declarationGraph.rows.filter((row) =>
      row.sourceKey === group.sourceKey &&
      (group.phaseCollection === undefined
        ? group.collections.includes(row.collection)
        : row.collection === group.phaseCollection)
    );
    return ownerRows.length === 1 &&
      ownerRows[0]!.gaps.every((gap) => gap !== "compile" && gap !== "review");
  });
}

function alignPrepared(observation: ContextWorkflowObservation): boolean {
  if (observation.documentSources.length === 0) return true;
  if (observation.unclassifiedDocumentTargets.length > 0) return false;
  return observation.pendingStructureTargets.length === 0;
}

function compileComplete(observation: ContextWorkflowObservation): boolean {
  if (observation.documentSources.length === 0) return true;
  if (observation.compileBatch !== undefined) {
    return (
      observation.compileBatch.complete ||
      observation.compileBatch.readyForReview
    ) &&
      observation.compileBatch.missingStructureDigests.length === 0;
  }
  if (observation.activeStructures.slotCount === 0) {
    return observation.unclassifiedDocumentTargets.length === 0 &&
      observation.pendingStructureTargets.length === 0 &&
      observation.stagedStructure.state === "missing";
  }
  return false;
}

function reviewGateClear(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.draftCandidates === 0) return true;
  const hasProseDrafts = observation.draftCollections.some(
    (collection) => collection !== "codegraph",
  );
  if (!hasProseDrafts) return false;
  if (observation.unclassifiedDocumentTargets.length > 0) return true;
  if (observation.pendingStructureTargets.length > 0) return true;
  if (observation.compileBatch !== undefined) {
    return !observation.compileBatch.readyForReview;
  }
  return false;
}

function activeProseWorkBlocksClose(input: {
  documentRoundStarted: boolean;
  pendingStructureTargets: number;
  declarationsComplete: boolean;
  structureConfirmed: boolean;
  compileComplete: boolean;
  reviewGateClear: boolean;
}): boolean {
  return input.documentRoundStarted &&
    (
      input.pendingStructureTargets > 0 ||
      !input.declarationsComplete ||
      !input.structureConfirmed ||
      !input.compileComplete ||
      !input.reviewGateClear
    );
}

function closeActionSatisfied(input: {
  proseWorkBlocksClose: boolean;
  pendingVerificationRefresh: boolean;
  draftCandidates: number;
  rejectedCandidates: number;
  hasApprovedKnowledge: boolean;
  closeReady: boolean;
  verifyIssues: readonly ProjectVerifyIssue[];
}): boolean {
  if (input.draftCandidates > 0) return true;
  if (input.pendingVerificationRefresh) return true;
  if (input.proseWorkBlocksClose) return true;
  if (input.rejectedCandidates !== 0) return false;
  if (!input.hasApprovedKnowledge) return true;
  return input.closeReady && !verifyErrorsAreCloseRepairable(input.verifyIssues);
}

function packageTemplatesReviewed(observation: ContextWorkflowObservation): boolean {
  if (observation.packages.length === 0) return true;
  return observation.packageTemplateReviews.length === observation.packages.length &&
    observation.packageTemplateReviews.every((item) =>
      item.state !== "review-required" && item.state !== "invalid"
    );
}

export function contextWorkflowAuthorities(
  options: {
    managed?: boolean;
    authorities?: readonly ContextWorkflowAuthority[];
  } = {},
): ContextWorkflowAuthority[] {
  const authorities = new Set(options.authorities ?? []);
  if (options.managed === true) {
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.extractionScope);
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.documentClassification);
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.structureConfirmation);
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.knowledgeReview);
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.packageOutput);
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.packageTemplateReview);
  }
  return [...authorities].sort();
}

export function createContextWorkflowFacts(
  observation: ContextWorkflowObservation,
  authorities: readonly ContextWorkflowAuthority[],
): ContextWorkflowFacts {
  const captureComplete =
    observation.capturedDocumentSources === observation.documentSources.length &&
    observation.pendingCaptureCommands.length === 0;
  const extractDeclarationsComplete =
    extractionDeclarationsComplete(observation);
  const extractionPreview = observation.extractionPreview ?? {
    current: observation.pendingExtractPhases.length === 0,
    capabilityClear: true,
    ownershipClear: true,
    scaleClear: true,
  };
  const extractComplete = observation.repoSources.length === 0 ||
    (
      extractDeclarationsComplete &&
      observation.sourceFreshness === "ready" &&
      observation.pendingExtractPhases.length === 0 &&
      observation.staleSourcePhases.length === 0
    );
  const documentsClassified =
    observation.unclassifiedDocumentTargets.length === 0;
  const documentRoundStarted =
    observation.stagedStructure.state === "draft" ||
    observation.stagedStructure.state === "confirmed" ||
    observation.stagedStructure.state === "frozen" ||
    observation.activeStructures.slotCount > 0 ||
    (observation.compileBatch?.plannedViewRefs.length ?? 0) > 0;
  const proseComplete = proseDeclarationsComplete(observation);
  const activeRoundProseComplete = activeRoundDeclarationsComplete(observation);
  const structureConfirmed =
    observation.stagedStructure.state !== "draft";
  const compiled = compileComplete(observation);
  const reviewGateIsClear = reviewGateClear(observation);
  const onlyProseDrafts = observation.draftCollections.length > 0 &&
    observation.draftCollections.every((collection) => collection !== "codegraph");
  const hasProseDrafts = observation.draftCollections.some(
    (collection) => collection !== "codegraph",
  );
  const structureRefreshRequired = captureComplete &&
    observation.pendingStructureTargets.length > 0 &&
    observation.draftCandidates > 0 &&
    hasProseDrafts;
  const reviewBatchResolved = observation.draftCandidates === 0 ||
    (observation.pendingStructureTargets.length > 0 && onlyProseDrafts);
  const evidenceClear = evidenceMaintenanceClear(observation);
  const hasApprovedKnowledge = observation.approvedPages > 0;
  const proseWorkBlocksClose = activeProseWorkBlocksClose({
    documentRoundStarted,
    pendingStructureTargets: observation.pendingStructureTargets.length,
    declarationsComplete: activeRoundProseComplete,
    structureConfirmed,
    compileComplete: compiled,
    reviewGateClear: reviewGateIsClear,
  });
  const closeSatisfied = closeActionSatisfied({
    proseWorkBlocksClose,
    pendingVerificationRefresh:
      activeProseRefreshRepairsVerification(observation),
    draftCandidates: observation.draftCandidates,
    rejectedCandidates: observation.rejectedCandidates,
    hasApprovedKnowledge,
    closeReady: observation.close.state === "ready",
    verifyIssues: observation.verifyIssues,
  });
  const packagesDeclared =
    !hasApprovedKnowledge || observation.packages.length > 0;
  const packagesCurrent =
    !hasApprovedKnowledge ||
    (
      observation.packages.length > 0 &&
      observation.packageFreshness.length === observation.packages.length &&
      observation.packageFreshness.every((item) => item.state === "ready")
    );
  const templatesReviewed = packageTemplatesReviewed(observation);
  const runtimeEvents = observation.runtimeEvents ?? {
    configured: false,
    pending_count: 0,
    pending_kinds: [],
  };
  const buildLogPending = runtimeEvents.configured &&
    runtimeEvents.pending_kinds.includes("package.build.completed");
  const documentOptimization = observation.documentOptimization ?? {
    enabled: false,
    current: true,
    pending_fragments: 0,
    conflict_fragments: 0,
    revision_requested: false,
  };

  return {
    workspace: {
      project_entry_valid: observation.projectEntryValid,
      state_valid: workspaceStateValid(observation),
    },
    verification: {
      blocking_clear: blockingVerificationClear(observation),
    },
    evidence: {
      maintenance_clear: evidenceClear,
    },
    gates: {
      evidence_maintenance_resolved: evidenceClear ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.evidenceMaintenance),
      source_read_resolved: captureComplete ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.sourceRead),
      extraction_scope_resolved: extractDeclarationsComplete,
      document_classification_resolved: documentsClassified,
      structure_confirmation_resolved: structureConfirmed,
      knowledge_review_resolved: reviewGateIsClear,
      package_output_resolved: packagesDeclared ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.packageOutput),
    },
    resume: {
      prose_declarations_complete: !captureComplete || !documentRoundStarted ||
        activeRoundProseComplete,
      ...(structureRefreshRequired ? { structure_refresh_required: true } : {}),
      structure_confirmation_resolved: !captureComplete || !documentRoundStarted ||
        structureConfirmed,
      structure_confirmed: !captureComplete || !documentRoundStarted || structureConfirmed,
      compile_complete: !captureComplete || !documentRoundStarted || compiled,
      knowledge_review_resolved: !captureComplete || !documentRoundStarted ||
        reviewGateIsClear,
      review_gate_clear: !captureComplete || !documentRoundStarted || reviewGateIsClear,
    },
    sources: {
      registered: observation.sourceCount > 0,
      repositories_ready:
        observation.readyRepoSources === observation.repoSources.length,
    },
    capture: {
      declarations_complete:
        observation.documentSources.length === 0 ||
        observation.missingCaptureSources.length === 0,
      complete: captureComplete,
    },
    extract: {
      declarations_complete: extractDeclarationsComplete,
      plans_complete: extractionPlansComplete(observation),
      capability_clear: extractionCapabilityClear(observation) &&
        (!extractionPreview.current || extractionPreview.capabilityClear),
      preview_current: extractionPreview.current,
      ownership_clear: extractionPreview.current
        ? extractionPreview.ownershipClear
        : true,
      scale_clear: extractionPreview.current ? extractionPreview.scaleClear : true,
      batch_digest: extractionPreview.digest ?? null,
      complete: extractComplete,
    },
    documents: {
      classified: documentsClassified,
    },
    prose: {
      declarations_complete: proseComplete,
    },
    align: {
      prepared: alignPrepared(observation),
    },
    structure: {
      confirmed: structureConfirmed,
    },
    compile: {
      complete: compiled,
    },
    review: {
      gate_clear: reviewGateIsClear,
      batch_resolved: reviewBatchResolved,
      ...(observation.reviewIdentityConflicts.count > 0
        ? { identity_conflicts_present: true as const }
        : {}),
      candidate_set_digest: observation.candidateSetDigest ?? null,
    },
    close: {
      current: closeSatisfied,
    },
    packages: {
      declared: packagesDeclared,
      templates_reviewed: templatesReviewed,
      current: packagesCurrent,
    },
    document_optimization: {
      enabled: documentOptimization.enabled,
      current: documentOptimization.current,
      pending_count: documentOptimization.pending_fragments,
      conflict_count: documentOptimization.conflict_fragments,
      ...(documentOptimization.revision_requested
        ? { revision_requested: true as const }
        : {}),
    },
    logs: {
      configured: runtimeEvents.configured,
      ...(buildLogPending && hasApprovedKnowledge && packagesCurrent
        ? { final_pending: true as const }
        : {}),
    },
  };
}
