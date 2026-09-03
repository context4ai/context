import type { ProjectStatus } from "../statusTypes.js";

export const CONTEXT_WORKFLOW_RESOURCE_IDS = [
  "context.workspace-current",
  "context.verification-current",
  "context.source-boundary",
  "context.source-current",
  "context.review-current",
  "context.package-current",
  "context.document-optimization-current",
] as const;

export type ContextWorkflowResourceId =
  (typeof CONTEXT_WORKFLOW_RESOURCE_IDS)[number];

function inline(value: unknown): string {
  return `\`${String(value).replaceAll("`", "'")}\``;
}

function bullets(values: readonly string[], empty = "None."): string {
  return values.length === 0
    ? empty
    : values.map((value) => `- ${value}`).join("\n");
}

function currentRoute(status: ProjectStatus): string {
  const current = status.workflow.current;
  if (current === undefined) {
    return [
      `- Status: ${inline(status.workflow.status)}`,
      "- Route: none",
    ].join("\n");
  }
  return [
    `- Node: ${inline(current.node)}`,
    `- Reason: ${inline(current.reason_code)}`,
    `- Availability: ${inline(current.availability)}`,
    `- Next kind: ${inline(current.configuration === undefined ? "command" : "configuration")}`,
  ].join("\n");
}

function renderWorkspace(status: ProjectStatus): string {
  return `# Current Context workspace

This view is an observation of the current workspace. It does not mutate lifecycle state.

## Current route

${currentRoute(status)}

## Counts

- Sources ready: ${status.readySources}/${status.sourceCount}
- Draft candidates: ${status.draftCandidates}
- Approved pages: ${status.approvedPages}
- Declared packages: ${status.packageCount}
- Output files: ${status.distFiles}
- Verification: ${status.verifyErrors} error(s), ${status.verifyWarnings} warning(s)
- Projection refresh issues: ${status.projectionRefreshIssues}

## Declaration coverage

- Declared phases: ${status.phases.length}
- Pending capture phases: ${status.pendingCapturePhases.length}
- Indexer registry: ${inline(status.indexerRegistry.state)}
- Indexer Candidate compile: ${inline(status.indexerCandidateCompile.state)}
- Legacy code-index migration: ${inline(status.codeIndexMigrationRequired ? "required" : "not-required")}
- Close projection: ${inline(status.close.state)}

## Diagnostics

${bullets(status.diagnostics.map((item) => inline(item)))}
`;
}

function renderVerification(status: ProjectStatus): string {
  const workflowDiagnostics = status.workflow.diagnostics.map((item) =>
    `${inline(item.severity)} ${inline(item.code)} — ${item.message}` +
    (item.count === undefined ? "" : ` (${item.count})`)
  );
  return `# Current verification and evidence

## Summary

- Verification errors: ${status.verifyErrors}
- Verification warnings: ${status.verifyWarnings}
- Projection refresh issues: ${status.projectionRefreshIssues}
- Evidence status: ${inline(status.evidenceStatus)}
- Evidence warning: ${inline(status.evidenceWarnings)}
- Approved projection: ${inline(status.close.state)}

## Workflow diagnostics

${bullets(workflowDiagnostics)}

## Detailed diagnostics

${bullets(status.diagnostics.map((item) => inline(item)))}
`;
}

function renderSources(status: ProjectStatus): string {
  const repositories = status.sources.map((source) =>
    `${inline(source.name)} — ready=${inline(source.ready)}, ref=${inline(source.ref)}, scope-match=${inline(source.scopeMatches)}` +
    (source.subpath === undefined ? "" : `, subpath=${inline(source.subpath)}`)
  );
  const documents = status.documentSources.map((source) => {
    const fidelity = source.captureFidelity;
    const summary = fidelity === undefined
      ? "fidelity=unavailable"
      : `fidelity=${inline(fidelity.status)}, evidence=${inline(fidelity.evidence_status)}, projection=${inline(fidelity.projection_status)}, discovered=${Object.values(fidelity.discovered).reduce((sum, count) => sum + count, 0)}, converted=${Object.values(fidelity.converted).reduce((sum, count) => sum + count, 0)}, skipped=${fidelity.skipped.reduce((sum, item) => sum + item.count, 0)}`;
    const issues = fidelity?.issues.map((issue) =>
      `${inline(issue.severity)} ${inline(issue.impact)} ${inline(issue.code)} ${inline(issue.block_type)} (${issue.count}) — ${issue.reason}`
    ) ?? [];
    const resources = source.resourceMaterialization;
    const resourceSummary = resources === undefined
      ? "resources=unavailable"
      : `resources=${inline(resources.status)}, discovered=${Object.values(resources.discovered).reduce((sum, count) => sum + count, 0)}, materialized=${Object.values(resources.materialized).reduce((sum, count) => sum + count, 0)}, reference-only=${Object.values(resources.reference_only).reduce((sum, count) => sum + count, 0)}, failed=${Object.values(resources.failed).reduce((sum, count) => sum + count, 0)}`;
    return [
      `${inline(`${source.type}:${source.name}`)} — captured=${inline(source.snapshotReady)}, manifest=${inline(source.manifest)}, ${summary}, ${resourceSummary}`,
      ...issues.map((issue) => `  - ${issue}`),
    ].join("\n");
  });
  return `# Current source scope

## Repository modules

${bullets(repositories)}

## Document sources

${bullets(documents)}

## Pending work

- Capture phases: ${status.pendingCapturePhases.length === 0
    ? "none"
    : status.pendingCapturePhases.map(inline).join(", ")}
- Indexer registry: ${inline(status.indexerRegistry.state)}
- Indexer Candidate compile: ${inline(status.indexerCandidateCompile.state)}
`;
}

function renderSourceBoundary(status: ProjectStatus): string {
  const repositories = status.sources.map((source) =>
    `${inline(source.name)} — ref=${inline(source.ref)}, scope-match=${inline(source.scopeMatches)}` +
    (source.subpath === undefined ? "" : `, subpath=${inline(source.subpath)}`)
  );
  const documents = status.documentSources.map((source) =>
    `${inline(`${source.type}:${source.name}`)} — locator=${inline(source.local ?? source.url ?? "registered")}, manifest=${inline(source.manifest)}`
  );
  return `# Registered source boundary

This view changes when registered source identity, locator, repository ref, or
scope changes. Capture and extraction progress does not change it.

## Repository modules

${bullets(repositories)}

## Document sources

${bullets(documents)}
`;
}

function renderReview(status: ProjectStatus): string {
  const pending = status.pendingReview;
  return `# Current knowledge review

## Scope

- Draft candidates: ${status.draftCandidates}
- Scope: ${pending === undefined ? "none" : inline(pending.scope)}
- Collections: ${pending === undefined ? "none" : pending.collections.map(inline).join(", ")}
- Candidate-set digest: ${pending?.candidateSetDigest === undefined
    ? "unavailable"
    : inline(pending.candidateSetDigest)}
- Decision source: ${pending === undefined ? "none" : inline(pending.decisionSource)}
- Inspection command: ${pending === undefined ? "none" : inline(pending.command)}
- Approved pages before this decision: ${status.approvedPages}

## Rule

Apply only a decision payload whose scope and candidate-set identity match the current review. A managed session may approve the complete current scope atomically. Ordinary review uses the user's exact payload unless the user cannot access the report and explicitly invokes the Route-documented force-approval phrase in the current conversation.
`;
}

function renderPackages(status: ProjectStatus): string {
  const packages = status.packages.map((item) =>
    `${inline(item.name)} — ${inline(item.state)}, kind=${inline(item.kind)}, inputs=${item.inputFiles}, outputs=${item.outputFiles}`
  );
  const templates = status.packageTemplateReviews.map((item) =>
    `${inline(item.packageName)} — ${inline(item.state)}, source=${inline(item.templatePath)}`
  );
  return `# Current package outputs

## Summary

- Declared packages: ${status.packageCount}
- Output files across the workspace: ${status.distFiles}
- Approved pages: ${status.approvedPages}
- Close projection: ${inline(status.close.state)}

## Packages

${bullets(packages)}

## Template review

${bullets(templates)}
`;
}

function renderDocumentOptimization(status: ProjectStatus): string {
  const current = status.documentOptimization;
  return `# Current document revisions

- Enabled: ${inline(current.enabled)}
- Policy: ${inline(current.policy)}
- Current: ${inline(current.current)}
- Eligible views: ${current.eligible_views}
- Eligible fragments: ${current.eligible_fragments}
- Revision pages: ${current.revision_pages}
- Revised fragments: ${current.revised_fragments}
- Kept fragments: ${current.kept_fragments}
- Pending fragments: ${current.pending_fragments}
- Conflicts: ${current.conflict_fragments}
- Retry attempts for the current problem: ${current.retry_attempts}
- Human guidance required: ${inline(current.guidance_required)}
- Mechanical signals: ${current.signal_count}
- Repair candidates: ${current.action_candidates.repair}
- Reshape candidates: ${current.action_candidates.reshape}
- Omission candidates: ${current.action_candidates.omit}
- Input-required candidates: ${current.action_candidates.request_input}
- Conversational correction requested: ${inline(current.revision_requested)}${current.requested_approved_path === undefined
    ? ""
    : `\n- Requested approved page: ${inline(current.requested_approved_path)}`}

## Three-round guidance report

${bullets(current.guidance_problems.map((problem) =>
    `attempts=${problem.attempts}; problem=${inline(problem.message)}; fragments=${problem.fragment_ids.map(inline).join(", ") || "current batch"}; signals=${problem.signal_codes.map(inline).join(", ") || "see current plan"}`
  ))}

Revision pages use the reserved \`__revision.md\` suffix beside their approved
page under \`knowledge/\`. Default knowledge discovery excludes them; document
optimization validation and package compilation apply them only while their
recorded source baseline remains current. Each pending fragment is one source
Section. The plan enumerates readability signals and the allowed keep, repair,
reshape, or omit actions; ambiguous or sensitive signals require one batched
user decision instead of an automatic omission.
`;
}

export function renderContextWorkflowResource(
  id: ContextWorkflowResourceId,
  status: ProjectStatus,
): string {
  switch (id) {
    case "context.workspace-current": return renderWorkspace(status);
    case "context.verification-current": return renderVerification(status);
    case "context.source-boundary": return renderSourceBoundary(status);
    case "context.source-current": return renderSources(status);
    case "context.review-current": return renderReview(status);
    case "context.package-current": return renderPackages(status);
    case "context.document-optimization-current": return renderDocumentOptimization(status);
  }
}

export function isContextWorkflowResourceId(
  value: string,
): value is ContextWorkflowResourceId {
  return (CONTEXT_WORKFLOW_RESOURCE_IDS as readonly string[]).includes(value);
}
