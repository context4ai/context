import type { Command } from "commander";
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
    const { files: _, content_digest: _digest, ...status } = await inspectWorkspaceVersion(root, options.base);
    void _; void _digest;
    process.stdout.write(JSON.stringify({ ...status, next_action: { command: "context version record --input <file> --format json" },
      input_example: { expected_digest: status.expected_digest, ...(options.base ? { base_ref: options.base } : {}), version: "0.1.0", title: "Summary", changes: ["Reader-visible changes"], triggers: [{ kind: "initial", description: "User requested initial knowledge production" }] } }, null, 2) + "\n");
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
      const recorded = await recordWorkspaceVersion(root, value);
      // The transaction is committed before observing the next Route. A failed
      // observation must not invite the Agent to submit the version again.
      let result: unknown;
      try {
        const status = await collectProjectStatus(root, {
          ...execution, ...(resourceReceipts === undefined ? {} : { resourceReceipts }),
        });
        result = { version: recorded.version, outcome: "recorded", workflow: status.workflow };
      } catch (error) {
        result = { ...recorded, next_action: { command: workflowStatusCommand(execution) }, outcome: "recorded", next_preparation: {
          message: error instanceof Error ? error.message : String(error),
          guidance: "Version recording succeeded. Refresh status; do not record this version again.",
        } };
      }
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    });
}
