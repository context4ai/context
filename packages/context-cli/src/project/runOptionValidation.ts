import type { PhaseDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { alignCommand, type ProseAlignRunOptions } from "./proseAlignTypes.js";

const WRITE_OPERATION_FLAGS = ["validate", "stage", "confirm"] as const;

function activeWriteOperations(options: ProseAlignRunOptions): string[] {
  return WRITE_OPERATION_FLAGS.filter((flag) => options[flag] === true)
    .map((flag) => `--${flag}`);
}

export function validateProjectRunOptions(input: {
  phase: PhaseDefinition;
  options: ProseAlignRunOptions;
}): void {
  const operations = activeWriteOperations(input.options);
  if (operations.length > 1) {
    throw new ContextError(ExitCode.UserError, "run write operations are mutually exclusive", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "ambiguous-run-operation",
      operations,
      next: `Choose exactly one of ${operations.join(", ")}.`,
    });
  }

  const documentWritePhase = input.phase.kind === "phase.align.prose" || input.phase.kind === "phase.compile.prose";
  const alignOnlyOperation = input.options.confirm === true;
  if ((operations.length > 0 && !documentWritePhase) ||
    (alignOnlyOperation && input.phase.kind !== "phase.align.prose")) {
    throw new ContextError(ExitCode.UserError, "the selected operation is not supported by this phase", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "unsupported-run-operation",
      phaseKind: input.phase.kind,
      operations,
      next: "Inspect the phase with --dry-run and use only operations declared for that phase kind.",
    });
  }
  if (operations.length > 0 && (input.options.view !== undefined || input.options.schema === true)) {
    throw new ContextError(ExitCode.UserError, "write operations cannot be combined with evidence views", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "ambiguous-run-mode",
      operations,
      view: input.options.schema === true ? "schema" : input.options.view,
      next: "Run the evidence view and the write operation as separate commands.",
    });
  }

  const existingKnowledgeFilters = [
    input.options.query !== undefined ? "--query" : undefined,
    input.options.collection !== undefined ? "--collection" : undefined,
    input.options.nodeType !== undefined ? "--node-type" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (existingKnowledgeFilters.length > 0 && input.phase.kind !== "phase.align.prose") {
    const command = `context run ${input.phase.id} --dry-run --format json`;
    throw new ContextError(ExitCode.UserError, "existing knowledge filters are supported only by prose align phases", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "existing-knowledge-filter-unsupported-phase",
      filters: existingKnowledgeFilters,
      phase_kind: input.phase.kind,
      next_action: {
        kind: "inspect_phase",
        command,
        reason_code: "existing-knowledge-filter-remove",
      },
      next: command,
    });
  }
  if (existingKnowledgeFilters.length > 0 && input.options.view !== "existing-knowledge") {
    const command = alignCommand(input.phase.id, [
      "--view",
      "existing-knowledge",
      ...(input.options.query !== undefined ? ["--query", input.options.query] : []),
      ...(input.options.collection !== undefined ? ["--collection", input.options.collection] : []),
      ...(input.options.nodeType !== undefined ? ["--node-type", input.options.nodeType] : []),
      "--format",
      "json",
    ]);
    throw new ContextError(ExitCode.UserError, "existing knowledge filters require the align existing-knowledge view", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "existing-knowledge-filter-without-view",
      filters: existingKnowledgeFilters,
      next_action: {
        kind: "read_existing_knowledge",
        command,
        reason_code: "existing-knowledge-filter-view-required",
      },
      input_schema: {
        view: "existing-knowledge",
        filters: ["query", "collection", "node_type"],
      },
      next: command,
    });
  }

  if (input.options.input === undefined) return;
  const readOnlyInputView = input.phase.kind === "phase.align.prose"
    ? input.options.view === "structure-summary" || input.options.view === "diagnostics"
    : input.phase.kind === "phase.compile.prose" && input.options.view === "diagnostics";
  if (operations.length === 0 && !readOnlyInputView) {
    throw new ContextError(ExitCode.UserError, "--input requires an operation that consumes the payload", {
      category: ErrorCategory.UserInputInvalid,
      reason_code: "ambiguous-run-input",
      input: input.options.input,
      next: input.phase.kind === "phase.align.prose" || input.phase.kind === "phase.compile.prose"
        ? `Rerun with --validate --input ${input.options.input} or --stage --input ${input.options.input}.`
        : "Remove --input; this phase does not accept a payload.",
    });
  }
}
