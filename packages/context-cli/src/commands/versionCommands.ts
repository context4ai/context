import type { Command } from "commander";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { findContextProjectRoot } from "../project/workspace.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";
import { changelogInputSchema, inspectWorkspaceVersion, recordWorkspaceVersion } from "../project/workspaceChangelog.js";
import { collectProjectStatus } from "../project/status.js";
import { workflowAuthorities } from "../project/workflow/workflowCommandOptions.js";
import { parseWorkflowResourceReceipts } from "../project/workflow/workflowResourceReceipts.js";
import { workflowStatusCommand } from "../project/workflow/workflowExecutionContext.js";

export function registerVersionCommands(program: Command) {
  const command = program.command("version").description("Inspect formal changes and record a knowledge workspace SemVer and changelog");
  command.command("inspect").option("--base <ref>", "Git commit or tag to compare; defaults to the current version tag or HEAD").option("--format <format>", "json", "json").action(async (options: { base?: string }) => {
    const root = findContextProjectRoot(process.cwd())?.projectRoot;
    if (!root) throw new TypeError("Run inside a Context workspace");
    const { files: _, content_digest: _digest, snapshot_format: _format, ...status } = await inspectWorkspaceVersion(root, options.base);
    void _; void _digest; void _format;
    // Suggest the version to record: the reusable one, else the next patch; 0.1.0 only for a first version.
    const first = status.version === "0.0.0";
    const [major, minor, patch] = status.version.split(".").map(Number);
    const suggested = status.reusable_version ?? (first ? "0.1.0" : `${major}.${minor}.${patch! + 1}`);
    process.stdout.write(JSON.stringify({ ...status, next_action: { command: "context version record --input <file> --format json" },
      input_example: { expected_digest: status.expected_digest, ...(options.base ? { base_ref: options.base } : {}), version: suggested, title: "Summary", changes: ["Reader-visible changes"],
        triggers: [first ? { kind: "initial", description: "User requested initial knowledge production" } : { kind: "other", description: "What caused this change" }] } }, null, 2) + "\n");
  });
  command.command("record").requiredOption("--input <file>", "YAML/JSON file or -").option("--format <format>", "json", "json")
    .action(async (options: { input: string }) => {
      const root = findContextProjectRoot(process.cwd())?.projectRoot;
      if (!root) throw new TypeError("Run inside a Context workspace");
      const value = changelogInputSchema.parse(await readYamlOrJsonInput({ path: options.input, label: "version record",
        missingNext: "Provide --input <file>", readFailureNext: "Check the input path", parseFailureNext: "Use valid YAML or JSON" }));
      const reference = program.opts().workflowResourceReceipts as string | undefined;
      const execution = { managed: program.opts().workflowManaged === true,
        authorities: workflowAuthorities(program.opts().workflowAuthority),
        ...(reference === undefined ? {} : { resourceReceiptsReference: reference }) };
      const resourceReceipts = execution.resourceReceiptsReference === undefined ? undefined
        : await parseWorkflowResourceReceipts(execution.resourceReceiptsReference, root);
      // Drafts still awaiting review: only the workflow's own record step may version them
      // (partial delivery); otherwise review comes first. Rejected candidates do not count.
      if ((await readCandidateRecords(root)).some(candidate => candidate.status === "draft")) {
        const current = (await collectProjectStatus(root, {
          ...execution, ...(resourceReceipts === undefined ? {} : { resourceReceipts }) })).workflow.current;
        if (current?.node !== "record-workspace-version") {
          throw new ContextError(ExitCode.WorkspaceStateError, `Drafts are still awaiting review; the current step is ${current?.node ?? "unknown"}, not version recording.`, {
            category: ErrorCategory.WorkspaceStateInvalid, reason_code: "version-review-pending",
            next_action: { command: current?.commands?.[0]?.command ?? workflowStatusCommand(execution) },
            next: "Finish the current step and Review first; the workflow reaches version recording after approval.",
          });
        }
      }
      const recorded = await recordWorkspaceVersion(root, value);
      // The transaction is committed before observing the next Route. A failed
      // observation must not invite the Agent to submit the version again.
      let result: unknown;
      try {
        const status = await collectProjectStatus(root, {
          ...execution, ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
        });
        result = { version: recorded.version, outcome: recorded.outcome ?? "recorded", workflow: status.workflow };
      } catch (error) {
        result = { ...recorded, next_action: { command: workflowStatusCommand(execution) }, outcome: recorded.outcome ?? "recorded", next_preparation: {
          message: error instanceof Error ? error.message : String(error),
          guidance: "Version recording succeeded. Refresh status; do not record this version again.",
        } };
      }
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    });
}
