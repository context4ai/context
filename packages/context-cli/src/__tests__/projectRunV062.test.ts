import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { initContextProject } from "../project/workspace.js";

interface DocumentPreviewJson {
  preview: {
    source: {
      type: string;
    };
    snapshot?: {
      manifest: string;
      exists: boolean;
    };
    candidateTree: Array<{
      path: string;
      collection: string;
      source: string;
    }>;
    knowledgePathExamples: Array<{
      path: string;
      source_ref: string;
    }>;
    sourceRefExamples: string[];
  };
}

interface PreviewErrorJson {
  preview_error: {
    message: string;
    detail: {
      category: string;
      next: string;
      expectedType?: string;
      actualType?: string;
    };
  };
}

interface PhaseListJson {
  phases: Array<{
    id: string;
    kind?: string;
    reads: string[];
    writes: string[];
    readResources: Array<{
      kind: string;
      label: string;
      path?: string;
      sourceType?: string;
      sourceName?: string;
    }>;
    writeResources: Array<{
      kind: string;
      label: string;
      path?: string;
      sourceType?: string;
      sourceName?: string;
    }>;
    diagnostics?: Array<{
      category: string;
      message: string;
      next?: string;
      sourceName?: string;
      actualType?: string;
    }>;
  }>;
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-run-v062-"));
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

function writeDocumentProjectEntry(project: string): void {
  writeFileSync(join(project, "src", "index.ts"), [
    'import { alignProse, compileProse, captureFile, captureLark, defineProject, source } from "@c4a/context";',
    "",
    'const productDocs = source("product-docs");',
    'const handbook = source("handbook");',
    "",
    "export default defineProject({",
    "  sources: [productDocs, handbook],",
    "  phases: [",
    "    captureFile({ source: productDocs }),",
    "    captureLark({ source: handbook }),",
    '    alignProse({ source: productDocs, collection: "architecture" }),',
    '    alignProse({ source: handbook, collection: "architecture" }),',
    '    compileProse({ source: productDocs, collection: "architecture" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

async function writeDocumentRegistries(project: string): Promise<void> {
  await mkdir(join(project, "sources", "file", "product-docs"), { recursive: true });
  await mkdir(join(project, "sources", "lark", "handbook"), { recursive: true });
  writeFileSync(join(project, "sources", "file", "index.yaml"), [
    "sources:",
    "  - name: product-docs",
    "    local: ../docs",
    "    snapshot:",
    "      manifest: sources/file/product-docs/manifest.json",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(project, "sources", "lark", "index.yaml"), [
    "sources:",
    "  - name: handbook",
    "    url: https://example.larksuite.com/wiki/handbook",
    "    snapshot:",
    "      manifest: sources/lark/handbook/manifest.json",
    "",
  ].join("\n"), "utf8");
}

async function createDocumentProject(root: string): Promise<string> {
  const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  writeDocumentProjectEntry(result.projectRoot);
  await writeDocumentRegistries(result.projectRoot);
  return result.projectRoot;
}

describe("0.6.2 document phase run planning", () => {
  test("rejects payload input without a consuming operation", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const result = await invokeCliInDir(project, [
        "run",
        "align:file:product-docs:architecture",
        "--input",
        "structure.yaml",
        "--format",
        "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--input requires an operation that consumes the payload");
      expect(result.stderr).toContain("ambiguous-run-input");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects mutually exclusive validate and stage operations", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const result = await invokeCliInDir(project, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--stage",
        "--input",
        "structure.yaml",
        "--format",
        "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("run write operations are mutually exclusive");
      expect(result.stderr).toContain("ambiguous-run-operation");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects write operations combined with evidence views", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const result = await invokeCliInDir(project, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--validate",
        "--input",
        "structure.yaml",
        "--format",
        "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("write operations cannot be combined with evidence views");
      expect(result.stderr).toContain("ambiguous-run-mode");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires existing knowledge filters to use the existing-knowledge view", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const result = await invokeCliInDir(project, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "source-index",
        "--query",
        "Install",
        "--format",
        "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("existing knowledge filters require the align existing-knowledge view");
      expect(result.stderr).toContain("existing-knowledge-filter-without-view");
      expect(result.stderr).toContain("context run align:file:product-docs:architecture --view existing-knowledge --query Install --format json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects existing knowledge filters on non-align phases with an executable recovery command", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const result = await invokeCliInDir(project, [
        "run",
        "compile:file:product-docs:architecture",
        "--query",
        "Install",
        "--format",
        "json",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("existing knowledge filters are supported only by prose align phases");
      expect(result.stderr).toContain("existing-knowledge-filter-unsupported-phase");
      expect(result.stderr).toContain("context run compile:file:product-docs:architecture --dry-run --format json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status defaults to a workflow-first summary and omits full inventories", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const summary = JSON.parse(await runCliInDir(project, [
        "status",
        "--format",
        "json",
      ])) as Record<string, unknown>;

      expect(Object.keys(summary).slice(0, 2)).toEqual(["workflow", "currentTarget"]);
      expect(summary).toHaveProperty("workflow.current");
      expect(summary).toHaveProperty("progress");
      expect(summary).toHaveProperty("counts");
      expect(summary).not.toHaveProperty("routing");
      expect(summary).not.toHaveProperty("next");
      expect(summary).not.toHaveProperty("sources");
      expect(summary).not.toHaveProperty("documentSources");
      expect(summary).not.toHaveProperty("phases");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run list includes document phase read/write summary", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const parsed = JSON.parse(await runCliInDir(project, ["run", "--list", "--format", "json"])) as {
        phases: Array<{ id: string; kind: string; reads: string[]; writes: string[] }>;
      };

      const capture = parsed.phases.find((phase) => phase.id === "capture:file:product-docs");
      const alignFile = parsed.phases.find((phase) => phase.id === "align:file:product-docs:architecture");
      const alignLark = parsed.phases.find((phase) => phase.id === "align:lark:handbook:architecture");
      const compile = parsed.phases.find((phase) => phase.id === "compile:file:product-docs:architecture");
      expect(capture).toMatchObject({
        id: "capture:file:product-docs",
        kind: "phase.capture.file",
        reads: ["source:file:product-docs"],
        writes: ["source-snapshot:file:product-docs"],
      });
      expect(alignFile?.reads).toEqual(["source-snapshot:file:product-docs"]);
      expect(alignFile?.writes).toEqual(["lifecycle:structure:*:draft"]);
      expect(alignLark?.reads).toEqual(["source-snapshot:lark:handbook"]);
      expect(compile?.reads).toEqual(["source-snapshot:file:product-docs", "lifecycle:structure:*:confirmed"]);
      expect(compile?.writes).toEqual(["lifecycle:structure:*:frozen", "lifecycle:candidates:*:draft"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("document phase planning uses registry snapshot manifest paths", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      writeFileSync(join(project, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs",
        "    snapshot:",
        "      manifest: sources/file/product-docs/meta/manifest.json",
        "",
      ].join("\n"), "utf8");

      const listed = JSON.parse(await runCliInDir(project, ["run", "--list", "--format", "json"])) as PhaseListJson;
      const capture = listed.phases.find((phase) => phase.id === "capture:file:product-docs");
      const compile = listed.phases.find((phase) => phase.id === "compile:file:product-docs:architecture");
      const align = listed.phases.find((phase) => phase.id === "align:file:product-docs:architecture");

      expect(capture?.writeResources[0]).toMatchObject({
        kind: "source.snapshot",
        label: "source-snapshot:file:product-docs",
        path: "sources/file/product-docs/meta/manifest.json",
      });
      expect(compile?.readResources[0]).toMatchObject({
        kind: "source.snapshot",
        label: "source-snapshot:file:product-docs",
        path: "sources/file/product-docs/meta/manifest.json",
      });
      expect(compile?.readResources[1]).toMatchObject({
        kind: "lifecycle.structure",
        label: "lifecycle:structure:*:confirmed",
        profileCollection: "architecture",
        path: ".tmp/context-runtime/lifecycle/structure.yaml",
      });
      expect(align?.readResources[0]).toMatchObject({
        kind: "source.snapshot",
        label: "source-snapshot:file:product-docs",
        path: "sources/file/product-docs/meta/manifest.json",
      });

      const dryRun = JSON.parse(await runCliInDir(project, [
        "run",
        "compile:file:product-docs:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as DocumentPreviewJson & {
        phase: {
          readResources: Array<{ path?: string }>;
        };
      };
      expect(dryRun.phase.readResources[0]?.path).toBe("sources/file/product-docs/meta/manifest.json");
      expect(dryRun.preview.snapshot?.manifest).toBe("sources/file/product-docs/meta/manifest.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile and align dry-run expose candidate tree and source_ref examples without writing candidates", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      writeFileSync(join(project, "sources", "file", "product-docs", "manifest.json"), "{}\n", "utf8");
      writeFileSync(join(project, "sources", "lark", "handbook", "manifest.json"), "{}\n", "utf8");
      const candidateFile = join(project, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
      expect(existsSync(candidateFile)).toBe(false);

      const compile = JSON.parse(await runCliInDir(project, [
        "run",
        "compile:file:product-docs:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as DocumentPreviewJson;
      const align = JSON.parse(await runCliInDir(project, [
        "run",
        "align:lark:handbook:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as DocumentPreviewJson;

      expect(compile.preview.candidateTree[0]).toEqual({
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        collection: "architecture",
        source: "product-docs",
      });
      expect(compile.preview.knowledgePathExamples[0]?.path).toBe("knowledge/architecture/product-docs/index-page.md");
      expect(compile.preview.knowledgePathExamples[0]?.source_ref).toBe("file:product-docs/index.md#span:<heading-hint> L<start>-<end>@<span-hash>");
      expect(compile.preview.sourceRefExamples[0]).toBe("file:product-docs/<doc-locator>#span:<heading-hint> L<start>-<end>@<hash>");
      expect(align.preview.source.type).toBe("lark");
      expect(align.preview.sourceRefExamples[1]).toBe("lark:handbook/index.md#span:<heading-hint> L<start>-<end>@<span-hash>");
      expect(JSON.stringify(compile)).not.toContain("#document:");
      expect(JSON.stringify(compile)).not.toContain("doc:");
      expect(JSON.stringify(compile)).not.toContain("document:");
      expect(existsSync(candidateFile)).toBe(false);
      expect(existsSync(join(project, ".tmp", "context-runtime", "runs"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("document dry-run reports structured diagnostics for unresolved source reference", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      writeFileSync(join(result.projectRoot, "src", "index.ts"), [
        'import { captureFile, compileProse, defineProject, source } from "@c4a/context";',
        "",
        'const missingDocs = source("missing-docs");',
        "",
        "export default defineProject({",
        "  sources: [missingDocs],",
        "  phases: [",
        "    captureFile({ source: missingDocs }),",
        '    compileProse({ source: missingDocs, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const listed = JSON.parse(await runCliInDir(result.projectRoot, ["run", "--list", "--format", "json"])) as PhaseListJson;
      expect(listed.phases.find((phase) => phase.id === "capture:file:missing-docs")?.diagnostics?.[0]).toMatchObject({
        category: "source-not-found",
        message: "document source is not declared: missing-docs",
        sourceName: "missing-docs",
        next: "context source add file missing-docs --local <relative-path>",
      });
      expect(listed.phases.find((phase) => phase.id === "compile:source:missing-docs:architecture")?.diagnostics?.[0]).toMatchObject({
        category: "source-not-found",
        message: "document source is not declared: missing-docs",
        sourceName: "missing-docs",
        next: "context source add file missing-docs --local <relative-path> or context source add lark missing-docs --url <url>",
      });

      const output = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "compile:file:missing-docs:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as PreviewErrorJson;

      expect(output.preview_error.message).toBe("document source is not declared: missing-docs");
      expect(output.preview_error.detail.category).toBe("source-not-found");
      expect(output.preview_error.detail.next).toBe("context source add file missing-docs --local <relative-path>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("document dry-run reports source type mismatch instead of treating wrong-type names as missing", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      writeFileSync(join(result.projectRoot, "src", "index.ts"), [
        'import { captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const handbook = source("handbook");',
        "",
        "export default defineProject({",
        "  sources: [handbook],",
        "  phases: [captureFile({ source: handbook })],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(result.projectRoot, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    url: https://example.larksuite.com/wiki/handbook",
        "",
      ].join("\n"), "utf8");

      const listed = JSON.parse(await runCliInDir(result.projectRoot, ["run", "--list", "--format", "json"])) as PhaseListJson;
      expect(listed.phases.find((phase) => phase.id === "capture:file:handbook")?.diagnostics?.[0]).toMatchObject({
        category: "user-input-invalid",
        message: "document source type mismatch: handbook is lark, expected file",
        sourceName: "handbook",
        expectedType: "file",
        actualType: "lark",
      });

      const output = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "capture:file:handbook",
        "--dry-run",
        "--format",
        "json",
      ])) as PreviewErrorJson;

      expect(output.preview_error.message).toBe("document source type mismatch: handbook is lark, expected file");
      expect(output.preview_error.detail.category).toBe("user-input-invalid");
      expect(output.preview_error.detail.expectedType).toBe("file");
      expect(output.preview_error.detail.actualType).toBe("lark");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run list and unrelated phases are not blocked by unresolved neutral align sources", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      writeFileSync(join(result.projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const productDocs = source("product-docs");',
        'const missingDocs = source("missing-docs");',
        "",
        "export default defineProject({",
        "  sources: [productDocs, missingDocs],",
        "  phases: [",
        "    captureFile({ source: productDocs }),",
        '    alignProse({ source: missingDocs, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(result.projectRoot, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: ../docs",
        "",
      ].join("\n"), "utf8");

      const parsed = JSON.parse(await runCliInDir(result.projectRoot, ["run", "--list", "--format", "json"])) as PhaseListJson;
      expect(parsed.phases.map((phase) => phase.id)).toContain("capture:file:product-docs");
      expect(parsed.phases.map((phase) => phase.id)).toContain("align:source:missing-docs:architecture");
      const missingAlign = parsed.phases.find((phase) => phase.id === "align:source:missing-docs:architecture");
      expect(missingAlign?.diagnostics?.[0]).toMatchObject({
        category: "source-not-found",
        message: "document source is not declared: missing-docs",
        sourceName: "missing-docs",
        next: "context source add file missing-docs --local <relative-path> or context source add lark missing-docs --url <url>",
      });

      const capture = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "capture:file:product-docs",
        "--dry-run",
        "--format",
        "json",
      ])) as DocumentPreviewJson;
      expect(capture.preview.source.type).toBe("file");

      const missingAlignDryRun = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "align:file:missing-docs:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as PreviewErrorJson;
      expect(missingAlignDryRun.preview_error.message).toBe("document source is not declared: missing-docs");
      expect(missingAlignDryRun.preview_error.detail.category).toBe("source-not-found");
      expect(missingAlignDryRun.preview_error.detail.next)
        .toBe("context source add file missing-docs --local <relative-path> or context source add lark missing-docs --url <url>");

      const neutralMissingAlignDryRun = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "align:source:missing-docs:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as PreviewErrorJson;
      expect(neutralMissingAlignDryRun.preview_error.message).toBe("document source is not declared: missing-docs");
      expect(neutralMissingAlignDryRun.preview_error.detail.category).toBe("source-not-found");
      expect(neutralMissingAlignDryRun.preview_error.detail.next)
        .toBe("context source add file missing-docs --local <relative-path> or context source add lark missing-docs --url <url>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("neutral prose align rejects repo sources with a specific diagnostic", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      writeFileSync(join(result.projectRoot, "src", "index.ts"), [
        'import { alignProse, defineProject, source } from "@c4a/context";',
        "",
        'const codeRepo = source("20260712/code-repo");',
        "",
        "export default defineProject({",
        "  sources: [codeRepo],",
        '  phases: [alignProse({ source: codeRepo, collection: "architecture" })],',
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(result.projectRoot, "sources", "repo", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: code-repo",
        "        git:",
        "          remote: https://git.example.com/team/code-repo.git",
        "          ref: a1b2c3d4e5f678901234567890abcdef12345678",
        "",
      ].join("\n"), "utf8");

      const parsed = JSON.parse(await runCliInDir(result.projectRoot, ["run", "--list", "--format", "json"])) as PhaseListJson;
      const align = parsed.phases.find((phase) => phase.id === "align:source:20260712/code-repo:architecture");
      expect(align?.diagnostics?.[0]).toMatchObject({
        category: "user-input-invalid",
        message: "document source type mismatch: 20260712/code-repo is repo, expected file or lark",
        sourceName: "20260712/code-repo",
        actualType: "repo",
      });

      const preview = JSON.parse(await runCliInDir(result.projectRoot, [
        "run",
        "align:source:20260712/code-repo:architecture",
        "--dry-run",
        "--format",
        "json",
      ])) as PreviewErrorJson;
      expect(preview.preview_error.message).toBe("document source type mismatch: 20260712/code-repo is repo, expected file or lark");
      expect(preview.preview_error.detail.actualType).toBe("repo");
      expect(preview.preview_error.detail.next).toContain("use extractTs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run wraps document registry parse failures as structured CLI errors", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      writeFileSync(join(result.projectRoot, "src", "index.ts"), [
        'import { alignProse, defineProject, source } from "@c4a/context";',
        "",
        'const productDocs = source("product-docs");',
        "",
        "export default defineProject({",
        "  sources: [productDocs],",
        '  phases: [alignProse({ source: productDocs, collection: "architecture" })],',
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(result.projectRoot, "sources", "file", "index.yaml"), "files: []\n", "utf8");

      const output = await invokeCliInDir(result.projectRoot, ["run", "--list", "--format", "json"]);

      expect(output.status).not.toBe(0);
      expect(output.stderr).toContain("✗ failed: user-input-invalid");
      expect(output.stderr).toContain("Invalid file sources registry");
      expect(output.stderr).toContain("Unrecognized key");
      expect(output.stderr).toContain("Fix sources registry YAML");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("undeclared document phase returns to the workflow route", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const output = await invokeCliInDir(result.projectRoot, ["run", "compile:file:product-docs:architecture"]);

      expect(output.status).not.toBe(0);
      expect(output.stderr).toContain("phase is not declared: compile:file:product-docs:architecture");
      expect(output.stderr).toContain('"code": "phase-not-declared"');
      expect(output.stderr).toContain("context status --format json");
      expect(output.stderr).toContain("product-docs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("lark sources do not expose a one-to-one stage phase", async () => {
    const root = makeTmp();
    try {
      const project = await createDocumentProject(root);
      const listed = JSON.parse(await runCliInDir(project, ["run", "--list", "--format", "json"])) as PhaseListJson;
      expect(listed.phases.map((phase) => phase.id)).not.toContain("stage:lark:handbook:architecture");

      const result = await invokeCliInDir(project, ["run", "stage:lark:handbook:architecture"]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("✗ failed: user-input-invalid");
      expect(result.stderr).toContain("phase is not declared: stage:lark:handbook:architecture");
      expect(result.stderr).toContain("context status --format json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
