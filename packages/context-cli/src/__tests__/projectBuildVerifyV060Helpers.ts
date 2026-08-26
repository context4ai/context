import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import {
  applyCodeIndexAuditDecision,
  buildCodeIndexAuditReport,
} from "../project/codeIndexAudit.js";

export async function invokeCliInDir(
  dir: string,
  args: string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
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

export async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const result = await invokeCliInDir(dir, args);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}

export function commitAll(path: string, message: string): string {
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["commit", "-qm", message], { cwd: path });
  const headRef = readFileSync(join(path, ".git", "HEAD"), "utf8").trim();
  return headRef.startsWith("ref: ")
    ? readFileSync(join(path, ".git", headRef.slice("ref: ".length)), "utf8").trim()
    : headRef;
}

export function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function appendRejectedCandidate(project: string, sourceRef: string): void {
  appendCandidate(project, {
    id: "sample-a/sample-lib/symbol/secret",
    status: "rejected",
    title: "Secret",
    summary: "This candidate must stay out of packages.",
    sourceRef,
  });
}

export function appendDraftCandidate(project: string, sourceRef: string): void {
  appendCandidate(project, {
    id: "sample-a/sample-lib/symbol/secondary",
    status: "draft",
    title: "Secondary",
    summary: "This draft must not hide source staleness.",
    sourceRef,
  });
}

export function writePackageTemplates(project: string): void {
  const kbRoot = join(project, "src", "package-templates", "kb");
  const llmsRoot = join(project, "src", "package-templates", "llms");
  mkdirSync(join(kbRoot, "meta"), { recursive: true });
  mkdirSync(llmsRoot, { recursive: true });
  writeFileSync(join(kbRoot, "AGENTS.md"), [
    "# {{packageName}}",
    "",
    "display={{displayName}}",
    "kind={{packageKind}}",
    "knowledge={{knowledgeCount}}",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(kbRoot, "meta", "{{packageName}}.txt"), "package={{packageName}}\n", "utf8");
  writeFileSync(join(llmsRoot, "llms.txt"), [
    "# {{packageName}}",
    "",
    "kind={{packageKind}}",
    "",
  ].join("\n"), "utf8");
}

export async function acceptCurrentCodeIndexAudit(
  project: string,
  summary = "The fixture's code index matches its intentionally narrow test scope.",
): Promise<void> {
  const audit = await buildCodeIndexAuditReport(project);
  if (audit === undefined) throw new Error("expected code-index audit report");
  await applyCodeIndexAuditDecision({
    projectRoot: project,
    payload: {
      schema: "context.code-index-audit-decision.v1",
      report_digest: audit.digest,
      decision: "accept",
      summary,
      reviewed_units: audit.units.map((unit) => unit.id),
      scope_assessment: {
        matches_requested_scope: true,
        omissions: [],
        summary: "The fixture sources and selected exports are represented.",
      },
      signal_assessments: audit.signals
        .filter((signal) => signal.severity === "elevated")
        .map((signal) => ({
          signal_id: signal.id,
          disposition: "not-applicable",
          reason: "This fixture deliberately verifies granular exported symbols rather than an aggregate production module map.",
        })),
    },
  });
}

export async function createApprovedProject(options: {
  approvedMarkdownSuffix?: string;
  beforeClose?: (project: string) => void | Promise<void>;
} = {}): Promise<{
  root: string;
  repo: string;
  project: string;
  sourceRef: string;
  approvedId: string;
}> {
  const root = makeTmp();
  const repo = join(root, "repo-a");
  const project = join(root, "kb");
  await mkdir(repo, { recursive: true });
  const head = initTsRepo(repo);
  if (head.length === 0) throw new Error("fixture git HEAD is empty");
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
  writePackageTemplates(project);
  await runCliInDir(project, [
    "run", "--preview-extraction-batch", "--preview-phase", "extract:20260712/sample-a:codeindex", "--format", "json",
  ]);
  await runCliInDir(project, ["run", "extract:20260712/sample-a:codeindex"]);
  const [row] = readRows(project);
  if (!row) throw new Error("expected one extracted candidate");
  const snapshotPath = join(project, ".tmp", "context-runtime", "extract", "candidates", `${row.id}.json`);
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { markdown: string };
  snapshot.markdown = [
    snapshot.markdown.trimEnd(),
    options.approvedMarkdownSuffix?.trim() ?? "",
  ].filter((part) => part.length > 0).join("\n\n") + "\n";
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await acceptCurrentCodeIndexAudit(
    project,
    "The fixture's single exported symbol page matches its intentionally narrow scope.",
  );
  await runCliInDir(project, ["review", "approve", row.id, "--collection", "codeindex"]);
  await options.beforeClose?.(project);
  await runCliInDir(project, ["close", "--format", "json"]);
  return {
    root,
    repo,
    project,
    approvedId: row.id,
    sourceRef: row.source_refs[0] ?? "",
  };
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-build-v060-"));
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
    "/** Primary button used by product screens. */",
    "export function Button(label: string) {",
    "  return label;",
    "}",
    "",
  ].join("\n"), "utf8");
  return commitAll(path, "add ts fixture");
}

interface CandidateRow {
  id: string;
  candidate_id: string;
  node_ref: string;
  view_ref: string;
  collection: string;
  status: string;
  kind: string;
  visibility: string;
  module: string;
  path: string;
  source_refs: string[];
  fingerprint: string;
  review: {
    title: string;
    summary: string;
    signals: string[];
    reason: string;
  };
  updated: string;
}

function readRows(project: string): CandidateRow[] {
  const file = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const row = JSON.parse(line) as Omit<CandidateRow, "id">;
      return { ...row, id: row.candidate_id };
    });
}

function appendCandidate(project: string, input: {
  id: string;
  status: "draft" | "rejected";
  title: string;
  summary: string;
  sourceRef: string;
}): void {
  const nodeRef = input.id;
  const viewRef = `codeindex:${nodeRef}`;
  const candidateId = `codeindex/${nodeRef}`;
  const row: CandidateRow = {
    id: candidateId,
    candidate_id: candidateId,
    node_ref: nodeRef,
    view_ref: viewRef,
    collection: "codeindex",
    status: input.status,
    kind: "component",
    visibility: "exported",
    module: "sample-lib",
    path: `codeindex/${nodeRef}.md`,
    source_refs: [input.sourceRef],
    fingerprint: `sha256:${createHash("sha256").update(`${input.status}:${candidateId}`).digest("hex")}`,
    review: {
      title: input.title,
      summary: input.summary,
      signals: ["manual fixture"],
      reason: "test fixture",
    },
    updated: "2026-06-21T00:00:00.000Z",
  };
  const file = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  const wire = { ...row } as Record<string, unknown>;
  delete wire.id;
  mkdirSync(join(project, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, `${existing}${JSON.stringify(wire)}\n`, "utf8");
  if (input.status === "rejected") {
    const decisionsPath = join(project, "knowledge", "decisions.json");
    const decisions = existsSync(decisionsPath)
      ? JSON.parse(readFileSync(decisionsPath, "utf8")) as Record<string, string>
      : {};
    decisions[candidateId] = row.fingerprint;
    writeFileSync(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  }
}

function writeProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { defineProject, extractTs, llmsPackage, reviewValidity, kbPackage, source } from "@c4a/context";',
    "",
    'const sampleA = source("20260712", "sample-a");',
    "",
    "export default defineProject({",
    "  sources: [sampleA],",
    "  phases: [",
    '    extractTs({ source: sampleA, collection: "codeindex" }),',
    '    reviewValidity({ collection: "codeindex" }),',
    "  ],",
    "  packages: [",
    "    kbPackage({",
    '      name: "sample-kb",',
    '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
    "    }),",
    "    llmsPackage({",
    '      name: "sample-llms",',
    '      template: "src/package-templates/llms",',
    '      select: { include: ["codeindex/sample-a/**"] },',
    "    }),",
    "  ],",
    "});",
    "",
  ].join("\n"), "utf8");
}
