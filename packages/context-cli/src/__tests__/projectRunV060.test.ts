import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { verifyProjectWorkspace } from "../project/verify.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-run-v060-"));
}

async function invokeCliInDir(dir: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
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
    return { status: 0, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
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
    return { status, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.chdir(originalCwd);
  }
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const result = await invokeCliInDir(dir, args);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  const headRef = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  const head = headRef.startsWith("ref: ")
    ? readFileSync(join(path, ".git", headRef.slice("ref: ".length)), "utf8").trim()
    : headRef;
  if (head.length === 0) throw new Error(`git HEAD is empty for ${path}`);
  return head;
}

function initTsRepo(path: string, packageName: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  execFileSync("mkdir", ["-p", "src"], { cwd: path });
  writeFileSync(join(path, "package.json"), `${JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: "./src/index.ts",
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(path, "src", "index.ts"), [
    'export { Button } from "./Button";',
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Button.ts"), [
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add ts fixture");
}

function readRows(project: string): Array<{ id: string; candidate_id: string; path: string; source_refs: string[] }> {
  const path = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as { candidate_id: string; path: string; source_refs: string[] };
      return { ...row, id: row.candidate_id };
    });
}

function readFullRows(project: string): Array<Record<string, unknown>> {
  const path = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function candidateSnapshotPath(project: string, id: string): string {
  return join(project, ".tmp", "context-runtime", "extract", "candidates", `${id}.json`);
}

async function runCliProcess(dir: string, args: string[]) {
  return invokeCliInDir(dir, args);
}

function writeProjectEntry(project: string, mode: "single" | "all"): void {
  const content = mode === "single"
    ? [
        'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
        "",
        'const sampleA = source("20260712", "sample-a");',
        "",
        "export default defineProject({",
        "  sources: [sampleA],",
        "  phases: [",
        '    extractTs({ source: sampleA, collection: "codegraph" }),',
        '    reviewValidity({ collection: "codegraph" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n")
    : [
        'import { allSources, defineProject, extractTs, reviewValidity } from "@c4a/context";',
        "",
        'const repoSources = allSources("repo");',
        "const repoSourceCollection = repoSources[0];",
        "",
        "export default defineProject({",
        "  sources: repoSources,",
        "  phases: [",
        '    extractTs({ source: repoSourceCollection, collection: "codegraph" }),',
        '    reviewValidity({ collection: "codegraph" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n");
  writeFileSync(join(project, "src", "index.ts"), content, "utf8");
}

function writeCustomProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { customPhase, defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
    "",
    'const sampleA = source("20260712", "sample-a");',
    "",
    "export default defineProject({",
    "  sources: [sampleA],",
    "  phases: [",
    '    customPhase("custom:sample-a:review", async (ctx) => {',
    "      await ctx.ensureSources({ source: sampleA });",
    '      await ctx.extract.ts(extractTs({ source: sampleA, collection: "codegraph" }));',
    '      await ctx.review.html(reviewValidity({ collection: "codegraph" }));',
    "    }),",
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.0 project phase runtime edge cases", () => {
  test("custom phase ctx helpers run current source, extract, and review primitives", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeCustomProjectEntry(project);

      const output = await runCliInDir(project, ["run", "custom:sample-a:review"]);
      expect(output).toContain("ran custom:sample-a:review");
      expect(readRows(project).map((row) => row.id)).toEqual(["codegraph/sample-a/symbol/button"]);
      expect(existsSync(join(project, ".tmp", "context-runtime", "review", "codegraph.html"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source-ref extract only materializes declared source and source-scopes candidate ids", async () => {
    const root = makeTmp();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    const project = join(root, "kb");
    try {
      await mkdir(repoA, { recursive: true });
      await mkdir(repoB, { recursive: true });
      const headA = initTsRepo(repoA, "shared-lib");
      const headB = initTsRepo(repoB, "shared-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        headA,
      ]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-b",
        "--local",
        "../repo-b",
        "--remote",
        "https://git.example.com/repo-b.git",
        "--ref",
        headB,
      ]);
      rmSync(join(project, "sources", "repo", "20260712", "sample-b"), { recursive: true, force: true });

      writeProjectEntry(project, "single");
      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(existsSync(join(project, "sources", "repo", "20260712", "sample-a"))).toBe(true);
      expect(existsSync(join(project, "sources", "repo", "20260712", "sample-b"))).toBe(false);
      expect(readRows(project).every((row) => row.source_refs[0]?.startsWith("repo:20260712/sample-a#"))).toBe(true);

      writeProjectEntry(project, "all");
      await runCliInDir(project, ["run", "extract:repo:codegraph"]);
      const ids = readRows(project).map((row) => row.id);
      expect(ids).toContain("codegraph/sample-a/symbol/button");
      expect(ids).toContain("codegraph/sample-b/symbol/button");
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extract removes stale candidate snapshots when source symbols disappear", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");

      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      const [row] = readRows(project);
      expect(row?.id).toBe("codegraph/sample-a/symbol/button");
      if (!row) throw new Error("expected one extracted candidate");
      const snapshotPath = join(project, ".tmp", "context-runtime", "extract", "candidates", `${row.id}.json`);
      expect(existsSync(snapshotPath)).toBe(true);

      writeFileSync(join(repo, "src", "Button.ts"), [
        "function Button(label: string) {",
        "  return label;",
        "}",
        "",
      ].join("\n"), "utf8");
      const nextHead = commitAll(repo, "make button internal");
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        nextHead,
      ]);

      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(readRows(project)).toEqual([]);
      expect(existsSync(snapshotPath)).toBe(false);
      expect(existsSync(dirname(snapshotPath))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extract removes approved candidate snapshots instead of rewriting them", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");

      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      const [row] = readRows(project);
      if (!row) throw new Error("expected one extracted candidate");
      const snapshotPath = join(project, ".tmp", "context-runtime", "extract", "candidates", `${row.id}.json`);
      expect(existsSync(snapshotPath)).toBe(true);

      await runCliInDir(project, ["review", "approve", row.id, "--collection", "codegraph"]);

      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(readRows(project)).toEqual([]);
      expect(existsSync(snapshotPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("malformed lifecycle candidate JSONL blocks status and extract with schema diagnostics", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");
      await mkdir(join(project, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      writeFileSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "not-json\n", "utf8");

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("diagnostic project: .tmp/context-runtime/lifecycle/candidates.jsonl:1 invalid JSON");
      expect(status).toContain("next: Inspect and repair the invalid workspace facts: context --workflow-revision");
      expect(status).toContain("verify --format json");

      const result = await runCliProcess(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("✗ failed: schema-invalid");
      expect(result.stderr).toContain(".tmp/context-runtime/lifecycle/candidates.jsonl:1 invalid JSON");

      writeFileSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify({ id: "bad-row" })}\n`, "utf8");
      const schemaStatus = await runCliInDir(project, ["status"]);
      expect(schemaStatus).toContain("state: route.workspace.state-invalid");
      expect(schemaStatus).toContain("diagnostic project: .tmp/context-runtime/lifecycle/candidates.jsonl:1 field candidate_id");

      const schemaResult = await runCliProcess(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(schemaResult.status).not.toBe(0);
      expect(schemaResult.stderr).toContain("✗ failed: schema-invalid");
      expect(schemaResult.stderr).toContain(".tmp/context-runtime/lifecycle/candidates.jsonl:1 field candidate_id");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review decisions accept only the minimal candidate fingerprint map", async () => {
    const root = makeTmp();
    const project = join(root, "kb");
    try {
      await runCliInDir(root, ["init", "kb"]);
      writeFileSync(join(project, "knowledge", "decisions.json"), `${JSON.stringify({
        schema: "context.review.decisions.v1",
        rejected: {},
      })}\n`, "utf8");

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.workspace.state-invalid");
      expect(status).toContain("knowledge/decisions.json is invalid");
      const verify = await verifyProjectWorkspace(project);
      expect(verify.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "decisions-invalid",
        path: "knowledge/decisions.json",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review html lists draft candidates and CLI reject keeps transient lifecycle state", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");
      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      const [row] = readRows(project);
      if (!row) throw new Error("expected one extracted candidate");

      const htmlPath = join(project, "review.html");
      const htmlResult = await runCliInDir(project, ["review", "html", "codegraph", "--out", "review.html"]);
      expect(htmlResult).toContain("✓ wrote review html");
      expect(htmlResult).toContain("url: file://");
      const html = readFileSync(htmlPath, "utf8");
      expect(html).toContain("Context Review");
      expect(html).toContain(row.id);
      expect(html).toContain(row.source_refs[0] ?? "");
      expect(html).toContain('<html lang="en" data-theme="light">');
      expect(html).toContain('id="theme"');
      expect(html).not.toContain("prefers-color-scheme");
      expect(html).toContain('id="all-approved">All approved</button>');
      expect(html).toContain('id="all-rejected">All rejected</button>');
      expect(html).toContain('id="payload-open">Payload</button>');
      expect(html).toContain("<textarea");
      expect(html).toContain("1 pending 0 approved 0 rejected");
      expect(html).toContain('id="filter-pending"');
      expect(html).toContain('[item.candidate_id, "pending"]');
      expect(html).toContain("Resolve all pending candidates before copying");
      expect(html).toContain('"kind":"collection"');
      expect(html).not.toContain('"visible_candidate_ids"');
      const openResult = JSON.parse(await runCliInDir(project, [
        "review", "html", "codegraph", "--open", "--format", "json",
      ])) as { opened: boolean; open_error?: string; file_url: string; absolute_path: string };
      expect(openResult).toMatchObject({ opened: false, open_error: "auto-open-disabled" });
      expect(openResult.file_url).toStartWith("file://");
      expect(openResult.absolute_path).toBeTruthy();
      const allHtmlResult = await runCliInDir(project, ["review", "html", "--all", "--out", "review-all.html"]);
      expect(allHtmlResult).toContain("✓ wrote review html");
      const allHtml = readFileSync(join(project, "review-all.html"), "utf8");
      expect(allHtml).toContain('"kind":"all"');
      expect(allHtml).toContain('"visible_candidate_ids"');

      const list = await runCliInDir(project, ["review", "list", "codegraph"]);
      expect(list).toContain(`draft ${row.id}`);

      const reject = await runCliInDir(project, ["review", "reject", row.id, "--collection", "codegraph"]);
      expect(reject).toContain("rejected: 1");
      const [rejected] = readFullRows(project);
      expect(rejected?.candidate_id).toBe(row.id);
      expect(rejected?.status).toBe("rejected");
      expect(existsSync(candidateSnapshotPath(project, row.id))).toBe(false);
      const decisionsPath = join(project, "knowledge", "decisions.json");
      expect(JSON.parse(readFileSync(decisionsPath, "utf8"))).toEqual({
        [row.id]: rejected?.fingerprint,
      });

      await runCliInDir(project, ["close", "--format", "json"]);
      expect(existsSync(join(project, ".tmp", "context-runtime", "lifecycle"))).toBe(false);
      expect(existsSync(join(project, ".tmp", "context-runtime", "review"))).toBe(false);
      expect(JSON.parse(readFileSync(decisionsPath, "utf8"))).toEqual({
        [row.id]: rejected?.fingerprint,
      });

      const repeated = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-a:codegraph", "--format", "json",
      ])) as { result: { candidates: { skippedRejected: number } } };
      expect(repeated.result.candidates.skippedRejected).toBe(1);
      expect(readFullRows(project)).toEqual([
        expect.objectContaining({ candidate_id: row.id, status: "rejected", fingerprint: rejected?.fingerprint }),
      ]);
      await runCliInDir(project, ["close", "--format", "json"]);

      writeFileSync(join(repo, "src", "Button.ts"), [
        "export function Button(label: string, suffix = \"\") {",
        "  return `${label}${suffix}`;",
        "}",
        "",
      ].join("\n"), "utf8");
      const changedHead = commitAll(repo, "change exported symbol");
      await runCliInDir(project, [
        "source", "add", "repo", "20260712",
        "--module", "sample-a",
        "--local", "../repo-a",
        "--remote", "https://git.example.com/repo-a.git",
        "--ref", changedHead,
      ]);
      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph", "--format", "json"]);
      expect(existsSync(decisionsPath)).toBe(false);
      expect(readFullRows(project)).toEqual([
        expect.objectContaining({ candidate_id: row.id, status: "draft" }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review html script payload escapes untrusted source markdown", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      initTsRepo(repo, "sample-lib");
      writeFileSync(join(repo, "src", "Button.ts"), [
        "/**",
        " * untrusted </script><img src=x onerror=alert(1)> marker",
        " */",
        "export function Button(label: string) {",
        "  return label;",
        "}",
        "",
      ].join("\n"), "utf8");
      const head = commitAll(repo, "add untrusted docs");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");
      await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
      await runCliInDir(project, ["review", "html", "codegraph", "--out", "review.html"]);
      const html = readFileSync(join(project, "review.html"), "utf8");
      expect(html).not.toContain("</script><img");
      expect(html).toContain("\\u003c/script\\u003e\\u003cimg");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extract refuses concurrent state writes while the project write lock is held", async () => {
    const root = makeTmp();
    const repo = join(root, "repo-a");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsRepo(repo, "sample-lib");

      await runCliInDir(root, ["init", "kb"]);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-a",
        "--local",
        "../repo-a",
        "--remote",
        "https://git.example.com/repo-a.git",
        "--ref",
        head,
      ]);
      writeProjectEntry(project, "single");
      await mkdir(join(project, ".tmp", "context-runtime", "locks", "project-write.lock"), { recursive: true });

      const result = await runCliProcess(project, ["run", "extract:20260712/sample-a:codegraph"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("context project write lock is already held");
      expect(result.stderr).toContain("Wait for the running context command to finish");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
