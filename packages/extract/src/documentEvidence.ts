import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  parseDocumentCaptureFidelity,
  parseDocumentResourceMaterialization,
  type DocumentCaptureFidelityReport,
  type DocumentResourceMaterializationReport,
} from "./documentCaptureFidelity";

export type {
  DocumentCaptureFidelityIssue,
  DocumentCaptureFidelityReport,
  DocumentResourceMaterializationItem,
  DocumentResourceMaterializationReport,
} from "./documentCaptureFidelity";
export {
  DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
  DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
  isNonBlockingDocumentResourceFailureReasonCode,
  parseDocumentCaptureFidelity,
  parseDocumentResourceMaterialization,
} from "./documentCaptureFidelity";

export const DOCUMENT_EVIDENCE_NORMALIZER_VERSION = "document-evidence-normalizer.v2";
export const DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION = "document.snapshot.v2";
export const DEFAULT_SOURCE_SPAN_HASH_LENGTH = 12;

export type DocumentSourceType = "file" | "lark";

export interface LogicalRawHashFile {
  path: string;
  bytes: string | Uint8Array;
}

export interface DocumentSourceSpan {
  heading_hint: string;
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  span_hash: string;
  full_span_hash: string;
  text: string;
  text_preview: string;
}

export interface ParsedSpanSourceRef {
  locator?: string;
  heading_hint: string;
  line_start: number;
  line_end: number;
  span_hash: string;
}

export interface DocumentSourceLocator {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
}

export interface DocumentSnapshotFileInput {
  path: string;
  bytes: string | Uint8Array;
  title?: string;
  locator?: string;
  source_path?: string;
}

export interface DocumentSnapshotFileEntry {
  path: string;
  source_path?: string;
  content_hash: string;
  line_count: number;
  title?: string;
  locator?: string;
}

export interface DocumentSnapshotAssetEntry {
  path: string;
  content_hash?: string;
  media_type?: string;
  role?: "evidence" | "presentation" | "audit";
  source?: Record<string, string>;
}

export interface DocumentSnapshotManifestMetadata {
  source?: {
    url?: string;
    docToken?: string;
    wikiToken?: string;
    title?: string;
    revisionId?: string;
  };
  capture?: {
    include?: string[];
    documentExtensions?: string[];
    routeFiles?: Array<{
      path: string;
      routes: string[];
    }>;
    routeHints?: Array<{
      documentPath: string;
      route: string;
      metadataPath: string;
    }>;
    report?: {
      path: string;
      fidelityStatus: DocumentCaptureFidelityReport["status"];
      evidenceStatus: DocumentCaptureFidelityReport["evidence_status"];
      projectionStatus: DocumentCaptureFidelityReport["projection_status"];
      resourceStatus: DocumentResourceMaterializationReport["status"];
    };
    fidelity?: DocumentCaptureFidelityReport;
    resourceMaterialization?: DocumentResourceMaterializationReport;
  };
}

type DocumentRouteFileMetadata = NonNullable<NonNullable<DocumentSnapshotManifestMetadata["capture"]>["routeFiles"]>;
type DocumentRouteHintMetadata = NonNullable<NonNullable<DocumentSnapshotManifestMetadata["capture"]>["routeHints"]>;
type DocumentCaptureReportMetadata = NonNullable<NonNullable<DocumentSnapshotManifestMetadata["capture"]>["report"]>;

export interface DocumentSnapshotManifest {
  schema_version: typeof DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION;
  source_type: DocumentSourceType;
  source_name: string;
  captured_at: string;
  snapshot_hash: string;
  normalizer_version: string;
  files: DocumentSnapshotFileEntry[];
  assets?: DocumentSnapshotAssetEntry[];
  metadata?: DocumentSnapshotManifestMetadata;
}

const BOM = "\uFEFF";
const HASH_ID_RE = /^(?:sha256:)?[a-f0-9]{64}$/u;
const SOURCE_SPAN_HASH_RE = /^[a-f0-9]{8,64}$/u;
const DOCUMENT_SOURCE_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/u;
const DOCUMENT_SOURCE_BATCH_RE = /^\d{8}\/[a-z0-9][a-z0-9._-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytesOf(value: string | Uint8Array): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(bytesOf(value)).digest("hex");
}

function normalizeHashId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  if (!/^[a-f0-9]{64}$/u.test(hex)) {
    throw new TypeError(`invalid sha256 hash id: ${value}`);
  }
  return `sha256:${hex}`;
}

function assertDocumentSourceType(value: string): asserts value is DocumentSourceType {
  if (value !== "file" && value !== "lark") {
    throw new TypeError(`document source_type must be file or lark: ${value}`);
  }
}

export function normalizeDocumentSourceName(name: string): string {
  const value = name.trim();
  if (!DOCUMENT_SOURCE_SLUG_RE.test(value) && !DOCUMENT_SOURCE_BATCH_RE.test(value)) {
    throw new TypeError(`document source name must be a lowercase path-safe slug or YYYYMMDD/module identity: ${name}`);
  }
  if (DOCUMENT_SOURCE_BATCH_RE.test(value)) {
    const dateName = value.slice(0, 8);
    const year = Number(dateName.slice(0, 4));
    const month = Number(dateName.slice(4, 6));
    const day = Number(dateName.slice(6, 8));
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new TypeError(`document source batch must be a valid calendar date: ${name}`);
    }
  }
  return value;
}

export function normalizeSnapshotRelativePath(path: string): string {
  const value = path.trim();
  if (value.length === 0 || value.includes("\0") || value.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(value)) {
    throw new TypeError(`snapshot path must be a POSIX relative path: ${path}`);
  }
  if (value.includes("\\")) {
    throw new TypeError(`snapshot path must use POSIX separators: ${path}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError(`snapshot path must not contain empty, dot, or traversal segments: ${path}`);
  }
  return value;
}

export function encodeSnapshotLocatorPath(path: string): string {
  return normalizeSnapshotRelativePath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function decodeSnapshotLocatorPath(path: string): string {
  try {
    return normalizeSnapshotRelativePath(path
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`invalid encoded snapshot locator path: ${path}: ${message}`);
  }
}

export function parseDocumentSourceLocator(source: string): DocumentSourceLocator | null {
  const match = /^(file|lark):(.+)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const segments = match[2].split("/");
  const batched = /^\d{8}$/u.test(segments[0] ?? "") && segments.length >= 3;
  const sourceName = batched ? `${segments[0]}/${segments[1]}` : segments[0];
  const documentPath = segments.slice(batched ? 2 : 1).join("/");
  if (sourceName === undefined || documentPath.length === 0) return null;
  try {
    return {
      sourceType: match[1] as DocumentSourceType,
      sourceName: normalizeDocumentSourceName(sourceName),
      documentPath: decodeSnapshotLocatorPath(documentPath),
    };
  } catch {
    return null;
  }
}

export function normalizeMarkdownDocument(input: string): string {
  let text = input.normalize("NFC");
  if (text.startsWith(BOM)) {
    text = text.slice(BOM.length);
  }
  text = text.replace(/\r\n?/g, "\n");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^(\s*)[*+]([ \t])/gmu, "$1-$2");

  const fenceCount = (text.match(/^```/gmu) ?? []).length;
  if (fenceCount % 2 === 1) {
    if (!text.endsWith("\n")) text += "\n";
    text += "```\n";
  }
  return text;
}

export function computeDocumentContentHash(bytes: string | Uint8Array): string {
  return `sha256:${sha256Hex(bytes)}`;
}

export function countMarkdownLines(bytes: string | Uint8Array): number {
  const text = bytesOf(bytes).toString("utf8");
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n?/g, "\n");
  return normalized.endsWith("\n")
    ? normalized.split("\n").length - 1
    : normalized.split("\n").length;
}

export function computeLogicalRawHash(files: readonly LogicalRawHashFile[]): string {
  const hash = createHash("sha256");
  const sorted = [...files]
    .map((file) => ({
      path: normalizeSnapshotRelativePath(file.path),
      bytes: bytesOf(file.bytes),
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  for (const file of sorted) {
    hash.update(Buffer.from(file.path, "utf8"));
    hash.update("\0");
    hash.update(Buffer.from(String(file.bytes.byteLength), "utf8"));
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function slugSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/[`*_~[\]()]/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "document";
}

function headingFromLine(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
  if (!match) return null;
  const title = (match[2] ?? "").trim();
  if (title.length === 0) return null;
  return { level: match[1]!.length, title };
}

function fenceMarker(line: string): { marker: "`" | "~"; length: number } | null {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  if (!match?.[1]) return null;
  return { marker: match[1][0] as "`" | "~", length: match[1].length };
}

export function truncateSourceSpanHash(hash: string, length = DEFAULT_SOURCE_SPAN_HASH_LENGTH): string {
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new TypeError(`source span hash must be a 64-character lowercase sha256 hex digest: ${hash}`);
  }
  if (!Number.isInteger(length) || length < 8 || length > 64) {
    throw new TypeError(`source span hash length must be an integer between 8 and 64: ${length}`);
  }
  return hash.slice(0, length);
}

function snapshotTextLines(markdown: string): string[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split("\n");
  if (markdown.endsWith("\n")) lines.pop();
  return lines;
}

function headingContextForLine(markdown: string, lineStart: number): { heading_hint: string; heading_path: string[] } {
  const lines = snapshotTextLines(markdown);
  const headings: Array<{ level: number; title: string; headingSlug: string } | undefined> = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  const maxIndex = Math.min(Math.max(lineStart, 1), lines.length);

  for (let index = 0; index < maxIndex; index += 1) {
    const line = lines[index] ?? "";
    const marker = fenceMarker(line);

    if (fence !== null) {
      if (marker !== null && marker.marker === fence.marker && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (marker !== null) {
      fence = marker;
      continue;
    }

    const heading = headingFromLine(line);
    if (heading !== null) {
      headings.splice(heading.level - 1);
      headings[heading.level - 1] = {
        ...heading,
        headingSlug: slugSegment(heading.title),
      };
    }
  }

  const headingPath = headings.flatMap((heading) => heading === undefined ? [] : [heading.title]);
  const headingHint = [...headings]
    .reverse()
    .find((heading) => heading !== undefined)?.headingSlug ?? "document";
  return {
    heading_hint: headingHint,
    heading_path: headingPath,
  };
}

export function createDocumentSourceSpan(
  markdown: string,
  input: { lineStart: number; lineEnd: number; hashLength?: number },
): DocumentSourceSpan {
  const lines = snapshotTextLines(markdown);
  const lineStart = input.lineStart;
  const lineEnd = input.lineEnd;
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
    throw new TypeError(`source span line range must be positive and ordered: L${lineStart}-${lineEnd}`);
  }
  if (lineEnd > lines.length) {
    throw new TypeError(`source span line range exceeds document line count: L${lineStart}-${lineEnd}`);
  }
  const text = lines.slice(lineStart - 1, lineEnd).join("\n");
  const fullSpanHash = sha256Hex(text);
  const heading = headingContextForLine(markdown, lineStart);
  return {
    heading_hint: heading.heading_hint,
    heading_path: heading.heading_path,
    line_start: lineStart,
    line_end: lineEnd,
    line_range: `L${lineStart}-${lineEnd}`,
    span_hash: truncateSourceSpanHash(fullSpanHash, input.hashLength ?? DEFAULT_SOURCE_SPAN_HASH_LENGTH),
    full_span_hash: fullSpanHash,
    text,
    text_preview: text.replace(/\s+/gu, " ").slice(0, 160),
  };
}

export function formatSpanSourceRef(
  span: Pick<DocumentSourceSpan, "heading_hint" | "line_start" | "line_end" | "span_hash" | "full_span_hash">,
  options: { locator?: string; hashLength?: number } = {},
): string {
  const hash = options.hashLength === undefined
    ? span.span_hash
    : truncateSourceSpanHash(span.full_span_hash, options.hashLength);
  const body = `#span:${span.heading_hint} L${span.line_start}-${span.line_end}@${hash}`;
  return options.locator !== undefined ? `${options.locator}${body}` : body;
}

export function formatCanonicalProseSourceRef(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
  span: Pick<DocumentSourceSpan, "heading_hint" | "line_start" | "line_end" | "span_hash" | "full_span_hash">;
  hashLength?: number;
}): string {
  const sourceName = normalizeDocumentSourceName(input.sourceName);
  const documentPath = normalizeSnapshotRelativePath(input.documentPath);
  return formatSpanSourceRef(input.span, {
    locator: `${input.sourceType}:${sourceName}/${encodeSnapshotLocatorPath(documentPath)}`,
    ...(input.hashLength !== undefined ? { hashLength: input.hashLength } : {}),
  });
}

export function parseSpanSourceRef(value: string): ParsedSpanSourceRef | null {
  const normalized = value.trim();
  const match = /^(?:(?<locator>[^#\s]+))?#span:(?<heading>[^\s#]+)\s+L(?<start>\d+)-(?<end>\d+)@(?<hash>[a-f0-9]{8,64})$/u.exec(normalized);
  if (!match?.groups) return null;
  const lineStart = Number(match.groups.start);
  const lineEnd = Number(match.groups.end);
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
    return null;
  }
  return {
    ...(match.groups.locator !== undefined ? { locator: match.groups.locator } : {}),
    heading_hint: match.groups.heading!,
    line_start: lineStart,
    line_end: lineEnd,
    span_hash: match.groups.hash!,
  };
}

export function sourceSpanHashMatches(refHash: string, fullSpanHash: string): boolean {
  return SOURCE_SPAN_HASH_RE.test(refHash) && /^[a-f0-9]{64}$/u.test(fullSpanHash) && fullSpanHash.startsWith(refHash);
}

export function createDocumentSnapshotFileEntry(input: DocumentSnapshotFileInput): DocumentSnapshotFileEntry {
  const path = normalizeSnapshotRelativePath(input.path);
  const sourcePath = input.source_path === undefined ? undefined : normalizeSnapshotRelativePath(input.source_path);
  if ((input.title?.trim().length ?? 0) === 0 && (input.locator?.trim().length ?? 0) === 0) {
    throw new TypeError(`snapshot file "${path}" must include title or locator`);
  }
  return {
    path,
    ...(sourcePath !== undefined && sourcePath !== path ? { source_path: sourcePath } : {}),
    content_hash: computeDocumentContentHash(input.bytes),
    line_count: countMarkdownLines(input.bytes),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.locator !== undefined ? { locator: input.locator.trim() } : {}),
  };
}

export function createDocumentSnapshotManifest(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  capturedAt: string;
  files: readonly DocumentSnapshotFileInput[];
  assets?: readonly DocumentSnapshotAssetEntry[];
  metadata?: DocumentSnapshotManifestMetadata;
  normalizerVersion?: string;
}): DocumentSnapshotManifest {
  const files = input.files.map(createDocumentSnapshotFileEntry);
  const sourceName = normalizeDocumentSourceName(input.sourceName);
  const logicalFiles: LogicalRawHashFile[] = [...input.files];
  for (const asset of input.assets ?? []) {
    if (asset.role !== "evidence" || asset.content_hash === undefined) continue;
    logicalFiles.push({ path: `@asset/${normalizeSnapshotRelativePath(asset.path)}`, bytes: asset.content_hash });
  }
  return parseDocumentSnapshotManifest({
    schema_version: DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    source_type: input.sourceType,
    source_name: sourceName,
    captured_at: input.capturedAt,
    snapshot_hash: computeLogicalRawHash(logicalFiles),
    normalizer_version: input.normalizerVersion ?? DOCUMENT_EVIDENCE_NORMALIZER_VERSION,
    files,
    ...(input.assets !== undefined ? { assets: input.assets } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}

function parseFileEntry(value: unknown, index: number): DocumentSnapshotFileEntry {
  if (!isRecord(value)) {
    throw new TypeError(`snapshot manifest files[${index}] must be an object`);
  }
  if (typeof value.path !== "string") {
    throw new TypeError(`snapshot manifest files[${index}].path must be a string`);
  }
  if (typeof value.content_hash !== "string" || !HASH_ID_RE.test(value.content_hash)) {
    throw new TypeError(`snapshot manifest files[${index}].content_hash must be sha256:<64 hex>`);
  }
  if (!Number.isInteger(value.line_count) || (value.line_count as number) < 0) {
    throw new TypeError(`snapshot manifest files[${index}].line_count must be a non-negative integer`);
  }
  const title = typeof value.title === "string" && value.title.trim().length > 0 ? value.title.trim() : undefined;
  const locator = typeof value.locator === "string" && value.locator.trim().length > 0 ? value.locator.trim() : undefined;
  const sourcePath = typeof value.source_path === "string" && value.source_path.trim().length > 0
    ? normalizeSnapshotRelativePath(value.source_path)
    : undefined;
  if (title === undefined && locator === undefined) {
    throw new TypeError(`snapshot manifest files[${index}] must include title or locator`);
  }
  return {
    path: normalizeSnapshotRelativePath(value.path),
    ...(sourcePath !== undefined ? { source_path: sourcePath } : {}),
    content_hash: normalizeHashId(value.content_hash),
    line_count: value.line_count as number,
    ...(title !== undefined ? { title } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

function parseAssetEntry(value: unknown, index: number): DocumentSnapshotAssetEntry {
  if (!isRecord(value)) {
    throw new TypeError(`snapshot manifest assets[${index}] must be an object`);
  }
  if (typeof value.path !== "string") {
    throw new TypeError(`snapshot manifest assets[${index}].path must be a string`);
  }
  const contentHash = typeof value.content_hash === "string" && HASH_ID_RE.test(value.content_hash)
    ? normalizeHashId(value.content_hash)
    : undefined;
  const mediaType = typeof value.media_type === "string" && value.media_type.trim().length > 0
    ? value.media_type.trim()
    : undefined;
  const role = value.role === "evidence" || value.role === "presentation" || value.role === "audit"
    ? value.role
    : undefined;
  const source = parseStringRecord(value.source, `snapshot manifest assets[${index}].source`);
  return {
    path: normalizeSnapshotRelativePath(value.path),
    ...(contentHash !== undefined ? { content_hash: contentHash } : {}),
    ...(mediaType !== undefined ? { media_type: mediaType } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

function parseStringRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new TypeError(`${field}.${key} must be a string`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) result[key] = trimmed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function optionalMetadataString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalMetadataStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new TypeError(`${field}[${index}] must be a string`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new TypeError(`${field}[${index}] must be a non-empty string`);
    }
    return trimmed;
  });
}

function optionalRouteFiles(value: unknown, field: string): DocumentRouteFileMetadata | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  const result = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`${field}[${index}] must be an object`);
    }
    const path = optionalMetadataString(item.path, `${field}[${index}].path`);
    if (path === undefined) {
      throw new TypeError(`${field}[${index}].path must be a non-empty string`);
    }
    const routes = optionalMetadataStringArray(item.routes, `${field}[${index}].routes`) ?? [];
    return {
      path: normalizeSnapshotRelativePath(path),
      routes,
    };
  }).filter((item) => item.routes.length > 0);
  return result.length > 0 ? result : undefined;
}

function optionalRouteHints(value: unknown, field: string): DocumentRouteHintMetadata | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(`${field} must be an array`);
  }
  const result = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`${field}[${index}] must be an object`);
    }
    const documentPath = optionalMetadataString(item.documentPath, `${field}[${index}].documentPath`);
    const route = optionalMetadataString(item.route, `${field}[${index}].route`);
    const metadataPath = optionalMetadataString(item.metadataPath, `${field}[${index}].metadataPath`);
    if (documentPath === undefined || route === undefined || metadataPath === undefined) {
      throw new TypeError(`${field}[${index}] must include documentPath, route, and metadataPath`);
    }
    return {
      documentPath: normalizeSnapshotRelativePath(documentPath),
      route,
      metadataPath: normalizeSnapshotRelativePath(metadataPath),
    };
  });
  return result.length > 0 ? result : undefined;
}

function captureReportMetadata(value: unknown): DocumentCaptureReportMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("snapshot manifest metadata.capture.report must be an object");
  const path = optionalMetadataString(value.path, "snapshot manifest metadata.capture.report.path");
  if (path === undefined) throw new TypeError("snapshot manifest metadata.capture.report.path is required");
  const fidelityStatus = value.fidelityStatus;
  const evidenceStatus = value.evidenceStatus;
  const projectionStatus = value.projectionStatus;
  const resourceStatus = value.resourceStatus;
  if (fidelityStatus !== "complete" && fidelityStatus !== "warning" && fidelityStatus !== "error") {
    throw new TypeError("snapshot manifest metadata.capture.report.fidelityStatus is invalid");
  }
  if (evidenceStatus !== "complete" && evidenceStatus !== "error") {
    throw new TypeError("snapshot manifest metadata.capture.report.evidenceStatus is invalid");
  }
  if (projectionStatus !== "complete" && projectionStatus !== "generic" &&
    projectionStatus !== "warning" && projectionStatus !== "error") {
    throw new TypeError("snapshot manifest metadata.capture.report.projectionStatus is invalid");
  }
  if (resourceStatus !== "complete" && resourceStatus !== "warning" && resourceStatus !== "error") {
    throw new TypeError("snapshot manifest metadata.capture.report.resourceStatus is invalid");
  }
  return {
    path: normalizeSnapshotRelativePath(path),
    fidelityStatus,
    evidenceStatus,
    projectionStatus,
    resourceStatus,
  };
}

function parseManifestMetadata(value: unknown): DocumentSnapshotManifestMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError("snapshot manifest metadata must be an object");
  }
  let source: DocumentSnapshotManifestMetadata["source"] | undefined;
  if (value.source !== undefined) {
    if (!isRecord(value.source)) {
      throw new TypeError("snapshot manifest metadata.source must be an object");
    }
    const url = optionalMetadataString(value.source.url, "snapshot manifest metadata.source.url");
    const docToken = optionalMetadataString(value.source.docToken, "snapshot manifest metadata.source.docToken");
    const wikiToken = optionalMetadataString(value.source.wikiToken, "snapshot manifest metadata.source.wikiToken");
    const title = optionalMetadataString(value.source.title, "snapshot manifest metadata.source.title");
    const revisionId = optionalMetadataString(value.source.revisionId, "snapshot manifest metadata.source.revisionId");
    source = {
      ...(url !== undefined ? { url } : {}),
      ...(docToken !== undefined ? { docToken } : {}),
      ...(wikiToken !== undefined ? { wikiToken } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(revisionId !== undefined ? { revisionId } : {}),
    };
    if (Object.keys(source).length === 0) source = undefined;
  }
  let capture: DocumentSnapshotManifestMetadata["capture"] | undefined;
  if (value.capture !== undefined) {
    if (!isRecord(value.capture)) {
      throw new TypeError("snapshot manifest metadata.capture must be an object");
    }
    const include = optionalMetadataStringArray(value.capture.include, "snapshot manifest metadata.capture.include");
    const documentExtensions = optionalMetadataStringArray(
      value.capture.documentExtensions,
      "snapshot manifest metadata.capture.documentExtensions",
    );
    const routeFiles = optionalRouteFiles(value.capture.routeFiles, "snapshot manifest metadata.capture.routeFiles");
    const routeHints = optionalRouteHints(value.capture.routeHints, "snapshot manifest metadata.capture.routeHints");
    const report = captureReportMetadata(value.capture.report);
    const fidelity = parseDocumentCaptureFidelity(value.capture.fidelity, "snapshot manifest metadata.capture.fidelity");
    const resourceMaterialization = parseDocumentResourceMaterialization(
      value.capture.resourceMaterialization,
      "snapshot manifest metadata.capture.resourceMaterialization",
    );
    capture = {
      ...(include !== undefined ? { include } : {}),
      ...(documentExtensions !== undefined ? { documentExtensions } : {}),
      ...(routeFiles !== undefined ? { routeFiles } : {}),
      ...(routeHints !== undefined ? { routeHints } : {}),
      ...(report !== undefined ? { report } : {}),
      ...(fidelity !== undefined ? { fidelity } : {}),
      ...(resourceMaterialization !== undefined ? { resourceMaterialization } : {}),
    };
    if (Object.keys(capture).length === 0) capture = undefined;
  }
  return source !== undefined || capture !== undefined
    ? {
        ...(source !== undefined ? { source } : {}),
        ...(capture !== undefined ? { capture } : {}),
      }
    : {};
}

export function parseDocumentSnapshotManifest(value: unknown): DocumentSnapshotManifest {
  if (!isRecord(value)) {
    throw new TypeError("snapshot manifest must be an object");
  }
  if (value.schema_version !== DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(`snapshot manifest schema_version must be ${DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof value.source_type !== "string") {
    throw new TypeError("snapshot manifest source_type must be a string");
  }
  assertDocumentSourceType(value.source_type);
  if (typeof value.source_name !== "string" || value.source_name.trim().length === 0) {
    throw new TypeError("snapshot manifest source_name must be a non-empty string");
  }
  const sourceName = normalizeDocumentSourceName(value.source_name);
  if (typeof value.captured_at !== "string" || value.captured_at.trim().length === 0) {
    throw new TypeError("snapshot manifest captured_at must be a non-empty string");
  }
  if (typeof value.snapshot_hash !== "string" || !HASH_ID_RE.test(value.snapshot_hash)) {
    throw new TypeError("snapshot manifest snapshot_hash must be sha256:<64 hex>");
  }
  if (typeof value.normalizer_version !== "string" || value.normalizer_version.trim().length === 0) {
    throw new TypeError("snapshot manifest normalizer_version must be a non-empty string");
  }
  if (!Array.isArray(value.files)) {
    throw new TypeError("snapshot manifest files must be an array");
  }
  const assets = value.assets === undefined
    ? undefined
    : Array.isArray(value.assets)
      ? value.assets.map(parseAssetEntry)
      : (() => {
        throw new TypeError("snapshot manifest assets must be an array");
      })();
  const metadata = parseManifestMetadata(value.metadata);
  const files = value.files.map(parseFileEntry);
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) {
      throw new TypeError(`snapshot manifest files contains duplicate path: ${file.path}`);
    }
    seenPaths.add(file.path);
  }
  return {
    schema_version: DOCUMENT_SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    source_type: value.source_type,
    source_name: sourceName,
    captured_at: value.captured_at,
    snapshot_hash: normalizeHashId(value.snapshot_hash),
    normalizer_version: value.normalizer_version,
    files,
    ...(assets !== undefined ? { assets } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
