import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { acceptCurrentCodeIndexAudit } from "./projectBuildVerifyV060Helpers.js";
import { writeApproved } from "./projectVerifyV062Helpers.js";

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
    "/** Returns the visible button label for the public component contract. */",
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
    '    extractTs({ source: sampleA, collection: "codeindex" }),',
    '    extractTs({ source: sampleB, collection: "codeindex" }),',
    "    captureFile({ source: manual }),",
    '    reviewValidity({ collection: "codeindex" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

function writeRepoOnlyProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { defineProject, extractTs, source } from "@c4a/context";',
    "",
    'const sampleA = source("20260712", "sample-a");',
    'const sampleB = source("20260712", "sample-b");',
    "",
    "export default defineProject({",
    "  sources: [sampleA, sampleB],",
    "  phases: [",
    '    extractTs({ source: sampleA, collection: "codeindex" }),',
    '    extractTs({ source: sampleB, collection: "codeindex" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.19 code-index batched human review", () => {
  test("a cold runtime continues all extraction phases before validating existing code evidence", async () => {
    const root = makeTmp();
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    const project = join(root, "kb");
    try {
      await mkdir(repoA, { recursive: true });
      await mkdir(repoB, { recursive: true });
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
      writeRepoOnlyProjectEntry(project);
      expect(existsSync(join(project, ".tmp", "context-runtime", "extract", "source-symbols.json"))).toBe(false);

      await runCliInDir(project, [
        "run", "extract:20260712/sample-a:codeindex", "--format", "json",
      ]);
      await writeApproved({
        projectRoot: project,
        collection: "codeindex",
        sources: ["repo:20260712/sample-b"],
        sourceRef: "src-1#symbol:src/Button.ts:Button:function@abc123abc123",
        body: "Existing sample B knowledge.",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: ["20260712/sample-b|Button|function"],
          candidate_fingerprint: "sha256:approved-sample-b",
        },
      });

      await runCliInDir(project, [
        "run", "--preview-extraction-batch",
        "--preview-phase", "extract:20260712/sample-b:codeindex",
        "--format", "json",
      ]);

      const status = JSON.parse(await runCliInDir(project, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        verifyErrors: number;
        pendingExtractPhases: string[];
        routing: { command_plan: Array<{ command: string }> };
      };
      expect(status.state).toBe("route.extract.pending-target");
      expect(status.verifyErrors).toBe(0);
      expect(status.pendingExtractPhases).toEqual(["extract:20260712/sample-b:codeindex"]);
      expect(status.routing.command_plan[0]?.command).toContain(
        "run extract:20260712/sample-b:codeindex --format json",
      );

      const verify = JSON.parse(await runCliInDir(project, ["verify", "--format", "json"])) as {
        ok: boolean;
        evidence_status: string;
        issues: Array<{ code: string }>;
      };
      expect(verify.ok).toBe(true);
      expect(verify.evidence_status).toBe("pass-with-unverifiable-evidence");
      expect(verify.issues.map((issue) => issue.code)).toContain("extract-symbol-index-incomplete");
      expect(verify.issues.map((issue) => issue.code)).not.toContain("approved-source-ref-stale");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("multiple confirmed repo modules finish extraction before one code-index Review", async () => {
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
      await runCliInDir(project, [
        "run", "--preview-extraction-batch", "--format", "json",
      ]);

      const first = JSON.parse(await runCliInDir(project, [
        "run", "extract:20260712/sample-a:codeindex", "--format", "json",
      ])) as { result: { next_action: { kind: string; command: string } } };
      expect(first.result.next_action).toMatchObject({
        kind: "continue-code-index-batch",
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
      expect(batchStatus.pendingExtractPhases).toEqual(["extract:20260712/sample-b:codeindex"]);
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
        "run extract:20260712/sample-b:codeindex --format json",
      );

      await runCliInDir(project, ["run", "extract:20260712/sample-b:codeindex", "--format", "json"]);
      const auditStatus = JSON.parse(await runCliInDir(project, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        codeIndexAudit: { current: boolean; resolved: boolean; report: { units: Array<{ id: string }> } };
      };
      expect(auditStatus.state).toBe("route.extract.audit-required");
      expect(auditStatus.codeIndexAudit.current).toBe(false);
      expect(auditStatus.codeIndexAudit.resolved).toBe(false);
      expect(auditStatus.codeIndexAudit.report.units.map((unit) => unit.id)).toEqual(
        expect.arrayContaining(["sample-a", "sample-b"]),
      );
      const prematureReview = await invokeCliInDir(project, [
        "review", "html", "codeindex", "--format", "json",
      ]);
      expect(prematureReview.status).not.toBe(0);
      expect(prematureReview.stderr).toContain("code-index quality audit must pass before candidate review");
      expect(prematureReview.stderr).toContain("code-index-audit-required-before-review");
      const prematureApproval = await invokeCliInDir(project, [
        "review", "approve-all", "codeindex", "--managed", "--format", "json",
      ]);
      expect(prematureApproval.status).not.toBe(0);
      expect(prematureApproval.stderr).toContain("code-index quality audit must pass before candidate review");
      await acceptCurrentCodeIndexAudit(
        project,
        "Both fixture modules were reviewed together and intentionally expose one symbol page each.",
      );
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
        collections: ["codeindex"],
        collection: "codeindex",
        count: 2,
        command: "context review html codeindex --open",
      });
      expect(reviewStatus.pendingExtractPhases).toEqual([]);
      expect(reviewStatus.routing).toMatchObject({
        human_gate: { required: true, kind: "knowledge-review" },
        command_plan: [
          {
            command: expect.stringContaining("review html codeindex --open"),
            availability: "immediate",
          },
          {
            command: expect.stringContaining("review approve-all codeindex --force --format json"),
            availability: "after-human-confirmation",
          },
        ],
      });

      const review = JSON.parse(await runCliInDir(project, [
        "review", "html", "codeindex", "--format", "json",
      ])) as { candidates: number };
      expect(review.candidates).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
