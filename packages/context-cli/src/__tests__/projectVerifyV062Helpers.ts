import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { createDocumentSnapshotManifest } from "@c4a/extract";
import YAML from "yaml";
import {
  renderDocumentManifestFile,
  updateDocumentManifestFile,
} from "../project/documentBatchManifest.js";
import { isKnowledgeCollection, okfTypeForCollection } from "../project/okfTypes.js";

export async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "context-cli-v062-"));
}

export async function writeFileRegistry(
  projectRoot: string,
  name = "docs",
  manifestPath?: string,
): Promise<void> {
  await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
    sources: [{
      name,
      ...(manifestPath !== undefined ? { snapshot: { manifest: manifestPath } } : {}),
    }],
  }), "utf8");
}

export async function writeLarkRegistry(
  projectRoot: string,
  name = "handbook",
  manifestPath?: string,
): Promise<void> {
  await mkdir(join(projectRoot, "sources", "lark"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "lark", "index.yaml"), YAML.stringify({
    sources: [{
      name,
      url: `https://example.larksuite.com/wiki/${name}`,
      ...(manifestPath !== undefined ? { snapshot: { manifest: manifestPath } } : {}),
    }],
  }), "utf8");
}

export async function writeSnapshot(input: {
  projectRoot: string;
  sourceType: "file" | "lark";
  sourceName: string;
  files: Array<{ path: string; bytes: string; title?: string }>;
}): Promise<void> {
  const [batch, module, ...rest] = input.sourceName.split("/");
  const batched = module !== undefined && rest.length === 0 && /^\d{8}$/u.test(batch ?? "");
  const root = join(input.projectRoot, "sources", input.sourceType, batched ? batch! : input.sourceName);
  const files = batched
    ? input.files.map((file, index) => ({
        ...file,
        path: input.files.length === 1
          ? `${module}${extname(file.path) || ".md"}`
          : `${module}--${index + 1}${extname(file.path) || ".md"}`,
      }))
    : input.files;
  await mkdir(root, { recursive: true });
  for (const file of files) {
    const filePath = join(root, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.bytes, "utf8");
  }
  const manifest = createDocumentSnapshotManifest({
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    capturedAt: "2026-06-23T00:00:00.000Z",
    files,
    ...(input.sourceType === "lark" ? {
      metadata: {
        source: {
          url: `https://example.larksuite.com/wiki/${input.sourceName}`,
        },
      },
    } : {}),
  });
  const manifestPath = join(root, "manifest.json");
  let current: unknown | null = null;
  try {
    current = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await writeFile(manifestPath, renderDocumentManifestFile(updateDocumentManifestFile({ current, snapshot: manifest })), "utf8");
}

function sourceRefsBlock(refs: readonly string[]): string[] {
  return refs.length <= 1
    ? []
    : ["", `<!-- context:source_refs ${JSON.stringify(refs, null, 2)} /context:source_refs -->`];
}

function sectionAttributes(input: {
  sourceRef: string;
  contentMode?: string;
  body: string;
}): string {
  if (!input.sourceRef.includes("#span:")) return ` source_ref="${input.sourceRef}"`;
  const mode = input.contentMode ?? "verbatim";
  const attrs = [`source_ref="${input.sourceRef}"`, `content_mode="${mode}"`];
  return ` ${attrs.join(" ")}`;
}

export async function writeApproved(input: {
  projectRoot: string;
  sources: string[];
  sourceRef: string;
  body?: string;
  collection?: string;
  contentMode?: string;
  extraFrontmatter?: Record<string, unknown>;
}): Promise<void> {
  const body = input.body ?? "File evidence text.";
  const collection = input.collection ?? "architecture";
  if (!isKnowledgeCollection(collection)) throw new Error(`unsupported test collection: ${collection}`);
  const nodeRef = "entity/overview";
  const refs = [input.sourceRef];
  const frontmatter = {
    title: "Overview",
    type: okfTypeForCollection(collection),
    node_ref: nodeRef,
    view_ref: `${collection}:${nodeRef}`,
    node_type: "entity",
    description: "Approved test page.",
    tags: ["docs"],
    timestamp: "2026-06-23T00:00:00.000Z",
    resource: input.sources[0] ?? "context://test",
    sources: input.sources,
    ...input.extraFrontmatter,
  };
  const content = [
    "---",
    YAML.stringify(frontmatter).trimEnd(),
    "---",
    "",
    "# Overview",
    "",
    `<!-- context:section id="section-1" kind="description"${sectionAttributes({
      sourceRef: input.sourceRef,
      ...(input.contentMode !== undefined ? { contentMode: input.contentMode } : {}),
      body,
    })} -->`,
    ...sourceRefsBlock(refs),
    "",
    body,
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n");
  const path = join(input.projectRoot, "knowledge", collection, "entity", "overview.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export function stableDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
