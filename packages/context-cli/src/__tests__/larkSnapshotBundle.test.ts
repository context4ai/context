import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { captureLark, source } from "@c4a/context";
import { fetchFeishuDocSnapshot, type LarkRunner } from "../lib/feishu.js";
import { fetchLarkSource } from "../project/sourceFetchLark.js";
import { readLarkSnapshotBundle } from "../project/larkSnapshotBundle.js";
import { importLarkDocument } from "../project/larkDocumentImport.js";
import { runCaptureLarkPhase } from "../project/documentCaptureLark.js";
import { createLarkCaptureProject } from "./projectCaptureLarkV062.fixtures.js";

const roots: string[] = [];
const url = "https://example.larkoffice.com/docx/doc-token-123";
const capturedAt = "2026-01-02T03:04:05.000Z";
const target = { kind: "docToken" as const, value: "doc-token-123" };
const originalBinary = process.env.CONTEXT_LARK_CLI_BIN;
afterEach(async () => {
  if (originalBinary === undefined) delete process.env.CONTEXT_LARK_CLI_BIN;
  else process.env.CONTEXT_LARK_CLI_BIN = originalBinary;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "context-lark-snapshot-"));
  roots.push(root);
  return root;
}
function arg(args: string[], name: string): string { return args[args.indexOf(name) + 1]!; }
function ok(data: unknown, identity = "bot") {
  return { stdout: JSON.stringify({ ok: true, identity, data }), stderr: "", exitCode: 0 };
}
const denied = { stdout: JSON.stringify({ ok: false, identity: "bot",
  error: { type: "authorization", subtype: "permission_denied", message: "Not allowed" } }), stderr: "", exitCode: 1 };
function fixtureRunner(calls: string[][], rich = false): LarkRunner {
  return async (args, options) => {
    calls.push(args);
    const identity = arg(args, "--as");
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args[0] === "docs" && args[1] === "+fetch") {
      if (arg(args, "--doc") === "synced-document") return ok({ document: { content: '<p id="shared-block">共享正文</p>' } }, identity);
      if (args.includes("--offset")) return ok({ document: { content: rich
        ? '<synced_reference src-token="synced-document" src-block-id="shared-block"/><source token="video-token" type="video"/><img token="missing-image"/>'
        : "<p>第二页。</p>" }, revision_id: "revision-1" }, identity);
      return ok({ title: "完整指南", revision_id: "revision-1", has_more: true, next_offset: 100,
        document: { content: '<title>完整指南</title><p>原始正文。</p>' + (rich
          ? '<img token="preview-image"/><whiteboard token="board-token"/><sheet token="sheet-token" sheet-id="sheet-id"/><base_refer token="base-token" table-id="table-id"/>' : "") } }, identity);
    }
    if (args[0] === "docs" && ["+media-download", "+media-preview"].includes(args[1]!)) {
      if (arg(args, "--token") === "missing-image" || arg(args, "--token") === "preview-image" && args[1] === "+media-download") return denied;
      await writeFile(resolve(options!.cwd!, `${arg(args, "--output")}${arg(args, "--type") === "whiteboard" ? ".svg" : ".png"}`), "preview bytes");
      return ok({}, identity);
    }
    if (args[0] === "whiteboard") {
      await writeFile(resolve(options!.cwd!, arg(args, "--output")), JSON.stringify({ nodes: [{ id: "node", text: "说明" }] }));
      return ok({}, identity);
    }
    if (args[0] === "sheets") {
      await writeFile(resolve(options!.cwd!, arg(args, "--output-path")), JSON.stringify({ annotated_csv: "Name,Value\n项目,1\n", has_more: false }));
      return ok({ complete: true, truncated: false }, identity);
    }
    if (args[0] === "base") return ok({ fields: ["Name"], data: [["记录"]], has_more: false }, identity);
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  };
}

test("standalone capture saves full pages and imports every resource offline with original provenance", async () => {
  const base = await temporary();
  const calls: string[][] = [];
  const exported = await fetchLarkSource({ url, output: join(base, "scratch", "source"), now: new Date(capturedAt), runner: fixtureRunner(calls, true) });
  expect(exported.status).toBe("captured");
  expect(exported.access_identity).toBe("bot");
  expect(exported.resource_materialization.materialized).toMatchObject({ image: 1, whiteboard: 1, sheet: 1, base: 1, "synced-reference": 1 });
  expect(exported.resource_materialization.reference_only.video).toBe(1);
  expect(exported.resource_materialization.failed.image).toBe(1);
  expect(calls.every(args => arg(args, "--as") === "bot")).toBe(true);
  expect(existsSync(join(base, "scratch", "sources"))).toBe(false);
  const root = await createLarkCaptureProject(base);
  const copied = join(root, ".tmp", "reused");
  await cp(exported.snapshot_dir, copied, { recursive: true });
  await rm(exported.snapshot_dir, { recursive: true });
  const bundle = await readLarkSnapshotBundle(copied, target);
  expect(bundle.fetched.markdown).toContain("共享正文");
  expect(bundle.fetched.assets.some(asset => asset.source?.representation === "preview")).toBe(true);
  expect(bundle.fetched.resourceMaterialization).toEqual(exported.resource_materialization);
  const first = await runCaptureLarkPhase({ projectRoot: root, phase: captureLark({ source: source("handbook") }),
    snapshotDirectory: copied, larkRunner: async () => { throw new Error("Import must not execute a remote command"); } });
  expect(first.access_identity).toBe("bot");
  expect(first.resource_materialization).toEqual(exported.resource_materialization);
  const manifest = JSON.parse(await readFile(join(root, first.snapshot.manifest), "utf8")) as { captured_at: string; metadata: { source: { revisionId: string } } };
  expect(manifest.captured_at).toBe(capturedAt);
  expect(manifest.metadata.source.revisionId).toBe("revision-1");
  // Also exercise the public import branch with a binary that must never run.
  const sentinel = join(base, "unexpected-network-call");
  const executable = join(base, "deny-lark.cjs");
  await writeFile(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'called'); process.exit(1);\n`, { mode: 0o700 });
  process.env.CONTEXT_LARK_CLI_BIN = executable;
  const repeated = await importLarkDocument(root, { type: "lark", name: "handbook", snapshot_dir: ".tmp/reused" });
  expect(repeated.snapshot.changed).toBe(false);
  expect(existsSync(sentinel)).toBe(false);
});

test("new capture locks bot but existing capture retains its opt-in document fallback behavior", async () => {
  const root = await temporary();
  const calls: string[] = [];
  const runner: LarkRunner = async args => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    calls.push(arg(args, "--as"));
    return arg(args, "--as") === "bot" ? denied : ok({ document: { content: "<p>Body.</p>" } }, "user");
  };
  await expect(fetchLarkSource({ url, output: join(root, "blocked"), runner })).rejects.toThrow();
  expect(calls).toEqual(["bot"]);
  expect(existsSync(join(root, "blocked", "snapshot.json"))).toBe(false);
  calls.length = 0;
  const legacy = await fetchFeishuDocSnapshot({ url, identity: "bot", docsApiVersion: "v2" }, runner);
  expect(calls).toEqual(["bot", "user"]);
  expect(legacy.identityFallback).toBe(true);
  const explicit = await fetchLarkSource({ url, output: join(root, "user"), identity: "user", runner: fixtureRunner([]) });
  expect(explicit.access_identity).toBe("user");
});

test("rejects cross-identity responses, mismatched source URLs, and incomplete raw pages", async () => {
  const root = await temporary();
  await expect(fetchLarkSource({ url, output: join(root, "identity"), runner: async args => args.includes("--help")
    ? { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 }
    : ok({ document: { content: "<p>Body.</p>" } }, "user") })).rejects.toThrow("different identity");
  const saved = await fetchLarkSource({ url, output: join(root, "complete"), runner: fixtureRunner([]) });
  await expect(readLarkSnapshotBundle(saved.snapshot_dir, { kind: "docToken", value: "other" })).rejects.toThrow("does not match");
  const path = join(saved.snapshot_dir, "snapshot.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as { response_files: unknown[] };
  manifest.response_files.pop();
  await writeFile(path, JSON.stringify(manifest));
  await expect(readLarkSnapshotBundle(saved.snapshot_dir, target)).rejects.toThrow("incomplete");
});

test("rejects changed bytes, escaped assets, symlinks, and bare Markdown without a capture receipt", async () => {
  const root = await temporary();
  const saved = await fetchLarkSource({ url, output: join(root, "snapshot"), runner: fixtureRunner([]) });
  const path = join(saved.snapshot_dir, "snapshot.json");
  const original = await readFile(path, "utf8");
  await writeFile(join(saved.snapshot_dir, "document.md"), "Invented text");
  await expect(readLarkSnapshotBundle(saved.snapshot_dir, target)).rejects.toThrow("content changed");
  const manifest = JSON.parse(original) as { document: { path: string } };
  manifest.document.path = "../outside.md";
  await writeFile(path, JSON.stringify(manifest));
  await expect(readLarkSnapshotBundle(saved.snapshot_dir, target)).rejects.toThrow("Unsafe");
  await writeFile(path, original);
  await rm(join(saved.snapshot_dir, "document.md"));
  await writeFile(join(root, "outside.md"), "External body");
  await symlink(join(root, "outside.md"), join(saved.snapshot_dir, "document.md"));
  await expect(readLarkSnapshotBundle(saved.snapshot_dir, target)).rejects.toThrow("not a regular file");
  await mkdir(join(root, "bare"));
  await writeFile(join(root, "bare", "document.md"), "<p>Fake body</p>");
  await expect(readLarkSnapshotBundle(join(root, "bare"), target)).rejects.toThrow("Cannot read complete");
});

test("does not overwrite output or write standalone snapshots into managed source directories", async () => {
  const base = await temporary();
  const root = await createLarkCaptureProject(base);
  let calls = 0;
  const runner: LarkRunner = async () => { calls++; throw new Error("No requests expected"); };
  await expect(fetchLarkSource({ url, output: root, runner })).rejects.toThrow("already exists");
  await expect(fetchLarkSource({ url, output: join(root, "sources", "scratch", "export"), runner })).rejects.toThrow("managed workspace state");
  expect(existsSync(join(root, "sources", "scratch"))).toBe(false);
  expect(calls).toBe(0);
});

test("import diagnoses an explicit resource policy mismatch without fetching or changing source files", async () => {
  const base = await temporary();
  const saved = await fetchLarkSource({ url, output: join(base, "snapshot"), runner: fixtureRunner([]) });
  const root = await createLarkCaptureProject(base);
  await expect(runCaptureLarkPhase({ projectRoot: root,
    phase: captureLark({ source: source("handbook"), resources: { images: "reference-only" } }),
    snapshotDirectory: saved.snapshot_dir,
    larkRunner: async () => { throw new Error("No requests during snapshot import"); },
  })).rejects.toThrow("different resource policy");
  expect(existsSync(join(root, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
});
