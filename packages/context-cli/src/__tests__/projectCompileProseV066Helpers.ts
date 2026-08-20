import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { cli_main, handleCliFailure } from "../cli.js";
import { initContextProject } from "../project/workspace.js";

const STRUCTURE_SCHEMA_VERSION = "context.structure.v1";
const TEST_COLLECTION = "architecture";
const SAMPLE_MARKDOWN = [
  "# Guide",
  "",
  "Alpha opening paragraph for compile.",
  "",
  "## Install",
  "",
  "- Keep the first install step.",
  "- Preserve the second install step.",
  "",
  "## Runtime Matrix",
  "",
  "| Option | Value |",
  "| runtime | edge |",
  "",
  "## Commands",
  "",
  "Run the command:",
  "",
  "```bash",
  "bun install",
  "context status",
  "```",
  "",
].join("\n");

export function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "context-cli-v066-"));
}

let cliQueue: Promise<unknown> = Promise.resolve();

export async function invokeCliInDir(dir: string, args: string[]): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  const run = async (): Promise<{ status: number; stdout: string; stderr: string }> => {
    const originalCwd = process.cwd();
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let status = 0;
    process.chdir(dir);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await cli_main(["node", "context", ...args]);
    } catch (error) {
      status = handleCliFailure(error, {
        stderr: {
          write: (chunk: string) => {
            stderr.push(chunk);
            return true;
          },
        },
        exit: (code: number) => {
          status = code;
        },
      });
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
      process.chdir(originalCwd);
    }
    return { status, stdout: stdout.join(""), stderr: stderr.join("") };
  };
  const previous = cliQueue;
  let release!: () => void;
  cliQueue = new Promise((resolveQueue) => {
    release = () => resolveQueue(undefined);
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

export async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const result = await invokeCliInDir(dir, args);
  if (result.status !== 0) {
    throw new Error([
      `context ${args.join(" ")} failed with status ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function renderProjectEntry(includePackage: boolean): string {
  return [
    `import { alignProse, captureFile, compileProse, defineProject, ${includePackage ? "kbPackage, " : ""}reviewValidity, source } from "@c4a/context";`,
    "",
    'const productDocs = source("product-docs");',
    "",
    "export default defineProject({",
    "  sources: [productDocs],",
    "  phases: [",
    "    captureFile({ source: productDocs }),",
    `    alignProse({ source: productDocs, collection: "${TEST_COLLECTION}" }),`,
    `    compileProse({ source: productDocs, collection: "${TEST_COLLECTION}" }),`,
    `    reviewValidity({ collection: "${TEST_COLLECTION}" }),`,
    "  ],",
    includePackage
      ? [
          "  packages: [",
          "    kbPackage({",
          '      name: "sample-kb",',
          '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
          `      select: { include: ["${TEST_COLLECTION}/**"] },`,
          "    }),",
          "  ],",
        ].join("\n")
      : "  packages: [],",
    "});",
    "",
  ].join("\n");
}

export async function enableKbPackage(projectRoot: string): Promise<void> {
  writeFileSync(join(projectRoot, "src", "index.ts"), renderProjectEntry(true), "utf8");
  await runCliInDir(projectRoot, ["package", "template", "accept", "--all", "--format", "json"]);
}

export async function createCapturedCompileProject(root: string): Promise<string> {
  mkdirSync(root, { recursive: true });
  const docsRoot = join(root, "docs");
  mkdirSync(docsRoot, { recursive: true });
  writeFileSync(join(docsRoot, "guide.md"), SAMPLE_MARKDOWN, "utf8");
  const initialized = await initContextProject({ cwd: root, projectDir: "kb", name: "sample", dev: true });
  const projectRoot = initialized.projectRoot;
  writeFileSync(join(projectRoot, "src", "index.ts"), renderProjectEntry(false), "utf8");
  mkdirSync(join(projectRoot, "sources", "file"), { recursive: true });
  writeFileSync(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
    sources: [{
      name: "product-docs",
      local: "../docs",
      include: ["guide.md"],
      snapshot: { manifest: "sources/file/product-docs/manifest.json" },
    }],
  }), "utf8");
  await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
  return projectRoot;
}

export async function sourceRefs(projectRoot: string): Promise<string[]> {
  const markdown = await readFile(join(projectRoot, "sources", "file", "product-docs", "guide.md"), "utf8");
  const locator = "file:product-docs/guide.md";
  return [
    { lineStart: 3, lineEnd: 8 },
    { lineStart: 12, lineEnd: 13 },
    { lineStart: 17, lineEnd: 17 },
    { lineStart: 19, lineEnd: 22 },
  ].map((range) => `${locator}${formatSpanSourceRef(createDocumentSourceSpan(markdown, range))}`);
}

export async function sourceRefsForRanges(
  projectRoot: string,
  ranges: ReadonlyArray<{ lineStart: number; lineEnd: number }>,
): Promise<string[]> {
  const markdown = await readFile(join(projectRoot, "sources", "file", "product-docs", "guide.md"), "utf8");
  const locator = "file:product-docs/guide.md";
  return ranges.map((range) => `${locator}${formatSpanSourceRef(createDocumentSourceSpan(markdown, range))}`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function structureDigest(body: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(body)).digest("hex")}`;
}

function structureBody(input: {
  nodes: unknown[];
  views: unknown[];
  edges: unknown[];
  evidenceSnapshotHash: string;
}): Record<string, unknown> {
  return {
    schema_version: STRUCTURE_SCHEMA_VERSION,
    sources: ["file:product-docs"],
    nodes: input.nodes,
    views: input.views,
    edges: input.edges,
    unresolved: [],
    evidence_snapshot_hash: input.evidenceSnapshotHash,
  };
}

function confirmedStructure(input: {
  projectRoot: string;
  nodes: unknown[];
  views: unknown[];
  edges: unknown[];
  hints?: Record<string, unknown>;
}): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(input.projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as { snapshot_hash: string };
  const body = structureBody({
    nodes: input.nodes,
    views: input.views,
    edges: input.edges,
    evidenceSnapshotHash: manifest.snapshot_hash,
  });
  return {
    ...body,
    ...(input.hints !== undefined ? { user_or_agent_hints: input.hints } : {}),
    lifecycle: {
      state: "confirmed",
      confirmed_by: "human",
      confirmed_at: "2026-06-24T12:00:00Z",
      structure_digest: structureDigest(body),
    },
  };
}

export async function stageConfirmedStructure(projectRoot: string, refs: readonly string[]): Promise<void> {
  const ref = refs[0] ?? (await sourceRefs(projectRoot))[0]!;
  const secondaryInstallRef = refs[1];
  const [edgeRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 7, lineEnd: 7 }]);
  const nodes = [{
    node_ref: "domain/product-docs",
    title: "Product Docs",
    node_type: "domain",
    summary: "Product docs structure root.",
  }, {
    node_ref: "entity/install",
    title: "Install",
    node_type: "entity",
    summary: "Install knowledge.",
    tags: ["module"],
  }, {
    node_ref: "entity/configure",
    title: "Configure",
    node_type: "entity",
    summary: "Configure knowledge.",
    tags: ["module"],
  }];
  const views = [{
    view_ref: `${TEST_COLLECTION}:entity/install`,
    node_ref: "entity/install",
    collection: TEST_COLLECTION,
    containment: "install",
    slug: "overview",
    title: "Install",
    node_type: "entity",
    path: `${TEST_COLLECTION}/install/overview.md`,
    summary: "Install knowledge.",
    sections: [{
      id: "install",
      section_ref: `${TEST_COLLECTION}:entity/install#install`,
      kind: "description",
      source_refs: secondaryInstallRef === undefined ? [ref] : [ref, secondaryInstallRef],
    }],
  }, {
    view_ref: `${TEST_COLLECTION}:entity/configure`,
    node_ref: "entity/configure",
    collection: TEST_COLLECTION,
    containment: "configure",
    slug: "overview",
    title: "Configure",
    node_type: "entity",
    path: `${TEST_COLLECTION}/configure/overview.md`,
    summary: "Configure knowledge.",
    sections: [{ id: "configure", section_ref: `${TEST_COLLECTION}:entity/configure#configure`, kind: "description", source_refs: [ref] }],
  }];
  const edges = [{
    type: "contains",
    from: "domain/product-docs",
    to: "entity/install",
    source_refs: [edgeRef ?? ref],
    note: "Product docs contains install knowledge.",
  }, {
    type: "prerequisite",
    from: "entity/install",
    to: "entity/configure",
    source_refs: [edgeRef ?? ref],
    note: "Install comes before configure.",
  }];
  mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
  writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify(confirmedStructure({
    projectRoot,
    nodes,
    views,
    edges,
  })), "utf8");
}

export async function stageConfirmedRichStructure(projectRoot: string, refs: readonly string[]): Promise<void> {
  const resolvedRefs = refs.length >= 4 ? refs : await sourceRefs(projectRoot);
  const [edgeRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 7, lineEnd: 7 }]);
  const nodes = [{
    node_ref: "domain/product-docs",
    title: "Product Docs",
    node_type: "domain",
    summary: "Product docs structure root.",
  }, {
    node_ref: "entity/install",
    title: "Install",
    node_type: "entity",
    summary: "Install workflow knowledge.",
    ownership: "Installation source spans.",
    tags: ["module"],
  }];
  const views = [{
    view_ref: `${TEST_COLLECTION}:entity/install`,
    node_ref: "entity/install",
    collection: TEST_COLLECTION,
    containment: "install",
    slug: "overview",
    title: "Install",
    node_type: "entity",
    path: `${TEST_COLLECTION}/install/overview.md`,
    summary: "Install workflow knowledge.",
    ownership: "Installation source spans.",
    sections: resolvedRefs.slice(0, 4).map((ref, index) => ({
      id: `install-${index + 1}`,
      section_ref: `${TEST_COLLECTION}:entity/install#install-${index + 1}`,
      kind: index === 2 ? "example" : "description",
      summary: `Install section ${index + 1}`,
      source_refs: [ref],
    })),
  }];
  mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
  writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify(confirmedStructure({
    projectRoot,
    nodes,
    views,
    edges: [{
      type: "contains",
      from: "domain/product-docs",
      to: "entity/install",
      source_refs: [edgeRef ?? resolvedRefs[0]!],
      note: "Product docs contains install knowledge.",
    }],
    hints: { grouping_notes: ["Keep setup concepts together when evidence supports it."] },
  })), "utf8");
}

export async function stageConfirmedParentIndexStructure(projectRoot: string, refs: readonly string[]): Promise<void> {
  const resolvedRefs = refs.length >= 4 ? refs : await sourceRefs(projectRoot);
  const parentRef = resolvedRefs[0]!;
  const firstChildDetailRef = resolvedRefs[1]!;
  const secondChildDetailRef = resolvedRefs[2]!;
  const secondChildRef = resolvedRefs[3]!;
  const [firstEdgeRef, secondEdgeRef] = await sourceRefsForRanges(projectRoot, [
    { lineStart: 7, lineEnd: 7 },
    { lineStart: 20, lineEnd: 20 },
  ]);
  const nodes = [{
    node_ref: "action/runbook",
    title: "Runbook",
    node_type: "action",
    summary: "Runbook parent index.",
    tags: ["runbook"],
  }, {
    node_ref: "action/runbook/install",
    title: "Install Steps",
    node_type: "action",
    summary: "Install steps.",
    tags: ["runbook"],
  }, {
    node_ref: "action/runbook/commands",
    title: "Command Steps",
    node_type: "action",
    summary: "Command steps.",
    tags: ["runbook"],
  }];
  const views = [{
    view_ref: `${TEST_COLLECTION}:action/runbook`,
    node_ref: "action/runbook",
    collection: TEST_COLLECTION,
    containment: "runbook",
    slug: "index",
    title: "Runbook",
    node_type: "action",
    generated: "parent_index",
    path: `${TEST_COLLECTION}/runbook/index.md`,
    summary: "Runbook parent index.",
    sections: [],
  }, {
    view_ref: `${TEST_COLLECTION}:action/runbook/install`,
    node_ref: "action/runbook/install",
    collection: TEST_COLLECTION,
    containment: "runbook",
    slug: "install",
    title: "Install Steps",
    node_type: "action",
    path: `${TEST_COLLECTION}/runbook/install.md`,
    summary: "Install steps.",
    sections: [{
      id: "install",
      section_ref: `${TEST_COLLECTION}:action/runbook/install#install`,
      kind: "description",
      summary: "Install steps.",
      source_refs: [parentRef],
    }, {
      id: "install-details",
      section_ref: `${TEST_COLLECTION}:action/runbook/install#install-details`,
      kind: "spec",
      summary: "Install details.",
      source_refs: [firstChildDetailRef],
    }],
  }, {
    view_ref: `${TEST_COLLECTION}:action/runbook/commands`,
    node_ref: "action/runbook/commands",
    collection: TEST_COLLECTION,
    containment: "runbook",
    slug: "commands",
    title: "Command Steps",
    node_type: "action",
    path: `${TEST_COLLECTION}/runbook/commands.md`,
    summary: "Command steps.",
    sections: [{
      id: "commands",
      section_ref: `${TEST_COLLECTION}:action/runbook/commands#commands`,
      kind: "spec",
      summary: "Command steps.",
      source_refs: [secondChildRef],
    }, {
      id: "command-context",
      section_ref: `${TEST_COLLECTION}:action/runbook/commands#command-context`,
      kind: "description",
      summary: "Command context.",
      source_refs: [secondChildDetailRef],
    }],
  }];
  const edges = [{
    type: "contains",
    from: `${TEST_COLLECTION}:action/runbook`,
    to: `${TEST_COLLECTION}:action/runbook/install`,
    source_refs: [firstEdgeRef ?? parentRef],
  }, {
    type: "contains",
    from: `${TEST_COLLECTION}:action/runbook`,
    to: `${TEST_COLLECTION}:action/runbook/commands`,
    source_refs: [secondEdgeRef ?? secondChildRef],
  }];
  mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
  writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify(confirmedStructure({
    projectRoot,
    nodes,
    views,
    edges,
  })), "utf8");
}

export async function multiCollectionStructurePayload(projectRoot: string, refs: readonly string[]): Promise<Record<string, unknown>> {
  const resolvedRefs = refs.length >= 4 ? refs : await sourceRefs(projectRoot);
  const overviewRef = resolvedRefs[0]!;
  const decisionRef = resolvedRefs[1]!;
  const runbookContextRef = resolvedRefs[2]!;
  const commandRef = resolvedRefs[3]!;
  const [decisionEdgeRef, commandEdgeRef] = await sourceRefsForRanges(projectRoot, [
    { lineStart: 12, lineEnd: 12 },
    { lineStart: 20, lineEnd: 20 },
  ]);
  const nodes = [{
    node_ref: "entity/install",
    title: "Install",
    node_type: "entity",
    summary: "Install architecture and decision knowledge.",
    tags: ["module"],
  }, {
    node_ref: "action/install-runbook",
    title: "Install Runbook",
    node_type: "action",
    summary: "Install runbook steps.",
    tags: ["runbook"],
  }];
  const views = [{
    view_ref: "architecture:entity/install",
    node_ref: "entity/install",
    collection: "architecture",
    containment: "install",
    slug: "overview",
    title: "Install Architecture",
    node_type: "entity",
    path: "architecture/install/overview.md",
    summary: "Install architecture view.",
    sections: [{
      id: "overview",
      section_ref: "architecture:entity/install#overview",
      kind: "description",
      summary: "Install architecture overview.",
      source_refs: [overviewRef],
    }],
  }, {
    view_ref: "decision:entity/install",
    node_ref: "entity/install",
    collection: "decision",
    containment: "install",
    slug: "choice",
    title: "Install Decision",
    node_type: "entity",
    path: "decision/install/choice.md",
    summary: "Install decision view.",
    sections: [{
      id: "choice",
      section_ref: "decision:entity/install#choice",
      kind: "decision",
      summary: "Install decision rationale.",
      source_refs: [decisionRef],
    }],
  }, {
    view_ref: "sop:action/install-runbook",
    node_ref: "action/install-runbook",
    collection: "sop",
    containment: "install",
    slug: "runbook",
    title: "Install Runbook",
    node_type: "action",
    path: "sop/install/runbook.md",
    summary: "Install runbook.",
    sections: [{
      id: "commands",
      section_ref: "sop:action/install-runbook#commands",
      kind: "spec",
      summary: "Install commands.",
      source_refs: [commandRef],
    }, {
      id: "runbook-context",
      section_ref: "sop:action/install-runbook#runbook-context",
      kind: "description",
      summary: "Install runbook context.",
      source_refs: [runbookContextRef],
    }],
  }];
  const edges = [{
    type: "contains",
    from: "entity/install",
    to: "action/install-runbook",
    source_refs: [commandEdgeRef ?? commandRef],
    note: "Install knowledge contains the runbook view.",
  }, {
    type: "supersedes",
    from: "decision:entity/install#choice",
    to: "architecture:entity/install",
    source_refs: [decisionEdgeRef ?? decisionRef],
    note: "Decision view qualifies the architecture view.",
  }, {
    type: "applies_to",
    from: "sop:action/install-runbook",
    to: "architecture:entity/install",
    source_refs: [commandEdgeRef ?? commandRef],
    note: "Runbook applies to the architecture install view.",
  }];
  return confirmedStructure({
    projectRoot,
    nodes,
    views,
    edges,
  });
}

export async function stageConfirmedMultiCollectionStructure(projectRoot: string, refs: readonly string[]): Promise<void> {
  mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
  writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify(await multiCollectionStructurePayload(projectRoot, refs)), "utf8");
}

export function writeYaml(projectRoot: string, name: string, value: unknown): string {
  const path = join(projectRoot, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, YAML.stringify(value), "utf8");
  return path;
}

function reviewCandidateIdsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
}

function draftCandidateIdsForReviewScope(projectRoot: string, collection?: string): string[] {
  const ledgerPath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
  const ledger = readFileSync(ledgerPath, "utf8");
  const ids: string[] = [];
  for (const line of ledger.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const row = JSON.parse(line) as {
      candidate_id?: unknown;
      collection?: unknown;
      status?: unknown;
    };
    if (row.status !== "draft") continue;
    if (collection !== undefined && row.collection !== collection) continue;
    if (typeof row.candidate_id === "string" && row.candidate_id.length > 0) {
      ids.push(row.candidate_id);
    }
  }
  return ids.sort();
}

function reviewScopeForHeader(projectRoot: string, header: Record<string, unknown>): Record<string, unknown> {
  const collection = typeof header.collection === "string" && header.collection.length > 0
    ? header.collection
    : undefined;
  const ids = draftCandidateIdsForReviewScope(projectRoot, collection);
  return {
    kind: collection === undefined ? "all" : "collection",
    ...(collection === undefined ? {} : { collection }),
    count: ids.length,
    ids_sha256: reviewCandidateIdsHash(ids),
    visible_candidate_ids: ids,
  };
}

function withReviewScope(projectRoot: string, row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const record = row as Record<string, unknown>;
  if (record.schema !== "context.review.decisions.v1" || record.scope !== undefined) return row;
  return {
    ...record,
    scope: reviewScopeForHeader(projectRoot, record),
  };
}

export function writeJsonl(projectRoot: string, name: string, rows: readonly unknown[]): string {
  const path = join(projectRoot, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(withReviewScope(projectRoot, row))).join("\n") + "\n", "utf8");
  return path;
}

function sectionBodies(markdown: string): string[] {
  const bodies: string[] = [];
  const regex = /<!--\s*context:section\b[\s\S]*?-->([\s\S]*?)(?:<!--\s*\/context:section\s*-->|$)/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const body = (match[1] ?? "")
      .replace(/<!--\s*context:source_refs\s*[\s\S]*?\/context:source_refs\s*-->/giu, "")
      .replace(/<!--\s*context:audit\s*[\s\S]*?\/context:audit\s*-->/giu, "")
      .replace(/<!--\s*context:summary\s*[\s\S]*?\/context:summary\s*-->/giu, "")
      .replace(/<!--\s*context:summary\s*-->\s*[\s\S]*?<!--\s*\/context:summary\s*-->/giu, "")
      .trim();
    if (body.length > 0) bodies.push(body);
  }
  return bodies;
}

export function extractSectionBodyList(markdown: string): string[] {
  return sectionBodies(markdown);
}

export function extractSectionBodies(markdown: string): string {
  return sectionBodies(markdown).join("\n\n");
}
