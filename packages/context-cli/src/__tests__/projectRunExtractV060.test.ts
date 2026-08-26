import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli_main } from "../cli.js";
import { readProjectCloseStatus } from "../project/close.js";
import { addRepoSource } from "../project/repoSources.js";

const REPO_NAMESPACE = "20260712";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-run-v060-"));
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

function initTsFixtureRepo(path: string): string {
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
  writeFileSync(join(path, "src", "index.ts"), [
    'export { Button } from "./Button";',
    'export type { ButtonProps } from "./Button";',
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Button.tsx"), [
    "export interface ButtonProps {",
    "  label: string;",
    "}",
    "",
    "export function Button(props: ButtonProps) {",
    "  return props.label;",
    "}",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Unused.ts"), "export const Unused = true;\n", "utf8");
  return commitAll(path, "add ts fixture");
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

async function writeSampleLibProjectEntry(project: string, transformMarker?: string): Promise<void> {
  const transform = transformMarker === undefined
    ? ""
    : `, transform: (markdown) => markdown.replace(\"- kind:\", \"- rendered-by: ${transformMarker}\\n- kind:\")`;
  await writeFile(join(project, "src", "index.ts"), [
    'import { defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
    "",
    'const sampleLib = source("20260712", "sample-lib");',
    "",
    "export default defineProject({",
    "  sources: [sampleLib],",
    "  phases: [",
    `    extractTs({ source: sampleLib, collection: "codeindex"${transform} }),`,
    '    reviewValidity({ collection: "codeindex" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

interface CandidateTestRecord {
  id: string;
  candidate_id: string;
  collection: string;
  status: string;
  change?: "add" | "update" | "remove";
  source_refs: string[];
  path: string;
  review?: { summary?: string };
  updated?: string;
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

function latestRunLog(project: string): Record<string, unknown> {
  const dir = join(project, ".tmp", "context-runtime", "runs");
  const files = readdirSync(dir).sort();
  const last = files.at(-1);
  if (!last) throw new Error("expected at least one run log");
  return JSON.parse(readFileSync(join(dir, last), "utf8")) as Record<string, unknown>;
}

describe("0.6.0 project run and extract", () => {
  test("project run dry-run does not write runtime files and extract creates draft candidates", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });

      const plan = await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex", "--dry-run"]);
      expect(plan).toContain("reads: source:repo:20260712/sample-lib");
      expect(plan).toContain("writes: lifecycle:candidates:codeindex:draft");
      expect(plan).toContain("candidate estimate");
      expect(plan).toContain("AST analyzed");
      expect(plan).toContain("relation(s)");
      expect(plan).toContain("approved knowledge tree preview:");
      expect(plan).toContain("knowledge/codeindex/sample-lib/symbol/button.md");
      expect(existsSync(join(project, ".tmp", "context-runtime", "runs"))).toBe(false);

      const dryRunJson = JSON.parse(await runCliInDir(project, [
        "run",
        "extract:20260712/sample-lib:codeindex",
        "--dry-run",
        "--format",
        "json",
      ])) as {
        preview?: {
          indexUnits: Array<{
            id: string;
            projectedPageCount: number;
            scale: string;
            outputProfile: string;
          }>;
          totals: {
            candidateEstimate: number;
            modules: number;
            discoveredFiles: number;
            analyzedFiles: number;
            skippedFiles: number;
            relations: number;
          };
          knowledgeTree: string[];
          knowledgePathExamples: Array<{ path: string; source: string; module: string }>;
          sources: Array<{
            modules: Array<{
              name: string;
              version?: string;
              entryFiles: string[];
              exportedSymbols: number;
              internalSymbols: number;
              candidateKinds: Record<string, number>;
            }>;
          }>;
        };
      };
      expect(dryRunJson.preview?.totals.modules).toBe(1);
      expect(dryRunJson.preview?.indexUnits[0]).toMatchObject({
        id: "sample-lib",
        projectedPageCount: expect.any(Number),
        scale: "normal",
        outputProfile: "public-api-reference",
      });
      expect(dryRunJson.preview?.totals.candidateEstimate).toBeGreaterThan(0);
      expect(dryRunJson.preview?.totals.discoveredFiles).toBeGreaterThan(0);
      expect(dryRunJson.preview?.totals.analyzedFiles).toBeGreaterThan(0);
      expect(dryRunJson.preview?.totals.skippedFiles).toBe(1);
      expect(dryRunJson.preview?.totals.relations).toBeGreaterThanOrEqual(0);
      expect(dryRunJson.preview?.sources[0]?.modules[0]).toMatchObject({
        name: "sample-lib",
        version: "1.0.0",
      });
      expect(dryRunJson.preview?.sources[0]?.modules[0]?.entryFiles).toEqual(["src/index.ts"]);
      expect(dryRunJson.preview?.sources[0]?.modules[0]?.exportedSymbols).toBeGreaterThan(0);
      expect(dryRunJson.preview?.sources[0]?.modules[0]?.internalSymbols).toBeGreaterThanOrEqual(0);
      expect(Object.values(dryRunJson.preview?.sources[0]?.modules[0]?.candidateKinds ?? {})
        .reduce((sum, count) => sum + count, 0)).toBe(dryRunJson.preview?.totals.candidateEstimate ?? 0);
      expect(dryRunJson.preview?.knowledgeTree).toContain("knowledge/");
      expect(dryRunJson.preview?.knowledgeTree).toContain("  codeindex/");
      expect(dryRunJson.preview?.knowledgePathExamples[0]).toMatchObject({
        path: "knowledge/codeindex/sample-lib/symbol/button.md",
        source: "20260712/sample-lib",
        module: "sample-lib",
      });
      expect(existsSync(join(project, ".tmp", "context-runtime", "runs"))).toBe(false);

      const batchPreview = JSON.parse(await runCliInDir(project, [
        "run",
        "--preview-extraction-batch",
        "--preview-phase",
        "extract:20260712/sample-lib:codeindex",
        "--format",
        "json",
      ])) as { cache: { reusablePhases: number }; scaleClear: boolean };
      expect(batchPreview).toMatchObject({
        cache: { reusablePhases: 1 },
        scaleClear: true,
      });

      const stdout = await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);
      expect(stdout).toContain("✓ ran extract:20260712/sample-lib:codeindex");
      expect(stdout).toContain("drafts: +");
      expect(stdout).toContain("next action: context status --format json");
      expect(stdout).toContain("candidate file: .tmp/context-runtime/lifecycle/candidates.jsonl");

      const rows = readCandidateRows(project);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.collection).toBe("codeindex");
        expect(row.status).toBe("draft");
        expect(row.source_refs[0] ?? "").toStartWith("repo:20260712/sample-lib#symbol:");
        expect(row.review?.summary).toBeTruthy();
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("sections");
        expect(row).not.toHaveProperty("signature");
        expect(row).not.toHaveProperty("props");
      }

      const log = latestRunLog(project);
      expect(log).toMatchObject({
        phase_id: "extract:20260712/sample-lib:codeindex",
        phase_kind: "phase.extract.ts",
        status: "success",
      });
      expect(log.reads).toContain("source:repo:20260712/sample-lib");
      expect(log.writes).toContain("lifecycle:candidates:codeindex:draft");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  test("project extract rerun preserves review state, avoids duplicates, and removes disappeared draft rows", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      let head = initTsFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);

      let rows = readCandidateRows(project);
      const rejected = rows.find((row) => row.id.endsWith("/buttonprops")) ?? rows[0];
      if (!rejected) throw new Error("expected rejected fixture candidate");
      const approved = rows.find((row) => row.id.endsWith("/button") && row.id !== rejected.id) ?? rows.find((row) => row.id !== rejected.id);
      if (!approved) throw new Error("expected approved fixture candidate");
      await runCliInDir(project, ["review", "reject", rejected.id, "--collection", "codeindex"]);
      const rejectedUpdated = readCandidateRows(project).find((row) => row.id === rejected.id)?.updated;
      await runCliInDir(project, ["review", "approve", approved.id, "--collection", "codeindex"]);

      await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);
      rows = readCandidateRows(project);
      expect(rows.filter((row) => row.id === rejected.id)).toHaveLength(1);
      expect(rows.find((row) => row.id === rejected.id)?.status).toBe("rejected");
      expect(rows.find((row) => row.id === rejected.id)?.updated).toBe(rejectedUpdated);
      expect(rows.find((row) => row.id === approved.id)).toBeUndefined();

      writeFileSync(join(repo, "src", "Badge.ts"), [
        "export interface BadgeProps {",
        "  tone: string;",
        "}",
        "",
        "export function Badge(props: BadgeProps) {",
        "  return props.tone;",
        "}",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(repo, "src", "index.ts"), [
        'export { Button } from "./Button";',
        'export type { ButtonProps } from "./Button";',
        'export { Badge } from "./Badge";',
        'export type { BadgeProps } from "./Badge";',
        "",
      ].join("\n"), "utf8");
      head = commitAll(repo, "add badge");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);
      rows = readCandidateRows(project);
      const ids = rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(rows.find((row) => row.id === rejected.id)?.status).toBe("rejected");
      expect(rows.some((row) => row.id.endsWith("/badge"))).toBe(true);

      writeFileSync(join(repo, "src", "index.ts"), [
        'export { Button } from "./Button";',
        'export type { ButtonProps } from "./Button";',
        "",
      ].join("\n"), "utf8");
      head = commitAll(repo, "remove badge export");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);
      rows = readCandidateRows(project);
      expect(rows.some((row) => row.id.endsWith("/badge"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);

  test("codeindex supports delta review and explicit verified auto promotion", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      let head = initTsFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });

      const initial = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--auto-promote", "--format", "json",
      ])) as { result: { execution: { policy: string; sourceState: string }; review: { required: boolean }; autoPromotion: { close: string; verify: string } } };
      expect(initial.result.execution).toEqual({ policy: "auto-promote", sourceState: "first-run" });
      expect(initial.result.review.required).toBe(false);
      expect(initial.result.autoPromotion.close).toBe("refreshed");
      expect(initial.result.autoPromotion.verify).toBe("passed");
      expect((await readProjectCloseStatus(project)).state).toBe("ready");
      expect(readCandidateRows(project)).toEqual([]);

      writeFileSync(join(repo, "src", "Button.tsx"), [
        "export interface ButtonProps {",
        "  label: string;",
        "  disabled?: boolean;",
        "}",
        "",
        "export function Button(props: ButtonProps) {",
        "  return props.disabled ? \"disabled\" : props.label;",
        "}",
        "",
      ].join("\n"), "utf8");
      head = commitAll(repo, "change button");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      const changed = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--format", "json",
      ])) as { result: { changes: { updated: number }; review: { required: boolean }; next_action: { command: string } } };
      expect(changed.result.changes.updated).toBeGreaterThan(0);
      expect(changed.result.review.required).toBe(true);
      expect(changed.result.next_action).toMatchObject({
        command: "context status --format json",
      });
      expect(readCandidateRows(project).some((row) => row.change === "update")).toBe(true);

      const promoted = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--auto-promote", "--format", "json",
      ])) as { result: { autoPromotion: { close: string; verify: string } } };
      expect(promoted.result.autoPromotion).toMatchObject({ close: "refreshed", verify: "passed" });
      expect((await readProjectCloseStatus(project)).state).toBe("ready");
      expect(readCandidateRows(project)).toEqual([]);

      writeFileSync(join(repo, "src", "index.ts"), "export type { ButtonProps } from \"./Button\";\n", "utf8");
      head = commitAll(repo, "remove button export");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      await runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"]);
      expect(readCandidateRows(project).some((row) => row.change === "remove")).toBe(true);
      const removed = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--auto-promote", "--format", "json",
      ])) as { result: { autoPromotion: { close: string; removed: number; verify: string } } };
      expect(removed.result.autoPromotion.removed).toBeGreaterThan(0);
      expect(removed.result.autoPromotion.close).toBe("refreshed");
      expect(removed.result.autoPromotion.verify).toBe("passed");
      expect((await readProjectCloseStatus(project)).state).toBe("ready");
      expect(readCandidateRows(project)).toEqual([]);

      const unchanged = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--auto-promote", "--format", "json",
      ])) as { result: { autoPromotion: { close: string; verify: string } } };
      expect(unchanged.result.autoPromotion).toMatchObject({ close: "current", verify: "passed" });

      await expect(runCliInDir(project, ["run", "review:codeindex:validity", "--auto-promote"])).rejects.toThrow(
        "--auto-promote is only valid",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  test("reader-facing transform changes invalidate approved candidate fingerprints", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initTsFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project, "v1");
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../sample-lib",
        remote: "https://git.example.com/sample-lib.git",
        ref: head,
      });
      await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--auto-promote", "--format", "json",
      ]);
      expect(readCandidateRows(project)).toEqual([]);

      await writeSampleLibProjectEntry(project, "v2");
      const changed = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-lib:codeindex", "--format", "json",
      ])) as {
        result: {
          execution: { sourceState: string };
          changes: { updated: number; unchanged: number };
          review: { required: boolean };
        };
      };
      expect(changed.result.execution.sourceState).toBe("changed");
      expect(changed.result.changes.updated).toBeGreaterThan(0);
      expect(changed.result.review.required).toBe(true);
      expect(readCandidateRows(project)).toEqual(expect.arrayContaining([
        expect.objectContaining({ change: "update", status: "draft" }),
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  test("project run failure writes phase log and stderr includes phase diagnostics", async () => {
    const root = makeTmp();
    const project = join(root, "kb");
    try {
      await runCliInDir(root, ["init", "kb"]);
      await writeSampleLibProjectEntry(project);
      await addRepoSource({
        projectRoot: project,
        namespace: REPO_NAMESPACE,
        module: "sample-lib",
        local: "../missing-lib",
        remote: "https://git.example.com/missing-lib.git",
        ref: "a".repeat(40),
      });

      await expect(runCliInDir(project, ["run", "extract:20260712/sample-lib:codeindex"])).rejects.toThrow(
        "repo source is not ready for extraction",
      );

      const log = latestRunLog(project);
      expect(log).toMatchObject({
        phase_id: "extract:20260712/sample-lib:codeindex",
        phase_kind: "phase.extract.ts",
        status: "failed",
      });
      expect((log.error as { message?: string }).message).toContain("repo source is not ready");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
