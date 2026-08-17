import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-batch-review-v069-"));
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
  writeFileSync(join(path, "src", "index.ts"), 'export { Button } from "./Button";\n', "utf8");
  writeFileSync(join(path, "src", "Button.ts"), [
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add ts fixture");
}

function writeMultiSourceProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { captureFile, defineProject, extractTs, reviewValidity, source } from "@c4a/context";',
    "",
    'const sampleA = source("20260712", "sample-a");',
    'const sampleB = source("20260712", "sample-b");',
    'const manual = source("20260712", "manual", { type: "file" });',
    "",
    "export default defineProject({",
    "  sources: [sampleA, sampleB, manual],",
    "  phases: [",
    '    extractTs({ source: sampleA, collection: "codegraph" }),',
    '    extractTs({ source: sampleB, collection: "codegraph" }),',
    "    captureFile({ source: manual }),",
    '    reviewValidity({ collection: "codegraph" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.9 codegraph batched human review", () => {
  test("multiple confirmed repo modules finish extraction before one codegraph Review", async () => {
    const root = makeTmp();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    const docs = join(root, "docs");
    const project = join(root, "kb");
    try {
      await mkdir(repoA, { recursive: true });
      await mkdir(repoB, { recursive: true });
      await mkdir(docs, { recursive: true });
      writeFileSync(join(docs, "manual.md"), "# Manual\n\nCaptured documentation.\n", "utf8");
      const headA = initTsRepo(repoA, "sample-a");
      const headB = initTsRepo(repoB, "sample-b");
      await runCliInDir(root, ["init", "kb"]);
      for (const source of [
        { module: "sample-a", local: "../repo-a", remote: "https://git.example.com/repo-a.git", ref: headA },
        { module: "sample-b", local: "../repo-b", remote: "https://git.example.com/repo-b.git", ref: headB },
      ]) {
        await runCliInDir(project, [
          "source", "add", "repo", "20260712",
          "--module", source.module,
          "--local", source.local,
          "--remote", source.remote,
          "--ref", source.ref,
        ]);
      }
      await runCliInDir(project, [
        "source", "add", "file", "20260712",
        "--module", "manual",
        "--local", "../docs/manual.md",
      ]);
      writeMultiSourceProjectEntry(project);
      await runCliInDir(project, ["run", "capture:file:20260712/manual", "--format", "json"]);

      const first = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-a:codegraph", "--format", "json",
      ])) as { result: { next_action: { kind: string; command: string } } };
      expect(first.result.next_action).toMatchObject({
        kind: "continue-codegraph-batch",
        command: "context status --format json",
      });

      const batchStatus = JSON.parse(await runCliInDir(project, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        draftCandidates: number;
        pendingExtractPhases: string[];
        routing: { human_gate: { required: boolean }; command_plan: Array<{ command: string; availability: string }> };
      };
      expect(batchStatus.state).toBe("route.extract.pending-target");
      expect(batchStatus.draftCandidates).toBeGreaterThan(0);
      expect(batchStatus.pendingExtractPhases).toEqual(["extract:20260712/sample-b:codegraph"]);
      expect(batchStatus.routing.human_gate).toMatchObject({
        required: false,
        kind: "none",
      });
      expect(batchStatus.routing.command_plan).toHaveLength(1);
      expect(batchStatus.routing.command_plan[0]).toMatchObject({
        availability: "immediate",
      });
      expect(batchStatus.routing.command_plan[0]?.command).toContain("--workflow-revision");
      expect(batchStatus.routing.command_plan[0]?.command).toContain(
        "run extract:20260712/sample-b:codegraph --format json",
      );

      await runCliInDir(project, ["run", "extract:20260712/sample-b:codegraph", "--format", "json"]);
      const reviewStatus = JSON.parse(await runCliInDir(project, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        draftCandidates: number;
        pendingExtractPhases: string[];
        pendingReview: {
          scope: string;
          collections: string[];
          collection: string;
          count: number;
          command: string;
        };
        routing: { human_gate: { required: boolean }; command_plan: Array<{ command: string; availability: string }> };
      };
      expect(reviewStatus.state).toBe("route.review.decision-required");
      expect(reviewStatus.draftCandidates).toBe(2);
      expect(reviewStatus.pendingReview).toMatchObject({
        scope: "collection",
        collections: ["codegraph"],
        collection: "codegraph",
        count: 2,
        command: "context review html codegraph --open",
      });
      expect(reviewStatus.pendingExtractPhases).toEqual([]);
      expect(reviewStatus.routing).toMatchObject({
        human_gate: { required: true, kind: "knowledge-review" },
        command_plan: [{
          command: expect.stringContaining("review html codegraph --open"),
          availability: "immediate",
        }],
      });

      const review = JSON.parse(await runCliInDir(project, [
        "review", "html", "codegraph", "--format", "json",
      ])) as { candidates: number };
      expect(review.candidates).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
