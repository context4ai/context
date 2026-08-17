import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDocumentSourceSpan,
  computeDocumentContentHash,
  computeLogicalRawHash,
  countMarkdownLines,
  formatCanonicalProseSourceRef,
  normalizeDocumentSourceName,
  parseDocumentSourceLocator,
  parseSpanSourceRef,
  sourceSpanHashMatches,
  type DocumentSourceSpan,
  type DocumentSnapshotManifest,
  type DocumentSourceType,
} from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";

export const RUNTIME_EVIDENCE_INDEX_SCHEMA_VERSION = "document.runtime-evidence-index.v1";

export interface RuntimeEvidenceDocument {
  path: string;
  content_hash: string;
  line_count: number;
  title?: string;
  locator?: string;
  route?: string;
  route_metadata_path?: string;
  canonical_locator: string;
}

export interface RuntimeEvidenceSpan {
  source_type: DocumentSourceType;
  source_name: string;
  document_path: string;
  canonical_source_ref: string;
  heading_hint: string;
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  span_hash: string;
  full_span_hash: string;
  text_preview: string;
}

export interface RuntimeEvidenceIndex {
  schema_version: typeof RUNTIME_EVIDENCE_INDEX_SCHEMA_VERSION;
  source_type: DocumentSourceType;
  source_name: string;
  materialized_at: string;
  source_manifest_path: string;
  snapshot_hash: string;
  generated_at: string;
  documents: RuntimeEvidenceDocument[];
}

export interface SnapshotMarkdownCache {
  entries: Map<string, Promise<string>>;
}

export interface BuildCommittedEvidenceIndexResult {
  manifest: DocumentSnapshotManifest;
  index: RuntimeEvidenceIndex;
  runtimeIndexPath: string;
  absoluteRuntimeIndexPath: string;
  snapshotMarkdownCache: SnapshotMarkdownCache;
}

export interface ResolvedProseSourceRef {
  span: RuntimeEvidenceSpan;
  parsed: NonNullable<ReturnType<typeof parseSpanSourceRef>>;
  status: "exact" | "line-drift" | "heading-drift" | "content-drift";
  headingHintMatches: boolean;
  lineRangeMatches: boolean;
  hashMatches: boolean;
}

function workspaceStateError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid,
    ...detail,
  });
}

function userInputError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function committedManifestRelativePath(sourceType: DocumentSourceType, sourceName: string): string {
  return join("sources", sourceType, normalizeDocumentSourceName(sourceName), "manifest.json");
}

function runtimeEvidenceIndexRelativePath(sourceType: DocumentSourceType, sourceName: string): string {
  return join(".tmp", "context-runtime", "evidence", sourceType, normalizeDocumentSourceName(sourceName), "source-index.json");
}

async function readJsonFile(path: string, next: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceStateError(`document snapshot metadata is unreadable: ${message}`, {
      path,
      next,
    });
  }
}

function assertManifestSource(input: {
  manifest: DocumentSnapshotManifest;
  sourceType: DocumentSourceType;
  sourceName: string;
}): void {
  if (input.manifest.source_type !== input.sourceType || input.manifest.source_name !== input.sourceName) {
    throw workspaceStateError(
      `document snapshot metadata is for ${input.manifest.source_type}:${input.manifest.source_name}, expected ${input.sourceType}:${input.sourceName}`,
      {
        expected: `${input.sourceType}:${input.sourceName}`,
        actual: `${input.manifest.source_type}:${input.manifest.source_name}`,
      },
    );
  }
}

async function readCommittedSnapshotFile(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt: string;
  path: string;
}): Promise<Uint8Array> {
  const absolutePath = join(input.projectRoot, input.materializedAt, input.path);
  try {
    return await readFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceStateError(`document snapshot file is unreadable: ${input.path}: ${message}`, {
      source: `${input.sourceType}:${input.sourceName}`,
      document_path: input.path,
      next: `rerun context run capture:${input.sourceType}:${input.sourceName} or restore ${input.materializedAt}/${input.path}`,
    });
  }
}

function snapshotMarkdownCacheKey(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt: string;
  snapshotHash: string;
  documentPath: string;
}): string {
  return [
    input.sourceType,
    input.sourceName,
    input.materializedAt,
    input.snapshotHash,
    input.documentPath,
  ].join("\0");
}

export async function readCommittedSnapshotMarkdown(input: {
  projectRoot: string;
  index: RuntimeEvidenceIndex;
  path: string;
  cache?: SnapshotMarkdownCache;
}): Promise<string> {
  const key = snapshotMarkdownCacheKey({
    sourceType: input.index.source_type,
    sourceName: input.index.source_name,
    materializedAt: input.index.materialized_at,
    snapshotHash: input.index.snapshot_hash,
    documentPath: input.path,
  });
  const cached = input.cache?.entries.get(key);
  if (cached !== undefined) return cached;

  const promise = readCommittedSnapshotFile({
    projectRoot: input.projectRoot,
    sourceType: input.index.source_type,
    sourceName: input.index.source_name,
    materializedAt: input.index.materialized_at,
    path: input.path,
  }).then((bytes) => Buffer.from(bytes).toString("utf8"));

  input.cache?.entries.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    if (input.cache?.entries.get(key) === promise) {
      input.cache.entries.delete(key);
    }
    throw error;
  }
}

function canonicalDocumentLocator(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
}): string {
  return `${input.sourceType}:${normalizeDocumentSourceName(input.sourceName)}/${input.documentPath.split("/").map(encodeURIComponent).join("/")}`;
}

function routeHintsByDocument(manifest: DocumentSnapshotManifest): Map<string, { route: string; metadataPath: string }> {
  const hints = new Map<string, { route: string; metadataPath: string }>();
  for (const hint of manifest.metadata?.capture?.routeHints ?? []) {
    hints.set(hint.documentPath, {
      route: hint.route,
      metadataPath: hint.metadataPath,
    });
  }
  return hints;
}

function spanToRuntime(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
  span: DocumentSourceSpan;
}): RuntimeEvidenceSpan {
  const sourceRef = formatCanonicalProseSourceRef({
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    documentPath: input.documentPath,
    span: input.span,
  });
  return {
    source_type: input.sourceType,
    source_name: input.sourceName,
    document_path: input.documentPath,
    canonical_source_ref: sourceRef,
    heading_hint: input.span.heading_hint,
    heading_path: [...input.span.heading_path],
    line_start: input.span.line_start,
    line_end: input.span.line_end,
    line_range: input.span.line_range,
    span_hash: input.span.span_hash,
    full_span_hash: input.span.full_span_hash,
    text_preview: input.span.text_preview,
  };
}

export async function buildCommittedEvidenceIndex(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt?: string;
  manifestPath?: string;
  now?: Date;
  writeRuntimeIndex?: boolean;
}): Promise<BuildCommittedEvidenceIndexResult> {
  let sourceName: string;
  try {
    sourceName = normalizeDocumentSourceName(input.sourceName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw userInputError(message, {
      source: `${input.sourceType}:${input.sourceName}`,
    });
  }
  const materializedAt = input.materializedAt ?? join("sources", input.sourceType, sourceName);
  const manifestRelPath = input.manifestPath ?? committedManifestRelativePath(input.sourceType, sourceName);
  const manifestAbsPath = join(input.projectRoot, manifestRelPath);
  let manifest: DocumentSnapshotManifest;
  try {
    manifest = parseDocumentSnapshotForSource(await readJsonFile(
      manifestAbsPath,
      `rerun context run capture:${input.sourceType}:${sourceName} or restore ${manifestRelPath}`,
    ), sourceName);
  } catch (error) {
    if (error instanceof ContextError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw workspaceStateError(`document snapshot metadata is invalid: ${message}`, {
      path: manifestRelPath,
      next: `rerun context run capture:${input.sourceType}:${input.sourceName} or fix ${manifestRelPath}`,
    });
  }
  assertManifestSource({
    manifest,
    sourceType: input.sourceType,
    sourceName,
  });

  const documents: RuntimeEvidenceDocument[] = [];
  const logicalFiles: Array<{ path: string; bytes: Uint8Array }> = [];
  const snapshotMarkdownCache: SnapshotMarkdownCache = { entries: new Map() };
  const routeHints = routeHintsByDocument(manifest);

  for (const file of manifest.files) {
    const bytes = await readCommittedSnapshotFile({
      projectRoot: input.projectRoot,
      sourceType: input.sourceType,
      sourceName,
      materializedAt,
      path: file.path,
    });
    const contentHash = computeDocumentContentHash(bytes);
    if (contentHash !== file.content_hash) {
      throw workspaceStateError(`document snapshot content hash mismatch: ${file.path}`, {
        expected: file.content_hash,
        actual: contentHash,
        document_path: file.path,
        next: `rerun context run capture:${input.sourceType}:${sourceName} or restore the committed snapshot file`,
      });
    }
    const lineCount = countMarkdownLines(bytes);
    if (lineCount !== file.line_count) {
      throw workspaceStateError(`document snapshot line count mismatch: ${file.path}`, {
        expected: file.line_count,
        actual: lineCount,
        document_path: file.path,
        next: `rerun context run capture:${input.sourceType}:${sourceName} or fix ${manifestRelPath}`,
      });
    }

    logicalFiles.push({ path: file.path, bytes });
    snapshotMarkdownCache.entries.set(snapshotMarkdownCacheKey({
      sourceType: input.sourceType,
      sourceName,
      materializedAt,
      snapshotHash: manifest.snapshot_hash,
      documentPath: file.path,
    }), Promise.resolve(Buffer.from(bytes).toString("utf8")));
    const routeHint = routeHints.get(file.path);
    documents.push({
      path: file.path,
      content_hash: file.content_hash,
      line_count: file.line_count,
      ...(file.title !== undefined ? { title: file.title } : {}),
      ...(file.locator !== undefined ? { locator: file.locator } : {}),
      ...(routeHint !== undefined
        ? {
            route: routeHint.route,
            route_metadata_path: routeHint.metadataPath,
          }
        : {}),
      canonical_locator: canonicalDocumentLocator({
        sourceType: input.sourceType,
        sourceName,
        documentPath: file.path,
      }),
    });
  }

  for (const asset of manifest.assets ?? []) {
    if (asset.content_hash === undefined) continue;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(input.projectRoot, materializedAt, asset.path));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw workspaceStateError(`document snapshot audit asset is missing: ${asset.path}`, {
        asset_ref: asset.path,
        reason: message,
        next: `rerun context run capture:${input.sourceType}:${sourceName} or restore the committed audit asset`,
      });
    }
    const contentHash = computeDocumentContentHash(bytes);
    if (contentHash !== asset.content_hash) {
      throw workspaceStateError(`document snapshot audit asset hash mismatch: ${asset.path}`, {
        expected: asset.content_hash,
        actual: contentHash,
        asset_ref: asset.path,
        next: `rerun context run capture:${input.sourceType}:${sourceName} or restore the committed audit asset`,
      });
    }
    if (asset.role === "evidence") {
      logicalFiles.push({ path: `@asset/${asset.path}`, bytes: Buffer.from(asset.content_hash, "utf8") });
    }
  }

  const snapshotHash = computeLogicalRawHash(logicalFiles);
  if (snapshotHash !== manifest.snapshot_hash) {
    throw workspaceStateError(`document snapshot hash mismatch for ${input.sourceType}:${sourceName}`, {
      expected: manifest.snapshot_hash,
      actual: snapshotHash,
      next: `rerun context run capture:${input.sourceType}:${sourceName} or restore ${materializedAt}/`,
    });
  }

  const index: RuntimeEvidenceIndex = {
    schema_version: RUNTIME_EVIDENCE_INDEX_SCHEMA_VERSION,
    source_type: input.sourceType,
    source_name: sourceName,
    materialized_at: materializedAt,
    source_manifest_path: manifestRelPath,
    snapshot_hash: manifest.snapshot_hash,
    generated_at: (input.now ?? new Date()).toISOString(),
    documents,
  };
  const runtimeIndexPath = runtimeEvidenceIndexRelativePath(input.sourceType, sourceName);
  const absoluteRuntimeIndexPath = join(input.projectRoot, runtimeIndexPath);
  if (input.writeRuntimeIndex ?? true) {
    await mkdir(dirname(absoluteRuntimeIndexPath), { recursive: true });
    await writeFile(absoluteRuntimeIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  return {
    manifest,
    index,
    runtimeIndexPath,
    absoluteRuntimeIndexPath,
    snapshotMarkdownCache,
  };
}

function parseCanonicalLocator(locator: string): {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
} | null {
  return parseDocumentSourceLocator(locator);
}

function markdownLineCount(markdown: string): number {
  if (markdown.length === 0) return 0;
  return markdown.endsWith("\n") ? markdown.split("\n").length - 1 : markdown.split("\n").length;
}

function createRuntimeSpan(input: {
  index: RuntimeEvidenceIndex;
  documentPath: string;
  markdown: string;
  lineStart: number;
  lineEnd: number;
}): RuntimeEvidenceSpan | null {
  try {
    return spanToRuntime({
      sourceType: input.index.source_type,
      sourceName: input.index.source_name,
      documentPath: input.documentPath,
      span: createDocumentSourceSpan(input.markdown, {
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
      }),
    });
  } catch {
    return null;
  }
}

function findUniqueSpanByHash(input: {
  index: RuntimeEvidenceIndex;
  documentPath: string;
  markdown: string;
  parsed: NonNullable<ReturnType<typeof parseSpanSourceRef>>;
}): RuntimeEvidenceSpan | null {
  const spanLength = input.parsed.line_end - input.parsed.line_start + 1;
  const lines = input.markdown.length === 0 ? [] : input.markdown.split("\n");
  if (input.markdown.endsWith("\n")) lines.pop();
  const lineCount = lines.length;
  if (spanLength < 1 || spanLength > lineCount) return null;
  const matches: RuntimeEvidenceSpan[] = [];
  for (let lineStart = 1; lineStart <= lineCount - spanLength + 1; lineStart += 1) {
    const lineEnd = lineStart + spanLength - 1;
    if (lineStart === input.parsed.line_start && lineEnd === input.parsed.line_end) continue;
    const text = lines.slice(lineStart - 1, lineEnd).join("\n");
    const fullSpanHash = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
    if (!sourceSpanHashMatches(input.parsed.span_hash, fullSpanHash)) continue;
    const span = createRuntimeSpan({
      index: input.index,
      documentPath: input.documentPath,
      markdown: input.markdown,
      lineStart,
      lineEnd,
    });
    if (span !== null) matches.push(span);
  }
  return matches.length === 1 ? matches[0]! : null;
}

function findUniqueSpanByHeading(input: {
  index: RuntimeEvidenceIndex;
  documentPath: string;
  markdown: string;
  parsed: NonNullable<ReturnType<typeof parseSpanSourceRef>>;
}): RuntimeEvidenceSpan | null {
  const lineCount = markdownLineCount(input.markdown);
  if (lineCount < 1) return null;
  const ranges: Array<{ lineStart: number; lineEnd: number }> = [];
  let currentStart: number | null = null;

  for (let line = 1; line <= lineCount; line += 1) {
    const span = createRuntimeSpan({
      index: input.index,
      documentPath: input.documentPath,
      markdown: input.markdown,
      lineStart: line,
      lineEnd: line,
    });
    const matches = span?.heading_hint === input.parsed.heading_hint;
    if (matches && currentStart === null) currentStart = line;
    if (!matches && currentStart !== null) {
      ranges.push({ lineStart: currentStart, lineEnd: line - 1 });
      currentStart = null;
    }
  }
  if (currentStart !== null) {
    ranges.push({ lineStart: currentStart, lineEnd: lineCount });
  }

  const spans = ranges.flatMap((range) => {
    const span = createRuntimeSpan({
      index: input.index,
      documentPath: input.documentPath,
      markdown: input.markdown,
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
    });
    return span === null ? [] : [span];
  });
  return spans.length === 1 ? spans[0]! : null;
}

function selectDocumentForSourceRef(input: {
  index: RuntimeEvidenceIndex;
  locator: ReturnType<typeof parseCanonicalLocator>;
}): RuntimeEvidenceDocument | null {
  if (input.locator !== null) {
    return input.index.documents.find((document) => document.path === input.locator?.documentPath) ?? null;
  }
  return input.index.documents.length === 1 ? input.index.documents[0]! : null;
}

function selectResolvedSpanForSourceRef(input: {
  index: RuntimeEvidenceIndex;
  documentPath: string;
  markdown: string;
  parsed: NonNullable<ReturnType<typeof parseSpanSourceRef>>;
  exactLineSpan: RuntimeEvidenceSpan | null;
  exactLineHashMatches: boolean;
}): RuntimeEvidenceSpan | null {
  const { index, documentPath, markdown, parsed, exactLineSpan, exactLineHashMatches } = input;
  const movedSpan = exactLineHashMatches
    ? null
    : findUniqueSpanByHash({
        index,
        documentPath,
        markdown,
        parsed,
      });
  const headingSpan = !exactLineHashMatches &&
    movedSpan === null &&
    (exactLineSpan === null || exactLineSpan.heading_hint !== parsed.heading_hint)
    ? findUniqueSpanByHeading({
        index,
        documentPath,
        markdown,
        parsed,
      })
    : null;
  return exactLineHashMatches
    ? exactLineSpan
    : movedSpan ?? headingSpan ?? (
        exactLineSpan?.heading_hint === parsed.heading_hint ? exactLineSpan : null
      );
}

function resolvedProseSourceRefStatus(input: {
  lineRangeMatches: boolean;
  hashMatches: boolean;
  headingHintMatches: boolean;
}): ResolvedProseSourceRef["status"] {
  const { lineRangeMatches, hashMatches, headingHintMatches } = input;
  if (lineRangeMatches && hashMatches && headingHintMatches) return "exact";
  if (!lineRangeMatches && hashMatches) return "line-drift";
  if (lineRangeMatches && hashMatches && !headingHintMatches) return "heading-drift";
  return "content-drift";
}

export async function resolveProseSourceRef(input: {
  projectRoot: string;
  index: RuntimeEvidenceIndex;
  sourceRef: string;
  snapshotMarkdownCache?: SnapshotMarkdownCache;
}): Promise<ResolvedProseSourceRef | null> {
  const parsed = parseSpanSourceRef(input.sourceRef);
  if (parsed === null) return null;
  const locator = parsed.locator !== undefined ? parseCanonicalLocator(parsed.locator) : null;
  if (parsed.locator !== undefined && locator === null) return null;
  if (locator !== null && (locator.sourceType !== input.index.source_type || locator.sourceName !== input.index.source_name)) {
    return null;
  }
  const document = selectDocumentForSourceRef({ index: input.index, locator });
  if (document === null) return null;
  const markdown = await readCommittedSnapshotMarkdown({
    projectRoot: input.projectRoot,
    index: input.index,
    path: document.path,
    ...(input.snapshotMarkdownCache !== undefined ? { cache: input.snapshotMarkdownCache } : {}),
  });

  const exactLineSpan = createRuntimeSpan({
    index: input.index,
    documentPath: document.path,
    markdown,
    lineStart: parsed.line_start,
    lineEnd: parsed.line_end,
  });
  const exactLineHashMatches = exactLineSpan !== null && sourceSpanHashMatches(parsed.span_hash, exactLineSpan.full_span_hash);
  const selected = selectResolvedSpanForSourceRef({
    index: input.index,
    documentPath: document.path,
    markdown,
    parsed,
    exactLineSpan,
    exactLineHashMatches,
  });
  if (selected === null) return null;

  const lineRangeMatches = selected.line_start === parsed.line_start && selected.line_end === parsed.line_end;
  const hashMatches = sourceSpanHashMatches(parsed.span_hash, selected.full_span_hash);
  const headingHintMatches = selected.heading_hint === parsed.heading_hint;
  const status = resolvedProseSourceRefStatus({ lineRangeMatches, hashMatches, headingHintMatches });

  return {
    span: selected,
    parsed,
    status,
    headingHintMatches,
    lineRangeMatches,
    hashMatches,
  };
}
