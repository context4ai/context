import {
  type ContextPhaseContext,
  type PhaseDefinition,
  type PhaseResourceReference,
} from "@c4a/context";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import type { LarkRunner } from "../lib/feishu.js";
import { ExitCode } from "../types/exitCode.js";
import {
  runCaptureFilePhase,
} from "./documentCapture.js";
import {
  runCaptureLarkPhase,
} from "./documentCaptureLark.js";
import {
  findPhaseForRun,
  normalizeRunPhasesForList,
  previewDocumentPhase,
  type DocumentPhasePreview,
  type ProjectPhaseListEntry,
} from "./documentRun.js";
import { ensureRepoSources } from "./repoSources.js";
import { errorView, resultSummary, writeRunSuccess, type ProjectRunFormat } from "./runOutput.js";
import { createPhaseRunId, writePhaseRunLog } from "./runLog.js";
import { findContextProjectRoot, loadContextProjectModule } from "./workspace.js";
import { bindWorkflowExecutionContext } from "./workflow/workflowExecutionContext.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export interface ProjectPhaseRunPlan {
  projectRoot: string;
  phase: {
    id: string;
    kind: PhaseDefinition["kind"];
    reads: string[];
    writes: string[];
    readResources: ProjectPhaseResourcePlan[];
    writeResources: ProjectPhaseResourcePlan[];
  };
  dryRun: boolean;
}

export interface ProjectPhaseResourcePlan {
  kind: PhaseResourceReference["kind"];
  label: string;
  path?: string;
  sourceType?: string;
  sourceName?: string;
  collection?: string;
  status?: string;
  packageName?: string;
  packageKind?: string;
}

function resourceLabel(resource: PhaseResourceReference): string {
  switch (resource.kind) {
    case "source":
      if (resource.source.kind === "source.collection") return `source:${resource.source.type}:*`;
      if (resource.source.kind === "source.ref") {
        const sourceType = "type" in resource.source ? resource.source.type : "registry";
        return `source:${sourceType}:${resource.source.name}`;
      }
      if (resource.source.kind === "source.repo") return `source:repo:${resource.source.name}`;
      if (resource.source.kind === "source.file") return `source:file:${resource.source.name}`;
      return `source:lark:${resource.source.name}`;
    case "source.snapshot":
      return `source-snapshot:${resource.sourceType}:${resource.source.name}`;
    case "knowledge.collection":
      return `knowledge:${resource.collection}:approved`;
    case "knowledge.approved":
      return "knowledge:approved";
    case "knowledge.decisions":
      return "knowledge:decisions";
    case "package.template":
      return `template:${resource.path}`;
    case "review.payload":
      return `review-payload:${resource.path}`;
    case "dist.package":
      return `dist:${resource.packageKind}:${resource.packageName}`;
  }
}

function sourceResourceName(resource: PhaseResourceReference): string | undefined {
  if (resource.kind !== "source" && resource.kind !== "source.snapshot") return undefined;
  const source = resource.source;
  if (source.kind === "source.collection") return "*";
  return source.name;
}

function phaseResourcePlan(resource: PhaseResourceReference): ProjectPhaseResourcePlan {
  const label = resourceLabel(resource);
  switch (resource.kind) {
    case "source": {
      const sourceName = sourceResourceName(resource);
      const sourceType = resource.source.kind === "source.collection"
        ? resource.source.type
        : "type" in resource.source
          ? resource.source.type
          : undefined;
      return {
        kind: resource.kind,
        label,
        ...(sourceType !== undefined ? { sourceType } : {}),
        ...(sourceName !== undefined ? { sourceName } : {}),
      };
    }
    case "source.snapshot":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
        sourceType: resource.sourceType,
        sourceName: resource.source.name,
      };
    case "knowledge.collection":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
        collection: resource.collection,
        status: resource.status,
      };
    case "knowledge.approved":
    case "knowledge.decisions":
    case "package.template":
    case "review.payload":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
      };
    case "dist.package":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
        packageName: resource.packageName,
        packageKind: resource.packageKind,
      };
  }
}

function phasePlan(projectRoot: string, phase: PhaseDefinition, dryRun: boolean): ProjectPhaseRunPlan {
  return {
    projectRoot,
    phase: {
      id: phase.id,
      kind: phase.kind,
      reads: phase.reads.map(resourceLabel),
      writes: phase.writes.map(resourceLabel),
      readResources: phase.reads.map(phaseResourcePlan),
      writeResources: phase.writes.map(phaseResourcePlan),
    },
    dryRun,
  };
}

function writePhaseList(projectRoot: string, entries: readonly ProjectPhaseListEntry[], format: ProjectRunFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      projectRoot,
      phases: entries.map((entry) => ({
        ...phasePlan(projectRoot, entry.phase, true).phase,
        ...(entry.diagnostics !== undefined && entry.diagnostics.length > 0 ? { diagnostics: entry.diagnostics } : {}),
      })),
    }, null, 2)}\n`);
    return;
  }

  const lines = entries.length === 0
    ? ["phases: none"]
    : entries.flatMap((entry) => {
        const plan = phasePlan(projectRoot, entry.phase, true);
        const reads = plan.phase.reads.length > 0 ? plan.phase.reads.join(", ") : "none";
        const writes = plan.phase.writes.length > 0 ? plan.phase.writes.join(", ") : "none";
        const diagnostics = (entry.diagnostics ?? []).map((diagnostic) =>
          `  diagnostic ${diagnostic.category}: ${diagnostic.message}${diagnostic.next !== undefined ? `; next:${diagnostic.next}` : ""}`,
        );
        return [
          `phase ${entry.phase.id} (${entry.phase.kind}) reads:${reads} writes:${writes}`,
          ...diagnostics,
        ];
      });
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "listed",
    subject: "project phases",
    headline: `${entries.length} phase(s)`,
    body: [
      `root: ${projectRoot}`,
      ...lines,
    ],
  }));
}

function previewBody(preview: DocumentPhasePreview): string[] {
  const lines: string[] = [
    `source: ${preview.source.type}:${preview.source.name}`,
    `source refs: ${preview.sourceRefExamples.join(", ") || "none"}`,
    `next action: ${preview.next_action.command}`,
  ];
  if (preview.snapshot !== undefined) {
    lines.push(`snapshot: ${preview.snapshot.manifest} (${preview.snapshot.exists ? "present" : "missing"})`);
  }
  return lines;
}

function writeRunPlan(
  plan: ProjectPhaseRunPlan,
  format: ProjectRunFormat,
  preview?: DocumentPhasePreview,
  previewError?: { message: string; detail?: unknown },
): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      ...plan,
      ...(preview !== undefined ? { preview } : {}),
      ...(previewError !== undefined ? { preview_error: previewError } : {}),
    }, null, 2)}\n`);
    return;
  }

  const body = [
    `dry-run: ${plan.dryRun ? "yes" : "no"}`,
    `reads: ${plan.phase.reads.length > 0 ? plan.phase.reads.join(", ") : "none"}`,
    `writes: ${plan.phase.writes.length > 0 ? plan.phase.writes.join(", ") : "none"}`,
    ...(preview !== undefined ? previewBody(preview) : []),
    ...(previewError !== undefined ? [`preview unavailable: ${previewError.message}`] : []),
  ];

  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "planned",
    subject: plan.phase.id,
    headline: plan.phase.kind,
    body,
  }));
}

function customPhaseContext(input: {
  projectRoot: string;
}): ContextPhaseContext {
  return {
    ensureSources: async (options) => {
      const source = options?.source;
      if (source === undefined) {
        await ensureRepoSources({ projectRoot: input.projectRoot });
        return;
      }
      if (source.kind === "source.repo" || (source.kind === "source.ref" && (!("type" in source) || source.type === "repo"))) {
        await ensureRepoSources({ projectRoot: input.projectRoot, name: source.name });
      }
    },
  };
}

export async function runProjectPhaseCommand(input: {
  cwd: string;
  phaseId?: string;
  list?: boolean;
  dryRun?: boolean;
  managed?: boolean;
  workflowRevision?: string;
  resourceReceiptsReference?: string;
  authorities?: readonly ContextWorkflowAuthority[];
  verbose?: boolean;
  format?: ProjectRunFormat;
  larkRunner?: LarkRunner;
}): Promise<void> {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "context run requires a context project", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }

  const loaded = await loadContextProjectModule(found.projectRoot);
  const format = input.format ?? "text";
  if (input.list === true || input.phaseId === undefined) {
    const phaseEntries = await normalizeRunPhasesForList({
      projectRoot: found.projectRoot,
      phases: loaded.project.phases,
    });
    writePhaseList(found.projectRoot, phaseEntries, format);
    return;
  }

  const phase = await findPhaseForRun({
    projectRoot: found.projectRoot,
    phases: loaded.project.phases,
    phaseId: input.phaseId,
    dryRun: input.dryRun === true,
  });
  if (phase === undefined) {
    const phaseEntries = await normalizeRunPhasesForList({
      projectRoot: found.projectRoot,
      phases: loaded.project.phases,
    });
    throw new ContextError(ExitCode.UserError, `phase is not declared: ${input.phaseId}`, {
      category: ErrorCategory.UserInputInvalid,
      code: "phase-not-declared",
      phaseId: input.phaseId,
      next: "context status --format json",
      available: phaseEntries.map((entry) => entry.phase.id),
      diagnostics: phaseEntries.flatMap((entry) => entry.diagnostics ?? []),
    });
  }

  const plan = phasePlan(found.projectRoot, phase, input.dryRun === true);
  if (input.dryRun === true) {
    let preview: DocumentPhasePreview | undefined;
    let previewError: { message: string; detail?: unknown } | undefined;
    if (phase.kind === "phase.capture.file" || phase.kind === "phase.capture.lark") {
      try {
        preview = await previewDocumentPhase({
          projectRoot: found.projectRoot,
          phase,
        });
      } catch (error) {
        if (error instanceof ContextError) {
          previewError = {
            message: error.message,
            detail: error.detail,
          };
        } else {
          previewError = { message: errorView(error).message };
        }
      }
    }
    writeRunPlan(plan, format, preview, previewError);
    return;
  }

  const runId = createPhaseRunId();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    let result: unknown;
    if (phase.kind === "phase.custom") {
      result = await phase.run(customPhaseContext({
        projectRoot: found.projectRoot,
      }));
    } else if (phase.kind === "phase.capture.file") {
      result = await runCaptureFilePhase({
        projectRoot: found.projectRoot,
        phase,
      });
    } else if (phase.kind === "phase.capture.lark") {
      result = await runCaptureLarkPhase({
        projectRoot: found.projectRoot,
        phase,
        ...(input.larkRunner !== undefined ? { larkRunner: input.larkRunner } : {}),
      });
    }

    result = bindWorkflowExecutionContext(result, {
      managed: input.managed === true,
      authorities: input.authorities ?? [],
      ...(input.workflowRevision === undefined
        ? {}
        : { revision: input.workflowRevision }),
      ...(input.resourceReceiptsReference === undefined
        ? {}
        : { resourceReceiptsReference: input.resourceReceiptsReference }),
    });
    const durationMs = Date.now() - started;
    const summary = resultSummary(result);
    const logPath = await writePhaseRunLog({
      projectRoot: found.projectRoot,
      runId,
      phase,
      dryRun: false,
      reads: plan.phase.reads,
      writes: plan.phase.writes,
      status: "success",
      startedAt,
      durationMs,
      ...(summary ? { summary } : {}),
    });
    writeRunSuccess({
      plan,
      result,
      logPath,
      format,
      verbose: input.verbose === true,
    });
  } catch (err) {
    const durationMs = Date.now() - started;
    const error = errorView(err);
    const logPath = await writePhaseRunLog({
      projectRoot: found.projectRoot,
      runId,
      phase,
      dryRun: false,
      reads: plan.phase.reads,
      writes: plan.phase.writes,
      status: "failed",
      startedAt,
      durationMs,
      error,
    });
    if (err instanceof ContextError) {
      throw new ContextError(err.code, err.message, {
        ...err.detail,
        phaseId: phase.id,
        phaseKind: phase.kind,
        reads: plan.phase.reads,
        writes: plan.phase.writes,
        duration_ms: durationMs,
        log: logPath,
      });
    }
    throw new ContextError(ExitCode.ExternalToolError, error.message, {
      category: ErrorCategory.Unknown,
      phaseId: phase.id,
      phaseKind: phase.kind,
      reads: plan.phase.reads,
      writes: plan.phase.writes,
      duration_ms: durationMs,
      log: logPath,
      error: {
        name: error.name,
        ...(error.code !== undefined ? { code: error.code } : {}),
      },
    });
  }
}
