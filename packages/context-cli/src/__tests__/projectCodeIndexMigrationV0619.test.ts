import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { legacyCodeIndexMigrationRequired, migrateLegacyCodeIndex } from "../project/codeIndexMigration.js";
import { CANDIDATE_LEDGER_FILE } from "../project/candidateLedger.js";
import { cli_main } from "../cli.js";

const CODE_INDEX_AUDIT_STATE_PATH = ".tmp/context-runtime/code-index-audit/state.json";

function currentCandidateRecord(): Record<string, unknown> {
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    candidate_id: `indexer/${"a".repeat(64)}`,
    node_ref: `node:subject:sha256:${"b".repeat(64)}`,
    view_ref: `view:artifact:sha256:${"c".repeat(64)}`,
    collection: "codeindex",
    status: "draft",
    candidate_type: "indexer-artifact",
    kind: "Guide",
    visibility: "public",
    module: "sample",
    path: "codeindex/sample.md",
    structure_digest: digest,
    source_refs: ["repo:sample"],
    body: "# Sample",
    indexer_candidate: {
      compile_digest: digest,
      file_digest: digest,
      artifact_ref: `artifact:subject:sha256:${"d".repeat(64)}`,
      section_refs: [`section:subject:sha256:${"e".repeat(64)}`],
      source_ref: "repo:sample",
      evidence_bindings: [],
      sections: [{
        section_ref: `section:subject:sha256:${"e".repeat(64)}`,
        section_key: "overview",
        evidence_refs: [],
        markdown: "# Sample",
        markdown_digest: digest,
      }],
    },
    fingerprint: digest,
    review: {
      title: "Sample",
      summary: "Sample",
      signals: ["current"],
      reason: "Current Indexer Candidate",
    },
    updated: "2026-07-12T00:00:00.000Z",
  };
}

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
      const candidateLedger = join(root, CANDIDATE_LEDGER_FILE);
      await mkdir(dirname(candidateLedger), { recursive: true });
      await writeFile(candidateLedger, `${JSON.stringify({
        candidate_id: "codegraph/sample/map",
        collection: "codegraph",
        status: "draft",
      })}\n`, "utf8");
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

  test("does not classify or remove a current Indexer Candidate ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-current-candidate-"));
    try {
      const candidateLedger = join(root, CANDIDATE_LEDGER_FILE);
      const content = `${JSON.stringify(currentCandidateRecord())}\n`;
      await mkdir(dirname(candidateLedger), { recursive: true });
      await writeFile(candidateLedger, content, "utf8");

      expect(await legacyCodeIndexMigrationRequired(root)).toBe(false);
      expect((await migrateLegacyCodeIndex(root)).changed).toBe(false);
      expect(await readFile(candidateLedger, "utf8")).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("removes legacy Candidate rows while retaining current rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-codeindex-mixed-candidate-"));
    try {
      const candidateLedger = join(root, CANDIDATE_LEDGER_FILE);
      const current = JSON.stringify(currentCandidateRecord());
      const legacy = JSON.stringify({
        candidate_id: "codegraph/sample/map",
        collection: "codegraph",
        status: "draft",
      });
      await mkdir(dirname(candidateLedger), { recursive: true });
      await writeFile(candidateLedger, `${legacy}\n${current}\n`, "utf8");

      expect(await legacyCodeIndexMigrationRequired(root)).toBe(true);
      const result = await migrateLegacyCodeIndex(root);
      expect(result.changed).toBe(true);
      expect(await readFile(candidateLedger, "utf8")).toBe(`${current}\n`);
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a direct review command leaves legacy state unchanged until explicit migration", async () => {
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
      expect(existsSync(join(root, "knowledge", "codegraph", "sample", "map.md"))).toBe(true);
      expect(existsSync(join(root, "knowledge", "codeindex"))).toBe(false);
      expect(await legacyCodeIndexMigrationRequired(root)).toBe(true);
    } finally {
      process.stdout.write = stdout;
      process.chdir(cwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
