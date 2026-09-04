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
    pendingCaptureCommands: [],
    missingCaptureSources: [],
    evidenceWarnings: "none",
    verifyErrors: 0,
    projectionRefreshIssues: 0,
    verifyIssues: [],
    draftCandidates: 0,
    rejectedCandidates: 0,
    draftCollections: [],
    approvedPages: 0,
    close: { state: "missing", diagnostics: [] },
    indexerRegistry: { state: "current", sourceRefs: [] },
    indexerCandidateCompile: { state: "current" },
  };
}
