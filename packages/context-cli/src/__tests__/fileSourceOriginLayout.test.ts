import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileSourceOriginInstallHint } from "../project/fileSourceOrigins.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { initContextProject } from "../project/workspace.js";
import { parseDocumentSnapshotForSource } from "../project/documentBatchManifest.js";
import { siteReferenceSource } from "../project/packageSiteSources.js";
import { loadSourcesRegistry } from "@c4a/context";
import {
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  writeCaptureProjectEntry,
} from "./projectCaptureFileV062Helpers.js";

interface CaptureOutput {
  result: {
    source: Record<string, unknown>;
    snapshot: { manifest: string; materializedAt: string; snapshot_hash: string; changed: boolean };
    documents: Array<{ path: string; title: string }>;
    asset_gaps?: Array<{ document: string; target: string; reason: string }>;
    diagnostics: string[];
  };
}

async function project(): Promise<{ root: string; projectRoot: string }> {
  const root = makeTmp();
  const { projectRoot } = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  return { root, projectRoot };
}

function manifestFor(projectRoot: string, sourceName: string) {
  return parseDocumentSnapshotForSource(JSON.parse(readFileSync(
    join(projectRoot, "sources", "file", sourceName, "manifest.json"),
    "utf8",
  )) as unknown, sourceName);
}

describe("file source layout, gaps and versioned origins", () => {
  test("tree layout keeps folders and linked images; broken links become gaps", async () => {
    const { root, projectRoot } = await project();
    try {
      const wiki = join(projectRoot, "..", "wiki");
      await mkdir(join(wiki, "guide", "img"), { recursive: true });
      await mkdir(join(wiki, "ops"), { recursive: true });
      writeFileSync(join(wiki, "guide", "start.md"), "# Start\n\n![flow](img/flow.png)\n![gone](img/missing.png)\n", "utf8");
      writeFileSync(join(wiki, "guide", "img", "flow.png"), new Uint8Array([1, 2, 3]));
      writeFileSync(join(wiki, "ops", "start.md"), "# Ops start\n\n![outside](../../elsewhere.png)\n", "utf8");
      await runCliInDir(projectRoot, ["source", "add", "file", "wiki", "--local", wiki, "--layout", "tree", "--format", "json"]);
      writeCaptureProjectEntry(projectRoot, "wiki");

      const output = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:wiki", "--format", "json"])) as CaptureOutput;
      expect(output.result.documents.map((doc) => doc.path)).toEqual(["guide/start.md", "ops/start.md"]);
      expect(output.result.asset_gaps).toEqual([
        { document: "guide/start.md", target: "img/missing.png", reason: "missing" },
        { document: "ops/start.md", target: "../../elsewhere.png", reason: "outside" },
      ]);
      expect(output.result.diagnostics.some((line) => line.includes("kept 2 linked asset(s) as links only"))).toBe(true);
      expect(readFileSync(join(projectRoot, "sources", "file", "wiki", "guide", "img", "flow.png"))).toEqual(Buffer.from([1, 2, 3]));
      const manifest = manifestFor(projectRoot, "wiki");
      expect(manifest.metadata?.capture?.layout).toBe("tree");
      expect(manifest.assets?.map((asset) => asset.path)).toEqual(["guide/img/flow.png"]);

      const ensure = JSON.parse(await runCliInDir(projectRoot, ["source", "ensure", "wiki", "--format", "json"])) as Array<Record<string, unknown>>;
      expect(ensure[0]).toMatchObject({ snapshotReady: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("document extensions capture JSON and YAML as citable text", async () => {
    const { root, projectRoot } = await project();
    try {
      const data = join(projectRoot, "..", "data");
      await mkdir(data, { recursive: true });
      writeFileSync(join(data, "rules.json"), "{\n  \"limit\": 3\n}\n", "utf8");
      writeFileSync(join(data, "flags.yaml"), "enabled: true\n", "utf8");
      writeFileSync(join(data, "readme.md"), "# Data\n", "utf8");
      await runCliInDir(projectRoot, [
        "source", "add", "file", "data", "--local", data,
        "--document-ext", ".md", "--document-ext", "json", "--document-ext", ".yaml", "--format", "json",
      ]);
      writeCaptureProjectEntry(projectRoot, "data");
      const output = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:data", "--format", "json"])) as CaptureOutput;
      expect(output.result.documents.map((doc) => doc.path)).toEqual(["flags.yaml", "readme.md", "rules.json"]);
      expect(readFileSync(join(projectRoot, "sources", "file", "data", "rules.json"), "utf8")).toContain("\"limit\": 3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a versioned origin installs under sources/<kind>/, is ignored by Git and recorded in the snapshot", async () => {
    const { root, projectRoot } = await project();
    try {
      const rejected = await invokeCliInDir(projectRoot, [
        "source", "add", "file", "handbook", "--local", "vendor/handbook",
        "--origin-kind", "git", "--origin-id", "https://example.com/team/handbook.git", "--origin-version", "abc1234",
        "--format", "json",
      ]);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("sources/git/<name>@abc1234");

      const install = join(projectRoot, "sources", "git", "handbook@abc1234");
      const added = JSON.parse(await runCliInDir(projectRoot, [
        "source", "add", "file", "handbook", "--local", "sources/git/handbook@abc1234/docs", "--layout", "tree",
        "--origin-kind", "git", "--origin-id", "https://example.com/team/handbook.git", "--origin-version", "abc1234",
        "--format", "json",
      ])) as Record<string, unknown>;
      expect(added.gitignore_added).toBe("sources/git/");
      expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toContain("\nsources/git/\n");
      expect(added).toMatchObject({ local: "sources/git/handbook@abc1234/docs", origin: { kind: "git", version: "abc1234" } });
      writeCaptureProjectEntry(projectRoot, "handbook");

      // A missing install is a deferred evidence gap whose next step is the install command.
      const missing = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:handbook", "--format", "json"])) as {
        result: { kind: string; captured: boolean; warning: { code: string; next: string } };
      };
      expect(missing.result).toMatchObject({ kind: "document.capture.warning", captured: false });
      expect(missing.result.warning.code).toBe("document.acquisition-unavailable");
      expect(missing.result.warning.next).toContain("into sources/git/handbook@abc1234/docs");
      expect(missing.result.warning.next).toContain("git clone");

      await mkdir(join(install, "docs", "setup"), { recursive: true });
      writeFileSync(join(install, "docs", "setup", "install.md"), "# Install\n\nRun it.\n", "utf8");
      const outside = join(projectRoot, "..", "linked.md");
      writeFileSync(outside, "# Linked\n", "utf8");
      symlinkSync(outside, join(install, "docs", "linked.md"));
      const linked = await invokeCliInDir(projectRoot, ["run", "capture:file:handbook", "--format", "json"]);
      expect(linked.status).not.toBe(0);
      expect(linked.stderr).toContain("symbolic link");
      rmSync(join(install, "docs", "linked.md"));

      const output = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:handbook", "--format", "json"])) as CaptureOutput;
      expect(output.result.source.origin).toMatchObject({ kind: "git", version: "abc1234" });
      const manifest = manifestFor(projectRoot, "handbook");
      expect(manifest.metadata?.source).toMatchObject({
        revisionId: "git:https://example.com/team/handbook.git@abc1234",
        title: "https://example.com/team/handbook.git",
      });
      expect(manifest.files.map((file) => file.path)).toEqual(["setup/install.md"]);
      expect(manifest.files[0]?.content_hash).toMatch(/^sha256:/u);

      const registry = await loadSourcesRegistry({ rootDir: projectRoot });
      const site = siteReferenceSource({
        source_ref: "file:handbook",
        locator: { path: "setup/install.md", start_line: 1, end_line: 3 },
      } as Parameters<typeof siteReferenceSource>[0], registry);
      expect(site).toMatchObject({
        label: "https://example.com/team/handbook.git@abc1234 · docs/setup/install.md L1–L3",
        href: "https://example.com/team/handbook/blob/abc1234/docs/setup/install.md#L1-L3",
      });

      const single = siteReferenceSource({
        source_ref: "file:handbook",
        locator: { path: "install.md", start_line: 2, end_line: 2 },
      } as Parameters<typeof siteReferenceSource>[0], { ...registry, files: registry.files.map((file) =>
        ({ ...file, local: "sources/git/handbook@abc1234/docs/setup/install.md" })) });
      expect(single.href).toBe("https://example.com/team/handbook/blob/abc1234/docs/setup/install.md#L2-L2");

      // Upgrade: a new version directory, same registration otherwise.
      const next = join(projectRoot, "sources", "git", "handbook@def5678", "docs", "setup");
      await mkdir(next, { recursive: true });
      writeFileSync(join(next, "install.md"), "# Install\n\nRun it twice.\n", "utf8");
      await runCliInDir(projectRoot, [
        "source", "add", "file", "handbook", "--local", "sources/git/handbook@def5678/docs", "--origin-version", "def5678", "--format", "json",
      ]);
      const upgraded = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:handbook", "--format", "json"])) as CaptureOutput;
      expect(upgraded.result.snapshot.changed).toBe(true);
      expect(manifestFor(projectRoot, "handbook").metadata?.source?.revisionId).toBe("git:https://example.com/team/handbook.git@def5678");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a frozen source keeps its snapshot without reading the local path", async () => {
    const { root, projectRoot } = await project();
    try {
      const docs = join(projectRoot, "..", "archive");
      await mkdir(docs, { recursive: true });
      writeFileSync(join(docs, "old.md"), "# Old\n\nKept.\n", "utf8");
      await runCliInDir(projectRoot, ["source", "add", "file", "archive", "--local", docs, "--format", "json"]);
      writeCaptureProjectEntry(projectRoot, "archive");

      const neverCaptured = await runCliInDir(projectRoot, ["source", "add", "file", "archive", "--freeze", "--format", "json"]);
      expect(JSON.parse(neverCaptured)).toMatchObject({ frozen: true });
      const blocked = await invokeCliInDir(projectRoot, ["run", "capture:file:archive", "--format", "json"]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("is frozen but has no captured snapshot");

      await runCliInDir(projectRoot, ["source", "add", "file", "archive", "--unfreeze", "--format", "json"]);
      const first = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:archive", "--format", "json"])) as CaptureOutput;
      await runCliInDir(projectRoot, ["source", "add", "file", "archive", "--freeze", "--format", "json"]);
      rmSync(docs, { recursive: true, force: true });

      const frozen = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:archive", "--format", "json"])) as CaptureOutput;
      expect(frozen.result.snapshot).toMatchObject({ changed: false, snapshot_hash: first.result.snapshot.snapshot_hash });
      expect(frozen.result.source.frozen).toBe(true);
      expect(frozen.result.documents.map((doc) => doc.path)).toEqual(["old.md"]);
      expect(existsSync(join(projectRoot, "sources", "file", "archive", "old.md"))).toBe(true);
      const ensure = JSON.parse(await runCliInDir(projectRoot, ["source", "ensure", "archive", "--format", "json"])) as Array<Record<string, unknown>>;
      expect(ensure[0]).toMatchObject({ snapshotReady: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("origins starting with a dash are rejected and git hints end options before arguments", async () => {
    const { root, projectRoot } = await project();
    try {
      const rejected = await invokeCliInDir(projectRoot, [
        "source", "add", "file", "evil", "--local", "sources/git/evil@v1",
        "--origin-kind", "git", "--origin-id=--upload-pack=touch /tmp/x", "--origin-version", "v1", "--format", "json",
      ]);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("invalid origin.id");
      const hint = fileSourceOriginInstallHint({ kind: "git", id: "https://example.com/a.git", version: "abc" }, "sources/git/a@abc");
      expect(hint).toContain("--no-checkout -- https://example.com/a.git sources/git/a@abc");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("tree assets cannot escape through symbolic links, skip documents and never overwrite the manifest", async () => {
    const { root, projectRoot } = await project();
    try {
      const wiki = join(projectRoot, "..", "wiki-links");
      await mkdir(wiki, { recursive: true });
      const secret = join(projectRoot, "..", "secret.json");
      writeFileSync(secret, "{\"token\": \"x\"}\n", "utf8");
      symlinkSync(secret, join(wiki, "creds.json"));
      writeFileSync(join(wiki, "rules.json"), "{\n  \"limit\": 3\n}\n", "utf8");
      writeFileSync(join(wiki, "index.md"), "# Index\n\n[creds](creds.json) [rules](rules.json)\n", "utf8");
      await runCliInDir(projectRoot, ["source", "add", "file", "links", "--local", wiki, "--layout", "tree",
        "--document-ext", ".md", "--document-ext", ".json", "--format", "json"]);
      writeCaptureProjectEntry(projectRoot, "links");
      const output = JSON.parse(await runCliInDir(projectRoot, ["run", "capture:file:links", "--format", "json"])) as CaptureOutput;
      expect(output.result.asset_gaps).toEqual([{ document: "index.md", target: "creds.json", reason: "outside" }]);
      expect(existsSync(join(projectRoot, "sources", "file", "links", "creds.json"))).toBe(false);
      const manifest = manifestFor(projectRoot, "links");
      expect(manifest.files.map((file) => file.path)).toEqual(["index.md", "rules.json"]);
      expect(manifest.assets ?? []).toEqual([]);

      writeFileSync(join(wiki, "manifest.json"), "{}\n", "utf8");
      const clash = await invokeCliInDir(projectRoot, ["run", "capture:file:links", "--format", "json"]);
      expect(clash.status).not.toBe(0);
      expect(clash.stderr).toContain("would overwrite the snapshot manifest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
