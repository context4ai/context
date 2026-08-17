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
  runCaptureProseInvestigation,
  runAlignProsePhase,
  type ProseAlignRunOptions,
} from "./proseAlign.js";
import {
  runCompileProsePhase,
} from "./proseCompile.js";
import {
  findPhaseForRun,
  isDocumentPhase,
  isDocumentPhasePreview,
  normalizeRunPhasesForList,
  previewDocumentPhase,
  type DocumentPhasePreview,
  type ProjectPhaseListEntry,
} from "./documentRun.js";
import {
  previewExtractTsPhase,
  runExtractTsPhase,
  type ExtractTsPhasePreview,
} from "./extractCandidates.js";
import { runExtractCustomPhase } from "./customExtractCandidates.js";
import { ensureRepoSources } from "./repoSources.js";
import { writeReviewHtml } from "./reviewHtml.js";
import { errorView, resultSummary, writeRunSuccess, type ProjectRunFormat } from "./runOutput.js";
import { createPhaseRunId, writePhaseRunLog } from "./runLog.js";
import { validateProjectRunOptions } from "./runOptionValidation.js";
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

type PhaseRunPreview = ExtractTsPhasePreview | DocumentPhasePreview;

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
    case "lifecycle.candidates":
      return `lifecycle:candidates:${resource.collection ?? "*"}:${resource.status ?? "*"}`;
    case "lifecycle.structure":
      return `lifecycle:structure:*:${resource.status ?? "*"}`;
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
    case "lifecycle.candidates":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
        ...(resource.collection !== undefined ? { collection: resource.collection } : {}),
        ...(resource.status !== undefined ? { status: resource.status } : {}),
      };
    case "lifecycle.structure":
      return {
        kind: resource.kind,
        label,
        path: resource.path,
        ...(resource.profileCollection !== undefined ? { profileCollection: resource.profileCollection } : {}),
        ...(resource.status !== undefined ? { status: resource.status } : {}),
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

function previewBody(preview: PhaseRunPreview): string[] {
  if (isDocumentPhasePreview(preview)) {
    const lines: string[] = [
      `source: ${preview.source.type}:${preview.source.name}`,
      `planned output: ${preview.candidateTree.map((entry) => entry.path).join(", ") || "none"}`,
      `source refs: ${preview.sourceRefExamples.join(", ") || "none"}`,
      `next action: ${preview.next_action.command}`,
    ];
    if (preview.snapshot !== undefined) {
      lines.push(`snapshot: ${preview.snapshot.manifest} (${preview.snapshot.exists ? "present" : "missing"})`);
    }
    for (const example of preview.knowledgePathExamples.slice(0, 5)) {
      lines.push(`knowledge path example: ${example.path} (${example.source_ref})`);
    }
    return lines;
  }

  const lines: string[] = [
    `include: ${preview.include.length > 0 ? preview.include.join(", ") : "none"}`,
    `entry mode: ${preview.mode}`,
    ...(preview.entries !== undefined ? [`entries: ${preview.entries.join(", ")}`] : []),
    `exported-only: ${preview.exportedOnly ? "yes" : "no"}`,
    `preview: ${preview.totals.sources} source(s), ${preview.totals.modules} module(s), discovered ${preview.totals.discoveredFiles} file(s), AST analyzed ${preview.totals.analyzedFiles} file(s), skipped ${preview.totals.skippedFiles} file(s), ${preview.totals.symbols} symbol(s), ${preview.totals.relations} relation(s), candidate estimate ${preview.totals.candidateEstimate}`,
  ];
  for (const source of preview.sources) {
    const head = source.head === undefined ? "" : ` head:${source.head.slice(0, 12)}`;
    lines.push(`source ${source.name}:${head} ref:${source.ref.slice(0, 12)} materialized:${source.materializedAt}`);
    for (const module of source.modules) {
      const version = module.version === undefined ? "" : `@${module.version}`;
      const kinds = Object.entries(module.candidateKinds)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${kind}:${count}`)
        .join(", ");
      lines.push(`  module ${module.path} (${module.name}${version}): discovered ${module.discoveredFiles}, AST analyzed ${module.analyzedFiles}, skipped ${module.skippedFiles}, symbols ${module.symbols} (${module.exportedSymbols} exported, ${module.internalSymbols} internal), relations ${module.relations}, candidates ${module.candidateEstimate}`);
      lines.push(`    entries: ${module.entryFiles.join(", ") || "none"}`);
      lines.push(`    candidate kinds: ${kinds || "none"}`);
      for (const reason of module.skippedReasons) lines.push(`    skipped reason: ${reason}`);
    }
    for (const moduleError of source.moduleErrors) {
      lines.push(`  module error ${moduleError.module_path}: ${moduleError.error}`);
    }
  }
  if (preview.knowledgeTree.length > 0) {
    lines.push("approved knowledge tree preview:");
    for (const line of preview.knowledgeTree) {
      lines.push(`  ${line}`);
    }
  }
  if (preview.knowledgePathExamples.length > 0) {
    lines.push("approved path examples:");
    for (const example of preview.knowledgePathExamples.slice(0, 5)) {
      lines.push(`  ${example.path} (${example.title}, ${example.kind}, source:${example.source})`);
    }
  }
  for (const hint of preview.agent_hints) {
    lines.push(`hint ${hint.code}: ${hint.message}${hint.command ? `; ${hint.command}` : ""}`);
  }
  return lines;
}

function writeRunPlan(
  plan: ProjectPhaseRunPlan,
  format: ProjectRunFormat,
  preview?: PhaseRunPreview,
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
  runId: string;
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
    extract: {
      ts: async (options) => {
        await runExtractTsPhase({
          projectRoot: input.projectRoot,
          phase: options,
          runId: input.runId,
        });
      },
    },
    review: {
      html: async (options) => {
        await writeReviewHtml({
          projectRoot: input.projectRoot,
          ...(options.collection !== undefined ? { collection: options.collection } : { all: true }),
        });
      },
    },
  };
}

export async function runProjectPhaseCommand(input: {
  cwd: string;
  phaseId?: string;
  list?: boolean;
  dryRun?: boolean;
  autoPromote?: boolean;
  managed?: boolean;
  workflowRevision?: string;
  resourceReceiptsReference?: string;
  authorities?: readonly ContextWorkflowAuthority[];
  verbose?: boolean;
  format?: ProjectRunFormat;
  align?: ProseAlignRunOptions;
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
  validateProjectRunOptions({ phase, options: input.align ?? {} });
  if (input.autoPromote === true && (
    phase.kind !== "phase.extract.ts" ||
    phase.collection !== "codegraph" ||
    input.dryRun === true
  )) {
    throw new ContextError(ExitCode.UserError, "--auto-promote is only valid when executing a phase.extract.ts codegraph phase", {
      category: ErrorCategory.UserInputInvalid,
      phaseId: phase.id,
      phaseKind: phase.kind,
      next: `Run context run ${phase.id}${phase.kind === "phase.extract.ts" ? " --auto-promote" : ""} without --dry-run.`,
    });
  }
  if (input.dryRun === true) {
    let preview: PhaseRunPreview | undefined;
    let previewError: { message: string; detail?: unknown } | undefined;
    if (phase.kind === "phase.extract.ts") {
      try {
        preview = await previewExtractTsPhase({
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
          const view = errorView(error);
          previewError = {
            message: view.message,
            ...(view.code !== undefined ? { detail: { code: view.code } } : {}),
          };
        }
      }
    } else if (isDocumentPhase(phase)) {
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
    if (phase.kind === "phase.extract.ts") {
      result = await runExtractTsPhase({
        projectRoot: found.projectRoot,
        phase,
        runId,
        ...(input.autoPromote === true ? { autoPromote: true } : {}),
      });
    } else if (phase.kind === "phase.extract.custom") {
      result = await runExtractCustomPhase({
        projectRoot: found.projectRoot,
        phase,
        runId,
      });
    } else if (phase.kind === "phase.custom") {
      result = await phase.run(customPhaseContext({
        projectRoot: found.projectRoot,
        runId,
      }));
    } else if (phase.kind === "phase.capture.file") {
      if (input.align?.view !== undefined || input.align?.schema === true) {
        result = await runCaptureProseInvestigation({
          projectRoot: found.projectRoot,
          phase,
          options: input.align,
        });
      } else {
        result = await runCaptureFilePhase({
          projectRoot: found.projectRoot,
          phase,
        });
      }
    } else if (phase.kind === "phase.capture.lark") {
      if (input.align?.view !== undefined || input.align?.schema === true) {
        result = await runCaptureProseInvestigation({
          projectRoot: found.projectRoot,
          phase,
          options: input.align,
        });
      } else {
        result = await runCaptureLarkPhase({
          projectRoot: found.projectRoot,
          phase,
          ...(input.larkRunner !== undefined ? { larkRunner: input.larkRunner } : {}),
        });
      }
    } else if (phase.kind === "phase.align.prose") {
      result = await runAlignProsePhase({
        projectRoot: found.projectRoot,
        phase,
        options: {
          ...(input.align ?? {}),
          ...(input.managed === true ? { managed: true } : {}),
        },
      });
    } else if (phase.kind === "phase.compile.prose") {
      result = await runCompileProsePhase({
        projectRoot: found.projectRoot,
        phase,
        options: input.align ?? {},
      });
    } else {
      throw new ContextError(
        ExitCode.UserError,
        `unsupported phase kind: ${phase.kind}; inspect the phase with --dry-run`,
        {
          category: ErrorCategory.UserInputInvalid,
          phaseId: phase.id,
          phaseKind: phase.kind,
          next: `context run ${phase.id} --dry-run`,
        },
      );
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
