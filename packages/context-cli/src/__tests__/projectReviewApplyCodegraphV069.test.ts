import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { commitAll, invokeCliInDir, runCliInDir } from "./projectBuildVerifyV060Helpers.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-review-codegraph-v069-"));
}

function initTsRepo(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, "package.json"), `${JSON.stringify({
    name: "sample-lib",
    version: "1.0.0",
    type: "module",
    exports: "./src/index.ts",
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(path, "src", "index.ts"), [
    'export { Button } from "./Button";',
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Button.ts"), [
    "/** Primary button. */",
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add ts fixture");
}

function writeProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
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
  ].join("\n"), "utf8");
}

interface CandidateRow {
  candidate_id: string;
  node_ref: string;
  view_ref: string;
  collection: string;
  status: string;
  path: string;
  source_refs: string[];
}

function readRawRows(project: string): Record<string, unknown>[] {
  return readFileSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readRows(project: string): Array<CandidateRow & { id: string }> {
  return readRawRows(project).map((row) => ({
    ...(row as unknown as CandidateRow),
    id: String(row.candidate_id),
  }));
}

function candidateSnapshotPath(project: string, id: string): string {
  return join(project, ".tmp", "context-runtime", "extract", "candidates", `${id}.json`);
}

async function createDraftProject(): Promise<{ root: string; repo: string; project: string; row: CandidateRow & { id: string } }> {
  const root = makeTmp();
  const repo = join(root, "repo-a");
  const project = join(root, "kb");
  mkdirSync(repo, { recursive: true });
  const head = initTsRepo(repo);
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
  writeProjectEntry(project);
  await runCliInDir(project, ["run", "extract:20260712/sample-a:codegraph"]);
  const [row] = readRows(project);
  if (row === undefined) throw new Error("expected extracted codegraph candidate");
  return { root, repo, project, row };
}

describe("0.6.9 codegraph review apply gates", () => {
  test("blocks stale codegraph candidates after repo source refresh", async () => {
    const { root, repo, project, row } = await createDraftProject();
    try {
      writeFileSync(join(repo, "src", "Button.ts"), [
        "/** Updated button. */",
        "export function Button(label: string) {",
        "  return label.trim();",
        "}",
        "",
      ].join("\n"), "utf8");
      const nextHead = commitAll(repo, "update button");
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

      const apply = await invokeCliInDir(project, ["review", "approve", row.id, "--collection", "codegraph"]);
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("candidate snapshot is missing or stale");
      expect(existsSync(join(project, "knowledge", row.path))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects approving the same view_ref at a new approved path", async () => {
    const { root, project, row } = await createDraftProject();
    try {
      const [rawRow] = readRawRows(project);
      if (rawRow === undefined) throw new Error("expected raw candidate row");
      const snapshotPath = candidateSnapshotPath(project, row.id);
      const snapshot = readFileSync(snapshotPath, "utf8");

      await runCliInDir(project, ["review", "approve", row.id, "--collection", "codegraph"]);
      const oldApprovedPath = join(project, "knowledge", row.path);
      expect(existsSync(oldApprovedPath)).toBe(true);

      const movedRow = {
        ...rawRow,
        status: "draft",
        path: "codegraph/moved/button.md",
        updated: "2026-06-28T00:00:00.000Z",
      };
      writeFileSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify(movedRow)}\n`, "utf8");
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, snapshot, "utf8");

      const apply = await invokeCliInDir(project, ["review", "approve", row.id, "--collection", "codegraph"]);
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("approved page already exists for view_ref at a different path");
      expect(existsSync(oldApprovedPath)).toBe(true);
      expect(existsSync(join(project, "knowledge", "codegraph", "moved", "button.md"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects approving over an existing target path owned by another view_ref", async () => {
    const { root, project, row } = await createDraftProject();
    try {
      const targetPath = join(project, "knowledge", row.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      const existing = [
        "---",
        "title: Existing Other View",
        "type: Wiki",
        "node_ref: entity/other",
        "view_ref: codegraph:entity/other",
        "node_type: entity",
        "visibility: exported",
        "tags:",
        "  - code",
        "timestamp: 2026-06-28T00:00:00.000Z",
        "resource: repo:sample-a",
        "sources:",
        "  - repo:sample-a",
        "---",
        "",
        "# Existing Other View",
        "",
      ].join("\n");
      writeFileSync(targetPath, existing, "utf8");

      const apply = await invokeCliInDir(project, ["review", "approve", row.id, "--collection", "codegraph"]);

      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("candidate target path already contains a different approved view");
      expect(readFileSync(targetPath, "utf8")).toBe(existing);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
