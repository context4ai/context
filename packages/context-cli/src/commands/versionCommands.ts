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
  command.command("inspect").option("--publish", "include same-version dist changes before publishing").option("--format <format>", "json", "json").action(async (options: { publish?: boolean }) => {
    const root = findContextProjectRoot(process.cwd())?.projectRoot;
    if (!root) throw new TypeError("Run inside a Context workspace");
    const { files: _, ...status } = await inspectWorkspaceVersion(root, options.publish === true);
    void _;
    process.stdout.write(JSON.stringify({ ...status, next_action: { command: "context version record --input <file> --format json" },
      input_example: { expected_digest: status.expected_digest, version: "0.1.0", title: "Summary", changes: ["Reader-visible changes"], triggers: [{ kind: "initial", description: "User requested initial knowledge production" }] } }, null, 2) + "\n");
  });
  command.command("publish-check").option("--format <format>", "json", "json").action(async () => {
    const root = findContextProjectRoot(process.cwd())?.projectRoot;
    if (!root) throw new TypeError("Run inside a Context workspace");
    const { inspectWorkspacePublish } = await import("../project/workspacePublishVersion.js");
    process.stdout.write(JSON.stringify(await inspectWorkspacePublish(root), null, 2) + "\n");
  });
  command.command("published").requiredOption("--hash <hash>", "publish-check hash of uploaded artifacts")
    .requiredOption("--receipt <receipt>", "successful external publication receipt")
    .option("--format <format>", "json", "json").action(async (options: { hash: string; receipt: string }) => {
      const root = findContextProjectRoot(process.cwd())?.projectRoot;
      if (!root) throw new TypeError("Run inside a Context workspace");
      const { markWorkspacePublished } = await import("../project/workspacePublishVersion.js");
      process.stdout.write(JSON.stringify(await markWorkspacePublished(root, options.hash, options.receipt)) + "\n");
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
