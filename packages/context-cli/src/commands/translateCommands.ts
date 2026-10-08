import type { Command } from "commander";
import { isAbsolute, join } from "node:path";
import { findContextProjectRoot, loadContextProjectModule } from "../project/workspace.js";
import { readYamlOrJsonInput } from "../project/payloadInput.js";
import { collectProjectStatus } from "../project/status.js";
import { workflowAuthorities } from "../project/workflow/workflowCommandOptions.js";
import { parseWorkflowResourceReceipts } from "../project/workflow/workflowResourceReceipts.js";
import { workflowStatusCommand } from "../project/workflow/workflowExecutionContext.js";
import {
  inspectSiteTranslations, prepareSiteTranslation, skipSiteTranslation, submitSiteTranslation, translationSubmitSchema,
} from "../project/siteTranslation.js";

function projectRoot(): string {
  const root = findContextProjectRoot(process.cwd())?.projectRoot;
  if (!root) throw new TypeError("Run inside a Context workspace");
  return root;
}

async function projectPackages(root: string) {
  return [...(await loadContextProjectModule(root)).project.packages];
}

function write(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function registerTranslateCommands(program: Command) {
  const command = program.command("translate").description("Translate approved knowledge for website locales declared in site.locales");
  const withWorkflow = async (root: string, result: Record<string, unknown>) => {
    const reference = program.opts().workflowResourceReceipts as string | undefined;
    const execution = { managed: program.opts().workflowManaged === true,
      authorities: workflowAuthorities(program.opts().workflowAuthority),
      ...(reference === undefined ? {} : { resourceReceiptsReference: reference }) };
    try {
      const resourceReceipts = execution.resourceReceiptsReference === undefined ? undefined
        : await parseWorkflowResourceReceipts(execution.resourceReceiptsReference, root);
      const status = await collectProjectStatus(root, { ...execution, ...(resourceReceipts === undefined ? {} : { resourceReceipts }) });
      return { ...result, workflow: status.workflow };
    } catch (error) {
      return { ...result, next_action: { command: workflowStatusCommand(execution) }, next_preparation: {
        message: error instanceof Error ? error.message : String(error),
        guidance: "The translation result was saved. Refresh status; do not submit it again.",
      } };
    }
  };
  command.command("status").description("Report translation freshness per locale").option("--format <format>", "json", "json").action(async () => {
    const root = projectRoot();
    const inspection = await inspectSiteTranslations(root, await projectPackages(root));
    const counts = inspection.locales.map(locale => {
      const items = inspection.items.filter(item => item.locale === locale);
      return { locale, current: items.filter(item => item.state === "current").length,
        stale: items.filter(item => item.state === "stale").length, missing: items.filter(item => item.state === "missing").length };
    });
    write({ locales: counts, pending: inspection.pending, orphans: inspection.orphans, route_satisfied: inspection.route_satisfied,
      ...(inspection.pending > 0 ? { next_action: { command: "context translate prepare --format json" } } : {}) });
  });
  command.command("prepare").description("Write the pending translation task").option("--format <format>", "json", "json").action(async () => {
    const root = projectRoot();
    const task = await prepareSiteTranslation(root, await projectPackages(root));
    write({ ...task, next_action: { command: "context translate submit --input <file> --format json" },
      input_example: { expected_digest: task.expected_digest,
        articles: task.items.filter(item => item.kind === "article").slice(0, 1).map(item => ({ locale: item.locale,
          approved_path: item.kind === "article" ? item.approved_path : "", file: `.tmp/agent-payloads/${item.kind === "article" ? item.translation_path : ""}` })),
        map_entries: task.items.filter(item => item.kind === "map-entry").slice(0, 1).map(item => ({ locale: item.locale,
          key: item.kind === "map-entry" ? item.key : "", title: "Translated title" })) } });
  });
  command.command("submit").description("Validate and save translated articles and navigation titles")
    .requiredOption("--input <file>", "YAML/JSON file or -").option("--format <format>", "json", "json")
    .action(async (options: { input: string }) => {
      const root = projectRoot();
      const value = translationSubmitSchema.parse(await readYamlOrJsonInput({ path: options.input, label: "translate submit",
        missingNext: "Provide --input <file>", readFailureNext: "Check the input path", parseFailureNext: "Use valid YAML or JSON" }));
      const saved = await submitSiteTranslation(root, await projectPackages(root), value,
        file => isAbsolute(file) ? file : join(root, file));
      write(await withWorkflow(root, { outcome: "submitted", ...saved }));
    });
  command.command("skip").description("Publish the current pending translations in the primary language")
    .requiredOption("--digest <digest>", "expected_digest from context translate prepare").option("--format <format>", "json", "json")
    .action(async (options: { digest: string }) => {
      const root = projectRoot();
      const skipped = await skipSiteTranslation(root, await projectPackages(root), options.digest);
      write(await withWorkflow(root, { outcome: "skipped", ...skipped }));
    });
}
