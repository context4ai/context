import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";

interface CandidateRow {
  id: string;
  path: string;
  source_refs: string[];
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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}

function initTsRepo(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  execFileSync("mkdir", ["-p", "src"], { cwd: path });
  writeFileSync(join(path, "package.json"), `${JSON.stringify({
    name: "sample-lib",
    version: "1.0.0",
    type: "module",
    exports: "./src/index.ts",
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(path, "src", "index.ts"), 'export { Button } from "./Button";\n', "utf8");
  writeFileSync(join(path, "src", "Button.ts"), [
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", "add ts fixture"], { cwd: path });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path, encoding: "utf8" }).trim();
}

function readRows(project: string): CandidateRow[] {
  const path = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as { candidate_id: string; path: string; source_refs: string[] };
      return { id: row.candidate_id, path: row.path, source_refs: row.source_refs };
    });
}

function idsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
}

function candidateSnapshotPath(project: string, id: string): string {
  return join(project, ".tmp", "context-runtime", "extract", "candidates", `${id}.json`);
}

async function createExtractedProject(): Promise<{ root: string; project: string; row: CandidateRow }> {
  const root = mkdtempSync(join(tmpdir(), "ctx-review-runtime-v060-"));
  const repo = join(root, "repo-a");
  const project = join(root, "kb");
  await mkdir(repo, { recursive: true });
  const head = initTsRepo(repo);
  await runCliInDir(root, ["init", "kb"]);
  await runCliInDir(project, [
    "source", "add", "repo", "20260712",
    "--module", "sample-a",
    "--local", "../repo-a",
    "--remote", "https://git.example.com/repo-a.git",
    "--ref", head,
  ]);
  writeFileSync(join(project, "src", "index.ts"), [
    'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
    "",
    'const sampleA = source("20260712", "sample-a");',
    "",
    "export default defineProject({",
    "  sources: [sampleA],",
    "  phases: [",
    '    extractTs({ source: sampleA, collection: "codeindex" }),',
    '    reviewValidity({ collection: "codeindex" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(project, ["run", "extract:20260712/sample-a:codeindex"]);
  const [row] = readRows(project);
  if (row === undefined) throw new Error("expected one extracted candidate");
  return { root, project, row };
}

describe("0.6.0 review runtime validation", () => {
  test("review reports malformed candidate snapshots as schema errors", async () => {
    const { root, project, row } = await createExtractedProject();
    try {
      writeFileSync(candidateSnapshotPath(project, row.id), "{", "utf8");
      const html = await invokeCliInDir(project, ["review", "html", "codeindex"]);
      expect(html.status).not.toBe(0);
      expect(html.stderr).toContain("schema-invalid");
      expect(html.stderr).toContain("candidate snapshot is invalid JSON");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply validates the full payload before writing approved pages", async () => {
    const { root, project, row } = await createExtractedProject();
    try {
      const ids = readRows(project).map((candidate) => candidate.id);
      writeFileSync(join(project, "review-payload.jsonl"), [
        JSON.stringify({
          schema: "context.review.decisions.v1",
          collection: "codeindex",
          default: "approved",
          total: ids.length,
          counts: { approved: ids.length, rejected: 0 },
          scope: { count: ids.length, ids_sha256: idsHash(ids) },
        }),
        JSON.stringify({ candidate_id: "missing/symbol/nope", status: "rejected" }),
        "",
      ].join("\n"), "utf8");
      const apply = await invokeCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("review payload decision is outside codeindex draft scope");
      expect(existsSync(join(project, "knowledge", row.path))).toBe(false);
      expect(readRows(project).map((candidate) => candidate.id)).toEqual([row.id]);
      expect(existsSync(candidateSnapshotPath(project, row.id))).toBe(true);

      writeFileSync(join(project, "duplicate-payload.jsonl"), [
        JSON.stringify({
          schema: "context.review.decisions.v1",
          collection: "codeindex",
          default: "rejected",
          total: ids.length,
          counts: { approved: 1, rejected: ids.length - 1 },
          scope: { count: ids.length, ids_sha256: idsHash(ids) },
        }),
        JSON.stringify({ candidate_id: row.id, status: "approved" }),
        JSON.stringify({ candidate_id: row.id, status: "rejected" }),
        "",
      ].join("\n"), "utf8");
      const duplicate = await invokeCliInDir(project, ["review", "apply", "duplicate-payload.jsonl"]);
      expect(duplicate.status).not.toBe(0);
      expect(duplicate.stderr).toContain("duplicate review decision candidate_id");
      expect(existsSync(join(project, "knowledge", row.path))).toBe(false);
      expect(readRows(project).map((candidate) => candidate.id)).toEqual([row.id]);

      writeFileSync(join(project, "unscoped-payload.jsonl"), [
        JSON.stringify({ schema: "context.review.decisions.v1", collection: "codeindex", default: "rejected" }),
        JSON.stringify({ candidate_id: row.id, status: "approved" }),
        "",
      ].join("\n"), "utf8");
      const unscoped = await invokeCliInDir(project, ["review", "apply", "unscoped-payload.jsonl"]);
      expect(unscoped.status).not.toBe(0);
      expect(unscoped.stderr).toContain("review payload requires an explicit scope");
      expect(existsSync(join(project, "knowledge", row.path))).toBe(false);

      writeFileSync(join(project, "legacy-payload.json"), `${JSON.stringify({
        decisions: [{ candidate_id: row.id, status: "approved" }],
      })}\n`, "utf8");
      const legacy = await invokeCliInDir(project, ["review", "apply", "legacy-payload.json"]);
      expect(legacy.status).not.toBe(0);
      expect(legacy.stderr).toContain("review payload header schema must be context.review.decisions.v1");

      writeFileSync(join(project, "malformed-payload.json"), "{", "utf8");
      const malformed = await invokeCliInDir(project, ["review", "apply", "malformed-payload.json"]);
      expect(malformed.status).not.toBe(0);
      expect(malformed.stderr).toContain("user-input-invalid");
      expect(malformed.stderr).toContain("review payload line 1 is invalid JSON");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply materializes approved markdown and repeated apply is unchanged", async () => {
    const { root, project, row } = await createExtractedProject();
    try {
      const ids = [row.id];
      writeFileSync(join(project, "review-payload.jsonl"), [
        JSON.stringify({
          schema: "context.review.decisions.v1",
          collection: "codeindex",
          default: "approved",
          total: ids.length,
          counts: { approved: 1, rejected: 0 },
          scope: { count: ids.length, ids_sha256: idsHash(ids) },
          note: "Apply these review decisions and continue",
        }),
        "",
      ].join("\n"), "utf8");
      const apply = await runCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(apply).toContain("approved: 1");
      expect(apply).toContain("materialized: 1");
      expect(readRows(project)).toEqual([]);

      const approvedPath = join(project, "knowledge", row.path);
      const approved = readFileSync(approvedPath, "utf8");
      expect(approved).toContain("title: Button");
      expect(approved).toContain("sources:");
      expect(approved).toContain("- repo:20260712/sample-a");
      expect(approved).toContain('source_ref="src-1#symbol:src/Button.ts:Button:function@');
      expect(approved).toContain("candidate_fingerprint: sha256:");
      expect(approved).not.toContain("code_origin:");
      expect(approved).not.toContain("id:");
      expect(approved).not.toContain("collection:");
      expect(approved).not.toContain("status: approved");
      expect(approved).not.toContain("- kind:");
      expect(approved).not.toContain("- visibility:");
      expect(approved).not.toContain("- source:");
      expect(existsSync(candidateSnapshotPath(project, row.id))).toBe(false);

      const stalePayload = await invokeCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(stalePayload.status).not.toBe(0);
      expect(stalePayload.stderr).toContain("review payload is stale");
      const repeat = await invokeCliInDir(project, ["review", "approve", row.id, "--collection", "codeindex"]);
      expect(repeat.status).not.toBe(0);
      expect(repeat.stderr).toContain("outside scoped draft candidates");
      expect(readFileSync(approvedPath, "utf8")).toBe(approved);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply accepts a pretty-printed single-object JSON payload", async () => {
    const { root, project, row } = await createExtractedProject();
    try {
      const ids = [row.id];
      writeFileSync(join(project, "review-payload.json"), `${JSON.stringify({
        schema: "context.review.decisions.v1",
        collection: "codeindex",
        default: "approved",
        total: ids.length,
        counts: { approved: ids.length, rejected: 0 },
        scope: { count: ids.length, ids_sha256: idsHash(ids) },
      }, null, 2)}\n`, "utf8");

      const apply = await invokeCliInDir(project, ["review", "apply", "review-payload.json"]);
      expect(apply.status).toBe(0);
      expect(apply.stdout).toContain("approved: 1");
      expect(existsSync(join(project, "knowledge", row.path))).toBe(true);
      expect(readRows(project)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
