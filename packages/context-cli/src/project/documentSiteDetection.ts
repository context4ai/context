import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { PhaseDefinition } from "@c4a/context";
import type { DocumentSnapshotManifest } from "@c4a/extract";

const SKIPPED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".tmp",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const ROUTE_METADATA_FILES = new Set(["_meta.json"]);
const DOC_SITE_CONFIG_FILES = new Set([
  "docusaurus.config.js",
  "docusaurus.config.mjs",
  "docusaurus.config.ts",
  "sidebars.js",
  "sidebars.mjs",
  "sidebars.ts",
  "vitepress.config.js",
  "vitepress.config.mjs",
  "vitepress.config.ts",
]);
const DOC_SITE_CONFIG_DIRS = new Set([".vitepress"]);
const MAX_SCAN_ENTRIES = 2000;

export interface DocumentSiteDetection {
  detected: boolean;
  mdxFiles: string[];
  routeMetadataFiles: string[];
  configFiles: string[];
  scannedEntryCount: number;
  truncated: boolean;
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).filter((part) => part.length > 0).join("/");
}

function emptyDetection(): DocumentSiteDetection {
  return {
    detected: false,
    mdxFiles: [],
    routeMetadataFiles: [],
    configFiles: [],
    scannedEntryCount: 0,
    truncated: false,
  };
}

function pushExample(target: string[], value: string): void {
  if (target.length < 5) target.push(value);
}

export async function detectDocumentSiteFiles(input: {
  projectRoot: string;
  local?: string | undefined;
}): Promise<DocumentSiteDetection> {
  if (input.local === undefined || input.local.trim().length === 0) return emptyDetection();
  const localRoot = resolve(input.projectRoot, input.local);
  const result = emptyDetection();
  let rootStats;
  try {
    rootStats = await stat(localRoot);
  } catch {
    return result;
  }
  const visitFile = (absolutePath: string, root: string): void => {
    const relPath = toPosixPath(relative(root, absolutePath)) || basename(absolutePath);
    const name = basename(relPath).toLowerCase();
    const extension = extname(name);
    if (extension === ".mdx") pushExample(result.mdxFiles, relPath);
    if (ROUTE_METADATA_FILES.has(name)) pushExample(result.routeMetadataFiles, relPath);
    if (DOC_SITE_CONFIG_FILES.has(name)) pushExample(result.configFiles, relPath);
  };
  if (rootStats.isFile()) {
    visitFile(localRoot, localRoot);
    result.scannedEntryCount = 1;
    result.detected = result.mdxFiles.length > 0 ||
      result.routeMetadataFiles.length > 0 ||
      result.configFiles.length > 0;
    return result;
  }
  if (!rootStats.isDirectory()) return result;
  const visitDir = async (dir: string): Promise<void> => {
    if (result.truncated) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (result.scannedEntryCount >= MAX_SCAN_ENTRIES) {
        result.truncated = true;
        return;
      }
      result.scannedEntryCount += 1;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (SKIPPED_DIRS.has(lower)) continue;
        if (DOC_SITE_CONFIG_DIRS.has(lower)) {
          pushExample(result.configFiles, toPosixPath(relative(localRoot, absolutePath)));
        }
        await visitDir(absolutePath);
        continue;
      }
      if (entry.isFile()) visitFile(absolutePath, localRoot);
    }
  };
  await visitDir(localRoot);
  result.detected = result.mdxFiles.length > 0 ||
    result.routeMetadataFiles.length > 0 ||
    result.configFiles.length > 0;
  return result;
}

export function manifestUsesMdxJsonDocs(manifest: DocumentSnapshotManifest): boolean {
  const capture = manifest.metadata?.capture;
  return Boolean(
    capture?.documentExtensions?.some((extension) => extension.toLowerCase() === ".mdx") ||
    (capture?.routeFiles?.length ?? 0) > 0 ||
    (capture?.routeHints?.length ?? 0) > 0,
  );
}

function capturePhaseSourceIds(phase: Extract<PhaseDefinition, { kind: "phase.capture.file" }>): string[] {
  const ids: string[] = [];
  if (phase.id.startsWith("capture:file:")) ids.push(phase.id.slice("capture:file:".length));
  const source = phase.source as Record<string, unknown>;
  if (typeof source.id === "string") ids.push(source.id);
  if (typeof source.name === "string") ids.push(source.name);
  return Array.from(new Set(ids));
}

export function projectUsesMdxJsonDocsForSource(input: {
  phases: readonly PhaseDefinition[];
  source: { id?: string; name: string };
}): boolean {
  const sourceIds = new Set([input.source.name, input.source.id].filter((value): value is string => value !== undefined));
  return input.phases.some((phase) => {
    if (phase.kind !== "phase.capture.file") return false;
    if (!capturePhaseSourceIds(phase).some((id) => sourceIds.has(id))) return false;
    return phase.processors?.some((processor) => processor.kind === "file.capture.processor.mdx-json-docs") ?? false;
  });
}

export function documentSiteConfigHint(input: {
  sourceName: string;
  detection: DocumentSiteDetection;
  processorConfigured?: boolean | undefined;
  snapshotConfigured?: boolean | undefined;
}): string | null {
  if (!input.detection.detected) return null;
  if (input.processorConfigured === true || input.snapshotConfigured === true) return null;
  const examples = [
    ...input.detection.mdxFiles.map((path) => `.mdx:${path}`),
    ...input.detection.routeMetadataFiles.map((path) => `route:${path}`),
    ...input.detection.configFiles.map((path) => `config:${path}`),
  ].slice(0, 5);
  return [
    `document-site-processor-not-configured:${input.sourceName}`,
    examples.length > 0 ? `Detected examples: ${examples.join(", ")}` : undefined,
    input.detection.truncated ? "detection-truncated" : undefined,
  ].filter((line): line is string => line !== undefined).join(" ");
}
