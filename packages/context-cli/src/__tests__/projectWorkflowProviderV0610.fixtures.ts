import type { ContextWorkflowObservation } from "../project/workflow/workflowTypes.js";

export function receiptPathFromCommand(command: string): string {
  const match = /--resource-receipts '@([^']+)'/u.exec(command);
  if (match?.[1] === undefined) throw new Error(`receipt path missing from command: ${command}`);
  return match[1];
}

export function emptyObservation(): ContextWorkflowObservation {
  return {
    projectRoot: "/workspace",
    projectEntryValid: true,
    stateDiagnostics: [],
    sourceCount: 0,
    repoSources: [],
    readyRepoSources: 0,
    documentSources: [],
    capturedDocumentSources: 0,
    phases: [],
    packages: [],
    packageFreshness: [],
    packageTemplateReviews: [],
    sourceFreshness: "ready",
    staleSourcePhases: [],
    pendingExtractPhases: [],
    pendingCaptureCommands: [],
    missingCaptureSources: [],
    evidenceWarnings: "none",
    verifyErrors: 0,
    projectionRefreshIssues: 0,
    verifyIssues: [],
    stagedStructure: {
      state: "missing",
      sourceKeys: [],
      collections: [],
      diagnostics: [],
    },
    activeStructures: {
      state: "missing",
      count: 0,
      slotCount: 0,
      sourceKeys: [],
      collections: [],
      structureDigests: [],
      slots: [],
      diagnostics: [],
    },
    declarationGraph: {
      rows: [],
      gaps: [],
      unresolvedPhases: [],
      resolvedPhases: [],
    },
    unclassifiedDocumentTargets: [],
    pendingStructureTargets: [],
    draftCandidates: 0,
    rejectedCandidates: 0,
    draftCollections: [],
    reviewIdentityConflicts: { count: 0, sourceKeys: [], conflicts: [] },
    approvedPages: 0,
    close: { state: "missing", diagnostics: [] },
  };
}
