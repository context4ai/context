import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { addRepoSource } from "../project/repoSources.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-extraction-preview-v0615-"));
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const originalCwd = process.cwd();
  const originalStdoutWrite = process.stdout.write;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await createCliProgram().parseAsync(["node", "context", ...args]);
  } catch (error) {
    const status = handleCliFailure(error, {
      stderr: {
        write: ((chunk: string | Uint8Array) => {
          stderrChunks.push(String(chunk));
          return true;
        }) as typeof process.stderr.write,
      },
      exit: (code) => code,
    });
    if (status !== 0) throw error;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.chdir(originalCwd);
  }
  if (stderrChunks.length > 0) throw new Error(stderrChunks.join(""));
  return stdoutChunks.join("");
}

function initLargeTsFixtureRepo(path: string, symbols: number): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  execFileSync("mkdir", ["-p", "src"], { cwd: path });
  writeFileSync(join(path, "package.json"), `${JSON.stringify({
    name: "large-lib",
    version: "1.0.0",
    type: "module",
    exports: "./src/index.ts",
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(path, "src", "index.ts"), [
    ...Array.from({ length: symbols }, (_, index) => `export const symbol${index} = ${index};`),
    "",
  ].join("\n"), "utf8");
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", "add large ts fixture"], { cwd: path });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim();
}

async function initializeLargeProject(root: string, symbols: number): Promise<string> {
  const repo = join(root, "large-lib");
  const project = join(root, "kb");
  await mkdir(repo, { recursive: true });
  const head = initLargeTsFixtureRepo(repo, symbols);
  await runCliInDir(root, ["init", "kb"]);
  writeFileSync(join(project, "src", "index.ts"), [
    'import { defineProject, extractTs, source } from "@c4a/context";',
    'const large = source("20260712", "large-lib");',
    "export default defineProject({",
    "  sources: [large],",
    '  phases: [extractTs({ source: large, collection: "codeindex" })],',
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
  await addRepoSource({
    projectRoot: project,
    namespace: "20260712",
    module: "large-lib",
    local: "../large-lib",
    remote: "https://git.example.com/large-lib.git",
    ref: head,
  });
  return project;
}

function readCandidateRows(project: string): unknown[] {
  const path = join(project, ".tmp/context-runtime/lifecycle/candidates.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

describe("0.6.15 extraction batch preview", () => {
  test("blocks an index unit above 300 projected pages before candidate writes", async () => {
    const root = makeTmp();
    try {
      const project = await initializeLargeProject(root, 301);
      const batch = JSON.parse(await runCliInDir(project, [
        "run", "--preview-extraction-batch", "--preview-phase",
        "extract:20260712/large-lib:codeindex", "--format", "json",
      ])) as {
        schema: string;
        preview_digest: string;
        summary: {
          scale_clear: boolean;
          blocked_units: number;
          projected_pages: number;
          advisories: string[];
          reusable_phase_caches: number;
        };
        items: { items: Array<{ scale: string; projected_pages: number; module_types: string[]; facets: string[] }> };
        views: Array<{ command: string }>;
      };
      expect(batch).toMatchObject({
        schema: "context.extraction-batch-preview-view.v1",
        summary: {
          scale_clear: false,
          blocked_units: 1,
          projected_pages: 301,
          advisories: ["batch-page-count-warning"],
          reusable_phase_caches: 0,
        },
      });
      expect(batch.items.items[0]).toMatchObject({
        scale: "blocked",
        projected_pages: 301,
        module_types: ["sdk-library"],
        facets: ["public-api"],
      });
      expect(batch.views[0]?.command).toContain(batch.preview_digest);
      expect(Buffer.byteLength(JSON.stringify(batch, null, 2))).toBeLessThanOrEqual(24_000);
      expect(existsSync(join(project, ".tmp/context-runtime/extract/previews/batch.json"))).toBe(true);
      await expect(runCliInDir(project, [
        "run", "extract:20260712/large-lib:codeindex",
      ])).rejects.toMatchObject({
        detail: expect.objectContaining({ code: "extract-scale-limit-exceeded" }),
      });
      expect(readCandidateRows(project)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("warns but keeps 101 to 300 page index units executable", async () => {
    const root = makeTmp();
    try {
      const project = await initializeLargeProject(root, 101);
      const batch = JSON.parse(await runCliInDir(project, [
        "run", "--preview-extraction-batch", "--format", "json",
      ])) as {
        preview_digest: string;
        summary: { scale_clear: boolean; warning_units: number; blocked_units: number };
        items: { items: Array<{ scale: string }> };
      };
      expect(batch).toMatchObject({
        summary: { scale_clear: true, warning_units: 1, blocked_units: 0 },
      });
      expect(batch.items.items[0]?.scale).toBe("warning");
      const targetSymbols = JSON.parse(await runCliInDir(project, [
        "run", "--preview-extraction-batch",
        "--preview-digest", batch.preview_digest,
        "--view", "items",
        "--item-kind", "target-symbol",
        "--page-size", "25",
        "--format", "json",
      ])) as {
        view: string;
        preview_digest: string;
        page: { total: number; shown: number; has_more: boolean };
        items: { item_id_field: string; items: Array<{ item_id: string; text: string }> };
      };
      expect(targetSymbols).toMatchObject({
        view: "items",
        preview_digest: batch.preview_digest,
        page: { total: 101, shown: 25, has_more: true },
        items: { item_id_field: "item_id" },
      });
      expect(targetSymbols.items.items.every((item) => item.item_id.length > 0 && item.text.length > 0)).toBe(true);
      await runCliInDir(project, ["run", "extract:20260712/large-lib:codeindex"]);
      expect(readCandidateRows(project)).toHaveLength(101);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
