import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { legacyCodeIndexMigrationRequired, migrateLegacyCodeIndex } from "../project/codeIndexMigration.js";
import { CODE_INDEX_AUDIT_STATE_PATH } from "../project/codeIndexAudit.js";
import { CANDIDATE_LEDGER_FILE, writeCandidateRecords } from "../project/candidateLedger.js";
import { cli_main } from "../cli.js";

describe("0.6.19 codeindex migration", () => {
  test("moves legacy knowledge and rewrites formal identities without a marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-migration-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "knowledge", "codegraph", "sample"), { recursive: true });
      await writeFile(join(root, "src", "index.ts"), 'extractTs({ source: sample, collection: "codegraph" });\n', "utf8");
      await writeFile(join(root, "knowledge", "codegraph", "sample", "map.md"), [
        "---",
        "view_ref: codegraph:sample/map",
        "---",
        "# Map",
      ].join("\n"), "utf8");
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(true);
      const result = await migrateLegacyCodeIndex(root);
      expect(result.changed).toBe(true);
      expect(result.moved_pages).toBe(1);
      expect(existsSync(join(root, "knowledge", "codegraph"))).toBe(false);
      expect(await readFile(join(root, "src", "index.ts"), "utf8")).toContain('collection: "codeindex"');
      expect(await readFile(join(root, "knowledge", "codeindex", "sample", "map.md"), "utf8"))
        .toContain("view_ref: codeindex:sample/map");
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(false);
      expect((await migrateLegacyCodeIndex(root)).changed).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects old/new path conflicts before changing either tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-conflict-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "knowledge", "codegraph"), { recursive: true });
      await mkdir(join(root, "knowledge", "codeindex"), { recursive: true });
      const source = 'extractTs({ collection: "codegraph" });\n';
      await writeFile(join(root, "src", "index.ts"), source, "utf8");
      await writeFile(join(root, "knowledge", "codegraph", "old.md"), "view_ref: codegraph:old\n", "utf8");
      await writeFile(join(root, "knowledge", "codeindex", "new.md"), "view_ref: codeindex:new\n", "utf8");
      await expect(migrateLegacyCodeIndex(root)).rejects.toThrow("resolve the duplicate collection first");
      expect(await readFile(join(root, "src", "index.ts"), "utf8")).toBe(source);
      expect(existsSync(join(root, "knowledge", "codegraph", "old.md"))).toBe(true);
      expect(existsSync(join(root, "knowledge", "codeindex", "new.md"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("detects and rewrites formal legacy identities without knowledge or runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-config-migration-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "package.json"), '{"name":"fixture"}\n', "utf8");
      await writeFile(join(root, "src", "index.ts"), [
        'const phase = "extract:sample:codegraph";',
        'extractTs({ collection: "codegraph" });',
        "",
      ].join("\n"), "utf8");
      await writeFile(join(root, "docs", "guide.mdx"), "Read `wikis/codegraph/sample/map.md`.\n", "utf8");
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(true);
      const result = await migrateLegacyCodeIndex(root);
      expect(result.changed).toBe(true);
      expect(result.moved_pages).toBe(0);
      expect(await readFile(join(root, "src", "index.ts"), "utf8")).toContain('"extract:sample:codeindex"');
      expect(await readFile(join(root, "docs", "guide.mdx"), "utf8")).toContain("wikis/codeindex/sample/map.md");
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalidates legacy candidates, review receipts, audit state, and package output", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-invalidation-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "index.ts"), 'extractTs({ collection: "codegraph" });\n', "utf8");
      await writeCandidateRecords(root, [{
        candidate_id: "codegraph/sample/map",
        node_ref: "sample/map",
        view_ref: "codegraph:sample/map",
        collection: "codegraph",
        status: "draft",
        kind: "module-map",
        visibility: "exported",
        module: "sample",
        path: "codegraph/sample/map.md",
        source_refs: ["repo:sample#symbol:src/index.ts:entry:function@sha256:abc"],
        fingerprint: "legacy",
        review: { title: "Map", summary: "Legacy", signals: ["legacy"], reason: "Legacy" },
        updated: "2026-08-25T00:00:00.000Z",
      }]);
      await mkdir(join(root, ".tmp", "context-runtime", "extract"), { recursive: true });
      await mkdir(join(root, ".tmp", "context-runtime", "review"), { recursive: true });
      await mkdir(join(root, ".tmp", "context-runtime", "code-index-audit"), { recursive: true });
      await mkdir(join(root, "dist", "sample"), { recursive: true });
      await writeFile(join(root, ".tmp", "context-runtime", "extract", "preview.json"), "{}\n", "utf8");
      await writeFile(join(root, ".tmp", "context-runtime", "review", "receipt.json"), "{}\n", "utf8");
      await writeFile(join(root, CODE_INDEX_AUDIT_STATE_PATH), "{}\n", "utf8");
      await writeFile(join(root, "dist", "sample", "manifest.json"), "{}\n", "utf8");

      const result = await migrateLegacyCodeIndex(root);
      expect(result.removed_runtime_paths).toEqual([
        ".tmp/context-runtime/extract",
        ".tmp/context-runtime/review",
        "dist",
        CODE_INDEX_AUDIT_STATE_PATH,
      ]);
      expect(existsSync(join(root, CANDIDATE_LEDGER_FILE))).toBe(false);
      expect(existsSync(join(root, ".tmp", "context-runtime", "review"))).toBe(false);
      expect(existsSync(join(root, "dist"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a direct review command migrates legacy protocol and continues the requested action", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-direct-"));
    const cwd = process.cwd();
    const stdout = process.stdout.write;
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "knowledge", "codegraph", "sample"), { recursive: true });
      await writeFile(join(root, "package.json"), `${JSON.stringify({
        name: "fixture",
        context: { project: true, entry: "src/index.ts" },
      })}\n`, "utf8");
      await writeFile(join(root, "src", "index.ts"), 'const collection = "codegraph";\n', "utf8");
      await writeFile(join(root, "knowledge", "codegraph", "sample", "map.md"), "view_ref: codegraph:sample/map\n", "utf8");
      process.chdir(root);
      process.stdout.write = (() => true) as typeof process.stdout.write;
      await cli_main(["node", "context", "review", "list", "codeindex", "--format", "json"]);
      expect(existsSync(join(root, "knowledge", "codeindex", "sample", "map.md"))).toBe(true);
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(false);
    } finally {
      process.stdout.write = stdout;
      process.chdir(cwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
