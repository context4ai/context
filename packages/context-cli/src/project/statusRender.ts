import { formatFeedback } from "../lib/cliFeedback.js";
import type { ProjectStatus } from "./statusTypes.js";

export function formatProjectStatus(status: ProjectStatus): string {
  const repoSourceLines = status.sources.map((source) =>
      `source ${source.name}: ${source.ready ? "ready" : "not-ready"} ` +
      `(local=${source.local ?? "-"}, ref=${source.ref}, materialized=${source.materialized ? "yes" : "no"})`
    );
  const documentSourceLines = status.documentSources.map((source) =>
    `source ${source.name}: ${source.snapshotReady ? "captured" : "needs-capture"} ` +
    `(type=${source.type}, materialized=${source.materializedAt}, manifest=${source.manifest})`
  );
  const sourceLines = repoSourceLines.length + documentSourceLines.length === 0
    ? ["sources: none"]
    : [...repoSourceLines, ...documentSourceLines];
  const diagnostics = status.sources.flatMap((source) =>
    source.diagnostics.map((diagnostic) => `diagnostic ${source.name}: ${diagnostic}`)
  );
  const documentDiagnostics = status.documentSources.flatMap((source) =>
    source.diagnostics.map((diagnostic) => `diagnostic ${source.name}: ${diagnostic}`)
  );
  const projectDiagnostics = status.diagnostics.map((diagnostic) => `diagnostic project: ${diagnostic}`);
  const hints = status.sources.flatMap((source) =>
    source.agent_hints.map((hint) => `agent hint ${source.name}: ${hint}`)
  );
  const documentHints = status.documentSources.flatMap((source) =>
    source.agent_hints.map((hint) => `agent hint ${source.name}: ${hint}`)
  );
  const packageLines = status.packages.length === 0
    ? ["packages: none"]
    : status.packages.flatMap((pkg) => [
      `package ${pkg.name}: ${pkg.state} (kind=${pkg.kind}, inputs=${pkg.inputFiles}, outputs=${pkg.outputFiles})`,
      ...(pkg.assetDelivery?.optimization?.state === "recommended"
        ? [`agent hint ${pkg.name}: package.assets.optimization-recommended; run bun add -D sharp and configure kbPackage.assets in src/index.ts`]
        : []),
    ]);
  return formatFeedback({
    symbol: status.verifyErrors > 0 || status.diagnostics.length > 0 ? "⚠" : "✓",
    action: "inspected",
    subject: "context project",
    headline: status.state,
    body: [
      "**Next action**:",
      `- ${status.next}`,
      `- human gate → ${status.routing.human_gate.required ? `${status.routing.human_gate.kind} (${status.routing.human_gate.confirmation}, ${status.routing.human_gate.persistence})` : "none"}`,
      ...(status.routing.configuration === undefined
        ? []
        : [`- configuration → ${status.routing.configuration.file}: ${status.routing.configuration.action}`]),
      ...status.routing.command_plan.map((item) => `- command (${item.availability}) → \`${item.command}\``),
      "",
      "**Project**:",
      `- root → \`${status.projectRoot}\``,
      `- state: ${status.state}`,
      ...(status.executionMode !== undefined
        ? [`- execution mode: ${status.executionMode.mode} (${status.executionMode.scope})`]
        : []),
      `- sources: ${status.readySources}/${status.sourceCount} ready`,
      `- draft candidates: ${status.draftCandidates}`,
      `- approved pages: ${status.approvedPages}`,
      `- packages: ${status.packageCount}`,
      `- dist files: ${status.distFiles}`,
      `- phases: ${status.phases.length > 0 ? status.phases.join(", ") : "none"}`,
      `- staged structure: ${status.stagedStructure.state}`,
      `- active structures: ${status.activeStructures.count} (${status.activeStructures.state})`,
      `- structure batch: ${status.structureBatch.state}, ${status.structureBatch.slotCount} slot(s) across ${status.structureBatch.sourceCount} source(s)`,
      `- unclassified document targets: ${status.unclassifiedDocumentTargets.length}`,
      `- pending structure targets: ${status.pendingStructureTargets.length}`,
      ...(status.compileBatch !== undefined
        ? [`- compile batch: ${status.compileBatch.plannedViewRefs.length - status.compileBatch.remainingViewRefs.length}/${status.compileBatch.plannedViewRefs.length} prepared, ${status.compileBatch.remainingViewRefs.length} remaining`]
        : []),
      `- source freshness: ${status.sourceFreshness}`,
      `- pending capture phases: ${status.pendingCapturePhases.length}`,
      `- pending extract phases: ${status.pendingExtractPhases.length}`,
      `- close: ${status.close.state}`,
      `- evidence status: ${status.evidenceStatus}`,
      `- evidence warning: ${status.evidenceWarnings}`,
      `- verify: ${status.verifyErrors} error(s), ${status.verifyWarnings} warning(s)`,
      `- projection refresh: ${status.projectionRefreshIssues} derived issue(s)`,
      "",
      "**Sources**:",
      ...sourceLines.map((line) => `- ${line}`),
      "",
      "**Packages**:",
      ...packageLines.map((line) => `- ${line}`),
      projectDiagnostics.length + diagnostics.length + documentDiagnostics.length + hints.length + documentHints.length > 0 ? "" : undefined,
      projectDiagnostics.length + diagnostics.length + documentDiagnostics.length > 0 ? "**Diagnostics**:" : undefined,
      ...projectDiagnostics.map((line) => `- ${line}`),
      ...diagnostics.map((line) => `- ${line}`),
      ...documentDiagnostics.map((line) => `- ${line}`),
      hints.length + documentHints.length > 0 ? "" : undefined,
      hints.length + documentHints.length > 0 ? "**Hints**:" : undefined,
      ...hints.map((line) => `- ${line}`),
      ...documentHints.map((line) => `- ${line}`),
    ],
    next: status.next,
  });
}
