import { Command } from "commander";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { beginDocumentRevision } from "../project/documentRevision.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { ExitCode } from "../types/exitCode.js";
import { beginKnowledgeUpdate } from "../project/knowledgeUpdate.js";
import { assertActionInputWorkspace } from "../project/actionInputWorkspace.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";

function requireProjectRoot(): string {
  const found = findContextProjectRoot(process.cwd());
  if (found !== null) return found.projectRoot;
  throw new ContextError(ExitCode.WorkspaceStateError, "revise requires a Context workspace", {
    category: ErrorCategory.WorkspaceNotFound,
  });
}

export function registerDocumentRevisionCommand(program: Command): void {
  const task = program.command("task").description("Explicit current-task recovery");
  task.command("prepare").description("Preview or discard current task state; preserve knowledge, sources and other temporary files")
    .option("--apply", "discard the explicitly authorized preview")
    .option("--plan-digest <digest>", "exact preparation preview revision")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { apply?: boolean; planDigest?: string; format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      const { prepareWorkspace } = await import("../project/workspacePreparation.js");
      process.stdout.write(`${JSON.stringify(await prepareWorkspace({ projectRoot: requireProjectRoot(),
        ...(options.apply ? { apply: true } : {}),
        ...(options.planDigest ? { plan_digest: options.planDigest } : {}) }))}\n`);
    });
  task.command("maintain").description("Register a scoped page revision, regeneration, or approved-output rebuild")
    .requiredOption("--input <file>", "YAML/JSON id, operation, timing and targets; - for stdin")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { input: string; format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      assertActionInputWorkspace(process.cwd(), options.input);
      const value = await readYamlOrJsonInput({ path: options.input, label: "maintenance",
        missingNext: "Provide id, operation (revise/regenerate/rebuild), timing and page targets with instructions.",
        readFailureNext: "Use an input file in this workspace.", parseFailureNext: "Provide valid YAML or JSON." });
      const { registerKnowledgeMaintenance } = await import("../project/knowledgeMaintenance.js");
      process.stdout.write(`${JSON.stringify(await registerKnowledgeMaintenance(requireProjectRoot(), value))}\n`);
    });
  task.command("advance-maintenance").description("Execute the current Graph-selected maintenance transition")
    .requiredOption("--revision <digest>", "current maintenance Route revision")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { revision: string; format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      const { advanceKnowledgeMaintenance } = await import("../project/knowledgeMaintenance.js");
      process.stdout.write(`${JSON.stringify(await advanceKnowledgeMaintenance(requireProjectRoot(), options.revision))}\n`);
    });
  task.command("maintenance-status").description("Inspect maintenance requests and the current cancellation revision")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      const { maintenanceRevision } = await import("../project/knowledgeMaintenance.js");
      process.stdout.write(`${JSON.stringify(await maintenanceRevision(requireProjectRoot()))}\n`);
    });
  task.command("cancel-maintenance <id>").description("Cancel a pending maintenance request without discarding an active draft")
    .option("--format <format>", "output format: json", "json")
    .option("--discard-revision <digest>", "explicitly discard this maintenance batch's unfinished drafts at the inspected revision")
    .action(async (id: string, options: { format: string; discardRevision?: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      const { cancelKnowledgeMaintenance } = await import("../project/knowledgeMaintenance.js");
      process.stdout.write(`${JSON.stringify(await cancelKnowledgeMaintenance(requireProjectRoot(), id, options.discardRevision))}\n`);
    });
  task.command("adjust").description("Adjust explicitly selected current source/module inputs while preserving unrelated work")
    .requiredOption("--input <file>", "YAML/JSON scopes and instruction; - for stdin")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { input: string; format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      assertActionInputWorkspace(process.cwd(), options.input);
      const value = await readYamlOrJsonInput({ path: options.input, label: "task adjust",
        missingNext: "Provide selected source/module scopes and the adjustment instruction.",
        readFailureNext: "Read the adjustment input in this workspace.", parseFailureNext: "Use YAML or JSON scopes and instruction." });
      const { adjustCurrentTaskSources } = await import("../project/taskSourceAdjustment.js");
      process.stdout.write(`${JSON.stringify(await adjustCurrentTaskSources(requireProjectRoot(), value))}\n`);
    });
  task.command("finish-rollback").description("Finish a Graph-selected rollback after close and all builds succeed")
    .option("--format <format>", "output format: json", "json")
    .action(async () => {
      const { finishTaskRollback } = await import("../project/taskRollback.js");
      process.stdout.write(`${JSON.stringify(await finishTaskRollback(requireProjectRoot()))}\n`);
    });
  task.command("rollback")
    .description("Preview exact user-selected reversions and discarded drafts; never reset the repository")
    .requiredOption("--input <file>", "YAML/JSON summary, discard_unfinished and exact file reversions; - for stdin")
    .option("--apply", "apply the user-approved rollback preview")
    .option("--plan-digest <digest>", "exact rollback preview revision")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { input: string; apply?: boolean; planDigest?: string; format: string }) => {
      if (options.format !== "json") throw new TypeError("--format must be json");
      assertActionInputWorkspace(process.cwd(), options.input);
      const value = await readYamlOrJsonInput({ path: options.input, label: "task rollback",
        missingNext: "Provide the explicit rollback scope and recoverable file contents.",
        readFailureNext: "Read the rollback input in this workspace.",
        parseFailureNext: "Use YAML or JSON with summary, discard_unfinished: true, and files." });
      const { rollbackProjectTask } = await import("../project/taskRollback.js");
      const result = await rollbackProjectTask({ projectRoot: requireProjectRoot(), value,
        ...(options.apply === undefined ? {} : { apply: options.apply }),
        ...(options.planDigest === undefined ? {} : { plan_digest: options.planDigest }) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });
  program.command("update")
    .description("Inspect acquired source changes against approved knowledge in confirmed requirement scopes")
    .requiredOption("--input <file>", "YAML/JSON scopes and optional change summary; - for stdin")
    .option("--format <format>", "output format: json", "json")
    .action(async (options: { input: string; format: string }) => {
      if (options.format !== "json") throw new ContextError(ExitCode.UserError, "--format must be json", {
        category: ErrorCategory.UserInputInvalid,
      });
      assertActionInputWorkspace(process.cwd(), options.input);
      const value = await readYamlOrJsonInput({ path: options.input, label: "update",
        missingNext: "Pass scopes with requirement_ref, source_ref and optional module_refs.",
        readFailureNext: "Fix the input path within the current workspace.",
        parseFailureNext: "Provide valid JSON or YAML scopes and an optional changes summary." });
      process.stdout.write(`${JSON.stringify(await beginKnowledgeUpdate(requireProjectRoot(), value), null, 2)}\n`);
    });
  program.command("revise <target>")
    .description("Repair one current Candidate or approved knowledge page through the Indexer lifecycle")
    .requiredOption("--instruction <feedback>", "reader-facing correction request")
    .option("--regenerate", "regenerate program blocks for an approved page, even at the same source version")
    .option("--timing <timing>", "after-batch or priority for approved pages; current Candidates are repaired in place", "after-batch")
    .option("--move-to <path>", "explicit new approved path in the same collection; preserves page identity")
    .option("--format <format>", "output format: json", "json")
    .action(async (target: string, options: Record<string, unknown>) => {
      if (options.format !== "json") {
        throw new ContextError(ExitCode.UserError, "--format must be json", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (typeof options.instruction !== "string") {
        throw new ContextError(ExitCode.UserError, "--instruction is required", {
          category: ErrorCategory.UserInputInvalid,
        });
      }
      if (options.timing !== "after-batch" && options.timing !== "priority") throw new TypeError("--timing must be after-batch or priority");
      process.stdout.write(`${JSON.stringify(await beginDocumentRevision({
        projectRoot: requireProjectRoot(),
        selector: target,
        timing: options.timing,
        regenerate: options.regenerate === true,
        ...(typeof options.moveTo === "string" ? { move_to: options.moveTo } : {}),
        instruction: options.instruction,
      }), null, 2)}\n`);
    });
}
