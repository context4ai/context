import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normalizeMarkdownDocument } from "@c4a/extract";
import { ContextError } from "../lib/errors.js";
import { readPrefetchedLarkDocument, type FetchFeishuDocSnapshotResult } from "../lib/feishu.js";
import { captureReportMaterialization, parseLarkCaptureReport } from "../lib/larkCaptureReport.js";
import { projectLarkDocxXml } from "../lib/larkDocxXml.js";
import type { LarkExternalResource } from "../lib/larkDocxResources.js";
import type { LarkResourceMaterializationPolicy } from "../lib/larkResourceMaterialization.js";
import { ExitCode } from "../types/exitCode.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "./documentCaptureContract.js";
import type { LarkSourceIdentity } from "./larkSourceIdentity.js";

const FILE = "snapshot.json";
const fileSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const assetSchema = z.object({
  path: z.string().min(1), file: fileSchema.optional(), media_type: z.string().optional(),
  role: z.enum(["evidence", "presentation", "audit"]).optional(), source: z.record(z.string()).optional(),
}).strict();
const policySchema = z.object({ images: z.enum(["bundle", "reference-only"]), gifs: z.enum(["bundle", "reference-only"]),
  videos: z.enum(["bundle", "reference-only"]), maxBytesPerResource: z.number().int().positive(), maxTotalBytes: z.number().int().positive(),
}).strict();
const schema = z.object({
  schema: z.literal("context.lark-snapshot.v1"), url: z.string().url(),
  access_identity: z.enum(["bot", "user"]), captured_at: z.string().datetime(),
  normalizer_version: z.literal(LARK_DOCUMENT_NORMALIZER_VERSION),
  resource_policy: policySchema,
  title: z.string().optional(), revision_id: z.string().optional(),
  document: fileSchema, response_files: z.array(fileSchema).min(1), assets: z.array(assetSchema),
}).strict();
type SnapshotManifest = z.infer<typeof schema>;
type FileEntry = z.infer<typeof fileSchema>;
export interface ImportedLarkSnapshot {
  url: string;
  capturedAt: string;
  resourcePolicy: LarkResourceMaterializationPolicy;
  fetched: FetchFeishuDocSnapshotResult;
}

export function normalizedSnapshotResourcePolicy(policy: LarkResourceMaterializationPolicy) {
  return { ...policy, images: policy.images ?? "bundle", gifs: policy.gifs ?? "bundle" };
}
export function assertSnapshotResourcePolicy(snapshot: ImportedLarkSnapshot, expected: LarkResourceMaterializationPolicy): void {
  if (!isDeepStrictEqual(snapshot.resourcePolicy, normalizedSnapshotResourcePolicy(expected))) {
    throw new ContextError(ExitCode.UserError, "Saved Lark snapshot was captured with a different resource policy; import did not reinterpret or refetch its resources", {
      reason_code: "lark.snapshot-policy-mismatch", captured_policy: snapshot.resourcePolicy,
      configured_policy: normalizedSnapshotResourcePolicy(expected),
      next: "Use the registered source's normal capture phase, or explicitly align its resource configuration with this saved capture before importing.",
    });
  }
}

export function larkSnapshotError(message: string, reason = "invalid"): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    reason_code: `lark.snapshot-${reason}`,
    next: "Use an intact directory created by context source fetch lark for this registered source; choose a new output directory to fetch again.",
  });
}
function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function safePath(path: string): string {
  if (isAbsolute(path) || path.includes("\\") || path.includes("\0") || /^[a-z]:/iu.test(path) ||
      path.split("/").some(part => !part || part === "." || part === "..")) {
    throw larkSnapshotError(`Unsafe snapshot relative path: ${path}`, "path-invalid");
  }
  return path;
}

/** Parents may include the OS's /tmp alias, but the selected bundle and its files may not be links. */
export async function assertSnapshotDirectory(directory: string): Promise<string> {
  const path = resolve(directory);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw larkSnapshotError("Snapshot must be a real directory", "path-invalid");
  return realpath(path);
}
async function readFileEntry(root: string, entry: FileEntry): Promise<Buffer> {
  const parts = safePath(entry.path).split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw larkSnapshotError(`Snapshot entry is not a regular file: ${entry.path}`, "path-invalid");
    }
  }
  const bytes = await readFile(current);
  if (digest(bytes) !== entry.sha256) throw larkSnapshotError(`Snapshot content changed: ${entry.path}`, "digest-mismatch");
  return bytes;
}

export function larkSnapshotUrl(url: string): { canonical: string; kind: "docToken" | "wikiToken"; token: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw larkSnapshotError("A full Lark document URL is required", "source-invalid"); }
  const match = /^\/(docx|docs|wiki)\/([^/]+)\/?$/u.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !match) {
    throw larkSnapshotError("Use an HTTPS docx, docs, or wiki document URL", "source-invalid");
  }
  return { canonical: `${parsed.origin}/${match[1]}/${match[2]}`,
    kind: match[1] === "wiki" ? "wikiToken" : "docToken", token: decodeURIComponent(match[2]!) };
}

function assertTarget(url: string, target: LarkSourceIdentity): void {
  const source = larkSnapshotUrl(url);
  const matches = target.kind === "url"
    ? source.canonical === larkSnapshotUrl(target.value).canonical
    : source.kind === target.kind && source.token === target.value;
  if (!matches) throw larkSnapshotError("Snapshot URL does not match the registered Lark source", "source-mismatch");
}

/** Publish only to a newly reserved directory. snapshot.json is the completion marker, written last. */
export async function writeLarkSnapshotBundle(input: {
  directory: string; url: string; capturedAt: string; responsePages: string[]; fetched: FetchFeishuDocSnapshotResult;
  resourcePolicy: LarkResourceMaterializationPolicy;
}): Promise<SnapshotManifest> {
  const root = await assertSnapshotDirectory(input.directory);
  const files = new Map<string, string | Uint8Array>();
  const add = (path: string, bytes: string | Uint8Array): FileEntry => {
    safePath(path);
    if (files.has(path)) throw larkSnapshotError(`Duplicate snapshot file: ${path}`);
    files.set(path, bytes);
    return { path, sha256: digest(bytes) };
  };
  const manifest: SnapshotManifest = {
    schema: "context.lark-snapshot.v1", url: input.url, access_identity: input.fetched.accessIdentity,
    captured_at: input.capturedAt, normalizer_version: LARK_DOCUMENT_NORMALIZER_VERSION,
    resource_policy: normalizedSnapshotResourcePolicy(input.resourcePolicy),
    ...(input.fetched.title === undefined ? {} : { title: input.fetched.title }),
    ...(input.fetched.revisionId === undefined ? {} : { revision_id: input.fetched.revisionId }),
    document: add("document.md", normalizeMarkdownDocument(input.fetched.markdown)),
    response_files: input.responsePages.map((page, index) => add(`responses/${index}.json`, page)),
    assets: input.fetched.assets.map(asset => {
      safePath(asset.path);
      const path = asset.path.startsWith("assets/") ? asset.path : `assets/${asset.path}`;
      return { path: asset.path,
        ...(asset.bytes === undefined ? {} : { file: add(path, asset.bytes) }),
        ...(asset.mediaType === undefined ? {} : { media_type: asset.mediaType }),
        ...(asset.role === undefined ? {} : { role: asset.role }),
        ...(asset.source === undefined ? {} : { source: asset.source }) };
    }),
  };
  schema.parse(manifest);
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes, { flag: "wx", mode: 0o600 });
  }
  // Validate the same contract as import before committing the portable receipt.
  await validateBundle(root, manifest);
  await writeFile(join(root, `${FILE}.pending`), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(join(root, `${FILE}.pending`), join(root, FILE));
  return manifest;
}

const resourceKinds = new Set<LarkExternalResource["kind"]>([
  "bookmark", "synced-reference", "document", "poll", "cite", "image", "video", "whiteboard", "diagram", "base", "sheet", "file", "chat", "embed",
]);
async function validateBundle(root: string, manifest: SnapshotManifest): Promise<ImportedLarkSnapshot> {
  const filePaths = [manifest.document.path, ...manifest.response_files.map(file => file.path),
    ...manifest.assets.flatMap(asset => asset.file ? [asset.file.path] : [])];
  if (new Set(filePaths).size !== filePaths.length || new Set(manifest.assets.map(asset => asset.path)).size !== manifest.assets.length) {
    throw larkSnapshotError("Snapshot contains duplicate file or asset paths");
  }
  const markdown = (await readFileEntry(root, manifest.document)).toString("utf8");
  const responsePages: string[] = [];
  for (const entry of manifest.response_files) {
    const page = (await readFileEntry(root, entry)).toString("utf8");
    const envelope = JSON.parse(page) as { identity?: unknown };
    if (envelope.identity !== undefined && envelope.identity !== manifest.access_identity) {
      throw larkSnapshotError("Saved response identity does not match the capture receipt", "identity-mismatch");
    }
    responsePages.push(page);
  }
  const raw = await readPrefetchedLarkDocument(manifest.url, { responsePages, identity: manifest.access_identity });
  const projection = projectLarkDocxXml({ xml: raw.body, sourceUrl: manifest.url });
  if (raw.revisionId !== manifest.revision_id || raw.title !== manifest.title && projection.title !== manifest.title) {
    throw larkSnapshotError("Saved document metadata does not match the capture receipt");
  }
  const assets: FetchFeishuDocSnapshotResult["assets"] = [];
  for (const asset of manifest.assets) {
    safePath(asset.path);
    assets.push({ path: asset.path,
      ...(asset.file === undefined ? {} : { bytes: await readFileEntry(root, asset.file) }),
      ...(asset.media_type === undefined ? {} : { mediaType: asset.media_type }),
      ...(asset.role === undefined ? {} : { role: asset.role }),
      ...(asset.source === undefined ? {} : { source: asset.source }) });
  }
  const xml = assets.find(asset => asset.path === "source.xml");
  if (!xml?.bytes || Buffer.from(xml.bytes).toString("utf8") !== projection.auditXml) {
    throw larkSnapshotError("Snapshot lacks the original XML corresponding to its complete response pages");
  }
  const reportAsset = assets.find(asset => asset.path === "capture-report.json");
  if (!reportAsset?.bytes) throw larkSnapshotError("Snapshot lacks a capture report");
  const report = parseLarkCaptureReport(JSON.parse(Buffer.from(reportAsset.bytes).toString("utf8")));
  if (!isDeepStrictEqual(report.fidelity, projection.fidelity)) {
    throw larkSnapshotError("Snapshot fidelity does not match its original document");
  }
  const materialization = captureReportMaterialization(report);
  const available = new Set(assets.filter(asset => asset.bytes !== undefined).map(asset => asset.path));
  for (const item of materialization.items) {
    if (!resourceKinds.has(item.kind as LarkExternalResource["kind"])) throw larkSnapshotError(`Unknown resource kind: ${item.kind}`);
    for (const path of item.asset_paths) {
      if (!available.has(path)) throw larkSnapshotError(`Resource report references a missing asset: ${path}`);
    }
  }
  return { url: manifest.url, capturedAt: manifest.captured_at, resourcePolicy: manifest.resource_policy, fetched: {
    markdown, assets, accessIdentity: manifest.access_identity, identityFallback: false,
    ...(manifest.title === undefined ? {} : { title: manifest.title }),
    ...(manifest.revision_id === undefined ? {} : { revisionId: manifest.revision_id }),
    fidelity: report.fidelity,
    resourceMaterialization: { ...materialization, items: materialization.items.map(item => ({ ...item, kind: item.kind as LarkExternalResource["kind"] })) },
  } };
}

export async function readLarkSnapshotBundle(directory: string, target: LarkSourceIdentity): Promise<ImportedLarkSnapshot> {
  try {
    const root = await assertSnapshotDirectory(directory);
    const path = join(root, FILE);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw larkSnapshotError("Snapshot receipt must be a regular file", "path-invalid");
    const manifest = schema.parse(JSON.parse(await readFile(path, "utf8")));
    assertTarget(manifest.url, target);
    return await validateBundle(root, manifest);
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw larkSnapshotError(`Cannot read complete Lark snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A new destination may be anywhere outside managed state; no planning directory convention is enforced. */
export async function reserveSnapshotDirectory(directory: string, workspaceRoot?: string): Promise<string> {
  const requested = resolve(directory);
  let ancestor = dirname(requested);
  const missing: string[] = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const parent = join(ancestor, ...missing);
  const output = join(parent, basename(requested));
  const { findContextProjectRoot } = await import("./workspace.js");
  const owner = findContextProjectRoot(parent)?.projectRoot ?? workspaceRoot;
  if (owner !== undefined) {
    const rel = relative(await realpath(owner), output);
    if (["sources", "knowledge", "dist", "src", ".tmp/context-runtime"].some(part => rel === part || rel.startsWith(`${part.split("/").join(sep)}${sep}`))) {
      throw larkSnapshotError("Standalone fetch cannot write into managed workspace state; choose a separate scratch directory", "path-invalid");
    }
  }
  // Reserve one private writer before any requests. A partial directory has no completion receipt.
  await mkdir(parent, { recursive: true });
  try { await mkdir(output, { mode: 0o700 }); }
  catch (error) { throw larkSnapshotError(`Snapshot output already exists or is unavailable: ${error instanceof Error ? error.message : String(error)}`, "output-unavailable"); }
  return output;
}
