import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli_main } from "../cli.js";
import { addRepoSource } from "../project/repoSources.js";

const REPO_NAMESPACE = "20260712";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-run-config-v060-"));
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const originalCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli_main(["node", "context", ...args]);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(originalCwd);
  }
  return chunks.join("");
}

function readGitHead(path: string): string {
  const headRaw = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/iu.test(headRaw)) return headRaw.toLowerCase();
  const match = /^ref:\s*(.+)\s*$/iu.exec(headRaw);
  const refPath = match?.[1];
  const head = refPath === undefined ? "" : readFileSync(join(path, ".git", refPath), "utf8").trim();
  if (!/^[a-f0-9]{40}$/iu.test(head)) {
    throw new Error(`expected git HEAD sha for ${path}, got ${JSON.stringify(headRaw)}`);
  }
  return head.toLowerCase();
}

function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  return readGitHead(path);
}

function initTsMonorepoFixture(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  for (const name of ["button", "link"]) {
    const moduleRoot = join(path, "packages", name);
    execFileSync("mkdir", ["-p", join("packages", name, "src")], { cwd: path });
    writeFileSync(join(moduleRoot, "package.json"), `${JSON.stringify({
      name: `@demo/${name}`,
      version: "1.0.0",
      type: "module",
      exports: "./src/index.ts",
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(moduleRoot, "src", "index.ts"), `export const ${name} = "${name}";\n`, "utf8");
  }
  return commitAll(path, "add monorepo fixture");
}

function initTsNoEntryFixtureRepo(path: string): string {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: path });
  execFileSync("mkdir", ["-p", "src/internal"], { cwd: path });
  writeFileSync(join(path, "package.json"), `${JSON.stringify({
    name: "no-entry-lib",
    version: "1.0.0",
    type: "module",
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(path, "src", "feature.ts"), [
    "export interface FeatureOptions { enabled: boolean }",
    "export function createFeature(options: FeatureOptions) { return options.enabled; }",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "internal", "format.ts"), [
    "function formatInternal(value: string) { return value.trim(); }",
    "export const formatPublic = formatInternal;",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add no-entry ts fixture");
}

interface CandidateTestRecord {
  id: string;
  candidate_id: string;
  [key: string]: unknown;
}

function readCandidateRows(project: string): CandidateTestRecord[] {
  const file = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return { ...row, id: row.candidate_id } as CandidateTestRecord;
    });
}

describe("0.6.0 project extraction configuration", () => {
  test("project extract rejects multi-module repo sources before writing drafts", async () => {
    const root = makeTmp();
    const repo = join(root, "monorepo");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsMonorepoFixture(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
        "",
        'const mono = source("20260712", "mono");',
        "",
        "export default defineProject({",
        "  sources: [mono],",
        "  phases: [",
        '    extractTs({ source: mono, collection: "codeindex", include: ["packages/button/src/**/*.{ts,tsx}"] }),',
        '    reviewValidity({ collection: "codeindex" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "mono",
        local: "../monorepo",
        remote: "https://git.example.com/monorepo.git",
        ref: head,
      });

      await expect(runCliInDir(project, ["run", "extract:20260712/mono:codeindex"])).rejects.toThrow(
        "repo source contains multiple code modules",
      );
      expect(existsSync(join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("project extraction uses Context-configured entries when package.json has no entry fields", async () => {
    const root = makeTmp();
    const repo = join(root, "no-entry-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsNoEntryFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
        "",
        'const lib = source("20260712", "no-entry-lib");',
        "",
        "export default defineProject({",
        "  sources: [lib],",
        "  phases: [",
        '    extractTs({ source: lib, collection: "codeindex", include: ["src/**/*.ts"], entries: ["src/feature.ts"] }),',
        '    reviewValidity({ collection: "codeindex" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "no-entry-lib",
        local: "../no-entry-lib",
        remote: "https://git.example.com/no-entry-lib.git",
        ref: head,
      });

      const preview = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/no-entry-lib:codeindex", "--dry-run", "--format", "json",
      ])) as { preview: { mode: string; entries: string[]; totals: { candidateEstimate: number } } };
      expect(preview.preview).toMatchObject({
        mode: "exports",
        entries: ["src/feature.ts"],
      });
      expect(preview.preview.totals.candidateEstimate).toBeGreaterThan(0);

      await runCliInDir(project, ["run", "extract:20260712/no-entry-lib:codeindex"]);
      const ids = readCandidateRows(project).map((row) => row.id);
      expect(ids.some((id) => id.endsWith("/createfeature"))).toBe(true);
      expect(ids.some((id) => id.endsWith("/formatpublic"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("project extraction exposes NO_ENTRY_DETECTED when no entry policy can select files", async () => {
    const root = makeTmp();
    const repo = join(root, "no-entry-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsNoEntryFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, source } from "@c4a/context";',
        'const lib = source("20260712", "no-entry-lib");',
        "export default defineProject({",
        "  sources: [lib],",
        '  phases: [extractTs({ source: lib, collection: "codeindex" })],',
        "  packages: [],",
        "});",
      ].join("\n"), "utf8");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "no-entry-lib",
        local: "../no-entry-lib",
        remote: "https://git.example.com/no-entry-lib.git",
        ref: head,
      });

      const preview = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/no-entry-lib:codeindex", "--dry-run", "--format", "json",
      ])) as { preview_error: { detail: { code: string } } };
      expect(preview.preview_error.detail.code).toBe("NO_ENTRY_DETECTED");
      await expect(runCliInDir(project, ["run", "extract:20260712/no-entry-lib:codeindex"])).rejects.toMatchObject({
        detail: expect.objectContaining({
          error: expect.objectContaining({ code: "NO_ENTRY_DETECTED" }),
        }),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("project scan mode extracts include-matched files without package entries", async () => {
    const root = makeTmp();
    const repo = join(root, "no-entry-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsNoEntryFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
        "",
        'const lib = source("20260712", "no-entry-lib");',
        "",
        "export default defineProject({",
        "  sources: [lib],",
        "  phases: [",
        '    extractTs({ source: lib, collection: "codeindex", include: ["src/**/*.ts"], mode: "scan", indexUnits: [{',
        '      id: "no-entry-lib-map", inputSources: ["20260712/no-entry-lib"], outputOwner: "no-entry-lib",',
        '      moduleType: "sdk-library", moduleTypeEvidence: ["src/index.ts public entry"], outputProfile: "module-map", responsibility: "Map the selected module scope.",',
        '      entries: ["src/feature.ts"], pageKinds: ["module-map"], protocols: [], dependencies: [], exclusions: [], capability: "complete"',
        '    }] }),',
        '    reviewValidity({ collection: "codeindex" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "no-entry-lib",
        local: "../no-entry-lib",
        remote: "https://git.example.com/no-entry-lib.git",
        ref: head,
      });

      const preview = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/no-entry-lib:codeindex", "--dry-run", "--format", "json",
      ])) as { preview: { mode: string; exportedOnly: boolean; totals: { candidateEstimate: number } } };
      expect(preview.preview).toMatchObject({ mode: "scan", exportedOnly: false });
      expect(preview.preview.totals.candidateEstimate).toBeGreaterThanOrEqual(4);

      await runCliInDir(project, ["run", "extract:20260712/no-entry-lib:codeindex"]);
      const ids = readCandidateRows(project).map((row) => row.id);
      expect(ids.some((id) => id.endsWith("/createfeature"))).toBe(true);
      expect(ids.some((id) => id.endsWith("/formatpublic"))).toBe(true);
      expect(ids.some((id) => id.endsWith("/formatinternal"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("configured entries must stay inside include", async () => {
    const root = makeTmp();
    const repo = join(root, "no-entry-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsNoEntryFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeFile(join(project, "src", "index.ts"), [
        'import { defineProject, extractTs, source } from "@c4a/context";',
        'const lib = source("20260712", "no-entry-lib");',
        "export default defineProject({",
        "  sources: [lib],",
        '  phases: [extractTs({ source: lib, collection: "codeindex", include: ["src/feature.ts"], entries: ["src/internal/format.ts"] })],',
        "  packages: [],",
        "});",
      ].join("\n"), "utf8");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "no-entry-lib",
        local: "../no-entry-lib",
        remote: "https://git.example.com/no-entry-lib.git",
        ref: head,
      });

      const output = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/no-entry-lib:codeindex", "--dry-run", "--format", "json",
      ])) as { preview_error: { message: string } };
      expect(output.preview_error.message).toMatch(/Configured extraction entry is missing or outside extractTs include/u);
      expect(readCandidateRows(project)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
