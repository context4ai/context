import { Command } from "commander";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  inspectProjectIndexerMaterialAnswerReview,
  resolveProjectIndexerMaterialAnswerReview,
} from "./indexerMaterialAnswerReviewActions.js";
import {
  acceptProjectIndexerMaterialAnswerRun,
  failProjectIndexerMaterialAnswerRun,
  observeProjectIndexerMaterialAnswerRuns,
  prepareProjectIndexerMaterialAnswerRuns,
  startProjectIndexerMaterialAnswerRun,
} from "./indexerMaterialAnswerRunActions.js";
import { buildProjectIndexerMaterialQuestionWorkset } from "./indexerMaterialQuestionActions.js";
import { actualizeProjectIndexerMaterialAnswerBindings } from
  "./indexerMaterialAnswerActualizationActions.js";
import {
  checkpointProjectIndexerMaterialAnswerReview,
  checkpointProjectIndexerReconciliationGaps,
  evaluateProjectIndexerMaterialGaps,
} from "./indexerMaterialGapActions.js";
import { closeProjectIndexerApprovedKnowledge } from
  "./indexerMaterialGapCloseActions.js";
import { auditProjectIndexerMaterialGapState } from
  "./indexerMaterialGapAuditActions.js";
import { readYamlOrJsonInput } from "./payloadInput.js";
import { findContextProjectRoot } from "./workspace.js";

type OutputFormat = "json" | "yaml";

function commandOptions(args: readonly unknown[]): Record<string, unknown> {
  const command = [...args].reverse().find((value) => value instanceof Command);
  return command instanceof Command ? command.opts() as Record<string, unknown> : {};
}

function stringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function outputFormat(options: Record<string, unknown>): OutputFormat {
  const value = stringOption(options, "format") ?? "json";
  if (value === "json" || value === "yaml") return value;
  throw new ContextError(ExitCode.UserError, "--format must be json or yaml", {
    category: ErrorCategory.UserInputInvalid,
    flag: "--format",
  });
}

function writeOutput(value: unknown, format: OutputFormat): void {
  process.stdout.write(format === "json"
    ? `${JSON.stringify(value, null, 2)}\n`
    : YAML.stringify(value));
}

function projectRoot(action: string): string {
  const project = findContextProjectRoot(process.cwd());
  if (project !== null) return project.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, `${action} requires a Context workspace`, {
    category: ErrorCategory.WorkspaceNotFound,
    next: "Run this command from a Context project after registering its sources.",
  });
}

async function readInput(path: string, label: string): Promise<unknown> {
  return readYamlOrJsonInput({
    path,
    label,
    missingNext: `Pass ${path === "-" ? "stdin" : "a payload file"}.`,
    readFailureNext: "Fix the input path or pass - for stdin, then retry.",
    parseFailureNext: "Fix the YAML/JSON payload and retry.",
  });
}

function addCommand(group: Command, name: string, description: string): Command {
  return group.command(name)
    .description(description)
    .requiredOption("--input <file>", "digest-bound material-answer input")
    .option("--format <format>", "output format: json | yaml", "json");
}

async function executeProjectAction(
  args: readonly unknown[],
  actionName: string,
  action: (input: { projectRoot: string; value: unknown }) => unknown | Promise<unknown>,
): Promise<void> {
  const options = commandOptions(args);
  const inputPath = stringOption(options, "input");
  if (inputPath === undefined) throw new TypeError("--input is required");
  writeOutput(await action({
    projectRoot: projectRoot(actionName),
    value: await readInput(inputPath, actionName),
  }), outputFormat(options));
}

export function registerIndexerMaterialAnswerCommands(indexer: Command): void {
  addCommand(
    indexer,
    "inspect-material-answer-review",
    "Build the exact evidence-binding baseline for one material-answer candidate",
  ).action(async (...args: unknown[]) => {
    await executeProjectAction(args, "inspect-material-answer-review", ({ value }) =>
      inspectProjectIndexerMaterialAnswerReview(value)
    );
  });

  addCommand(
    indexer,
    "review-material-answer-candidate",
    "Approve or reject only the exact material-answer evidence binding",
  ).action(async (...args: unknown[]) => {
    await executeProjectAction(args, "review-material-answer-candidate", ({ value }) =>
      resolveProjectIndexerMaterialAnswerReview(value)
    );
  });

  const projectActions = [{
    name: "audit-material-gap-state",
    description: "Read-only recompute retained material gaps and route lifecycle drift",
    action: auditProjectIndexerMaterialGapState,
  }, {
    name: "checkpoint-material-gaps",
    description: "Recompute reconciliation and durably checkpoint current material gaps",
    action: checkpointProjectIndexerReconciliationGaps,
  }, {
    name: "checkpoint-material-answer-review",
    description: "Persist one exact answer-approved Review successor under ledger CAS",
    action: checkpointProjectIndexerMaterialAnswerReview,
  }, {
    name: "evaluate-material-gaps",
    description: "Evaluate current blocking gaps before layout or after actualization",
    action: evaluateProjectIndexerMaterialGaps,
  }, {
    name: "actualize-material-answer-bindings",
    description: "Map answer-approved landings onto one current layout proposal set",
    action: actualizeProjectIndexerMaterialAnswerBindings,
  }, {
    name: "close-indexer-approved-knowledge",
    description: "Atomically close approved structure and resolved material answers",
    action: closeProjectIndexerApprovedKnowledge,
  }, {
    name: "build-material-question-workset",
    description: "Build immutable material-question work from current registry authority",
    action: buildProjectIndexerMaterialQuestionWorkset,
  }, {
    name: "prepare-material-answer-runs",
    description: "Prepare recoverable second-phase material-answer runs",
    action: prepareProjectIndexerMaterialAnswerRuns,
  }, {
    name: "observe-material-answer-runs",
    description: "Observe current material-answer run state and next refs",
    action: observeProjectIndexerMaterialAnswerRuns,
  }, {
    name: "start-material-answer-run",
    description: "CAS-start one pending or stale material-answer run",
    action: startProjectIndexerMaterialAnswerRun,
  }, {
    name: "accept-material-answer-run",
    description: "Validate evidence reads and atomically accept one material-answer result",
    action: acceptProjectIndexerMaterialAnswerRun,
  }, {
    name: "fail-material-answer-run",
    description: "Record one current material-answer run failure",
    action: failProjectIndexerMaterialAnswerRun,
  }] as const;
  for (const item of projectActions) {
    addCommand(indexer, item.name, item.description).action(async (...args: unknown[]) => {
      await executeProjectAction(args, item.name, item.action);
    });
  }
}
