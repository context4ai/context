import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentSourceSpan, formatCanonicalProseSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { createCliProgram, handleCliFailure } from "../cli.js";
import { approvedKnowledgeInputHash } from "../project/close.js";
import { initContextProject } from "../project/workspace.js";

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ctx-project-align-prose-v062-"));
}

export async function invokeCliInDir(dir: string, args: string[]): Promise<CliResult> {
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
    return { status, stdout: stdoutChunks.join("") , stderr: stderrChunks.join("") };
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

function writeAlignProjectEntry(projectRoot: string): void {
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
    "",
    'const docs = source("product-docs");',
    "",
    "export default defineProject({",
    "  sources: [docs],",
    "  phases: [",
    "    captureFile({ source: docs }),",
    '    alignProse({ source: docs, collection: "architecture" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

export async function createCapturedAlignProject(root: string): Promise<{ projectRoot: string; docsDir: string }> {
  const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  const projectRoot = result.projectRoot;
  const docsDir = join(projectRoot, "..", "docs");
  await mkdir(docsDir, { recursive: true });
  writeFileSync(join(docsDir, "guide.md"), [
    "# Guide",
    "",
    "Alpha opening paragraph for chunk one.",
    "",
    "## Install",
    "",
    "Install the package before configuring it.",
    "",
    "## Configure",
    "",
    "Set the options that match the deployment.",
    "",
    "See [Reference](./reference.md) for related setup.",
    "",
    "## Uncertain Relation",
    "",
    "Install may be required before configuring deployments.",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(docsDir, "reference.md"), [
    "# Reference",
    "",
    "Secondary reference paragraph for source mapping filters.",
    "",
  ].join("\n"), "utf8");
  await runCliInDir(projectRoot, [
    "source",
    "add",
    "file",
    "product-docs",
    "--local",
    docsDir,
    "--format",
    "json",
  ]);
  writeAlignProjectEntry(projectRoot);
  await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
  return { projectRoot, docsDir };
}

function snapshotHash(projectRoot: string): string {
  return String((JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as { snapshot_hash: string }).snapshot_hash);
}

export function writePayload(projectRoot: string, name: string, payload: Record<string, unknown>): string {
  const path = join(projectRoot, name);
  const payloadWithEvidence = payload.evidence_snapshot_hash === undefined
    ? { ...payload, evidence_snapshot_hash: snapshotHash(projectRoot) }
    : payload;
  writeFileSync(path, `${YAML.stringify(payloadWithEvidence)}\n`, "utf8");
  return path;
}

export function structurePayload(projectRoot: string, sourceRef: string): Record<string, unknown> {
  const edgeRef = sourceRefForLine(projectRoot, "guide.md", 7);
  return {
    schema_version: "context.structure.v1",
    sources: ["file:product-docs"],
    evidence_snapshot_hash: snapshotHash(projectRoot),
    nodes: [
      {
        node_ref: "domain/product-docs",
        title: "Product Docs",
        node_type: "domain",
        ownership: "Owns product documentation overview.",
      },
      {
        node_ref: "entity/install",
        title: "Install",
        node_type: "entity",
        tags: ["module"],
        ownership: "Owns installation guidance.",
      },
    ],
    views: [
      {
        view_ref: "architecture:domain/product-docs",
        node_ref: "domain/product-docs",
        collection: "architecture",
        containment: "product-docs",
        slug: "overview",
        title: "Product Docs",
        node_type: "domain",
        path: "architecture/product-docs/overview.md",
        ownership: "Owns product documentation overview.",
        sections: [{
          id: "overview",
          section_ref: "architecture:domain/product-docs#overview",
          kind: "description",
          ownership: "Overview source span",
          summary: "Mirror the overview span during compile.",
          source_refs: [sourceRef],
        }],
      },
      {
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
        collection: "architecture",
        containment: "product-docs",
        slug: "install",
        title: "Install",
        node_type: "entity",
        path: "architecture/product-docs/install.md",
        ownership: "Owns installation guidance.",
        sections: [{
          id: "install",
          section_ref: "architecture:entity/install#install",
          kind: "description",
          ownership: "Install source span",
          source_refs: [sourceRef],
        }],
      },
    ],
    edges: [{
      type: "contains",
      from: "domain/product-docs",
      to: "entity/install",
      source_refs: [edgeRef],
    }],
    unresolved: [{
      issue: "weak_evidence",
      note: "Leave unsupported relationships unresolved.",
      source_refs: [sourceRef],
    }],
    user_or_agent_hints: {
      preferred_nodes: [{
        node_ref: "entity/install",
        reason: "User wants installation as a standalone node.",
      }],
      grouping_notes: ["Keep setup concepts together when evidence supports it."],
      do_not_force: ["Do not add relationships without source refs."],
    },
    lifecycle: {
      state: "draft",
    },
  };
}

export async function writeApprovedStructure(projectRoot: string, sourceRef: string): Promise<void> {
  const edgeRef = sourceRefForLine(projectRoot, "guide.md", 7);
  mkdirSync(join(projectRoot, "knowledge", "architecture", "product-docs"), { recursive: true });
  writeFileSync(join(projectRoot, "knowledge", "architecture", "product-docs", "overview.md"), [
    "---",
    "title: Product Docs",
    "type: Guide",
    "description: Approved product docs.",
    "tags:",
    "  - domain",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: file:product-docs/guide.md",
    "sources:",
    "  - file:product-docs/guide.md",
    "node_ref: domain/product-docs",
    "view_ref: architecture:domain/product-docs",
    "node_type: domain",
    "---",
    "",
    `<!-- context:section id="overview" kind="description" source_ref="${sourceRef}" content_mode="verbatim" -->`,
    "Alpha opening paragraph for chunk one.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(projectRoot, "knowledge", "architecture", "product-docs", "setup.md"), [
    "---",
    "title: Install",
    "type: Guide",
    "description: Approved setup node with a title matching the staged install node.",
    "tags:",
    "  - module",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: file:product-docs/guide.md",
    "sources:",
    "  - file:product-docs/guide.md",
    "node_ref: entity/setup",
    "view_ref: architecture:entity/setup",
    "node_type: entity",
    "---",
    "",
    `<!-- context:section id="install" kind="description" source_ref="${sourceRef}" content_mode="verbatim" -->`,
    "Install the package before configuring it.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
  const structure = {
    schema_version: "context.approved-structure.v1",
    input_hash: "sha256:test",
    nodes: [{
      node_ref: "domain/product-docs",
      title: "Product Docs",
      node_type: "domain",
      summary: "Approved product docs.",
    }, {
      node_ref: "entity/setup",
      title: "Install",
      node_type: "entity",
      summary: "Approved setup node with a title matching the staged install node.",
    }],
    views: [{
      view_ref: "architecture:domain/product-docs",
      node_ref: "domain/product-docs",
      collection: "architecture",
      containment: "product-docs",
      slug: "overview",
      title: "Product Docs",
      node_type: "domain",
      path: "architecture/product-docs/overview.md",
      sections: [{
        id: "overview",
        section_ref: "architecture:domain/product-docs#overview",
        kind: "description",
        source_refs: [sourceRef],
      }],
    }, {
      view_ref: "architecture:entity/setup",
      node_ref: "entity/setup",
      collection: "architecture",
      containment: "product-docs",
      slug: "setup",
      title: "Install",
      node_type: "entity",
      path: "architecture/product-docs/setup.md",
      sections: [{
        id: "install",
        section_ref: "architecture:entity/setup#install",
        kind: "description",
        source_refs: [sourceRef],
      }],
    }],
    edges: [{
      type: "contains",
      from: "domain/product-docs",
      to: "architecture:entity/setup",
      source_refs: [edgeRef],
    }],
  };
  writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), `${YAML.stringify(structure)}\n`, "utf8");
  writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), `${YAML.stringify({
    ...structure,
    input_hash: await approvedKnowledgeInputHash(projectRoot),
  })}\n`, "utf8");
}

export function writeCodegraphApprovedStructure(projectRoot: string): void {
  mkdirSync(join(projectRoot, "knowledge", "codegraph", "services"), { recursive: true });
  writeFileSync(join(projectRoot, "knowledge", "codegraph", "services", "gateway.md"), [
    "---",
    "title: Gateway",
    "type: Wiki",
    "description: Approved codegraph gateway.",
    "tags:",
    "  - module",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: repo:product-docs",
    "sources:",
    "  - repo:product-docs",
    "node_ref: entity/gateway",
    "view_ref: codegraph:entity/gateway",
    "node_type: entity",
    "visibility: public",
    "code_symbols:",
    "  - src/index.ts#symbol:Gateway",
    "---",
    "",
    "# Gateway",
    "",
  ].join("\n"), "utf8");
  writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), `${YAML.stringify({
    schema_version: "context.approved-structure.v1",
    input_hash: "sha256:test",
    nodes: [{
      node_ref: "entity/gateway",
      title: "Gateway",
      node_type: "entity",
    }],
    views: [{
      view_ref: "codegraph:entity/gateway",
      node_ref: "entity/gateway",
      collection: "codegraph",
      containment: "services",
      slug: "gateway",
      title: "Gateway",
      node_type: "entity",
      path: "codegraph/services/gateway.md",
      sections: [],
    }],
    edges: [],
  })}\n`, "utf8");
}

export async function firstSourceRef(projectRoot: string): Promise<string> {
  const sourceIndex = JSON.parse(await runCliInDir(projectRoot, [
    "run",
    "align:file:product-docs:architecture",
    "--view",
    "source-index",
    "--format",
    "json",
  ])) as { result: { source_index: { spans: Array<{ source_ref: string }> } } };
  return sourceIndex.result.source_index.spans[0]!.source_ref;
}

export function sourceRefForLine(projectRoot: string, documentPath: string, line: number): string {
  const markdown = readFileSync(join(projectRoot, "..", "docs", documentPath), "utf8");
  return formatCanonicalProseSourceRef({
    sourceType: "file",
    sourceName: "product-docs",
    documentPath,
    span: createDocumentSourceSpan(markdown, { lineStart: line, lineEnd: line }),
  });
}

export function sourceRefForRange(projectRoot: string, documentPath: string, lineStart: number, lineEnd: number): string {
  const markdown = readFileSync(join(projectRoot, "..", "docs", documentPath), "utf8");
  return formatCanonicalProseSourceRef({
    sourceType: "file",
    sourceName: "product-docs",
    documentPath,
    span: createDocumentSourceSpan(markdown, { lineStart, lineEnd }),
  });
}

export function largeNarrativePayload(
  projectRoot: string,
  sourceRef: string,
  sectionCount = 25,
): Record<string, unknown> {
  const sections = Array.from({ length: sectionCount }, (_, index) => ({
    id: `segment-${index + 1}`,
    section_ref: `architecture:action/large-runbook#segment-${index + 1}`,
    kind: index === 0 ? "spec" : "description",
    summary: `Segment ${index + 1}`,
    source_refs: [sourceRef],
  }));
  return {
    schema_version: "context.structure.v1",
    sources: ["file:product-docs"],
    evidence_snapshot_hash: snapshotHash(projectRoot),
    nodes: [{
      node_ref: "action/large-runbook",
      title: "Large Runbook",
      node_type: "action",
      summary: "Large narrative that may benefit from smaller navigation units.",
      tags: ["runbook"],
    }],
    views: [{
      view_ref: "architecture:action/large-runbook",
      node_ref: "action/large-runbook",
      collection: "architecture",
      containment: "runbooks",
      slug: "large-runbook",
      title: "Large Runbook",
      node_type: "action",
      path: "architecture/runbooks/large-runbook.md",
      summary: "Large narrative that may benefit from smaller navigation units.",
      sections,
    }],
    edges: [],
    unresolved: [],
    lifecycle: {
      state: "draft",
    },
  };
}
