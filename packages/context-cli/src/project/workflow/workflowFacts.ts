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

function workspaceStateValid(observation: ContextWorkflowObservation): boolean {
  return observation.stateDiagnostics.length === 0;
}

function blockingVerificationClear(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.capturedDocumentSources < observation.documentSources.length) {
    return true;
  }
  return observation.verifyErrors === 0 ||
    verifyErrorsAreCloseRepairable(observation.verifyIssues) ||
    onlySourceDriftErrors(observation.verifyIssues);
}

function evidenceMaintenanceClear(
  observation: ContextWorkflowObservation,
): boolean {
  if (observation.capturedDocumentSources < observation.documentSources.length) {
    return true;
  }
  if (verifyErrorsAreCloseRepairable(observation.verifyIssues)) return true;
  return observation.evidenceWarnings !== "orphaned" &&
    observation.evidenceWarnings !== "stale";
}

function indexerRegistryCoversSources(
  observation: ContextWorkflowObservation,
): boolean {
  const refs = new Set(observation.indexerRegistry.sourceRefs);
  const repositoriesCovered = observation.repoSources.every((source) =>
    refs.has(`repo:${source.name}`) || refs.has(`repo:${source.id}`)
  );
  const documentsCovered = observation.documentSources.every((source) =>
    refs.has(`docs:${source.name}`) ||
    refs.has(`${source.type}:${source.name}`) ||
    (source.id !== undefined && (
      refs.has(`docs:${source.id}`) || refs.has(`${source.type}:${source.id}`)
    ))
  );
  return repositoriesCovered && documentsCovered;
}

function closeActionSatisfied(input: {
  draftCandidates: number;
  rejectedCandidates: number;
  hasApprovedKnowledge: boolean;
  closeReady: boolean;
  verifyIssues: readonly ProjectVerifyIssue[];
}): boolean {
  // Pending drafts defer close until the Review route has resolved.
  if (input.draftCandidates > 0) return true;
  // Omit is a completed Review decision. It needs one close, not an endless
  // close loop while its durable rejection remains in the Candidate ledger.
  if (!input.hasApprovedKnowledge && input.rejectedCandidates === 0) return true;
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
    authorities.add(CONTEXT_WORKFLOW_AUTHORITIES.sourceRead);
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
  const partialDelivery = observation.indexerCandidateCompile.partial_delivery === true && observation.indexerCandidateCompile.state === "current" && !observation.indexerCandidateCompile.revision_pending;
  const reviewGateClear = observation.draftCandidates === 0 || partialDelivery;
  const hasApprovedKnowledge = observation.approvedPages > 0;
  const rollback = observation.indexerCandidateCompile.rollback_pending === true;
  const indexerLifecycleCurrent = !observation.indexerCandidateCompile.managed_source_pending && !observation.indexerCandidateCompile.revision_pending && (observation.sourceCount === 0 || (
    observation.indexerRegistry.state === "current" &&
    indexerRegistryCoversSources(observation) &&
    (
      observation.indexerCandidateCompile.state === "current" ||
      (observation.close.state === "ready" && !observation.indexerCandidateCompile.delivery_pending)
    )
  ));
  const evidenceClear = evidenceMaintenanceClear(observation);
  const packagesDeclared = !hasApprovedKnowledge || observation.packages.length > 0;
  const packagesCurrent = rollback ? observation.packageFreshness.length === observation.packages.length &&
    observation.packageFreshness.every((item) => item.state === "ready") : !hasApprovedKnowledge || (
    observation.packages.length > 0 &&
    observation.packageFreshness.length === observation.packages.length &&
    observation.packageFreshness.every((item) => item.state === "ready")
  );
  const runtimeEvents = observation.runtimeEvents ?? {
    configured: false,
    pending_count: 0,
    pending_kinds: [],
  };
  const buildLogPending = runtimeEvents.configured &&
    runtimeEvents.pending_kinds.includes("package.build.completed");

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
    indexer: {
      lifecycle_current: indexerLifecycleCurrent,
      registry_state: observation.indexerRegistry.state,
    },
    gates: {
      evidence_maintenance_resolved: evidenceClear ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.evidenceMaintenance),
      source_read_resolved: captureComplete ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.sourceRead),
      knowledge_review_resolved: reviewGateClear,
      package_output_resolved: packagesDeclared ||
        hasAuthority(authorities, CONTEXT_WORKFLOW_AUTHORITIES.packageOutput),
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
    review: {
      gate_clear: reviewGateClear,
      batch_resolved: reviewGateClear,
      candidate_set_digest: observation.candidateSetDigest ?? null,
    },
    close: {
      // A pending revision (including a rejected draft) must reach Author
      // before the root graph can close its approved output.
      current: observation.indexerCandidateCompile.revision_pending === true || closeActionSatisfied({
        draftCandidates: partialDelivery ? 0 : observation.draftCandidates,
        rejectedCandidates: observation.rejectedCandidates,
        hasApprovedKnowledge: hasApprovedKnowledge || rollback,
        closeReady: observation.close.state === "ready",
        verifyIssues: observation.verifyIssues,
      }),
    },
    packages: {
      declared: packagesDeclared,
      templates_reviewed: packageTemplatesReviewed(observation),
      current: packagesCurrent && !partialDelivery,
    },
    logs: {
      configured: runtimeEvents.configured,
      ...(buildLogPending && hasApprovedKnowledge && packagesCurrent
        ? { final_pending: true as const }
        : {}),
    },
  };
}
