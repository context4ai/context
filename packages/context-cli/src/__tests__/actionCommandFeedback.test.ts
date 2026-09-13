import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Command } from "commander";
import { registerProjectActionCommands } from "../commands/actionCommands.js";
import { completeCurrentIndexerAction } from "../project/indexerCurrentAction.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function invoke(args: string[]) {
  const program = new Command().exitOverride();
  registerProjectActionCommands(program);
  return program.parseAsync(["action", ...args], { from: "user" });
}

test.each(["prepare-current", "complete-current"])("%s explains invalid output formats without opening an input", async command => {
  await expect(invoke([command, "--revision", "current", "--format", "xml",
    ...(command === "complete-current" ? ["--input", "does-not-exist.yaml"] : [])])).rejects.toMatchObject({
    detail: { reason_code: "invalid-action-format", flag: "--format", valid_formats: ["json", "yaml"],
      next_action: { command: `context action ${command} --help` } },
  });
});

test("blank completion arguments explain how to obtain the current task", async () => {
  await expect(invoke(["complete-current", "--revision", "current", "--input", " "])).rejects.toMatchObject({
    detail: { reason_code: "missing-action-argument", flag: "--input", next_action: { command: "context status --format json" } },
  });
});

test("missing workspaces have an entry recovery without reading the proposed file", async () => {
  const parent = resolve(".tmp/action-command-feedback");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  const previous = process.cwd();
  try {
    process.chdir(root);
    for (const command of ["prepare-current", "complete-current"]) {
      await expect(invoke([command, "--revision", "current",
        ...(command === "complete-current" ? ["--input", "missing.yaml"] : [])])).rejects.toMatchObject({
        detail: { reason_code: "action-workspace-not-found", next_action: { command: "context entry --format json" } },
      });
    }
  } finally { process.chdir(previous); }
});

test("maintenance schema and preview errors retain a recovery path", async () => {
  const parent = resolve(".tmp/action-command-feedback");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "maintenance-")); roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ context: { project: true, entry: "src/index.ts" } }));
  const input = { cwd: root, revision: "current", submissionPath: ".tmp/result.yaml" };
  await expect(completeCurrentIndexerAction({ ...input, value: { stage: "source-update" } })).rejects.toMatchObject({
    detail: { reason_code: "production-maintenance-action-failed", file: ".tmp/result.yaml",
      issues: expect.any(Array), next_action: { command: "context status --format json" } },
  });
  await expect(completeCurrentIndexerAction({ ...input, preview: true,
    value: { stage: "source-update", decisions: [], scope_summary: "No new articles", new_topics: [] } })).rejects.toMatchObject({
    detail: { reason_code: "production-maintenance-action-failed", next_action: { command: "context status --format json" } },
  });
});
