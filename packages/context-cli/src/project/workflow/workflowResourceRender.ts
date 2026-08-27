import type { ProjectStatus } from "../statusTypes.js";

export const CONTEXT_WORKFLOW_RESOURCE_IDS = [
  "context.workspace-current",
  "context.verification-current",
  "context.source-boundary",
  "context.source-current",
  "context.extraction-preview",
  "context.code-index-audit",
  "context.structure-current",
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

function renderExtractionPreview(status: ProjectStatus): string {
  const preview = status.extractionPreview.report;
  if (preview === undefined) {
    return `# Current code extraction preview\n\nNo current preview is available. Run the Route-selected batch preview command.\n`;
  }
  const units = preview.phases.flatMap((phase) => phase.indexUnits.map((unit) =>
    `${inline(unit.id)} — owner=${inline(unit.outputOwner)}, types=${unit.moduleTypes.map(inline).join("+")}, facets=${unit.facets.length === 0 ? "none" : unit.facets.map(inline).join("+")}, profile=${inline(unit.outputProfile)}, plan=${inline(unit.plan)}, pages=${unit.currentPageCount}→${unit.projectedPageCount}, changes=+${unit.changes.added}/~${unit.changes.updated}/-${unit.changes.removed}/=${unit.changes.unchanged}${unit.changes.exact ? "" : " (estimated)"}, scale=${inline(unit.scale)}, semantic-coverage=${unit.semanticCoverage === undefined ? "n/a" : `${unit.semanticCoverage.covered.length}/${unit.semanticCoverage.required.length}${unit.semanticCoverage.uncovered.length === 0 ? "" : ` missing:${unit.semanticCoverage.uncovered.map(inline).join("+")}`}`}, exported/internal=${unit.visibility.exported}/${unit.visibility.internal}, bytes=${unit.contentBytes.total}, max-page-bytes=${unit.contentBytes.max}, top-directories=${unit.topDirectories.map((item) => `${inline(item.path)}:${item.count}`).join(", ") || "none"}, risks=${unit.risks.length === 0 ? "none" : unit.risks.map(inline).join(", ")}`
  ));
  const capabilityGaps = preview.phases.flatMap((phase) =>
    "inspection" in phase
      ? phase.inspection.capabilityGaps.map((gap) =>
          `${inline(gap.indexUnitId)} — ${gap.reason}${gap.requestedMaterial === undefined ? "" : `; requested=${inline(gap.requestedMaterial)}`}`
        )
      : []
  );
  return `# Current code extraction preview

## Batch

- Digest: ${inline(preview.digest)}
- Index units: ${preview.totals.indexUnits}
- Projected pages: ${preview.totals.projectedPages}
- Projected content bytes: ${preview.totals.contentBytes}
- Warning units: ${preview.totals.warnings}
- Blocked units: ${preview.totals.blocked}
- Capability clear: ${inline(preview.capabilityClear)}
- Ownership clear: ${inline(preview.ownershipClear)}
- Scale clear: ${inline(preview.scaleClear)}
- Batch advisories: ${inline(preview.advisories.length === 0 ? "none" : preview.advisories.join(", "))}
- Reusable phase caches: ${preview.cache.reusablePhases}/${preview.totals.phases}

## Index units

${bullets(units)}

## Capability gaps

${bullets(capabilityGaps)}
`;
}

function renderCodeIndexAudit(status: ProjectStatus): string {
  const audit = status.codeIndexAudit;
  const report = audit.report;
  if (report === undefined) {
    return "# Current code-index audit\n\nNo code-index audit scope is available.\n";
  }
  const units = report.units.map((unit) =>
    `${inline(unit.id)} — profile=${inline(unit.output_profile)}, types=${unit.module_types.map(inline).join("+") || "unknown"}, pages=${unit.page_count}, facts=${unit.dimensions.find((dimension) => dimension.dimension === "semantic-fact-lines")?.observed ?? "unscorable"}, max-page-lines=${unit.max_page_lines}, absolute-failures=${unit.absolute_failure_count}, below-target=${unit.below_target_count}, actions=${unit.recommended_actions.map(inline).join(", ") || "none"}`
  );
  const dimensions = report.units.flatMap((unit) => unit.dimensions.map((dimension) =>
    `${inline(unit.id)} / ${inline(dimension.dimension)} — observed=${inline(dimension.observed ?? "unscorable")}${inline(dimension.unit)}, floor=${inline(dimension.floor ?? "n/a")}, target=${inline(dimension.target ?? "n/a")}, ceiling=${inline(dimension.ceiling ?? "n/a")}, score=${inline(dimension.score ?? "n/a")}, status=${inline(dimension.status)}, absolute-gate=${inline(dimension.absolute_gate)}, actions=${dimension.recommended_actions.map(inline).join(", ") || "none"}`
  ));
  const actionGuidance = report.units.flatMap((unit) => unit.action_guidance.map((guidance) =>
    `${inline(unit.id)} / ${inline(guidance.action)} — dimensions=${guidance.failed_dimensions.map(inline).join(", ") || "none"}; pages=${guidance.affected_pages.map(inline).join(", ") || "none"}; templates=${guidance.template_paths.map(inline).join(", ")}; configuration=${guidance.configuration_fields.map(inline).join(", ")}; expected=${guidance.expected_improvement.map(inline).join(", ") || "inspect-current-dimension"}`
  ));
  const guidanceDeltas = audit.guidance_units.flatMap((unit) => unit.dimension_deltas.map((delta) =>
    `${inline(unit.unit_id)} / ${inline(delta.dimension)} — before=${inline(delta.before ?? "unscorable")}, after=${inline(delta.after ?? "unscorable")}, delta=${inline(delta.delta ?? "unscorable")}, status=${inline(delta.status)}`
  ));
  const signals = report.signals.map((signal) =>
    `${inline(signal.severity)} ${inline(signal.id)} — ${signal.message}` +
    (signal.view_ref === undefined ? "" : `; page=${inline(signal.view_ref)}`)
  );
  const samples = report.page_samples.map((page) =>
    `${inline(page.view_ref)} — chars=${page.effective_chars}, evidence=${page.evidence_count}, section-scoped=${page.section_scoped_evidence_count}, sections=${page.section_count}, relations=${page.relation_count}`
  );
  return `# Current code-index audit

This report combines absolute mechanical quality bounds with a required Agent
semantic review. Absolute failures must be repaired; dimensions between their
floor and target should be improved toward target. Inspect the reported pages,
their evidence, and the user-confirmed scope, then submit one explicit decision:
\`accept\`, \`revise\`, or \`request-input\`.

## Batch

- Report digest: ${inline(report.digest)}
- Scope digest: ${inline(report.scope_digest)}
- Source: ${inline(report.source)}
- Units: ${report.summary.units}
- Pages: ${report.summary.pages}
- Effective prose characters: ${report.summary.effective_chars}
- Evidence items: ${report.summary.evidence}
- Sections: ${report.summary.sections}
- Relations: ${report.summary.relations}
- Signals: ${report.summary.signals} (${report.summary.elevated_signals} elevated)
- Current decision: ${audit.decision === undefined ? "none" : inline(audit.decision.decision)}
- Human guidance required: ${inline(audit.guidance_required)}

## Index units

${bullets(units)}

## Independent mechanical dimensions

${bullets(dimensions)}

## Concrete revision guidance

${bullets(actionGuidance)}

## Three-revision deltas

${bullets(guidanceDeltas)}

## Signals

${bullets(signals)}

## Evidence-heavy page samples

${bullets(samples)}

## Decision rule

- In fully managed work, fix every signal that represents a real scope,
  structure, evidence, or content-depth problem and repeat extraction until it
  converges. Do not accept a real problem merely to continue.
- A false positive may be accepted only with a concrete assessment tied to the
  inspected page and intended output profile.
- Submit the decision using the current Route input schema and report digest.
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
    case "context.extraction-preview": return renderExtractionPreview(status);
    case "context.code-index-audit": return renderCodeIndexAudit(status);
    case "context.structure-current": return renderStructure(status);
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
