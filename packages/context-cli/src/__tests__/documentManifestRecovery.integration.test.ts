import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocumentSnapshotManifest } from "@c4a/extract";
import { initContextProject } from "../project/workspace.js";
import { runCliInDir, writeCaptureProjectEntry } from "./projectCaptureFileV062Helpers.js";
import { createLarkCaptureProject, runLarkCapturePhase } from "./projectCaptureLarkV062.fixtures.js";
import type { ProjectStatus } from "../project/statusTypes.js";
import { parseDocumentSnapshotBatchManifest } from "../project/documentBatchManifest.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function rootDir() {
  const root = await mkdtemp(join(tmpdir(), "context-manifest-recovery-"));
  roots.push(root);
  return root;
}
async function observe(root: string, managed = false, authorized = false): Promise<ProjectStatus> {
  return JSON.parse(await runCliInDir(root, ["status", "--format", "json", "--view", "full",
    ...(managed ? ["--managed"] : []), ...(authorized ? ["--authority", "context.source-read"] : [])]));
}
async function backups(root: string) {
  const path = join(root, ".tmp/context-runtime/recovery/document-manifests");
  return Promise.all((await readdir(path)).map((name) => readFile(join(path, name), "utf8")));
}

test.each([false, true])("a damaged file manifest returns to authorized capture and can advance (managed=%s)", async (managed) => {
  const root = await rootDir();
  const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/intro.md"), "# Intro\n\nRegistered source content.\n");
  await runCliInDir(projectRoot, ["source", "add", "file", "product-docs", "--local", "../docs", "--format", "json"]);
  writeCaptureProjectEntry(projectRoot);
  await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
  const path = join(projectRoot, "sources/file/product-docs/manifest.json");
  const damaged = "{ interrupted manifest";
  await writeFile(path, damaged);
  const current = await observe(projectRoot, managed);
  expect(current.documentSources[0]?.snapshotReady).toBe(false);
  expect(current.workflow.current?.node).toBe(managed ? "capture-next" : "authorize-document-capture");
  if (!managed) expect(current.workflow.current?.gate?.resolution).toBe("user");
  expect(await readFile(path, "utf8")).toBe(damaged);
  const authorized = managed ? current : await observe(projectRoot, false, true);
  expect(authorized.workflow.current?.commands[0]?.command).toContain("run capture:file:product-docs");
  const result = JSON.parse(await runCliInDir(projectRoot, ["--workflow-revision", authorized.workflow.current!.revision,
    ...(managed ? ["--workflow-managed"] : []),
    "--workflow-authority", "context.source-read", "run", "capture:file:product-docs", "--format", "json"]));
  expect(result.result.diagnostics.some((item: string) => item.includes("damaged snapshot manifest"))).toBe(true);
  expect(parseDocumentSnapshotManifest(JSON.parse(await readFile(path, "utf8"))).source_name).toBe("product-docs");
  expect(await backups(projectRoot)).toContain(damaged);
  const next = await observe(projectRoot, managed);
  expect(next.readySources).toBe(1);
  expect(next.workflow.current?.node).toBe("run-indexer-lifecycle");
});

test.each(["entry", "json", "identity"])("repairing a damaged batch preserves source files and advances remaining capture (%s)", async (damage) => {
  const root = await rootDir();
  const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  for (const id of ["first", "second"]) {
    await mkdir(join(root, id));
    await writeFile(join(root, id, "intro.md"), `# ${id}\n\nIndependent source content.\n`);
    await runCliInDir(projectRoot, ["source", "add", "file", "20260908", "--module", id, "--local", `../${id}`, "--format", "json"]);
  }
  await writeFile(join(projectRoot, "src/index.ts"), [
    'import { captureFile, defineProject, source } from "@c4a/context";',
    'const first = source("20260908", "first", { type: "file" });',
    'const second = source("20260908", "second", { type: "file" });',
    'export default defineProject({ sources: [first, second], phases: [captureFile({source:first}), captureFile({source:second})], packages: [] });',
  ].join("\n"));
  for (const id of ["first", "second"]) await runCliInDir(projectRoot, ["run", `capture:file:20260908/${id}`, "--format", "json"]);
  const path = join(projectRoot, "sources/file/20260908/manifest.json");
  const before = parseDocumentSnapshotBatchManifest(JSON.parse(await readFile(path, "utf8")));
  const siblingPath = join(projectRoot, "sources/file/20260908/second.md");
  const siblingBytes = await readFile(siblingPath);
  const damaged = damage === "json" ? "{ interrupted batch" : JSON.stringify(damage === "identity"
    ? { ...before, source_type: "lark" }
    : { ...before, sources: { ...before.sources, first: { source_name: "20260908/first" } } });
  await writeFile(path, damaged);
  expect((await observe(projectRoot, true)).workflow.current?.node).toBe("capture-next");
  if (damage === "entry") {
    const upstream = join(root, "first/intro.md");
    const original = await readFile(upstream);
    await rm(upstream);
    await expect(runCliInDir(projectRoot, ["run", "capture:file:20260908/first", "--format", "json"]))
      .rejects.toThrow(/no Markdown or MDX/);
    expect(await readFile(path, "utf8")).toBe(damaged);
    expect(await readFile(siblingPath)).toEqual(siblingBytes);
    await writeFile(upstream, original);
  }
  await runCliInDir(projectRoot, ["run", "capture:file:20260908/first", "--format", "json"]);
  let after = parseDocumentSnapshotBatchManifest(JSON.parse(await readFile(path, "utf8")));
  expect(await readFile(siblingPath)).toEqual(siblingBytes);
  if (damage === "entry") expect(after.sources.second).toEqual(before.sources.second);
  else {
    // An unreadable container cannot establish the other source's snapshot.
    // Its files survive and the normal capture queue restores that source.
    expect(after.sources.second).toBeUndefined();
    const remaining = await observe(projectRoot, true);
    expect(remaining.workflow.current?.commands[0]?.command).toContain("capture:file:20260908/second");
    await runCliInDir(projectRoot, ["run", "capture:file:20260908/second", "--format", "json"]);
    after = parseDocumentSnapshotBatchManifest(JSON.parse(await readFile(path, "utf8")));
    expect(after.sources.second?.snapshot_hash).toBe(before.sources.second?.snapshot_hash);
  }
  expect(after.sources.first?.snapshot_hash).toBe(before.sources.first?.snapshot_hash);
  expect((await observe(projectRoot, true)).readySources).toBe(2);
  expect(await backups(projectRoot)).toContain(damaged);
});

test("Lark capture rebuilds a damaged manifest from the authorized fetch result", async () => {
  const root = await rootDir();
  const projectRoot = await createLarkCaptureProject(root);
  const larkRunner = async (args: string[]) => ({ stderr: "", exitCode: 0,
    stdout: args.includes("--help") ? "Flags:\n --api-version string\n --doc-format string\n" : JSON.stringify({ ok: true,
      data: { title: "Handbook", document: { content: "<title>Handbook</title><p>Verified source text.</p>" }, revision_id: "rev-1" } }) });
  await runLarkCapturePhase({ cwd: projectRoot, phaseId: "capture:lark:handbook", format: "json", larkRunner });
  const path = join(projectRoot, "sources/lark/handbook/manifest.json");
  await writeFile(path, "not valid JSON");
  expect((await observe(projectRoot)).workflow.current?.node).toBe("authorize-document-capture");
  await runLarkCapturePhase({ cwd: projectRoot, phaseId: "capture:lark:handbook", format: "json", larkRunner });
  expect(parseDocumentSnapshotManifest(JSON.parse(await readFile(path, "utf8"))).source_type).toBe("lark");
  expect(await backups(projectRoot)).toContain("not valid JSON");
  expect((await observe(projectRoot)).readySources).toBe(1);
});
