import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { initContextProject } from "../project/workspace.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { readProductionStage } from "../project/productionStageStore.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

type Route = { node: string; commands: Array<{ command: string }> };
type Status = { workflow: { current?: Route }; progress: { deferredCaptureSources?: string[] } };
const status = async (root: string): Promise<Status> => {
  const value = JSON.parse(await runCliInDir(root, ["status", "--format", "json"])) as {
    next_route?: { inline?: Route; file?: string }; progress: Status["progress"] };
  const route = value.next_route?.inline ?? (value.next_route?.file
    ? JSON.parse(await readFile(value.next_route.file, "utf8")) as Route : undefined);
  return { workflow: route ? { current: route } : {}, progress: value.progress };
};

async function workspace(requirements: Array<{ id: string; sources: string[] }>) {
  const parent = resolve(".tmp/production-deferred-capture-tests");
  await mkdir(parent, { recursive: true });
  const outer = await mkdtemp(join(parent, "case-")); roots.push(outer);
  const root = (await initContextProject({ cwd: outer, projectDir: "workspace", dev: true })).projectRoot;
  const docs = ["package", "wiki"];
  for (const name of docs) {
    await mkdir(join(outer, name), { recursive: true });
    await writeFile(join(outer, name, "guide.md"), `# ${name}\nHow the ${name} works.\n`);
    await runCliInDir(root, ["source", "add", "file", "20261125", "--module", name, "--local", join(outer, name), "--format", "json"]);
  }
  await writeFile(join(root, "src/index.ts"), [
    'import { captureFile, defineProject, kbPackage, source } from "@c4a/context";',
    'const pkg = source("20261125", "package", { type: "file" });',
    'const wiki = source("20261125", "wiki", { type: "file" });',
    'export default defineProject({ sources: [pkg, wiki], phases: [captureFile({ source: pkg }), captureFile({ source: wiki })],',
    '  packages: [kbPackage({ name: "kb", template: { path: "src/package-templates/kb", vars: {} } })] });',
  ].join("\n"));
  // Only the package is captured; the wiki still waits for source-read permission.
  await runCliInDir(root, ["run", "capture:file:20261125/package", "--format", "json"]);
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ requirements: requirements.map(item => ({
    id: item.id, purpose: `Explain the ${item.id}`, target_scope: { targets: item.sources.map(source_ref => ({ source_ref })) } })) }));
  return root;
}

test("a request whose sources are captured is not blocked by another source still waiting for capture", async () => {
  const root = await workspace([{ id: "package", sources: ["file:20261125/package"] }, { id: "wiki", sources: ["file:20261125/wiki"] }]);
  const before = await status(root);
  // The capture Gate stays for the waiting wiki, and the Route also hands the
  // Agent the exact command, with its revision, to start the captured request now.
  expect(before.workflow.current?.node).toBe("authorize-document-capture");
  expect(before.progress.deferredCaptureSources).toEqual(["file:20261125/wiki"]);
  const command = before.workflow.current?.commands.map(item => item.command).find(item => item.includes("prepare-current")) ?? "";
  expect(command).toMatch(/^context action prepare-current --revision sha256:[a-f0-9]{64} --source file:20261125\/package --format json$/u);
  const revision = /--revision (\S+)/u.exec(command)![1]!;
  await runCliInDir(root, ["action", "prepare-current", "--revision", revision, "--source", "file:20261125/package", "--format", "json"]);
  // With a stage, capture is gated only on the stage's own documents.
  expect((await readProductionStage(root))?.requested_sources).toEqual(["file:20261125/package"]);
  const during = await status(root);
  expect(during.workflow.current?.node).not.toBe("authorize-document-capture");
  expect(during.progress.deferredCaptureSources).toEqual(["file:20261125/wiki"]);
});

test("a request that needs the waiting source still asks for source-read permission", async () => {
  const root = await workspace([{ id: "all", sources: ["file:20261125/package", "file:20261125/wiki"] }]);
  const current = await status(root);
  expect(current.workflow.current?.node).toBe("authorize-document-capture");
  expect(current.progress.deferredCaptureSources ?? []).toEqual([]);
});
