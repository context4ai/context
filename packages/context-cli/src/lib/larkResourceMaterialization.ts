import { createLarkResourceScheduler, forEachLarkResource } from "./larkResourceScheduler.js";
import { downloadLarkMedia } from "./larkMediaDownload.js";
import { exportLarkWhiteboardRaw } from "./larkWhiteboardExport.js";
import { LarkResourceBudgetError, omitLarkImage } from "./larkImagePolicy.js";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
  DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
  isNonBlockingDocumentResourceFailureReasonCode,
} from "@c4a/extract";
import type { LarkExternalResource } from "./larkDocxXml.js";
import {
  isLarkResourcePermissionDenied,
  runLarkResourceCommand,
  type LarkResourceCommandRunner,
} from "./larkResourceCommand.js";

export type {
  LarkResourceCommandOptions,
  LarkResourceCommandResult,
  LarkResourceCommandRunner,
} from "./larkResourceCommand.js";

export type LarkResourceAssetRole = "evidence" | "presentation" | "audit";
export type LarkAccessIdentity = "user" | "bot";

export interface LarkMaterializedAsset {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
  role: LarkResourceAssetRole;
  source: Record<string, string>;
}

export interface LarkResourceMaterializationItem {
  kind: LarkExternalResource["kind"];
  locator: string;
  status: "materialized" | "reference-only" | "failed";
  required: boolean;
  asset_paths: string[];
  reason_code?: string;
  reason?: string;
}

export interface LarkResourceMaterializationReport {
  status: "complete" | "warning" | "error";
  discovered: Record<string, number>;
  materialized: Record<string, number>;
  reference_only: Record<string, number>;
  failed: Record<string, number>;
  items: LarkResourceMaterializationItem[];
}

export interface LarkResourceMaterializationPolicy {
  images?: "reference-only" | "bundle";
  gifs?: "reference-only" | "bundle";
  videos: "reference-only" | "bundle";
  maxBytesPerResource: number;
  maxTotalBytes: number;
}

export interface SyncedReferenceProjection {
  markdown: string;
  resources: LarkExternalResource[];
}

export interface MaterializeLarkResourcesInput {
  mediaFiles?: Readonly<Record<string, string>>;
  resources: readonly LarkExternalResource[];
  runner: LarkResourceCommandRunner;
  policy: LarkResourceMaterializationPolicy;
  identity?: LarkAccessIdentity;
  resolveSyncedReference?: (resource: LarkExternalResource) => Promise<SyncedReferenceProjection>;
}

export interface MaterializeLarkResourcesResult {
  assets: LarkMaterializedAsset[];
  replacements: Map<string, string>;
  report: LarkResourceMaterializationReport;
}

const REQUIRED_KINDS = new Set<LarkExternalResource["kind"]>([
  "image",
  "file",
  "whiteboard",
  "diagram",
  "sheet",
  "base",
  "synced-reference",
]);

const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function countByKind(items: readonly LarkResourceMaterializationItem[], status?: LarkResourceMaterializationItem["status"]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (status !== undefined && item.status !== status) continue;
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function resourceDigest(resource: Pick<LarkExternalResource, "kind" | "locator">): string {
  return createHash("sha256").update(`${resource.kind}\0${resource.locator}`, "utf8").digest("hex").slice(0, 20);
}

function safeLabel(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).replace(/[\r\n]+/gu, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function markdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/gu, "\\$1");
}

function markdownTarget(value: string): string {
  return value.replace(/[()\s]/gu, (char) => encodeURIComponent(char));
}

function sourceAssetTarget(path: string): string {
  return markdownTarget(path.startsWith("assets/") ? path : `assets/${path}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function mediaTypeFor(path: string, bytes: Uint8Array): string {
  const byExtension = MEDIA_TYPES_BY_EXTENSION[extname(path).toLowerCase()];
  if (byExtension !== undefined) return byExtension;
  const head = Buffer.from(bytes).subarray(0, 16);
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 6).toString("ascii") === "GIF87a" || head.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (head.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  return "application/octet-stream";
}

function extensionFor(mediaType: string, originalPath: string): string {
  const existing = extname(originalPath).toLowerCase();
  if (existing.length > 1 && existing.length <= 10) return existing;
  const match = Object.entries(MEDIA_TYPES_BY_EXTENSION).find(([, value]) => value === mediaType);
  return match?.[0] ?? ".bin";
}

function resourceToken(resource: LarkExternalResource): string | undefined {
  const attrs = resource.attributes;
  return attrs.token ?? attrs["file-token"] ?? attrs["image-token"] ?? attrs["board-token"] ?? attrs["obj-token"] ?? attrs.src ?? attrs.id;
}

function structuredToken(resource: LarkExternalResource): string | undefined {
  return resource.attributes.token ?? resource.attributes["obj-token"] ?? resource.attributes["spreadsheet-token"] ?? resource.attributes["base-token"];
}

function jsonPayload(stdout: string): unknown {
  const parsed = JSON.parse(stdout.trim()) as unknown;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed) {
    return (parsed as { data?: unknown }).data;
  }
  return parsed;
}

function findStringField(value: unknown, names: ReadonlySet<string>): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringField(item, names);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (names.has(key) && typeof item === "string") return item;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = findStringField(item, names);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findBooleanField(value: unknown, name: string): boolean | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!Array.isArray(value)) {
    const direct = (value as Record<string, unknown>)[name];
    if (typeof direct === "boolean") return direct;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findBooleanField(item, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function downloadedFile(input: {
  runner: LarkResourceCommandRunner;
  identity: LarkAccessIdentity;
  token: string;
  type: "media" | "whiteboard";
  localPath?: string;
  allowPreview?: boolean;
}): Promise<{ path: string; bytes: Uint8Array; mediaType: string; representation: "original" | "preview" }> {
  if (input.localPath !== undefined) {
    const bytes = await readFile(input.localPath);
    return { path: input.localPath, bytes, mediaType: mediaTypeFor(input.localPath, bytes), representation: "original" };
  }
  const tempRoot = await mkdtemp(join(tmpdir(), "context-lark-resource-"));
  try {
    const representation = await downloadLarkMedia({ ...input, cwd: tempRoot });
    const entries = (await readdir(tempRoot, { withFileTypes: true })).filter((entry) => entry.isFile());
    if (entries.length !== 1) throw new Error(`media download produced ${entries.length} files, expected exactly one`);
    const path = entries[0]?.name ?? "resource.bin";
    const bytes = await readFile(join(tempRoot, path));
    return { path, bytes, mediaType: mediaTypeFor(path, bytes), representation };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index] ?? "";
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function markdownCell(value: unknown): string {
  const text = typeof value === "string" ? value : stableJson(value);
  return text.replace(/\r?\n/gu, "<br>").replace(/\|/gu, "\\|");
}

function markdownTable(rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return "_No rows._";
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => markdownCell(row[index] ?? "")));
  const header = normalized[0] ?? Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  return [header, header.map(() => "---"), ...normalized.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

async function sheetMaterialization(
  resource: LarkExternalResource,
  runner: LarkResourceCommandRunner,
  identity: LarkAccessIdentity,
): Promise<{
  asset: LarkMaterializedAsset;
  replacement: string;
}> {
  const token = structuredToken(resource);
  const sheetId = resource.attributes["sheet-id"];
  if (token === undefined || sheetId === undefined) throw new Error("embedded Sheet requires token and sheet-id");
  const tempRoot = await mkdtemp(join(tmpdir(), "context-lark-sheet-"));
  try {
    const outputPath = join(tempRoot, "sheet.json");
    const stdout = await runLarkResourceCommand(runner, [
      "sheets",
      "+csv-get",
      "--as",
      identity,
      "--spreadsheet-token",
      token,
      "--sheet-id",
      sheetId,
      "--include-row-prefix=false",
      "--output-path",
      "./sheet.json",
      "--format",
      "json",
    ], { cwd: tempRoot });
    const receipt = jsonPayload(stdout);
    if (findBooleanField(receipt, "truncated") === true || findBooleanField(receipt, "complete") === false) {
      throw new Error("embedded Sheet read was truncated");
    }
    const payload = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    const csv = findStringField(payload, new Set(["annotated_csv", "csv", "content", "text"]));
    if (csv === undefined) throw new Error("embedded Sheet response has no CSV payload");
    const digest = resourceDigest(resource);
    const path = `materialized/sheet/${digest}.csv`;
    const title = safeLabel(resource.title, "Embedded Sheet");
    return {
      asset: {
        path,
        bytes: Buffer.from(csv, "utf8"),
        mediaType: "text/csv",
        role: "evidence",
        source: { kind: resource.kind, locator: resource.locator },
      },
      replacement: `#### ${title}\n\n${markdownTable(parseCsv(csv))}\n\n[CSV snapshot](${sourceAssetTarget(path)}) <!-- ${resource.locator} -->`,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

interface BasePageRecords {
  records: unknown[];
  fieldOrder: string[];
}

function basePageRecords(value: unknown): BasePageRecords | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const direct = record.records;
    if (Array.isArray(direct)) return { records: direct, fieldOrder: [] };
    if (Array.isArray(record.fields) && record.fields.every((field) => typeof field === "string") && Array.isArray(record.data)) {
      const fields = record.fields as string[];
      return {
        fieldOrder: fields,
        records: record.data.map((row) => {
          if (!Array.isArray(row)) return row;
          return {
            fields: Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""])),
          };
        }),
      };
    }
  }
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = basePageRecords(item);
    if (found !== undefined) return found;
  }
  return undefined;
}

function baseRows(records: readonly unknown[], preferredFieldOrder: readonly string[]): unknown[][] {
  const normalized = records.map((record) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return { value: record };
    const raw = record as Record<string, unknown>;
    const fields = raw.fields !== null && typeof raw.fields === "object" && !Array.isArray(raw.fields)
      ? raw.fields as Record<string, unknown>
      : raw;
    return fields;
  });
  const available = new Set(normalized.flatMap((record) => Object.keys(record)));
  const preferred = preferredFieldOrder.filter((field, index) => available.has(field) && preferredFieldOrder.indexOf(field) === index);
  const headers = [...preferred, ...[...available].filter((field) => !preferred.includes(field)).sort()];
  return [headers, ...normalized.map((record) => headers.map((header) => record[header] ?? ""))];
}

async function baseMaterialization(
  resource: LarkExternalResource,
  runner: LarkResourceCommandRunner,
  identity: LarkAccessIdentity,
): Promise<{
  asset: LarkMaterializedAsset;
  replacement: string;
}> {
  const token = structuredToken(resource);
  const tableId = resource.attributes["table-id"];
  const viewId = resource.attributes["view-id"];
  if (token === undefined || tableId === undefined) throw new Error("embedded Base requires token and table-id");
  const records: unknown[] = [];
  let fieldOrder: string[] = [];
  for (let offset = 0, page = 0; page < 500; page++) {
    const args = [
      "base",
      "+record-list",
      "--as",
      identity,
      "--base-token",
      token,
      "--table-id",
      tableId,
      "--offset",
      String(offset),
      "--limit",
      "200",
      "--format",
      "json",
    ];
    if (viewId !== undefined) args.push("--view-id", viewId);
    const payload = jsonPayload(await runLarkResourceCommand(runner, args));
    const pageResult = basePageRecords(payload);
    if (pageResult === undefined) {
      throw new Error("embedded Base response has no records or fields/data payload");
    }
    const pageRecords = pageResult.records;
    if (fieldOrder.length === 0 && pageResult.fieldOrder.length > 0) fieldOrder = pageResult.fieldOrder;
    records.push(...pageRecords);
    if (findBooleanField(payload, "has_more") !== true) break;
    if (pageRecords.length === 0) throw new Error("embedded Base returned has_more=true without records");
    offset += pageRecords.length;
    if (page === 499) throw new Error("embedded Base exceeded 500 pagination calls");
  }
  const canonical = `${stableJson(records)}\n`;
  const digest = resourceDigest(resource);
  const path = `materialized/base/${digest}.json`;
  const title = safeLabel(resource.title, "Embedded Base");
  return {
    asset: {
      path,
      bytes: Buffer.from(canonical, "utf8"),
      mediaType: "application/json",
      role: "evidence",
      source: { kind: resource.kind, locator: resource.locator },
    },
    replacement: `#### ${title}\n\n${markdownTable(baseRows(records, fieldOrder))}\n\n[JSON snapshot](${sourceAssetTarget(path)}) <!-- ${resource.locator} -->`,
  };
}

async function whiteboardMaterialization(
  resource: LarkExternalResource,
  runner: LarkResourceCommandRunner,
  identity: LarkAccessIdentity,
): Promise<{
  assets: LarkMaterializedAsset[];
  replacement: string;
  reason_code?: string;
  reason?: string;
}> {
  const token = resourceToken(resource);
  if (token === undefined) throw new Error(`${resource.kind} has no whiteboard token`);
  const preview = await downloadedFile({ runner, identity, token, type: "whiteboard" });
  const digest = resourceDigest(resource);
  const previewPath = `materialized/${resource.kind}/${digest}${extensionFor(preview.mediaType, preview.path)}`;
  const rawPath = `materialized/${resource.kind}/${digest}.json`;
  const title = markdownLabel(safeLabel(resource.title, resource.kind === "diagram" ? "Diagram" : "Whiteboard"));
  const previewAsset: LarkMaterializedAsset = {
    path: previewPath,
    bytes: preview.bytes,
    mediaType: preview.mediaType,
    role: "presentation",
    source: { kind: resource.kind, locator: resource.locator, identity, representation: "preview" },
  };
  const previewMarkdown = `![${title}](${sourceAssetTarget(previewPath)})`;
  let rawBytes: Uint8Array;
  try {
    rawBytes = await exportLarkWhiteboardRaw(runner, identity, token);
  } catch (error) {
    if (!isLarkResourcePermissionDenied(error)) throw error;
    return {
      assets: [previewAsset],
      replacement: `${previewMarkdown} <!-- ${resource.locator} -->\n\n> Preview captured; structured whiteboard data is unavailable because export permission was denied.`,
      reason_code: "document.resource.preview",
      reason: `Same-identity preview captured; structured export permission denied: ${error.message}`,
    };
  }
  return {
    assets: [
      previewAsset,
      {
        path: rawPath,
        bytes: rawBytes,
        mediaType: "application/json",
        role: "evidence",
        source: { kind: resource.kind, locator: resource.locator, identity },
      },
    ],
    replacement: `${previewMarkdown}\n\n[Raw snapshot](${sourceAssetTarget(rawPath)}) <!-- ${resource.locator} -->`,
  };
}

function placeholderFor(resource: LarkExternalResource): string | undefined {
  const title = safeLabel(resource.title, resource.kind);
  switch (resource.kind) {
    case "image": return `> Image: ${title} (${resource.locator})`;
    case "video": return `> Video: ${title} (${resource.locator})`;
    case "file": return `> File: ${title} (${resource.locator})`;
    case "whiteboard": return `> Whiteboard: ${resource.locator}`;
    case "diagram": return `> Diagram: ${resource.locator}`;
    case "sheet":
    case "base":
    case "synced-reference": return undefined;
    default: return "";
  }
}

function referenceOnlyReason(resource: LarkExternalResource): string {
  if (resource.kind === "video") return "video stays as a stable reference by the default capture policy";
  if (resource.kind === "poll") return resource.inline_content === true
    ? "poll options were projected as non-interactive Markdown"
    : "poll options are absent from the exported XML";
  return "resource is an external navigation reference, not inline evidence";
}

function materializationReport(items: readonly LarkResourceMaterializationItem[]): LarkResourceMaterializationReport {
  const hasRequiredFailure = items.some((item) =>
    item.status === "failed" &&
    item.required &&
    !isNonBlockingDocumentResourceFailureReasonCode(item.reason_code)
  );
  const hasOptionalFailure = items.some((item) => item.status === "failed" || item.reason_code === "image-budget-exceeded" || item.reason_code === "document.resource.preview") || items.some(
    (item) => item.status === "reference-only" && item.kind === "poll" && item.reason?.includes("absent") === true,
  );
  return {
    status: hasRequiredFailure ? "error" : hasOptionalFailure ? "warning" : "complete",
    discovered: countByKind(items),
    materialized: countByKind(items, "materialized"),
    reference_only: countByKind(items, "reference-only"),
    failed: countByKind(items, "failed"),
    items: [...items],
  };
}

function resourceFailureReasonCode(resource: LarkExternalResource, error: unknown): string | undefined {
  if (isLarkResourcePermissionDenied(error)) {
    return DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE;
  }
  if (resource.kind !== "diagram" && resource.kind !== "whiteboard") return undefined;
  const message = error instanceof Error ? error.message : String(error);
  return /\b2890003\b/u.test(message)
    ? DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE
    : undefined;
}

function unavailableReplacement(resource: LarkExternalResource, reasonCode: string): string {
  const title = markdownLabel(safeLabel(resource.title, resource.kind));
  const reason = reasonCode === DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE
    ? "export permission denied"
    : "source no longer exists";
  return `> Resource unavailable: ${title} (${resource.kind}; ${reason}). <!-- ${resource.locator} -->`;
}

function assertBudget(asset: LarkMaterializedAsset, policy: LarkResourceMaterializationPolicy, total: number): void {
  if (asset.bytes.byteLength > policy.maxBytesPerResource) {
    throw new LarkResourceBudgetError(`resource is ${asset.bytes.byteLength} bytes, above maxBytesPerResource=${policy.maxBytesPerResource}`);
  }
  if (total + asset.bytes.byteLength > policy.maxTotalBytes) {
    throw new LarkResourceBudgetError(`materialized resources exceed maxTotalBytes=${policy.maxTotalBytes}`);
  }
}

export async function materializeLarkResources(input: MaterializeLarkResourcesInput): Promise<MaterializeLarkResourcesResult> {
  input = { ...input, runner: createLarkResourceScheduler(input.runner) };
  const assets: LarkMaterializedAsset[] = [];
  const replacements = new Map<string, string>();
  const items: LarkResourceMaterializationItem[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const identity = input.identity ?? "user";

  const materialize = async (resource: LarkExternalResource, depth: number): Promise<void> => {
    const key = `${resource.kind}\0${resource.locator}`;
    if (seen.has(key)) return;
    seen.add(key);
    const required = REQUIRED_KINDS.has(resource.kind);
    if (omitLarkImage(resource, input.policy, items, replacements)) return;
    try {
      if (resource.kind === "diagram" && resource.inline_content === true) {
        replacements.set(resource.locator, "");
        items.push({
          kind: resource.kind,
          locator: resource.locator,
          status: "materialized",
          required,
          asset_paths: [],
          reason: "inline diagram source was preserved in the Markdown projection",
        });
        return;
      }
      if (["bookmark", "cite", "document", "chat", "embed", "poll"].includes(resource.kind) ||
        (resource.kind === "video" && input.policy.videos === "reference-only")) {
        items.push({
          kind: resource.kind,
          locator: resource.locator,
          status: "reference-only",
          required: false,
          asset_paths: [],
          reason: referenceOnlyReason(resource),
        });
        return;
      }

      if (resource.kind === "sheet" || resource.kind === "base") {
        const result = resource.kind === "sheet"
          ? await sheetMaterialization(resource, input.runner, identity)
          : await baseMaterialization(resource, input.runner, identity);
        assertBudget(result.asset, input.policy, totalBytes);
        totalBytes += result.asset.bytes.byteLength;
        assets.push(result.asset);
        replacements.set(resource.locator, result.replacement);
        items.push({ kind: resource.kind, locator: resource.locator, status: "materialized", required, asset_paths: [result.asset.path] });
        return;
      }

      if (resource.kind === "whiteboard" || resource.kind === "diagram") {
        const result = await whiteboardMaterialization(resource, input.runner, identity);
        for (const asset of result.assets) {
          assertBudget(asset, input.policy, totalBytes);
          totalBytes += asset.bytes.byteLength;
          assets.push(asset);
        }
        replacements.set(resource.locator, result.replacement);
        items.push({
          kind: resource.kind,
          locator: resource.locator,
          status: "materialized",
          required,
          asset_paths: result.assets.map((asset) => asset.path),
          ...(result.reason_code === undefined ? {} : { reason_code: result.reason_code, reason: result.reason }),
        });
        return;
      }

      if (resource.kind === "synced-reference") {
        if (depth >= 4) throw new Error("synced reference nesting exceeds 4 levels");
        if (input.resolveSyncedReference === undefined) throw new Error("synced reference resolver is unavailable");
        const projected = await input.resolveSyncedReference(resource);
        const digest = resourceDigest(resource);
        const asset: LarkMaterializedAsset = {
          path: `materialized/synced-reference/${digest}.md`,
          bytes: Buffer.from(projected.markdown, "utf8"),
          mediaType: "text/markdown",
          role: "evidence",
          source: { kind: resource.kind, locator: resource.locator },
        };
        assertBudget(asset, input.policy, totalBytes);
        totalBytes += asset.bytes.byteLength;
        for (const nested of projected.resources) await materialize(nested, depth + 1);
        assets.push(asset);
        const projectedMarkdown = applyLarkResourceReplacements(projected.markdown, projected.resources, replacements);
        replacements.set(
          resource.locator,
          `${projectedMarkdown.trim()}\n\n[Synced block snapshot](${sourceAssetTarget(asset.path)}) <!-- ${resource.locator} -->`,
        );
        items.push({ kind: resource.kind, locator: resource.locator, status: "materialized", required, asset_paths: [asset.path] });
        return;
      }

      const token = resourceToken(resource);
      if (token === undefined) throw new Error(`${resource.kind} has no downloadable token`);
      const downloaded = await downloadedFile({
        runner: input.runner,
        identity,
        token,
        type: "media",
        allowPreview: resource.kind === "image",
        ...(input.mediaFiles?.[token] === undefined ? {} : { localPath: input.mediaFiles[token] }),
      });
      if (omitLarkImage(resource, input.policy, items, replacements, downloaded.mediaType)) return;
      const digest = resourceDigest(resource);
      const extension = extensionFor(downloaded.mediaType, downloaded.path);
      const asset: LarkMaterializedAsset = {
        path: `materialized/${resource.kind}/${digest}${extension}`,
        bytes: downloaded.bytes,
        mediaType: downloaded.mediaType,
        role: "evidence",
        source: { kind: resource.kind, locator: resource.locator, identity, representation: downloaded.representation },
      };
      assertBudget(asset, input.policy, totalBytes);
      totalBytes += asset.bytes.byteLength;
      assets.push(asset);
      const title = markdownLabel(safeLabel(resource.title, resource.kind));
      const target = sourceAssetTarget(asset.path);
      const replacement = downloaded.mediaType.startsWith("image/")
        ? `![${title}](${target}) <!-- ${resource.locator} -->`
        : `[${title}](${target}) <!-- ${resource.locator} -->`;
      replacements.set(resource.locator, downloaded.representation === "preview"
        ? `${replacement}\n\n> Image preview captured; the original could not be downloaded.` : replacement);
      items.push({ kind: resource.kind, locator: resource.locator, status: "materialized", required, asset_paths: [asset.path],
        ...(downloaded.representation === "preview" ? { reason_code: "document.resource.preview", reason: "Same-identity preview captured; original download permission denied" } : {}),
      });
    } catch (error) {
      if (error instanceof LarkResourceBudgetError && omitLarkImage(resource, input.policy, items, replacements, undefined, error.message)) return;
      const reasonCode = resourceFailureReasonCode(resource, error);
      if (isNonBlockingDocumentResourceFailureReasonCode(reasonCode)) {
        replacements.set(resource.locator, unavailableReplacement(resource, reasonCode!));
      }
      items.push({
        kind: resource.kind,
        locator: resource.locator,
        status: "failed",
        required,
        asset_paths: [],
        ...(reasonCode === undefined ? {} : { reason_code: reasonCode }),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await forEachLarkResource(input.resources.filter(resource => resource.kind !== "synced-reference"), (resource) => materialize(resource, 0));
  // Resolve nested projections after shared leaf resources have their replacements.
  for (const resource of input.resources.filter(resource => resource.kind === "synced-reference")) await materialize(resource, 0);
  // Completion timing must not reorder persisted audit records or assets.
  items.sort((a, b) => a.locator.localeCompare(b.locator) || a.kind.localeCompare(b.kind));
  assets.sort((a, b) => a.path.localeCompare(b.path));
  return { assets, replacements, report: materializationReport(items) };
}

export function applyLarkResourceReplacements(
  markdown: string,
  resources: readonly LarkExternalResource[],
  replacements: ReadonlyMap<string, string>,
): string {
  let output = markdown;
  for (const resource of resources) {
    const replacement = replacements.get(resource.locator);
    if (replacement === undefined) continue;
    const placeholder = placeholderFor(resource);
    if (placeholder !== undefined && placeholder.length > 0) {
      output = output.split(placeholder).join(replacement);
      continue;
    }
    if (resource.kind === "sheet" || resource.kind === "base") {
      const pattern = new RegExp(`> [^\\n]*\\(${escapeRegExp(resource.locator)}\\)`, "gu");
      output = output.replace(pattern, replacement);
      continue;
    }
    if (resource.kind === "synced-reference") {
      const pattern = new RegExp(`> [^\\n]*<!-- ${escapeRegExp(resource.locator)} -->`, "gu");
      output = output.replace(pattern, replacement);
    }
  }
  return output;
}
