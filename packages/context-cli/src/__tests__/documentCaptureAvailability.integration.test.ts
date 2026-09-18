import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LarkRunner } from "../lib/feishu.js";
import { collectProjectStatus } from "../project/status.js";
import { createLarkCaptureProject, makeLarkCaptureTmp, runLarkCapturePhase } from "./projectCaptureLarkV062.fixtures.js";
import { initContextProject } from "../project/workspace.js";
import { runCliInDir, writeCaptureProjectEntry } from "./projectCaptureFileV062Helpers.js";

const denied: LarkRunner = async args => args.includes("--help")
  ? { stdout: "--api-version --doc-format", stderr: "", exitCode: 0 }
  : { stdout: "", stderr: "permission denied", exitCode: 1 };
const available: LarkRunner = async args => args.includes("--help")
  ? { stdout: "--api-version --doc-format", stderr: "", exitCode: 0 }
  : { stdout: JSON.stringify({ ok: true, data: { title: "Manual", document: { content: "<p>Registered evidence.</p>" } } }), stderr: "", exitCode: 0 };
const capture = (cwd: string, runner: LarkRunner) => runLarkCapturePhase({ cwd, phaseId: "capture:lark:handbook", format: "json", larkRunner: runner });

test("unavailable first document stays uncaptured without an automatic retry loop; config changes retry", async () => {
  const root = makeLarkCaptureTmp();
  try {
    const project = await createLarkCaptureProject(root);
    expect((await collectProjectStatus(project)).pendingCapturePhases).toHaveLength(1);
    const result = JSON.parse(await capture(project, denied)).result;
    expect(result).toMatchObject({ captured: false, warning: { state: "deferred-no-evidence" } });
    expect(existsSync(join(project, "sources/lark/handbook/manifest.json"))).toBe(false);
    const status = await collectProjectStatus(project);
    expect(status.sourceSummary.document).toEqual({ total: 1, captured: 0 });
    expect(status.pendingCapturePhases).toEqual([]);
    expect(status.documentSources[0]?.snapshotReady).toBe(false);
    expect(status.state).not.toBe("route.capture.permission-required");
    const registry = join(project, "sources/lark/index.yaml");
    writeFileSync(registry, readFileSync(registry, "utf8").replace("doc-token-123", "other-token"));
    expect((await collectProjectStatus(project)).pendingCapturePhases).toHaveLength(1);
    await capture(project, available);
    const retried = await collectProjectStatus(project);
    expect(retried.sourceSummary.document.captured).toBe(1);
    expect(retried.documentSources[0]?.acquisitionWarning).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("refresh failure retains exact valid snapshot; damaged snapshots cannot be used as fallback", async () => {
  const root = makeLarkCaptureTmp();
  try {
    const project = await createLarkCaptureProject(root);
    await capture(project, available);
    const manifest = join(project, "sources/lark/handbook/manifest.json");
    const before = readFileSync(manifest, "utf8");
    expect(JSON.parse(await capture(project, denied)).result.warning.state).toBe("retained-snapshot");
    expect(readFileSync(manifest, "utf8")).toBe(before);
    expect((await collectProjectStatus(project)).documentSources[0]?.snapshotReady).toBe(true);
    writeFileSync(manifest, "{invalid");
    await expect(capture(project, denied)).rejects.toThrow();
    const status = await collectProjectStatus(project);
    expect(status.documentSources[0]?.acquisitionWarning).toBeUndefined();
    expect(status.pendingCapturePhases).toHaveLength(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("local document read failures defer without fabricating content and can be retried", async () => {
  const root = makeLarkCaptureTmp();
  try {
    const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
    const path = join(root, "manual.md");
    await runCliInDir(projectRoot, ["source", "add", "file", "product-docs", "--local", path, "--format", "json"]);
    writeCaptureProjectEntry(projectRoot);
    const run = () => runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
    expect(JSON.parse(await run()).result.warning.state).toBe("deferred-no-evidence");
    writeFileSync(path, "# Manual\n\nValid content.\n");
    await run();
    rmSync(path);
    expect(JSON.parse(await run()).result.warning.state).toBe("retained-snapshot");
    expect((await collectProjectStatus(projectRoot)).sourceSummary.document.captured).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
