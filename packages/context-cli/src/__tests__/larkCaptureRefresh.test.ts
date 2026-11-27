import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { computeDocumentContentHash } from "@c4a/extract";
import { fetchFeishuDocSnapshot } from "../lib/feishu.js";
import { captureLark, source } from "@c4a/context";
import { runCaptureLarkPhase } from "../project/documentCaptureLark.js";
import { restoreDocumentSnapshot } from "../project/documentSnapshotRestore.js";
import { readMissingLarkResources } from "../project/larkCaptureFreshness.js";
import type { LarkRunner } from "../lib/feishu.js";
import { createLarkCaptureProject } from "./projectCaptureLarkV062.fixtures.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "context-refresh-")); roots.push(root);
  return createLarkCaptureProject(root);
}
const phase = captureLark({ source: source("handbook") });
const documentPath = "sources/lark/handbook/index.md";
const manifestPath = "sources/lark/handbook/manifest.json";
function runner(state: { revision: string; text?: string; asset?: string; incomplete?: boolean }, calls: string[][] = []): LarkRunner {
  return async args => {
    calls.push(args);
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    return { stdout: JSON.stringify({ ok: true, data: {
      title: "Guide", revision_id: state.revision,
      document: { content: state.incomplete ? "<title>Guide</title><img alt='Missing identity'/>" : `<title>Guide</title><p>${state.text ?? "Keep"}</p>` },
      ...(state.asset === undefined ? {} : { assets: [{ path: "image.png", role: "presentation", media_type: "image/png", base64: Buffer.from(state.asset).toString("base64") }] }),
    } }), stderr: "", exitCode: 0 };
  };
}
test("same revision keeps the snapshot; explicit refresh updates changed assets", async () => {
  const root = await workspace();
  const state = { revision: "1", asset: "first" };
  const read = runner(state);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const before = await readFile(join(root, manifestPath), "utf8");
  state.asset = "second";
  expect((await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).snapshot.changed).toBe(false);
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(before);
  expect((await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] })).snapshot.changed).toBe(true);
  expect(await readFile(join(root, "sources/lark/handbook/assets/image.png"), "utf8")).toBe("second");
});
test("unchanged content at a new revision is cached against the local snapshot", async () => {
  const root = await workspace(); const state = { revision: "1" }; const read = runner(state);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const before = await readFile(join(root, manifestPath), "utf8");
  state.revision = "2";
  expect((await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).snapshot.changed).toBe(false);
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(before);
  await writeFile(join(root, documentPath), "local edit");
  expect((await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).snapshot.changed).toBe(true);
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Keep");
});
test("incomplete body leaves a complete existing snapshot intact", async () => {
  const root = await workspace(); const state = { revision: "1", incomplete: false }; const read = runner(state);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const before = await readFile(join(root, manifestPath), "utf8");
  state.revision = "2"; state.incomplete = true;
  await expect(runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).rejects.toThrow("incomplete body");
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(before);
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Keep");
});
test("restores complete source files and their manifest from a specified Git commit", async () => {
  const root = await workspace(); const state = { revision: "1", text: "Original" }; const read = runner(state);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  git("add", "sources"); git("commit", "-qm", "Capture source"); const commit = git("rev-parse", "HEAD");
  state.revision = "2"; state.text = "Updated";
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  git("add", "sources"); git("commit", "-qm", "Update source"); const updated = git("rev-parse", "HEAD");
  await writeFile(join(root, documentPath), "Invalid historical bytes");
  git("add", "sources"); git("commit", "-qm", "Record inconsistent copy"); const corrupted = git("rev-parse", "HEAD");
  expect((await restoreDocumentSnapshot(root, { type: "lark", name: "handbook" })).commit).toBe(updated);
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Updated");
  const restored = await restoreDocumentSnapshot(root, { type: "lark", name: "handbook", commit });
  expect(restored.commit).toBe(commit);
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Original");
  await expect(restoreDocumentSnapshot(root, { type: "lark", name: "handbook", commit: corrupted })).rejects.toThrow("hash mismatch");
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Original");
  expect((await readMissingLarkResources(root))).toEqual([]);
  await writeFile(join(root, manifestPath), "{broken manifest");
  expect((await restoreDocumentSnapshot(root, { type: "lark", name: "handbook", commit })).commit).toBe(commit);
  expect(JSON.parse(await readFile(join(root, manifestPath), "utf8")).source_name).toBe("handbook");
});

test("missing resources remain visible and their retry bypasses an unchanged revision", async () => {
  const root = await workspace(); let allowed = false; let downloads = 0;
  const read: LarkRunner = async (args, options) => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args.includes("+media-download") || args.includes("+media-preview")) {
      downloads++;
      if (!allowed) return { stdout: "", stderr: JSON.stringify({ ok: false, error: {
        type: "authorization", subtype: "permission_denied", message: "current identity does not have export permission for this document media",
      } }), exitCode: 1 };
      await writeFile(resolve(options!.cwd!, args[args.indexOf("--output") + 1]!), "image bytes");
      return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
    }
    return { stdout: JSON.stringify({ ok: true, data: { revision_id: "1", document: {
      content: '<title>Guide</title><p>Read this.</p><img token="illustration" alt="Diagram"/>',
    } } }), stderr: "", exitCode: 0 };
  };
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const missing = await readMissingLarkResources(root);
  expect(missing[0]?.retry_action.input).toEqual({ refresh_sources: ["lark:handbook"] });
  const attempts = downloads; allowed = true;
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  expect(downloads).toBe(attempts);
  expect((await readMissingLarkResources(root)).length).toBe(1);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: missing[0]!.retry_action.input.refresh_sources });
  expect(downloads).toBeGreaterThan(attempts);
  expect(await readMissingLarkResources(root)).toEqual([]);
});


test("a legacy incomplete body report must be repaired even when the remote revision is unchanged", async () => {
  const root = await workspace();
  const state = { revision: "1" }; const read = runner(state);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  const summary = manifest.metadata.capture.report;
  const reportPath = join(root, "sources/lark/handbook", summary.path);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  // Old CLI captures could persist a valid, hashed report with incomplete body
  // projection. A byte-valid cache is not proof that its content was complete.
  const incomplete = await fetchFeishuDocSnapshot({ url: "doc-token-123" }, runner({ revision: "1", incomplete: true }));
  report.fidelity = incomplete.fidelity;
  expect(report.fidelity.evidence_status).toBe("error");
  const bytes = JSON.stringify(report) + "\n";
  await writeFile(reportPath, bytes);
  manifest.assets.find((asset: { path: string }) => asset.path === summary.path).content_hash = computeDocumentContentHash(bytes);
  summary.fidelityStatus = report.fidelity.status;
  summary.evidenceStatus = report.fidelity.evidence_status;
  summary.projectionStatus = report.fidelity.projection_status;
  await writeFile(join(root, manifestPath), JSON.stringify(manifest) + "\n");
  const repaired = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  expect(repaired.snapshot.changed).toBe(true);
  expect(repaired.fidelity.projection_status).toBe("complete");
  expect(JSON.parse(await readFile(reportPath, "utf8")).fidelity.projection_status).toBe("complete");
});

test("generic projections remain capturable and reusable at the same revision", async () => {
  const root = await workspace();
  const read: LarkRunner = async args => args.includes("--help") ? runner({ revision: "1" })(args)
    : { stdout: JSON.stringify({ ok: true, data: { revision_id: "generic-1", document: {
      content: "<title>Tasks</title><future_block><p>Retained task text</p></future_block>",
    } } }), stderr: "", exitCode: 0 };
  const first = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  expect(first.fidelity.projection_status).toBe("generic");
  expect(await readFile(join(root, documentPath), "utf8")).toContain("Retained task text");
  expect((await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).snapshot.changed).toBe(false);
});

test.each(["refresh", "policy", "prefetched", "normalizer"])("resource failure retries and %s reacquisition preserves a good snapshot", async mode => {
  const root = await workspace(); let fail = true; let downloads = 0;
  const read: LarkRunner = async (args, options) => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args.includes("+media-download") || args.includes("+media-preview")) {
      downloads++;
      if (fail) return { stdout: "", stderr: "Network connection interrupted", exitCode: 1 };
      await writeFile(resolve(options!.cwd!, args[args.indexOf("--output") + 1]!), "good image");
      return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
    }
    return { stdout: JSON.stringify({ ok: true, data: { revision_id: "1", document: {
      content: '<title>Guide</title><img token="illustration" alt="Diagram"/>',
    } } }), stderr: "", exitCode: 0 };
  };
  await expect(runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).rejects.toThrow("required resources");
  const attempts = downloads; fail = false;
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  expect(downloads).toBeGreaterThan(attempts);
  const before = await readFile(join(root, manifestPath), "utf8");
  const body = await readFile(join(root, documentPath), "utf8"); fail = true;
  let expectedManifest = before;
  if (mode === "normalizer") {
    const old = JSON.parse(before); old.normalizer_version = "old-normalizer";
    expectedManifest = JSON.stringify(old); await writeFile(join(root, manifestPath), expectedManifest);
  }
  await expect(runCaptureLarkPhase({ projectRoot: root,
    phase: mode === "policy" ? captureLark({ source: source("handbook"), resources: { maxBytesPerResource: 1 } }) : phase,
    larkRunner: read,
    ...(mode === "refresh" ? { refreshSources: ["lark:handbook"] } : {}),
    ...(mode === "prefetched" ? { prefetched: { identity: "bot" as const, responsePages: [(await read(["docs", "+fetch"])).stdout] } } : {}),
  })).rejects.toThrow("existing snapshot was preserved");
  expect(await readFile(join(root, manifestPath), "utf8")).toBe(expectedManifest);
  expect(await readFile(join(root, documentPath), "utf8")).toBe(body);
});

test.each(["preview", "reference-only", "existing-preview"])("same-revision capture handles %s without silently losing original resources", async mode => {
  const root = await workspace(); let preview = mode === "existing-preview"; let revision = "1";
  const read: LarkRunner = async (args, options) => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args.includes("+media-download") || args.includes("+media-preview")) {
      if (preview && args.includes("+media-download")) return { stdout: "", exitCode: 1,
        stderr: JSON.stringify({ ok: false, error: { type: "authorization", subtype: "permission_denied", message: "Original image download denied" } }) };
      await writeFile(resolve(options!.cwd!, args[args.indexOf("--output") + 1]!), args.includes("+media-preview") ? "small preview" : "original image");
      return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
    }
    return { stdout: JSON.stringify({ ok: true, data: { revision_id: revision, document: {
      content: '<title>Guide</title><img token="illustration" alt="Diagram"/>',
    } } }), stderr: "", exitCode: 0 };
  };
  const first = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  const paths = [manifestPath, documentPath, ...first.assets.map(asset => `sources/lark/handbook/${asset.path}`)];
  const before = await Promise.all(paths.map(path => readFile(join(root, path))));
  preview = true;
  const input = { projectRoot: root, larkRunner: read, refreshSources: ["lark:handbook"],
    phase: mode === "reference-only" ? captureLark({ source: source("handbook"), resources: { images: "reference-only" } }) : phase };
  if (mode === "existing-preview") {
    // Repeating an already degraded representation is not a new downgrade.
    const repeated = await runCaptureLarkPhase(input);
    expect(repeated.resource_materialization.items[0]?.reason_code).toBe("document.resource.preview");
  } else if (mode === "preview") {
    // A located downgrade is saved and listed, not refused: the main text is still captured.
    const saved = await runCaptureLarkPhase(input);
    expect(saved.resource_materialization.items[0]).toMatchObject({ status: "materialized", reason_code: "document.resource.preview" });
    expect(saved.diagnostics.join("\n")).toContain("lark.capture.resource-degraded: image");
  } else {
    // An explicit policy exclusion is the user's choice, not a lost resource: it is saved with a placeholder.
    const saved = await runCaptureLarkPhase(input);
    expect(saved.snapshot.changed).toBe(true);
    expect(saved.resource_materialization.items[0]).toMatchObject({ status: "reference-only", reason_code: "image-excluded-by-policy" });
    expect(saved.diagnostics.join("\n")).toContain("lark.capture.resource-degraded: image");
    expect(await readFile(join(root, documentPath), "utf8")).toContain("Image omitted: Diagram");
    expect(before.length).toBeGreaterThan(0);
  }
});

test("a same-revision refresh keeps the main text when a resource becomes a permission gap", async () => {
  const root = await workspace(); let denied = false;
  const read: LarkRunner = async (args, options) => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args.includes("+media-download") || args.includes("+media-preview")) {
      if (denied) return { stdout: "", exitCode: 1,
        stderr: JSON.stringify({ ok: false, error: { type: "authorization", subtype: "permission_denied", message: "Image access denied" } }) };
      await writeFile(resolve(options!.cwd!, args[args.indexOf("--output") + 1]!), "original image");
      return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
    }
    return { stdout: JSON.stringify({ ok: true, data: { revision_id: "1", document: {
      content: '<title>Guide</title><p>Main rule</p><img token="illustration" alt="Diagram"/>',
    } } }), stderr: "", exitCode: 0 };
  };
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read });
  denied = true;
  const saved = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(saved.resource_materialization.items[0]).toMatchObject({ status: "failed", reason_code: "document.resource.permission-denied" });
  expect(saved.diagnostics.join("\n")).toContain("lark.capture.resource-degraded: image");
  const body = await readFile(join(root, documentPath), "utf8");
  expect(body).toContain("Main rule");
  expect(body).toContain("> Resource unavailable: Diagram");
});

interface ResourceDocument { fail: Set<string>; downloads: string[]; revision?: string | null; text?: string; whiteboard?: boolean; file?: boolean }
function resourceDocument(tokens: readonly string[], options: ResourceDocument): LarkRunner {
  return async (args, commandOptions) => {
    if (args.includes("--help")) return { stdout: "--api-version string\n--doc-format string", stderr: "", exitCode: 0 };
    if (args.includes("+media-download") || args[0] === "whiteboard") {
      const token = args[0] === "whiteboard" ? `raw:${args[args.indexOf("--whiteboard-token") + 1]!}` : args[args.indexOf("--token") + 1]!;
      options.downloads.push(token);
      if (options.fail.has(token)) return { stdout: "", stderr: "unexpected media failure", exitCode: 1 };
      const output = args[args.indexOf("--output") + 1]!;
      await writeFile(resolve(commandOptions!.cwd!, args[0] === "whiteboard" ? output : `${output}.png`),
        args[0] === "whiteboard" ? JSON.stringify({ nodes: [] }) : `bytes of ${token}`);
      return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
    }
    const revision = options.revision === undefined ? "1" : options.revision;
    return { stdout: JSON.stringify({ ok: true, data: { ...(revision === null ? {} : { revision_id: revision }), document: {
      content: `<title>Guide</title><p>${options.text ?? "Main rule"}</p>${tokens.map(token => `<img token="${token}" alt="Figure ${token}"/>`).join("")}`
        + (options.whiteboard ? '<whiteboard token="board"/>' : "") + (options.file ? '<file token="attachment" name="Plan.pdf"/>' : ""),
    } } }), stderr: "", exitCode: 0 };
  };
}

async function failOnce(root: string, read: LarkRunner, options: ResourceDocument, input: Partial<Parameters<typeof runCaptureLarkPhase>[0]> = {}) {
  await expect(runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, ...input })).rejects.toThrow("required resources could not be materialized");
  options.fail.clear(); options.downloads.length = 0;
}

test("a retry after failed resources downloads only the missing ones and completes the snapshot", async () => {
  const root = await workspace();
  const options = { fail: new Set(["c"]), downloads: [] as string[] };
  const read = resourceDocument(["a", "b", "c"], options);
  await expect(runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read })).rejects.toThrow("required resources could not be materialized");
  expect(options.downloads.sort()).toEqual(["a", "b", "c"]);
  options.fail.clear(); options.downloads.length = 0;
  const retried = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads).toEqual(["c"]);
  expect(retried.resource_materialization.status).toBe("complete");
  expect(retried.resource_materialization.items.map(item => item.status)).toEqual(["materialized", "materialized", "materialized"]);
  const body = await readFile(join(root, documentPath), "utf8");
  for (const token of ["a", "b", "c"]) expect(body).toContain(`Figure ${token}`);
  // No image went over budget, so the report is written exactly as before.
  expect(JSON.parse(await readFile(join(root, "sources/lark/handbook/assets/capture-report.json"), "utf8"))).not.toHaveProperty("resource_budget");
  // A complete snapshot is not reused by later refreshes: they download again.
  options.downloads.length = 0;
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads.sort()).toEqual(["a", "b", "c"]);
});

test("a retry downloads a saved resource again when its bytes no longer match the snapshot", async () => {
  const root = await workspace();
  const options = { fail: new Set(["b"]), downloads: [] as string[] };
  const read = resourceDocument(["a", "b"], options);
  const first = await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read }).catch(error => error);
  expect(String(first)).toContain("required resources could not be materialized");
  const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
  const saved = manifest.assets.find((asset: { source?: { kind?: string } }) => asset.source?.kind === "image");
  await writeFile(join(root, "sources/lark/handbook", saved.path), "edited locally");
  options.fail.clear(); options.downloads.length = 0;
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads.sort()).toEqual(["a", "b"]);
});

test.each([
  ["a new revision", (options: ResourceDocument) => { options.revision = "2"; }],
  ["a changed body without a revision", (options: ResourceDocument) => { options.text = "Edited rule"; }],
] as const)("a retry after %s downloads every resource again", async (_name, change) => {
  const root = await workspace();
  const options: ResourceDocument = { fail: new Set(["b"]), downloads: [], ...(_name.includes("without") ? { revision: null } : {}) };
  const read = resourceDocument(["a", "b"], options);
  await failOnce(root, read, options);
  change(options);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads.sort()).toEqual(["a", "b"]);
});

test("without a revision, the same raw body reuses saved resources", async () => {
  const root = await workspace();
  const options: ResourceDocument = { fail: new Set(["b"]), downloads: [], revision: null };
  const read = resourceDocument(["a", "b"], options);
  await failOnce(root, read, options);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads).toEqual(["b"]);
});

test("a retry with another identity or a host prefetch downloads every resource again", async () => {
  const previous = process.env.CONTEXT_LARK_IDENTITY;
  try {
    for (const mode of ["identity", "prefetched"] as const) {
      const root = await workspace();
      const options: ResourceDocument = { fail: new Set(["b"]), downloads: [] };
      const read = resourceDocument(["a", "b"], options);
      process.env.CONTEXT_LARK_IDENTITY = "user";
      await failOnce(root, read, options);
      if (mode === "identity") process.env.CONTEXT_LARK_IDENTITY = "bot";
      await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"],
        ...(mode === "prefetched" ? { prefetched: { identity: "user" as const, responsePages: [(await read(["docs", "+fetch"])).stdout] } } : {}) });
      expect(options.downloads.sort()).toEqual(["a", "b"]);
    }
  } finally {
    if (previous === undefined) delete process.env.CONTEXT_LARK_IDENTITY; else process.env.CONTEXT_LARK_IDENTITY = previous;
  }
});

test("a retry reads whiteboards again and reuses only images", async () => {
  const root = await workspace();
  const options: ResourceDocument = { fail: new Set(["b"]), downloads: [], whiteboard: true };
  const read = resourceDocument(["a", "b"], options);
  await failOnce(root, read, options);
  await runCaptureLarkPhase({ projectRoot: root, phase, larkRunner: read, refreshSources: ["lark:handbook"] });
  expect(options.downloads.sort()).toEqual(["b", "board", "raw:board"]);
});

test("after a failed capture, excluding the failing type by policy saves the snapshot", async () => {
  const root = await workspace();
  const options: ResourceDocument = { fail: new Set(["attachment"]), downloads: [], file: true };
  const read = resourceDocument(["a"], options);
  await failOnce(root, read, options);
  const saved = await runCaptureLarkPhase({ projectRoot: root, larkRunner: read, refreshSources: ["lark:handbook"],
    phase: captureLark({ source: source("handbook"), resources: { files: "reference-only" } }) });
  expect(options.downloads).toEqual([]);
  expect(saved.resource_materialization.status).toBe("complete");
  expect(saved.resource_materialization.items.find(item => item.kind === "file")).toMatchObject({ status: "reference-only", reason_code: "file-excluded-by-policy" });
  expect(await readFile(join(root, documentPath), "utf8")).toContain("File omitted: Plan.pdf");
});

test("explicit bundle settings still skip an unchanged revision", async () => {
  const root = await workspace();
  const options: ResourceDocument = { fail: new Set(), downloads: [], file: true };
  const read = resourceDocument(["a"], options);
  const explicit = captureLark({ source: source("handbook"), resources: { images: "bundle", gifs: "bundle", files: "bundle", whiteboards: "bundle" } });
  await runCaptureLarkPhase({ projectRoot: root, phase: explicit, larkRunner: read });
  options.downloads.length = 0;
  expect((await runCaptureLarkPhase({ projectRoot: root, phase: explicit, larkRunner: read })).snapshot.changed).toBe(false);
  expect(options.downloads).toEqual([]);
});

test("a retry skips images that went over the unchanged budget, and downloads them after the budget is raised", async () => {
  const big = "b".repeat(30);
  for (const raised of [false, true]) {
    const root = await workspace();
    const options: ResourceDocument = { fail: new Set(["c"]), downloads: [] };
    const read = resourceDocument(["a", big, "c"], options);
    const limited = captureLark({ source: source("handbook"), resources: { maxBytesPerResource: 20, maxTotalBytes: 100 } });
    await failOnce(root, read, options, { phase: limited });
    const report = JSON.parse(await readFile(join(root, "sources/lark/handbook/assets/capture-report.json"), "utf8"));
    expect(report.resource_budget).toEqual({ maxBytesPerResource: 20, maxTotalBytes: 100 });
    const retried = await runCaptureLarkPhase({ projectRoot: root, larkRunner: read, refreshSources: ["lark:handbook"],
      phase: raised ? captureLark({ source: source("handbook"), resources: { maxBytesPerResource: 100, maxTotalBytes: 100 } }) : limited });
    expect(options.downloads.sort()).toEqual(raised ? [big, "c"].sort() : ["c"]);
    expect(retried.resource_materialization.status).toBe(raised ? "complete" : "warning");
  }
});
