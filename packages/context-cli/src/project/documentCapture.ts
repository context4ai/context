import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { CaptureFilePhaseDefinition, FileSourceRegistryEntry } from "@c4a/context";
import {
  createDocumentSnapshotManifest,
  normalizeMarkdownDocument,
  normalizeSnapshotRelativePath,
  type DocumentSnapshotManifest,
  type DocumentSnapshotFileInput,
} from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  fileSnapshotLinkedAssetMismatchDiagnostic,
  readLinkedCaptureAssets,
  writeCaptureAssetIfChanged,
} from "./documentCaptureAssets.js";
import { MDX_COMPONENT_EVIDENCE_DOCUMENT_PATH, renderMdxComponentEvidence, type MdxSourceFile } from "./documentMdxEvidence.js";
import { readRouteMetadataFiles, routeEvidenceSnapshot, routeForDocument, type RouteHint } from "./documentCaptureRoutes.js";
import { detectDocumentSiteFiles, documentSiteConfigHint } from "./documentSiteDetection.js";
import { documentSourceAddCommand, resolveDocumentPhaseSource } from "./documentRun.js";
import {
  findDocumentSnapshotForSource,
  readDocumentManifestFile,
  renderDocumentManifestFile,
  updateDocumentManifestFile,
} from "./documentBatchManifest.js";
import {
  workspaceRouteReevaluation,
  type WorkspaceRouteReevaluation,
} from "./workflow/workflowReceipt.js";
import { withProjectWriteLock } from "./writeLock.js";

export const DEFAULT_FILE_SOURCE_INCLUDE = ["**/*.md"] as const;

const DEFAULT_DOCUMENT_FILE_EXTENSIONS = [".md"] as const;

interface SourceCaptureFile {
  absolutePath: string;
  sourcePath: string;
  snapshotPath: string;
}

export interface CaptureFileRunResult {
  kind: "document.capture.file.result";
  source: {
    type: "file";
    name: string;
    local: string;
    include: readonly string[];
  };
  snapshot: {
    manifest: string;
    materializedAt: string;
    snapshot_hash: string;
    changed: boolean;
  };
  documents: Array<{
    path: string;
    title: string;
    line_count: number;
    route?: string;
    empty?: boolean;
  }>;
  metadata_files?: Array<{
    path: string;
    routes: string[];
  }>;
  diagnostics: string[];
  next_action: WorkspaceRouteReevaluation;
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).filter((part) => part.length > 0).join("/");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      const after = glob[index + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegex(char ?? "");
  }
  source += "$";
  return new RegExp(source, "u");
}

function includePatternMatches(path: string, include: readonly string[]): boolean {
  return include.some((pattern) => globToRegExp(pattern).test(path));
}

function isConfiguredDocumentFile(path: string, extensions: readonly string[]): boolean {
  const extension = extname(path).toLowerCase();
  return extensions.some((candidate) => candidate.toLowerCase() === extension);
}

function isRouteMetadataFile(path: string, routeMetadataFile?: string): boolean {
  return routeMetadataFile !== undefined && basename(path).toLowerCase() === routeMetadataFile.toLowerCase();
}

function matchesDocumentInclude(path: string, include: readonly string[], extensions: readonly string[]): boolean {
  return isConfiguredDocumentFile(path, extensions) && includePatternMatches(path, include);
}

function matchesMetadataInclude(path: string, include: readonly string[], routeMetadataFile?: string): boolean {
  return isRouteMetadataFile(path, routeMetadataFile) && includePatternMatches(path, include);
}

function titleFromMarkdown(markdown: string, fallbackPath: string): string {
  const heading = markdown.split("\n").find((line) => /^#\s+\S/u.test(line));
  if (heading !== undefined) {
    return heading.replace(/^#\s+/u, "").replace(/\s+#*\s*$/u, "").trim();
  }
  return basename(fallbackPath, extname(fallbackPath));
}

function countLines(markdown: string): number {
  if (markdown.length === 0) return 0;
  return markdown.endsWith("\n") ? markdown.split("\n").length - 1 : markdown.split("\n").length;
}

function shortPathHash(path: string, length: number): string {
  return createHash("sha256").update(path).digest("hex").slice(0, length);
}

function uniqueFlatSnapshotPath(sourcePath: string, used: Set<string>): string {
  const normalized = normalizeSnapshotRelativePath(sourcePath);
  const fileName = basename(normalized);
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const extension = extname(fileName);
  const stem = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
  for (const hashLength of [8, 12, 16, 24, 32]) {
    const candidate = `${stem}-${shortPathHash(normalized, hashLength)}${extension}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new TypeError(`unable to assign unique flat snapshot path for ${sourcePath}`);
}

function assignFlatSnapshotPaths(files: readonly SourceCaptureFile[], module?: string): SourceCaptureFile[] {
  const used = new Set<string>();
  const flattened = files.map((file) => ({
    ...file,
    snapshotPath: uniqueFlatSnapshotPath(file.sourcePath, used),
  }));
  if (module === undefined) return flattened;
  return flattened.map((file) => {
    const extension = extname(file.snapshotPath);
    const snapshotPath = flattened.length === 1
      ? `${module}${extension}`
      : `${module}--${file.snapshotPath}`;
    return { ...file, snapshotPath };
  });
}

async function walkMarkdownFiles(input: {
  localRoot: string;
  include: readonly string[];
  documentExtensions: readonly string[];
  routeMetadataFile?: string;
}): Promise<{
  documents: SourceCaptureFile[];
  metadata: SourceCaptureFile[];
}> {
  const rootStat = await stat(input.localRoot);
  if (rootStat.isFile()) {
    const sourcePath = normalizeSnapshotRelativePath(basename(input.localRoot));
    return {
      documents: matchesDocumentInclude(sourcePath, input.include, input.documentExtensions)
        ? [{ absolutePath: input.localRoot, sourcePath, snapshotPath: sourcePath }]
        : [],
      metadata: matchesMetadataInclude(sourcePath, input.include, input.routeMetadataFile)
        ? [{ absolutePath: input.localRoot, sourcePath, snapshotPath: sourcePath }]
        : [],
    };
  }
  if (!rootStat.isDirectory()) {
    throw new ContextError(ExitCode.UserError, `file source local path is not a file or directory: ${input.localRoot}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Update the file source local path with context source add file <source-name> --local <path>",
    });
  }

  const documents: SourceCaptureFile[] = [];
  const metadata: SourceCaptureFile[] = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const sourcePath = normalizeSnapshotRelativePath(toPosixPath(relative(input.localRoot, absolutePath)));
      if (matchesDocumentInclude(sourcePath, input.include, input.documentExtensions)) {
        documents.push({ absolutePath, sourcePath, snapshotPath: sourcePath });
      } else if (matchesMetadataInclude(sourcePath, input.include, input.routeMetadataFile)) {
        metadata.push({ absolutePath, sourcePath, snapshotPath: sourcePath });
      }
    }
  };
  await visit(input.localRoot);
  documents.sort((left, right) => left.snapshotPath.localeCompare(right.snapshotPath));
  metadata.sort((left, right) => left.snapshotPath.localeCompare(right.snapshotPath));
  return { documents, metadata };
}

async function writeTextIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, "utf8") === content) return;
  } catch {
    // Missing or unreadable target will be overwritten below.
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function sourceManifestPath(entry: FileSourceRegistryEntry): string {
  return entry.snapshot?.manifest ?? join(entry.materializedAt, "manifest.json");
}

function runtimeError(message: string, detail: Record<string, unknown>): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

export function normalizeFileSourceIncludeForSnapshot(include: readonly string[]): string[] {
  return Array.from(new Set(include)).sort((left, right) => left.localeCompare(right));
}

export function fileSourceIncludeMismatchDiagnostic(input: {
  manifest: DocumentSnapshotManifest;
  source: FileSourceRegistryEntry;
  projectRoot?: string;
  materializedAt?: string;
}): string | null {
  if (input.source.include !== undefined) {
    const currentInclude = normalizeFileSourceIncludeForSnapshot(input.source.include);
    const capturedInclude = input.manifest.metadata?.capture?.include;
    if (capturedInclude === undefined) {
      return "snapshot capture include metadata is missing for explicit registry include";
    }
    const normalizedCaptured = normalizeFileSourceIncludeForSnapshot(capturedInclude);
    if (normalizedCaptured.length !== currentInclude.length ||
      normalizedCaptured.some((pattern, index) => pattern !== currentInclude[index])) {
      return `snapshot include is stale: captured ${normalizedCaptured.join(", ")}; registry ${currentInclude.join(", ")}`;
    }
  }
  if (input.projectRoot !== undefined && input.materializedAt !== undefined) {
    return fileSnapshotLinkedAssetMismatchDiagnostic({
      projectRoot: input.projectRoot,
      materializedAt: input.materializedAt,
      manifest: input.manifest,
    });
  }
  return null;
}

function normalizeDocumentExtensions(extensions: readonly string[]): string[] {
  return Array.from(new Set(extensions.map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  ))).sort((left, right) => left.localeCompare(right));
}

function captureRulesForPhase(input: {
  phase: CaptureFilePhaseDefinition;
  source: FileSourceRegistryEntry;
}): {
  include: readonly string[];
  documentExtensions: readonly string[];
  routeMetadataFile?: string;
} {
  const mdxJson = input.phase.processors?.find((processor) => processor.kind === "file.capture.processor.mdx-json-docs");
  const routeMetadataFile = mdxJson?.routeMetadataFile ?? (mdxJson !== undefined ? "_meta.json" : undefined);
  const include = input.source.include ?? mdxJson?.include ?? (
    routeMetadataFile !== undefined ? ["**/*.md", "**/*.mdx", `**/${routeMetadataFile}`] : DEFAULT_FILE_SOURCE_INCLUDE
  );
  const documentExtensions = normalizeDocumentExtensions(mdxJson?.documentExtensions ?? (
    mdxJson !== undefined ? [".md", ".mdx"] : DEFAULT_DOCUMENT_FILE_EXTENSIONS
  ));
  return {
    include,
    documentExtensions,
    ...(routeMetadataFile !== undefined ? { routeMetadataFile } : {}),
  };
}

function phaseUsesMdxJsonDocs(phase: CaptureFilePhaseDefinition): boolean {
  return phase.processors?.some((processor) => processor.kind === "file.capture.processor.mdx-json-docs") ?? false;
}

function assertFileSnapshotMaterializedAt(source: FileSourceRegistryEntry): void {
  const { materializedAt, name: sourceName } = source;
  const normalized = toPosixPath(materializedAt);
  const base = `sources/file/${source.namespace ?? sourceName}`;
  if (normalized === base || normalized.startsWith(`${base}/`)) return;
  throw runtimeError(`file source ${sourceName} has invalid snapshot materializedAt: ${materializedAt}`, {
    sourceName,
    materializedAt,
    next: `fix sources/file/index.yaml so ${sourceName}.materializedAt is under ${base}`,
  });
}

async function removeEmptySnapshotDirs(root: string, dir = root): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".tmp" || entry.name === ".cache") continue;
    await removeEmptySnapshotDirs(root, join(dir, entry.name));
  }
  if (dir === root) return;
  const remaining = await readdir(dir);
  if (remaining.length === 0) {
    await rm(dir, { recursive: true, force: true });
  }
}

async function cleanupStaleSnapshotFiles(input: {
  materializedAtAbsPath: string;
  previousPaths: ReadonlySet<string>;
  currentPaths: ReadonlySet<string>;
}): Promise<void> {
  for (const path of input.previousPaths) {
    if (!input.currentPaths.has(path)) {
      await rm(join(input.materializedAtAbsPath, path), { force: true });
    }
  }
  await removeEmptySnapshotDirs(input.materializedAtAbsPath);
}

async function readDocumentFiles(input: {
  files: SourceCaptureFile[];
  sourceName: string;
  local: string;
  routeHints: ReadonlyMap<string, RouteHint>;
}): Promise<{
  snapshotFiles: DocumentSnapshotFileInput[];
  documents: CaptureFileRunResult["documents"];
  mdxSources: MdxSourceFile[];
}> {
  const snapshotFiles: DocumentSnapshotFileInput[] = [];
  const documents: CaptureFileRunResult["documents"] = [];
  const mdxSources: MdxSourceFile[] = [];
  for (const file of input.files) {
    let raw: string;
    try {
      raw = await readFile(file.absolutePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw runtimeError(`file source ${input.sourceName} document read failed: ${file.snapshotPath}: ${message}`, {
        sourceName: input.sourceName,
        local: input.local,
        path: file.snapshotPath,
        next: `fix file permissions or update sources/file/index.yaml include for ${input.sourceName}, then rerun context run capture:file:${input.sourceName}`,
      });
    }
    const normalized = normalizeMarkdownDocument(raw);
    const title = titleFromMarkdown(normalized, file.sourcePath);
    const route = routeForDocument({ sourcePath: file.sourcePath, documentPath: file.snapshotPath, routeHints: input.routeHints });
    if (extname(file.snapshotPath).toLowerCase() === ".mdx") {
      mdxSources.push({
        path: file.snapshotPath,
        raw,
      });
    }
    snapshotFiles.push({
      path: file.snapshotPath,
      ...(file.sourcePath !== file.snapshotPath ? { source_path: file.sourcePath } : {}),
      bytes: normalized,
      title,
    });
    documents.push({
      path: file.snapshotPath,
      title,
      line_count: countLines(normalized),
      ...(route !== undefined ? { route: route.route } : {}),
      ...(normalized.trim().length === 0 ? { empty: true } : {}),
    });
  }
  return { snapshotFiles, documents, mdxSources };
}

export function isCaptureFileRunResult(value: unknown): value is CaptureFileRunResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "document.capture.file.result";
}

async function prepareFileCaptureInput(input: {
  projectRoot: string;
  phase: CaptureFilePhaseDefinition;
  entry: FileSourceRegistryEntry & { local: string };
  sourceName: string;
}): Promise<{
  captureRules: ReturnType<typeof captureRulesForPhase>;
  files: { documents: SourceCaptureFile[]; metadata: SourceCaptureFile[] };
  siteConfigHint: string | null;
}> {
  const captureRules = captureRulesForPhase({ phase: input.phase, source: input.entry });
  const localRoot = resolve(input.projectRoot, input.entry.local);
  const siteDetection = await detectDocumentSiteFiles({
    projectRoot: input.projectRoot,
    local: input.entry.local,
  });
  const siteConfigHint = documentSiteConfigHint({
    sourceName: input.sourceName,
    detection: siteDetection,
    processorConfigured: phaseUsesMdxJsonDocs(input.phase),
  });
  let files: { documents: SourceCaptureFile[]; metadata: SourceCaptureFile[] };
  try {
    files = await walkMarkdownFiles({
      localRoot,
      include: captureRules.include,
      documentExtensions: captureRules.documentExtensions,
      ...(captureRules.routeMetadataFile !== undefined ? { routeMetadataFile: captureRules.routeMetadataFile } : {}),
    });
  } catch (error) {
    if (error instanceof ContextError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw runtimeError(`file source local path is unreadable: ${input.entry.local}: ${message}`, {
      sourceName: input.sourceName,
      local: input.entry.local,
      next: `fix the local path or rerun ${documentSourceAddCommand("file", input.sourceName)}`,
    });
  }
  if (files.documents.length === 0) {
    const next = siteConfigHint ??
      `update sources/file/index.yaml include for ${input.sourceName} or add Markdown/MDX files before rerunning capture`;
    throw runtimeError(`file source ${input.sourceName} has no Markdown or MDX document files matching include`, {
      sourceName: input.sourceName,
      local: input.entry.local,
      include: captureRules.include,
      next,
      ...(siteConfigHint !== null ? { agent_hints: [siteConfigHint] } : {}),
    });
  }
  return {
    captureRules,
    siteConfigHint,
    files: {
      documents: assignFlatSnapshotPaths(files.documents, input.entry.module),
      metadata: assignFlatSnapshotPaths(files.metadata, input.entry.module),
    },
  };
}

function appendGeneratedCaptureEvidence(input: {
  module?: string;
  routeMetadata: Awaited<ReturnType<typeof readRouteMetadataFiles>>;
  documentSnapshot: Awaited<ReturnType<typeof readDocumentFiles>>;
}): void {
  const { snapshotFiles, documents } = input.documentSnapshot;
  const routeEvidence = routeEvidenceSnapshot(input.routeMetadata.routeHints);
  if (routeEvidence !== null) {
    const path = input.module === undefined
      ? routeEvidence.file.path
      : `${input.module}--${routeEvidence.file.path}`;
    snapshotFiles.push({ ...routeEvidence.file, path });
    documents.push({ ...routeEvidence.document, path });
  }
  const mdxComponentEvidence = renderMdxComponentEvidence(input.documentSnapshot.mdxSources);
  if (mdxComponentEvidence === null) return;
  const path = input.module === undefined
    ? MDX_COMPONENT_EVIDENCE_DOCUMENT_PATH
    : `${input.module}--${MDX_COMPONENT_EVIDENCE_DOCUMENT_PATH}`;
  snapshotFiles.push({
    path,
    bytes: mdxComponentEvidence.markdown,
    title: "MDX component text",
  });
  documents.push({
    path,
    title: "MDX component text",
    line_count: countLines(mdxComponentEvidence.markdown),
  });
}

async function runCaptureFilePhaseUnlocked(input: {
  projectRoot: string;
  phase: CaptureFilePhaseDefinition;
  now?: Date;
}): Promise<CaptureFileRunResult> {
  const resolved = await resolveDocumentPhaseSource({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  if (resolved.sourceType !== "file") {
    throw runtimeError(`document source type mismatch: ${resolved.sourceName} is ${resolved.sourceType}, expected file`, {
      sourceName: resolved.sourceName,
      expectedType: "file",
      actualType: resolved.sourceType,
    });
  }

  const entry = resolved.entry as FileSourceRegistryEntry;
  assertFileSnapshotMaterializedAt(entry);
  if (entry.local === undefined || entry.local.trim().length === 0) {
    throw runtimeError(`file source ${resolved.sourceName} is missing local refresh hint`, {
      sourceName: resolved.sourceName,
      next: documentSourceAddCommand("file", resolved.sourceName),
    });
  }

  const prepared = await prepareFileCaptureInput({
    projectRoot: input.projectRoot,
    phase: input.phase,
    entry: entry as FileSourceRegistryEntry & { local: string },
    sourceName: resolved.sourceName,
  });
  const { captureRules, files, siteConfigHint } = prepared;
  const { include } = captureRules;
  const snapshotPathBySourcePath = new Map<string, string>([
    ...files.documents.map((file) => [file.sourcePath, file.snapshotPath] as const),
    ...files.metadata.map((file) => [file.sourcePath, file.snapshotPath] as const),
  ]);
  const routeMetadata = await readRouteMetadataFiles({
    files: files.metadata,
    sourceName: resolved.sourceName,
    local: entry.local,
    snapshotPathBySourcePath,
  });
  const documentSnapshot = await readDocumentFiles({
    files: files.documents,
    sourceName: resolved.sourceName,
    local: entry.local,
    routeHints: routeMetadata.routeHints,
  });
  const linkedAssets = await readLinkedCaptureAssets({
    files: files.documents,
    localRoot: resolve(input.projectRoot, entry.local),
    sourceName: resolved.sourceName,
  });
  const { snapshotFiles, documents } = documentSnapshot;
  const { metadataFiles } = routeMetadata;
  appendGeneratedCaptureEvidence({
    ...(entry.module !== undefined ? { module: entry.module } : {}),
    routeMetadata,
    documentSnapshot,
  });

  const manifestPath = sourceManifestPath(entry);
  const manifestAbsPath = join(input.projectRoot, manifestPath);
  const materializedAt = entry.materializedAt;
  const materializedAtAbsPath = join(input.projectRoot, materializedAt);
  const manifestInput = {
    sourceType: "file",
    sourceName: resolved.sourceName,
    capturedAt: (input.now ?? new Date()).toISOString(),
    files: snapshotFiles,
    metadata: {
      capture: {
        include: normalizeFileSourceIncludeForSnapshot(include),
        documentExtensions: [...captureRules.documentExtensions],
        ...(metadataFiles.length > 0 ? { routeFiles: metadataFiles } : {}),
        ...(routeMetadata.routeHints.size > 0
          ? {
              routeHints: Array.from(routeMetadata.routeHints.values()).map((hint) => ({
                documentPath: hint.documentPath,
                route: hint.route,
                metadataPath: hint.metadataPath,
              })).sort((left, right) => left.documentPath.localeCompare(right.documentPath)),
            }
          : {}),
      },
    },
    ...((routeMetadata.assets.length > 0 || linkedAssets.length > 0)
      ? {
          assets: [
            ...routeMetadata.assets,
            ...linkedAssets.map((asset) => ({
              path: asset.snapshotPath,
              content_hash: asset.contentHash,
              role: "evidence" as const,
              source: { kind: "file" },
            })),
          ],
        }
      : {}),
  } satisfies Parameters<typeof createDocumentSnapshotManifest>[0];
  const manifest = createDocumentSnapshotManifest(manifestInput);
  const currentManifestFile = await readDocumentManifestFile(manifestAbsPath);
  const previousManifest = currentManifestFile === null
    ? null
    : findDocumentSnapshotForSource(currentManifestFile, resolved.sourceName);
  const changed = previousManifest?.snapshot_hash !== manifest.snapshot_hash;
  const manifestToWrite = changed || previousManifest === null
    ? manifest
    : {
        ...manifest,
        captured_at: previousManifest.captured_at,
      };
  const manifestContent = renderDocumentManifestFile(updateDocumentManifestFile({
    current: currentManifestFile,
    snapshot: manifestToWrite,
  }));

  try {
    for (const file of snapshotFiles) {
      await writeTextIfChanged(join(materializedAtAbsPath, file.path), String(file.bytes));
    }
    for (const file of files.metadata) {
      await writeTextIfChanged(join(materializedAtAbsPath, file.snapshotPath), routeMetadata.rawByPath.get(file.snapshotPath) ?? "");
    }
    for (const asset of linkedAssets) {
      await writeCaptureAssetIfChanged(join(materializedAtAbsPath, asset.snapshotPath), asset.bytes);
    }
    await writeTextIfChanged(manifestAbsPath, manifestContent);
    await cleanupStaleSnapshotFiles({
      materializedAtAbsPath,
      previousPaths: new Set([
        ...(previousManifest?.files.map((file) => file.path) ?? []),
        ...(previousManifest?.metadata?.capture?.routeFiles?.map((file) => file.path) ?? []),
        ...(previousManifest?.assets?.map((asset) => asset.path) ?? []),
      ]),
      currentPaths: new Set([
        ...snapshotFiles.map((file) => file.path),
        ...files.metadata.map((file) => file.snapshotPath),
        ...linkedAssets.map((asset) => asset.snapshotPath),
        ...routeMetadata.assets.map((asset) => asset.path),
      ]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw runtimeError(`file source ${resolved.sourceName} snapshot write failed: ${message}`, {
      sourceName: resolved.sourceName,
      materializedAt,
      manifest: manifestPath,
      next: `fix write permissions or restore ${materializedAt}, then rerun context run capture:file:${resolved.sourceName}`,
    });
  }

  return {
    kind: "document.capture.file.result",
    source: {
      type: "file",
      name: resolved.sourceName,
      local: entry.local,
      include,
    },
    snapshot: {
      manifest: manifestPath,
      materializedAt,
      snapshot_hash: manifest.snapshot_hash,
      changed,
    },
    documents,
    ...(metadataFiles.length > 0 ? { metadata_files: metadataFiles } : {}),
    diagnostics: siteConfigHint !== null ? [siteConfigHint] : [],
    next_action: workspaceRouteReevaluation(input.phase.id),
  };
}

export async function runCaptureFilePhase(input: {
  projectRoot: string;
  phase: CaptureFilePhaseDefinition;
  now?: Date;
}): Promise<CaptureFileRunResult> {
  return withProjectWriteLock(input.projectRoot, "capture-file", () => runCaptureFilePhaseUnlocked(input));
}
