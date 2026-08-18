import type { ProjectStatus } from "../statusTypes.js";

export const CONTEXT_WORKFLOW_RESOURCE_IDS = [
  "context.workspace-current",
  "context.verification-current",
  "context.source-boundary",
  "context.source-current",
  "context.structure-current",
  "context.review-current",
  "context.package-current",
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
- Pending extraction phases: ${status.pendingExtractPhases.length}
- Unclassified documents: ${status.unclassifiedDocumentTargets.length}
- Pending structure targets: ${status.pendingStructureTargets.length}
- Active structure slots: ${status.activeStructures.slotCount}
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
- Extraction phases: ${status.pendingExtractPhases.length === 0
    ? "none"
    : status.pendingExtractPhases.map(inline).join(", ")}
- Stale extraction phases: ${status.staleSourcePhases.length === 0
    ? "none"
    : status.staleSourcePhases.map(inline).join(", ")}
- Unclassified documents: ${status.unclassifiedDocumentTargets.length === 0
    ? "none"
    : status.unclassifiedDocumentTargets.map((target) => inline(target.sourceKey)).join(", ")}
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

function renderStructure(status: ProjectStatus): string {
  const activeSlots = status.activeStructures.slots.map((slot) =>
    `${inline(slot.sourceKey)} / ${inline(slot.collection)} — ${inline("active")}, digest=${inline(slot.structureDigest)}`
  );
  const pendingSlots = status.structureBatch.slots
    .filter((slot) => slot.stage !== "structure-active")
    .map((slot) =>
      `${inline(slot.sourceKey)}${slot.collection === undefined ? "" : ` / ${inline(slot.collection)}`} — ${inline(slot.stage)}` +
      (slot.configurationGaps === undefined || slot.configurationGaps.length === 0
        ? ""
        : `, missing=${slot.configurationGaps.map(inline).join(", ")}`)
    );
  const staged = status.stagedStructure.state === "draft"
    ? [
        `- Sources: ${(status.stagedStructure.sourceKeys ?? []).map(inline).join(", ") || "none"}`,
        `- Collections: ${(status.stagedStructure.collections ?? []).map(inline).join(", ") || "none"}`,
        `- Digest: ${status.stagedStructure.structureDigest === undefined ? "unavailable" : inline(status.stagedStructure.structureDigest)}`,
        `- Counts: ${status.stagedStructure.nodeCount ?? 0} node(s), ${status.stagedStructure.viewCount ?? 0} view(s), ${status.stagedStructure.sectionCount ?? 0} section(s), ${status.stagedStructure.sourceRefCount ?? 0} source ref(s), ${status.stagedStructure.edgeCount ?? 0} edge(s), ${status.stagedStructure.unresolvedCount ?? 0} unresolved`,
        `- Diagnostics: ${status.stagedStructure.diagnostics.length}`,
      ].join("\n")
    : "No structure is staged for confirmation.";
  const compile = status.compileBatch === undefined
    ? "No compile batch is active."
    : `${status.compileBatch.plannedViewRefs.length - status.compileBatch.remainingViewRefs.length}/${status.compileBatch.plannedViewRefs.length} view(s) prepared; ${status.compileBatch.remainingViewRefs.length} remaining.`;
  return `# Current document structure batch

## Batch

- State: ${inline(status.structureBatch.state)}
- Sources in current batch: ${status.structureBatch.sourceCount}
- Active slots: ${status.activeStructures.slotCount}
- Pending or unclassified slots: ${pendingSlots.length}
- Staged structure: ${inline(status.stagedStructure.state)}
- Active snapshots: ${inline(status.activeStructures.state)}
- Compile: ${compile}

## Staged confirmation target

${staged}

## Active confirmed slots

${bullets(activeSlots)}

## Pending or unclassified slots

${bullets(pendingSlots)}

## Configuration gaps

${bullets(status.configurationGaps.map(inline))}
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

Apply only a decision payload whose scope and candidate-set identity match the current review. A managed session may approve the complete current scope atomically; ordinary review still uses the user's exact payload.
`;
}

function renderPackages(status: ProjectStatus): string {
  const packages = status.packages.flatMap((item) => {
    const summary =
      `${inline(item.name)} — ${inline(item.state)}, kind=${inline(item.kind)}, inputs=${item.inputFiles}, outputs=${item.outputFiles}`;
    if (item.assetDelivery?.optimization?.state !== "recommended") return [summary];
    const optimization = item.assetDelivery.optimization;
    return [
      summary,
      `  - optional asset optimization: ${optimization.candidateFiles} PNG/JPEG file(s), ${optimization.originalBytes} byte(s); run ${inline("bun add -D sharp")} and configure ${inline("kbPackage().assets.optimize")} only for bundled delivery`,
    ];
  });
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

export function renderContextWorkflowResource(
  id: ContextWorkflowResourceId,
  status: ProjectStatus,
): string {
  switch (id) {
    case "context.workspace-current": return renderWorkspace(status);
    case "context.verification-current": return renderVerification(status);
    case "context.source-boundary": return renderSourceBoundary(status);
    case "context.source-current": return renderSources(status);
    case "context.structure-current": return renderStructure(status);
    case "context.review-current": return renderReview(status);
    case "context.package-current": return renderPackages(status);
  }
}

export function isContextWorkflowResourceId(
  value: string,
): value is ContextWorkflowResourceId {
  return (CONTEXT_WORKFLOW_RESOURCE_IDS as readonly string[]).includes(value);
}
