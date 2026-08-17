import { resolve } from "node:path";
import type { AlignProsePhaseDefinition } from "@c4a/context";
import { ErrorCategory, formatFeedback } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { runAlignProsePhase } from "./proseAlign.js";
import type {
  ProseAlignRunResult,
  StageResult,
  ValidateResult,
} from "./proseAlignTypes.js";
import { findContextProjectRoot, loadContextProjectModule } from "./workspace.js";

export const PROSE_STRUCTURE_BATCH_SCHEMA = "context.prose.structure-batch.v1";

interface ProseStructureBatchItem {
  phaseId: string;
  input: string;
}

interface ProseStructureBatchValidation {
  phase_id: string;
  input: string;
  state: ValidateResult["state"];
  valid: boolean;
  structure_digest: string;
  nodes: number;
  views: number;
  sections: number;
  diagnostics: number;
  confirmation_blockers: number;
  self_healed?: ValidateResult["self_healed"];
  diagnostics_command: string;
}

export interface ProseStructureBatchResult {
  kind: "prose.structure-batch.result";
  schema: typeof PROSE_STRUCTURE_BATCH_SCHEMA;
  operation: "validated" | "staged";
  state: "ready" | "invalid" | "staged" | "confirmed";
  targets: number;
  ready: number;
  written: number;
  validations: ProseStructureBatchValidation[];
  writes: Array<{
    phase_id: string;
    operation: StageResult["operation"];
    structure_digest: string;
    nodes: number;
    views: number;
    self_healed?: StageResult["self_healed"];
  }>;
  next_action: {
    kind: "stage_structure_batch" | "repair_structure_batch" | "reevaluate_workspace";
    command: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/=-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function parseBatchPayload(value: unknown): ProseStructureBatchItem[] {
  if (!isRecord(value) || value.schema !== PROSE_STRUCTURE_BATCH_SCHEMA || !Array.isArray(value.items)) {
    throw new ContextError(ExitCode.UserError, `batch input must match ${PROSE_STRUCTURE_BATCH_SCHEMA}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Read the current Route action input_schema and provide one phase_id/input pair per pending structure slot.",
    });
  }
  if (value.items.length === 0 || value.items.length > 100) {
    throw new ContextError(ExitCode.UserError, "structure batch items must contain 1 to 100 entries", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const seen = new Set<string>();
  return value.items.map((item, index) => {
    if (!isRecord(item) || typeof item.phase_id !== "string" || typeof item.input !== "string") {
      throw new ContextError(ExitCode.UserError, `structure batch items[${index}] requires phase_id and input`, {
        category: ErrorCategory.UserInputInvalid,
      });
    }
    const phaseId = item.phase_id.trim();
    const input = item.input.trim();
    if (phaseId.length === 0 || input.length === 0) {
      throw new ContextError(ExitCode.UserError, `structure batch items[${index}] requires non-empty phase_id and input`, {
        category: ErrorCategory.UserInputInvalid,
      });
    }
    if (seen.has(phaseId)) {
      throw new ContextError(ExitCode.UserError, `structure batch contains duplicate phase_id: ${phaseId}`, {
        category: ErrorCategory.UserInputInvalid,
      });
    }
    seen.add(phaseId);
    return { phaseId, input };
  });
}

function alignPhase(
  phases: readonly { id: string; kind: string }[],
  phaseId: string,
): AlignProsePhaseDefinition {
  const phase = phases.find((item) => item.id === phaseId);
  if (phase === undefined || phase.kind !== "phase.align.prose") {
    throw new ContextError(ExitCode.UserError, `structure batch phase is not a declared alignProse phase: ${phaseId}`, {
      category: ErrorCategory.UserInputInvalid,
      phase_id: phaseId,
    });
  }
  return phase as AlignProsePhaseDefinition;
}

function validationSummary(
  phaseId: string,
  input: string,
  result: ValidateResult,
): ProseStructureBatchValidation {
  const counts = result.structure_summary_compact !== undefined &&
      isRecord(result.structure_summary_compact.counts)
    ? result.structure_summary_compact.counts
    : undefined;
  return {
    phase_id: phaseId,
    input,
    state: result.state,
    valid: result.valid,
    structure_digest: result.structure_digest,
    nodes: result.nodes,
    views: result.views,
    sections: counts !== undefined && typeof counts.sections === "number"
      ? counts.sections
      : 0,
    diagnostics: result.diagnostics.length,
    confirmation_blockers: result.confirmation_blockers.length,
    ...(result.self_healed === undefined ? {} : { self_healed: result.self_healed }),
    diagnostics_command: `context run ${shellQuote(phaseId)} --validate --input ${shellQuote(input)} --format json --verbose`,
  };
}

function assertValidationResult(result: ProseAlignRunResult, phaseId: string): ValidateResult {
  if (result.kind === "prose.align.validate.result") return result;
  throw new ContextError(ExitCode.WorkspaceStateError, `align phase did not return validation result: ${phaseId}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
  });
}

function assertStageResult(result: ProseAlignRunResult, phaseId: string): StageResult {
  if (result.kind === "prose.align.structure-write.result") return result;
  throw new ContextError(ExitCode.WorkspaceStateError, `align phase did not return structure write result: ${phaseId}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
  });
}

export async function runProseStructureBatch(input: {
  cwd: string;
  batchInput: string;
  operation: "validate" | "stage";
  managed: boolean;
}): Promise<ProseStructureBatchResult> {
  const found = findContextProjectRoot(input.cwd);
  if (found === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "structure batch requires a Context project", {
      category: ErrorCategory.WorkspaceNotFound,
    });
  }
  const raw = await readYamlOrJsonInput({
    path: input.batchInput,
    label: "prose structure batch",
    missingNext: "Pass --batch-input <payload.yaml|json>.",
    readFailureNext: "Repair the batch input path and retry.",
    parseFailureNext: "Repair the batch YAML/JSON and retry.",
  });
  const items = parseBatchPayload(raw);
  const loaded = await loadContextProjectModule(found.projectRoot);
  const resolved = items.map((item) => ({
    ...item,
    inputReference: item.input,
    input: resolve(found.projectRoot, item.input),
    phase: alignPhase(loaded.project.phases, item.phaseId),
  }));
  const validated = await Promise.all(resolved.map(async (item) => {
    const result = assertValidationResult(await runAlignProsePhase({
      projectRoot: found.projectRoot,
      phase: item.phase,
      options: { validate: true, input: item.input },
    }), item.phaseId);
    return { ...item, result };
  }));
  const validations = validated.map((item) =>
    validationSummary(item.phaseId, item.inputReference, item.result)
  );
  const ready = validations.filter((item) => item.state === "ready").length;
  const statusCommand = "context status --format json";
  if (ready !== items.length) {
    const result: ProseStructureBatchResult = {
      kind: "prose.structure-batch.result",
      schema: PROSE_STRUCTURE_BATCH_SCHEMA,
      operation: "validated",
      state: "invalid",
      targets: items.length,
      ready,
      written: 0,
      validations,
      writes: [],
      next_action: {
        kind: "repair_structure_batch",
        command: validations.find((item) => !item.valid)?.diagnostics_command ?? statusCommand,
      },
    };
    if (input.operation === "stage") {
      throw new ContextError(ExitCode.UserError, "structure batch contains targets that are not ready; no structure was written", {
        category: ErrorCategory.UserInputInvalid,
        result,
      });
    }
    return result;
  }
  if (input.operation === "validate") {
    return {
      kind: "prose.structure-batch.result",
      schema: PROSE_STRUCTURE_BATCH_SCHEMA,
      operation: "validated",
      state: "ready",
      targets: items.length,
      ready,
      written: 0,
      validations,
      writes: [],
      next_action: {
        kind: "stage_structure_batch",
        command: `context run --batch-input ${shellQuote(input.batchInput)} --stage${input.managed ? " --managed" : ""} --format json`,
      },
    };
  }

  const writes: ProseStructureBatchResult["writes"] = [];
  for (const item of resolved) {
    try {
      const result = assertStageResult(await runAlignProsePhase({
        projectRoot: found.projectRoot,
        phase: item.phase,
        options: {
          stage: true,
          input: item.input,
          ...(input.managed ? { managed: true } : {}),
        },
      }), item.phaseId);
      writes.push({
        phase_id: item.phaseId,
        operation: result.operation,
        structure_digest: result.structure_digest,
        nodes: result.nodes,
        views: result.views,
        ...(result.self_healed === undefined ? {} : { self_healed: result.self_healed }),
      });
    } catch (error) {
      throw new ContextError(ExitCode.WorkspaceStateError, `structure batch stopped after ${writes.length} successful write(s)`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        completed: writes,
        failed_phase_id: item.phaseId,
        reason: error instanceof Error ? error.message : String(error),
        next: statusCommand,
      });
    }
  }
  return {
    kind: "prose.structure-batch.result",
    schema: PROSE_STRUCTURE_BATCH_SCHEMA,
    operation: "staged",
    state: input.managed ? "confirmed" : "staged",
    targets: items.length,
    ready,
    written: writes.length,
    validations,
    writes,
    next_action: {
      kind: "reevaluate_workspace",
      command: statusCommand,
    },
  };
}

export function formatProseStructureBatchResult(
  result: ProseStructureBatchResult,
  format: "text" | "json",
): string {
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  return formatFeedback({
    symbol: result.state === "invalid" ? "⚠" : "✓",
    action: result.operation,
    subject: "prose structure batch",
    headline: `${result.ready}/${result.targets} ready, ${result.written} written`,
    body: result.validations.map((item) =>
      `${item.phase_id}: ${item.state} (${item.nodes} nodes, ${item.views} views, ${item.diagnostics} diagnostics)`
    ),
    next: result.next_action.command,
  });
}
