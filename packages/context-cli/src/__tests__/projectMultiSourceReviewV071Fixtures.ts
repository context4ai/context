import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import YAML from "yaml";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";
import { initContextProject } from "../project/workspace.js";
import {
  runCliInDir,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

export const COLLECTION = "architecture";
export const SOURCE_NAMES = ["source-a", "source-b"] as const;
const SOURCE_TEXT = "# Reference\n\nStable source paragraph.\n";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export async function createProject(root: string): Promise<string> {
  for (const sourceName of SOURCE_NAMES) {
    const docs = join(root, sourceName);
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "reference.md"), SOURCE_TEXT, "utf8");
  }
  const initialized = await initContextProject({ cwd: root, projectDir: "kb", name: "multi-source", dev: true });
  const projectRoot = initialized.projectRoot;
  writeFileSync(join(projectRoot, "src", "index.ts"), [
    'import { alignProse, captureFile, compileProse, defineProject, reviewValidity, source } from "@c4a/context";',
    "",
    'const sourceA = source("source-a");',
    'const sourceB = source("source-b");',
    "",
    "export default defineProject({",
    "  sources: [sourceA, sourceB],",
    "  phases: [",
    "    captureFile({ source: sourceA }),",
    "    captureFile({ source: sourceB }),",
    `    alignProse({ source: sourceA, collection: "${COLLECTION}" }),`,
    `    alignProse({ source: sourceB, collection: "${COLLECTION}" }),`,
    `    compileProse({ source: sourceA, collection: "${COLLECTION}" }),`,
    `    compileProse({ source: sourceB, collection: "${COLLECTION}" }),`,
    '    reviewValidity({ scope: "all" }),',
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
  mkdirSync(join(projectRoot, "sources", "file"), { recursive: true });
  writeFileSync(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
    sources: SOURCE_NAMES.map((sourceName) => ({
      name: sourceName,
      local: `../${sourceName}`,
      include: ["reference.md"],
      snapshot: { manifest: `sources/file/${sourceName}/manifest.json` },
    })),
  }), "utf8");
  for (const sourceName of SOURCE_NAMES) {
    await runCliInDir(projectRoot, ["run", `capture:file:${sourceName}`, "--format", "json"]);
  }
  return projectRoot;
}

export function stageStructure(projectRoot: string, sourceName: string, revision = "initial"): string {
  const markdown = readFileSync(join(projectRoot, "sources", "file", sourceName, "reference.md"), "utf8");
  const sourceRef = `file:${sourceName}/reference.md${formatSpanSourceRef(createDocumentSourceSpan(markdown, {
    lineStart: 3,
    lineEnd: 3,
  }))}`;
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, "sources", "file", sourceName, "manifest.json"),
    "utf8",
  )) as { snapshot_hash: string };
  const nodeRef = `entity/${sourceName}`;
  const viewRef = `${COLLECTION}:${nodeRef}`;
  const body = {
    schema_version: "context.structure.v1",
    sources: [`file:${sourceName}`],
    nodes: [{
      node_ref: nodeRef,
      title: sourceName,
      node_type: "entity",
      summary: `Independent source knowledge (${revision}).`,
      tags: ["module"],
    }],
    views: [{
      view_ref: viewRef,
      node_ref: nodeRef,
      collection: COLLECTION,
      containment: sourceName,
      slug: "overview",
      title: sourceName,
      node_type: "entity",
      path: `${COLLECTION}/${sourceName}/overview.md`,
      summary: `Independent source knowledge (${revision}).`,
      sections: [{
        id: "overview",
        section_ref: `${viewRef}#overview`,
        kind: "description",
        source_refs: [sourceRef],
      }],
    }],
    edges: [],
    unresolved: [],
    evidence_snapshot_hash: manifest.snapshot_hash,
  };
  const structurePath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml");
  mkdirSync(dirname(structurePath), { recursive: true });
  writeFileSync(structurePath, YAML.stringify({
    ...body,
    lifecycle: {
      state: "confirmed",
      confirmed_by: "human",
      confirmed_at: "2026-01-01T00:00:00Z",
      structure_digest: digest(body),
    },
  }), "utf8");
  return viewRef;
}

export function writeDraftStructure(projectRoot: string, sourceName: string): string {
  const markdown = readFileSync(join(projectRoot, "sources", "file", sourceName, "reference.md"), "utf8");
  const sourceRef = `file:${sourceName}/reference.md${formatSpanSourceRef(createDocumentSourceSpan(markdown, {
    lineStart: 3,
    lineEnd: 3,
  }))}`;
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, "sources", "file", sourceName, "manifest.json"),
    "utf8",
  )) as { snapshot_hash: string };
  const nodeRef = `entity/${sourceName}`;
  const viewRef = `${COLLECTION}:${nodeRef}`;
  return writeYaml(projectRoot, `${sourceName}-structure.yaml`, {
    schema_version: "context.structure.v1",
    sources: [`file:${sourceName}`],
    nodes: [{
      node_ref: nodeRef,
      title: sourceName,
      node_type: "entity",
      summary: "Independent source knowledge.",
      tags: ["module"],
    }],
    views: [{
      view_ref: viewRef,
      node_ref: nodeRef,
      collection: COLLECTION,
      containment: sourceName,
      slug: "overview",
      title: sourceName,
      node_type: "entity",
      path: `${COLLECTION}/${sourceName}/overview.md`,
      summary: "Independent source knowledge.",
      sections: [{
        id: "overview",
        section_ref: `${viewRef}#overview`,
        kind: "description",
        source_refs: [sourceRef],
      }],
    }],
    edges: [],
    unresolved: [],
    evidence_snapshot_hash: manifest.snapshot_hash,
    lifecycle: { state: "draft" },
  });
}

export async function compileView(
  projectRoot: string,
  sourceName: string,
  viewRef: string,
  operation: "add" | "update" = "add",
): Promise<void> {
  const context = JSON.parse(await runCliInDir(projectRoot, [
    "run",
    `compile:file:${sourceName}:${COLLECTION}`,
    "--view",
    "node-context",
    "--source",
    viewRef,
    "--format",
    "json",
  ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
  const actionFile = writeYaml(projectRoot, `${sourceName}-actions.yaml`, {
    schema_version: "context.compile-actions.v1",
    view_ref: viewRef,
    actions: [{
      op: operation,
      section_id: "overview",
      kind: "description",
      summary: "Source-backed overview.",
      source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
    }],
  });
  await runCliInDir(projectRoot, [
    "run",
    `compile:file:${sourceName}:${COLLECTION}`,
    "--stage",
    "--input",
    actionFile,
    "--format",
    "json",
  ]);
}

export function writeApprovedPage(
  projectRoot: string,
  sourceName: string,
  slug: string,
  collection = COLLECTION,
): void {
  const nodeRef = `entity/${sourceName}/${slug}`;
  const viewRef = `${collection}:${nodeRef}`;
  const markdown = readFileSync(join(projectRoot, "sources", "file", sourceName, "reference.md"), "utf8");
  const canonicalSourceRef = `file:${sourceName}/reference.md${formatSpanSourceRef(createDocumentSourceSpan(markdown, {
    lineStart: 3,
    lineEnd: 3,
  }))}`;
  const localSourceRef = canonicalSourceRef.replace(`file:${sourceName}/reference.md`, "src-1");
  const dir = join(projectRoot, "knowledge", collection, sourceName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), [
    "---",
    `title: ${sourceName} ${slug}`,
    "type: Guide",
    `description: ${sourceName} ${slug} source span.`,
    "tags:",
    "  - module",
    "timestamp: 2026-01-01T00:00:00Z",
    `resource: file:${sourceName}/reference.md`,
    `node_ref: ${nodeRef}`,
    `view_ref: ${viewRef}`,
    "node_type: entity",
    "sources:",
    `  - file:${sourceName}/reference.md`,
    "---",
    "",
    `<!-- context:section id="overview" kind="description" source_ref="${localSourceRef}" content_mode="verbatim" -->`,
    "",
    "Stable source paragraph.",
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
}

export async function writeEdgeSnapshot(projectRoot: string, sourceName: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(
    join(projectRoot, "sources", "file", sourceName, "manifest.json"),
    "utf8",
  )) as { snapshot_hash: string };
  const sourceRef = `file:${sourceName}/reference.md#span:reference L1-3@abcdef123456`;
  const nodes = (["parent", "child"] as const).map((slug) => ({
    node_ref: `entity/${sourceName}/${slug}`,
    title: `${sourceName} ${slug}`,
    node_type: "entity" as const,
    tags: ["module"],
  }));
  const views = (["parent", "child"] as const).map((slug) => ({
    view_ref: `${COLLECTION}:entity/${sourceName}/${slug}`,
    node_ref: `entity/${sourceName}/${slug}`,
    collection: COLLECTION,
    containment: sourceName,
    slug,
    title: `${sourceName} ${slug}`,
    node_type: "entity" as const,
    path: `${COLLECTION}/${sourceName}/${slug}.md`,
    summary: `${slug} view`,
    sections: [],
  }));
  const edges = [{
    type: "contains" as const,
    from: views[0]!.view_ref,
    to: views[1]!.view_ref,
    source_refs: [sourceRef],
  }];
  const body = {
    schema_version: "context.structure.v1" as const,
    sources: [`file:${sourceName}`],
    evidence_snapshot_hash: manifest.snapshot_hash,
    nodes,
    views,
    edges,
    unresolved: [],
  };
  await writeStructureSnapshot(projectRoot, {
    ...body,
    lifecycle: {
      state: "confirmed",
      confirmed_by: "human",
      confirmed_at: "2026-01-01T00:00:00Z",
      structure_digest: digest(body),
    },
    payload_digest: digest({ sourceName }),
    structure_digest: digest(body),
  } as AlignPayload);
}
