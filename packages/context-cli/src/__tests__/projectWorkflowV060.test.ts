import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { createCliProgram, handleCliFailure } from "../cli.js";

let cliInvocationQueue: Promise<void> = Promise.resolve();

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-v060-workflow-"));
}

async function withSerializedCliInvocation<T>(run: () => Promise<T>): Promise<T> {
  const previous = cliInvocationQueue;
  let release: () => void = () => {};
  cliInvocationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

async function invokeCliInDirUnsafe(dir: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
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

async function invokeCliInDir(dir: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return withSerializedCliInvocation(() => invokeCliInDirUnsafe(dir, args));
}

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const result = await invokeCliInDir(dir, args);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

function readGitHead(path: string): string {
  const headRaw = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/iu.test(headRaw)) return headRaw.toLowerCase();
  const match = /^ref:\s*(.+)\s*$/iu.exec(headRaw);
  const refPath = match?.[1];
  if (refPath === undefined) throw new Error(`cannot read git HEAD in ${path}`);
  const looseRefPath = join(path, ".git", refPath);
  if (existsSync(looseRefPath)) {
    return readFileSync(looseRefPath, "utf8").trim().toLowerCase();
  }
  const packedRefs = readFileSync(join(path, ".git", "packed-refs"), "utf8");
  for (const line of packedRefs.split(/\r?\n/u)) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, name] = line.trim().split(/\s+/u);
    if (name === refPath && sha !== undefined) return sha.toLowerCase();
  }
  throw new Error(`cannot resolve git HEAD ref ${refPath} in ${path}`);
}

function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  return readGitHead(path);
}

function initFixtureRepo(path: string): string {
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
    'export { Secret } from "./Secret";',
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Button.ts"), [
    "/** Primary button used by product screens. */",
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(path, "src", "Secret.ts"), [
    "/** Internal secret exported only for packaging exclusion tests. */",
    "export function Secret(value: string) {",
    "  return value;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add fixture symbols");
}

function writeProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { allSources, defineProject, extractTs, llmsPackage, reviewValidity, kbPackage } from "@c4a/context";',
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
    "  packages: [",
    "    kbPackage({",
    '      name: "sample-kb",',
    '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
    "    }),",
    "    llmsPackage({",
    '      name: "sample-llms",',
    '      template: "src/package-templates/llms",',
    '      select: { include: ["codegraph/sample-lib/**"] },',
    "    }),",
    "  ],",
    "});",
    "",
  ].join("\n"), "utf8");
}

function writePackageTemplates(project: string): void {
  const kbRoot = join(project, "src", "package-templates", "kb");
  const llmsRoot = join(project, "src", "package-templates", "llms");
  execFileSync("mkdir", ["-p", "src/package-templates/kb/meta", "src/package-templates/llms"], { cwd: project });
  writeFileSync(join(kbRoot, "AGENTS.md"), [
    "# {{displayName}}",
    "",
    "package={{packageName}}",
    "kind={{packageKind}}",
    "knowledge={{knowledgeCount}}",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(kbRoot, "meta", "{{packageName}}.txt"), "name={{packageName}}\n", "utf8");
  writeFileSync(join(llmsRoot, "llms.txt"), [
    "# {{packageName}}",
    "",
    "{{knowledge}}",
    "",
  ].join("\n"), "utf8");
}

interface CandidateRow {
  id: string;
  candidate_id: string;
  collection: string;
  status: string;
  path: string;
  source_refs: string[];
  review: {
    title: string;
    summary: string;
  };
  [key: string]: unknown;
}

function readRows(project: string): CandidateRow[] {
  const path = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return { ...row, id: row.candidate_id } as CandidateRow;
    });
}

function readTimestamp(markdown: string): string {
  const match = /^timestamp:\s*"?([^"\n]+)"?\s*$/mu.exec(markdown);
  if (match?.[1] === undefined) throw new Error("approved markdown did not contain timestamp");
  return match[1];
}

function idsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
}

function appendSourceDocChange(repo: string): string {
  writeFileSync(join(repo, "src", "Button.ts"), [
    "/** Primary button used by product screens after a source update. */",
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(repo, "update button docs");
}

describe("0.6.0 current workflow acceptance", () => {
  test("runs init to source, extract, review, apply, build, verify, and status", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initFixtureRepo(repo);

      const init = await runCliInDir(root, ["init", "kb"]);
      expect(init).toContain('initialized "kb"');
      for (const rel of ["src", "sources", "knowledge", "dist", "AGENTS.md", "package.json"]) {
        expect(existsSync(join(project, rel))).toBe(true);
      }
      expect(existsSync(join(project, "unapproved"))).toBe(false);
      expect(existsSync(join(project, ".context"))).toBe(false);

      writeProjectEntry(project);
      writePackageTemplates(project);

      const missingSourceStatus = await runCliInDir(project, ["status"]);
      expect(missingSourceStatus).toContain("state: route.source.boundary-required");
      expect(missingSourceStatus).toContain("human gate → source-boundary");
      expect(missingSourceStatus).toContain("No knowledge source boundary has been registered");

      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-lib",
        "--local",
        "../sample-lib",
        "--remote",
        "https://git.example.com/sample-lib.git",
        "--ref",
        head.slice(0, 12),
      ]);
      const registry = YAML.parse(readFileSync(join(project, "sources", "repo", "index.yaml"), "utf8")) as {
        sources: Array<{ name: string; modules: Array<{ name: string; git: { ref: string } }> }>;
      };
      expect(registry.sources[0]?.modules.find((module) => module.name === "sample-lib")?.git.ref).toBe(head);
      expect(lstatSync(join(project, "sources", "repo", "20260712", "sample-lib")).isSymbolicLink()).toBe(true);

      const readyStatus = await runCliInDir(project, ["status"]);
      expect(readyStatus).toContain("state: route.extract.pending-target");
      expect(readyStatus).toContain("source 20260712/sample-lib: ready");

      const dryRun = await runCliInDir(project, ["run", "extract:repo:codegraph", "--dry-run"]);
      expect(dryRun).toContain("reads: source:repo:*");
      expect(dryRun).toContain("writes: lifecycle:candidates:codegraph:draft");
      expect(existsSync(join(project, ".tmp", "context-runtime", "runs"))).toBe(false);

      const extract = await runCliInDir(project, ["run", "extract:repo:codegraph"]);
      expect(extract).toContain("drafts: +");
      const rows = readRows(project);
      const button = rows.find((row) => row.review.title === "Button");
      const secret = rows.find((row) => row.review.title === "Secret");
      expect(button).toBeDefined();
      expect(secret).toBeDefined();
      for (const row of rows) {
        expect(row.collection).toBe("codegraph");
        expect(row.status).toBe("draft");
        expect(row.source_refs[0] ?? "").toStartWith("repo:20260712/sample-lib#symbol:");
        expect(row).not.toHaveProperty("content");
        expect(row).not.toHaveProperty("sections");
        expect(row).not.toHaveProperty("signature");
        expect(row).not.toHaveProperty("props");
      }

      const needsReview = await runCliInDir(project, ["status"]);
      expect(needsReview).toContain("state: route.review.decision-required");
      expect(needsReview).toContain("review html codegraph --open");
      expect(needsReview).toContain("--workflow-revision");
      expect(needsReview).toContain("human gate → knowledge-review");
      expect(needsReview).toContain("current candidate batch needs one review decision set");

      const reviewHtml = JSON.parse(await runCliInDir(project, ["review", "html", "codegraph", "--format", "json"])) as {
        path: string;
        url: string;
        candidates: number;
      };
      expect(reviewHtml.candidates).toBeGreaterThanOrEqual(2);
      expect(reviewHtml.url).toStartWith("file://");
      const html = readFileSync(reviewHtml.path, "utf8");
      expect(html).toContain("Context Review");
      expect(html).toContain(button?.id ?? "");
      expect(html).toContain(secret?.id ?? "");
      expect(html).toContain('<html lang="en" data-theme="light">');
      expect(html).toContain('id="theme"');
      expect(html).not.toContain("prefers-color-scheme");
      expect(html).toContain("Copy manually from the modal");
      expect(html).toContain('<textarea id="payload"');
      expect(html).toContain('id="payload-modal"');
      expect(html).toContain("context.review.decisions.v1");
      expect(html).toContain("ids_sha256");
      expect(html).toContain(`${reviewHtml.candidates} pending 0 approved 0 rejected`);
      expect(html).toContain('id="filter-pending"');
      expect(html).toContain('[item.candidate_id, "pending"]');
      expect(html).toContain("Review payload is not ready");

      const reviewList = JSON.parse(await runCliInDir(project, ["review", "list", "codegraph", "--format", "json"])) as Array<{
        candidate_id: string;
        status: string;
        snapshot_ready: boolean;
      }>;
      expect(reviewList.find((candidate) => candidate.candidate_id === button?.id)).toMatchObject({
        status: "draft",
        snapshot_ready: true,
      });

      const draftIds = rows.map((row) => row.id);
      writeFileSync(join(project, "review-payload.jsonl"), [
        JSON.stringify({
          schema: "context.review.decisions.v1",
          collection: "codegraph",
          default: "rejected",
          total: draftIds.length,
          counts: { approved: 1, rejected: draftIds.length - 1 },
          scope: {
            count: draftIds.length,
            ids_sha256: idsHash(draftIds),
          },
          note: "apply workflow acceptance decisions",
        }),
        JSON.stringify({ candidate_id: button?.id, status: "approved" }),
        "",
      ].join("\n"), "utf8");
      const apply = await runCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(apply).toContain("approved: 1");
      expect(apply).toContain("rejected: 1");
      expect(apply).toContain("materialized: 1");

      const afterApplyRows = readRows(project);
      expect(afterApplyRows.find((row) => row.id === button?.id)).toBeUndefined();
      expect(afterApplyRows.find((row) => row.id === secret?.id)?.status).toBe("rejected");
      const approvedPath = join(project, "knowledge", button?.path ?? "");
      const approved = readFileSync(approvedPath, "utf8");
      const timestamp = readTimestamp(approved);
      expect(approved).toContain("title: Button");
      expect(approved).toContain("type: Wiki");
      expect(approved).toContain("description: Exported function symbol from src/Button.ts.");
      expect(approved).toContain("resource: context://repo/20260712/sample-lib/symbol/Button?kind=function");
      expect(approved).toContain("sources:\n  - repo:20260712/sample-lib");
      expect(approved).toContain("visibility: exported");
      expect(approved).toContain("node_ref: sample-lib/symbol/button");
      expect(approved).toContain("view_ref: codegraph:sample-lib/symbol/button");
      expect(approved).toContain("code_symbols:\n  - sample-lib|Button|function");
      expect(approved).toContain('source_ref="src-1#symbol:src/Button.ts:Button:function@');
      expect(approved).toContain("candidate_fingerprint: sha256:");
      expect(approved).not.toContain("code_origin:");
      expect(approved).toContain("<!-- context:section");
      expect(approved).not.toContain("id:");
      expect(approved).not.toContain("collection:");
      expect(approved).not.toContain("status: approved");
      expect(approved).not.toContain("updated:");
      expect(approved).not.toContain("\ncontext:\n");
      expect(approved).not.toContain("<!-- c4a:section");

      const stalePayload = await invokeCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(stalePayload.status).not.toBe(0);
      expect(stalePayload.stderr).toContain("review payload is stale");
      const repeatApply = await invokeCliInDir(project, ["review", "approve", button?.id ?? "", "--collection", "codegraph"]);
      expect(repeatApply.status).not.toBe(0);
      expect(repeatApply.stderr).toContain("outside scoped draft candidates");
      const approvedAfterRepeat = readFileSync(approvedPath, "utf8");
      expect(approvedAfterRepeat).toBe(approved);
      expect(readTimestamp(approvedAfterRepeat)).toBe(timestamp);

      const close = JSON.parse(await runCliInDir(project, ["close", "--format", "json"])) as {
        structure: string;
        nodes: number;
        edgeContract: { validationScope: string; valid: boolean };
        verifyErrors: number;
      };
      expect(close.structure).toBe("knowledge/structure.yaml");
      expect(close.nodes).toBe(1);
      expect(close.edgeContract).toMatchObject({ validationScope: "structure", valid: true });
      expect(close.verifyErrors).toBe(0);
      expect(existsSync(join(project, ".tmp", "context-runtime", "lifecycle"))).toBe(false);
      expect(JSON.parse(readFileSync(join(project, "knowledge", "decisions.json"), "utf8"))).toEqual({
        [secret!.id]: secret!.fingerprint,
      });

      const readyToBuild = await runCliInDir(project, ["status"]);
      expect(readyToBuild).toContain("state: route.build.package-stale");

      const build = await runCliInDir(project, ["build"]);
      expect(build).toContain("sample-kb");
      expect(build).toContain("sample-llms");
      const kb = readFileSync(join(project, "dist", "sample-kb", "AGENTS.md"), "utf8");
      const querySkill = readFileSync(join(project, "dist", "sample-kb", "skills", "knowledge-query", "SKILL.md"), "utf8");
      const kbIndex = readFileSync(join(project, "dist", "sample-kb", "wikis", "index.md"), "utf8");
      const llms = readFileSync(join(project, "dist", "sample-llms", "llms.txt"), "utf8");
      expect(kb).toContain("package=sample-kb");
      expect(querySkill).toContain("Answer from the approved knowledge");
      expect(kbIndex).toContain("type: Knowledge Bundle");
      expect(kbIndex).toContain("timestamp:");
      expect(kbIndex).toContain("package: \"sample-kb\"");
      expect(kbIndex).toContain("package_kind: \"kb\"");
      expect(kbIndex).toContain("knowledge_count: 1");
      expect(kbIndex).not.toContain("\ncontext:\n");
      expect(llms).toContain("Primary button used by product screens.");
      expect(llms).not.toContain("Internal secret exported only for packaging exclusion tests.");
      expect(querySkill).toContain("Evidence Contract");
      expect(querySkill).toContain("Search Fallback");
      expect(querySkill).toContain("Do not infer a relationship from page co-occurrence");

      const verify = await runCliInDir(project, ["verify"]);
      expect(verify).toContain("verified context project");
      const built = await runCliInDir(project, ["status"]);
      expect(built).toContain("state: workflow.complete");
      expect(built).toContain("verify: 0 error(s)");

      writeFileSync(approvedPath, approved.replace(/@[a-f0-9]+/u, "@000000000000"), "utf8");
      const brokenVerify = await invokeCliInDir(project, ["verify"]);
      expect(brokenVerify.status).not.toBe(0);
      expect(brokenVerify.stdout).toContain("approved-source-ref-stale");
      const verifyFailed = await runCliInDir(project, ["status"]);
      expect(verifyFailed).toContain("state: route.verify.failed");
      writeFileSync(approvedPath, approved, "utf8");

      writeFileSync(
        join(project, "src", "package-templates", "kb", "AGENTS.md"),
        `${kb}\ntemplateChanged=true\n`,
        "utf8",
      );
      const packageStale = await runCliInDir(project, ["status"]);
      expect(packageStale).toContain("state: route.build.package-stale");
      expect(packageStale).toContain("package sample-kb: stale");

      const nextHead = appendSourceDocChange(repo);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-lib",
        "--local",
        "../sample-lib",
        "--remote",
        "https://git.example.com/sample-lib.git",
        "--ref",
        nextHead,
      ]);
      const sourceStale = await runCliInDir(project, ["status"]);
      expect(sourceStale).toContain("state: route.extract.pending-target");
      expect(sourceStale).toContain("source freshness: stale");
      expect(sourceStale).toContain("--workflow-revision");
      expect(sourceStale).toContain("run extract:repo:codegraph --format json");
      expect(readRows(project)).toEqual([]);
      expect(JSON.parse(readFileSync(join(project, "knowledge", "decisions.json"), "utf8"))).toEqual({
        [secret!.id]: secret!.fingerprint,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("applies compact JSONL review payload with default decisions and exceptions", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    try {
      await mkdir(repo, { recursive: true });
      const head = initFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);
      writeProjectEntry(project);
      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "sample-lib",
        "--local",
        "../sample-lib",
        "--remote",
        "https://git.example.com/sample-lib.git",
        "--ref",
        head,
      ]);
      await runCliInDir(project, ["run", "extract:repo:codegraph"]);

      const rows = readRows(project);
      const button = rows.find((row) => row.review.title === "Button");
      expect(button).toBeDefined();
      const ids = rows.map((row) => row.id);
      writeFileSync(join(project, "review-payload.jsonl"), [
        JSON.stringify({
          schema: "context.review.decisions.v1",
          collection: "codegraph",
          default: "rejected",
          total: ids.length,
          counts: { approved: 1, rejected: ids.length - 1 },
          scope: {
            count: ids.length,
            ids_sha256: idsHash(ids),
          },
          note: "compact payload acceptance decisions",
        }),
        JSON.stringify({ candidate_id: button?.id, status: "approved" }),
        "",
      ].join("\n"), "utf8");

      const apply = await runCliInDir(project, ["review", "apply", "review-payload.jsonl"]);
      expect(apply).toContain("decisions: 2");
      expect(apply).toContain("approved: 1");
      expect(apply).toContain("rejected: 1");
      expect(existsSync(join(project, "knowledge", button?.path ?? ""))).toBe(true);
      const afterApplyRows = readRows(project);
      expect(afterApplyRows.find((row) => row.id === button?.id)).toBeUndefined();
      expect(afterApplyRows.filter((row) => row.status === "rejected")).toHaveLength(ids.length - 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source ensure reports missing local repo without cloning or creating the target", async () => {
    const root = makeTmp();
    const repo = join(root, "sample-lib");
    const project = join(root, "kb");
    const missingLocal = join(root, "missing-lib");
    try {
      await mkdir(repo, { recursive: true });
      const head = initFixtureRepo(repo);
      await runCliInDir(root, ["init", "kb"]);

      await runCliInDir(project, [
        "source",
        "add",
        "repo",
        "20260712",
        "--module",
        "missing-lib",
        "--local",
        "../missing-lib",
        "--remote",
        "https://git.example.com/missing-lib.git",
        "--ref",
        head,
      ]);
      expect(existsSync(missingLocal)).toBe(false);
      expect(existsSync(join(project, "sources", "repo", "20260712", "missing-lib"))).toBe(false);

      const ensure = await runCliInDir(project, ["source", "ensure", "20260712/missing-lib"]);
      expect(ensure).toContain("missing-lib");
      expect(ensure).toContain("local path is missing");
      expect(ensure).toContain("repo-local-checkout-missing");
      expect(existsSync(missingLocal)).toBe(false);
      expect(existsSync(join(project, "sources", "repo", "20260712", "missing-lib"))).toBe(false);

      const status = await runCliInDir(project, ["status"]);
      expect(status).toContain("state: route.source.repository-not-ready");
      expect(status).toContain("agent hint 20260712/missing-lib");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
