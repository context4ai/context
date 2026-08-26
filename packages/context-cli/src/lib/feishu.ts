import { spawn } from "node:child_process";
import {
  LARK_EMPTY_SUB_PAGE_LIST_CODE,
  projectLarkDocxXml,
  projectLarkDocxXmlBlock,
  type LarkCaptureFidelityReport,
  type LarkDocxProjection,
  type LarkExternalResource,
} from "./larkDocxXml.js";
import {
  applyLarkResourceReplacements,
  materializeLarkResources,
  type LarkAccessIdentity,
  type LarkResourceAssetRole,
  type LarkResourceMaterializationPolicy,
  type LarkResourceMaterializationReport,
} from "./larkResourceMaterialization.js";
import { createLarkCaptureReport } from "./larkCaptureReport.js";

/**
 * Name of the binary we spawn. Matches the `bin` field of the official npm
 * package `@larksuite/cli` — which is `lark-cli` (not `lark`, not `lark-cli.js`).
 * Kept as a constant so spawn call, error messages, and doc strings stay in
 * sync: changing the real bin name only needs a one-line edit here.
 */
const LARK_BIN = "lark-cli";

/**
 * Hard cap on pagination loops in `fetchFeishuDoc`. A single Lark doc returning
 * `has_more=true` for more pages than this almost certainly means a server-side
 * regression or an infinite loop — we prefer to fail loudly rather than hang.
 */
const MAX_FETCH_PAGES = 50;
const MAX_STRUCTURAL_FETCH_ATTEMPTS = 2;

export class LarkCliNotInstalledError extends Error {
  constructor() {
    super(`${LARK_BIN} not installed — see https://github.com/larksuite/cli for install instructions`);
    this.name = "LarkCliNotInstalledError";
  }
}

export class LarkCliError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "LarkCliError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface RunLarkResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunLarkOptions {
  cwd?: string;
}

export type LarkRunner = (args: string[], options?: RunLarkOptions) => Promise<RunLarkResult>;
type DocsFetchApiVersion = "v1" | "v2";

const defaultRunner: LarkRunner = (args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(LARK_BIN, args, {
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new LarkCliNotInstalledError());
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });

export async function checkLarkCli(runner: LarkRunner = defaultRunner): Promise<string> {
  const result = await runner(["--version"]);
  if (result.exitCode !== 0) {
    throw new LarkCliError(`${LARK_BIN} --version failed`, result.exitCode, result.stderr);
  }
  return result.stdout.trim();
}

export interface FetchFeishuDocInput {
  /**
   * Full feishu/lark URL (e.g. `https://xxx.feishu.cn/docx/...`,
   * `https://xxx.larkoffice.com/wiki/...`). We pass the URL verbatim to
   * `lark-cli docs +fetch --doc <url>` — lark-cli resolves wiki tokens to
   * underlying obj_tokens on its side, so we don't need a separate
   * `wiki spaces get_node` pre-step.
   */
  url: string;
  docsApiVersion?: DocsFetchApiVersion | "auto";
  /**
   * Identity used to read the document. `auto` prefers the user identity and
   * falls back to the bot only when user credentials themselves are absent or
   * cannot be refreshed. It never changes identity after a permission error.
   */
  identity?: LarkAccessIdentity | "auto";
  resourcePolicy?: Partial<LarkResourceMaterializationPolicy>;
}

export interface FetchFeishuDocAsset {
  path: string;
  bytes?: Uint8Array;
  mediaType?: string;
  source?: Record<string, string>;
  role?: LarkResourceAssetRole;
}

export interface FetchFeishuDocSnapshotResult {
  markdown: string;
  title?: string;
  revisionId?: string;
  assets: FetchFeishuDocAsset[];
  fidelity: LarkCaptureFidelityReport;
  resourceMaterialization: LarkResourceMaterializationReport;
  accessIdentity: LarkAccessIdentity;
  identityFallback: boolean;
}

const DEFAULT_RESOURCE_POLICY: LarkResourceMaterializationPolicy = {
  videos: "reference-only",
  maxBytesPerResource: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

interface DocsFetchCapabilities {
  apiVersion: DocsFetchApiVersion;
  supportsDocFormat: boolean;
}

interface DocsFetchPlan {
  apiVersion: DocsFetchApiVersion;
  docFormat?: "xml";
}

const docsFetchCapabilitiesCache = new WeakMap<LarkRunner, Promise<DocsFetchCapabilities>>();

async function detectDocsFetchCapabilities(runner: LarkRunner): Promise<DocsFetchCapabilities> {
  const result = await runner(["docs", "+fetch", "--help"]).catch((): RunLarkResult => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }));
  const help = `${result.stdout}\n${result.stderr}`;
  const supportsApiVersion = result.exitCode === 0 && /\s--api-version\b/u.test(help);
  return {
    apiVersion: supportsApiVersion ? "v2" : "v1",
    supportsDocFormat: result.exitCode === 0 && /\s--doc-format\b/u.test(help),
  };
}

function resolveDocsFetchPlan(
  requested: FetchFeishuDocInput["docsApiVersion"],
  runner: LarkRunner,
): Promise<DocsFetchPlan> {
  if (requested === "v1" || requested === "v2") {
    return Promise.resolve({ apiVersion: requested, docFormat: "xml" });
  }
  let capabilitiesPromise = docsFetchCapabilitiesCache.get(runner);
  if (capabilitiesPromise === undefined) {
    capabilitiesPromise = detectDocsFetchCapabilities(runner);
    docsFetchCapabilitiesCache.set(runner, capabilitiesPromise);
  }
  return capabilitiesPromise.then((capabilities) => {
    if (!capabilities.supportsDocFormat) {
      throw new LarkCliError(
        `${LARK_BIN} docs +fetch does not support --doc-format xml; upgrade @larksuite/cli before capturing Lark sources`,
        0,
        "",
      );
    }
    return { apiVersion: capabilities.apiVersion, docFormat: "xml" };
  });
}

function docsFetchFailureMessage(stderr: string, apiVersion: DocsFetchApiVersion): string {
  const trimmed = stderr.trim();
  const base = `${LARK_BIN} docs +fetch failed: ${trimmed}`;
  const mentionsV2 = /api-version|--api-version|v2|deprecated|lark-cli update/iu.test(stderr);
  if (apiVersion === "v1" && mentionsV2) {
    return `${base}\nDetected docs API v2 guidance from lark-cli. Upgrade @larksuite/cli and run \`lark-cli update\`; newer docs +fetch supports \`--api-version v2\`.`;
  }
  return base;
}

/**
 * Shape of the `.data` payload returned by `lark-cli docs +fetch --format json`.
 *
 * `lark-cli --format json` always wraps the shortcut result in a success
 * envelope `{ok, identity, data, meta, notice}` (see `RuntimeContext.Out` in
 * larksuite/cli's `shortcuts/common/runner.go`). The real `docs +fetch`
 * payload lives under `.data`.
 *
 * `has_more` is only present when the upstream MCP tool needs pagination;
 * when absent we treat the response as complete.
 */
interface DocsFetchPayload {
  title?: string;
  markdown?: string;
  revision_id?: string;
  revisionId?: string;
  assets?: unknown;
  attachments?: unknown;
  document?: {
    title?: string;
    content?: string;
    markdown?: string;
    revision_id?: string;
    revisionId?: string;
    reference_map?: unknown;
    tips?: string;
    [k: string]: unknown;
  };
  has_more?: boolean;
  /**
   * Server-provided offset to continue fetching from, in the same unit as
   * `--offset` (bytes of the markdown stream). We use this verbatim instead
   * of incrementing by our own page size, because `--limit` is measured in
   * bytes and a single UTF-8 character may span multiple bytes.
   */
  next_offset?: number;
  [k: string]: unknown;
}

interface DocsFetchEnvelope {
  ok?: boolean;
  identity?: string;
  data?: DocsFetchPayload;
  error?: unknown;
  [k: string]: unknown;
}

function envelopeErrorText(error: unknown): string {
  if (error === null || typeof error !== "object" || Array.isArray(error)) return String(error ?? "unknown error");
  const record = error as Record<string, unknown>;
  const fields = ["type", "subtype", "code", "message", "hint"] as const;
  const parts = fields.flatMap((field) => {
    const value = record[field];
    return typeof value === "string" || typeof value === "number" ? [`${field}=${String(value)}`] : [];
  });
  return parts.length > 0 ? parts.join("; ") : JSON.stringify(record);
}

function parseDocsFetchPayload(stdout: string): DocsFetchPayload {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new LarkCliError("document is empty — it may not exist or you lack permission", 0, "");
  }
  let envelope: DocsFetchEnvelope;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    envelope = parsed as DocsFetchEnvelope;
  } catch (err) {
    throw new LarkCliError(
      `failed to parse ${LARK_BIN} docs +fetch output (not JSON): ${err instanceof Error ? err.message : String(err)}`,
      0,
      stdout.slice(0, 200),
    );
  }
  if (envelope.ok === false) {
    throw new LarkCliError(
      `${LARK_BIN} docs +fetch returned ok=false: ${envelopeErrorText(envelope.error)}`,
      0,
      stdout,
    );
  }
  // Tolerate both envelope-wrapped and bare shapes. Real CLI output always
  // wraps in `{ok, identity, data}`; test mocks may pass the bare payload
  // directly to keep fixture boilerplate minimal.
  if (envelope.data && typeof envelope.data === "object") {
    return envelope.data;
  }
  return envelope as DocsFetchPayload;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordStringValue(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function payloadShapeSummary(payload: DocsFetchPayload): string {
  const keys = Object.keys(payload).sort().join(", ") || "(none)";
  const document = payload.document;
  if (document && typeof document === "object") {
    const documentKeys = Object.keys(document).sort().join(", ") || "(none)";
    return `top-level keys: ${keys}; document keys: ${documentKeys}`;
  }
  return `top-level keys: ${keys}`;
}

function extractDocsFetchContent(payload: DocsFetchPayload, requestedFormat: "xml" | "markdown"): {
  title?: string;
  body?: string;
  format: "xml" | "markdown";
  recognizedShape: boolean;
} {
  const document = payload.document && typeof payload.document === "object" ? payload.document : undefined;
  const title = stringValue(payload.title) ?? stringValue(document?.title);
  const markdown = stringValue(payload.markdown) ?? stringValue(document?.markdown);
  const withTitle = (result: { body?: string; format: "xml" | "markdown"; recognizedShape: boolean }) =>
    title === undefined ? result : { ...result, title };
  if (markdown !== undefined) {
    if (requestedFormat === "xml") {
      throw new LarkCliError(
        `${LARK_BIN} docs +fetch returned Markdown despite --doc-format xml; capture stopped because the response cannot provide auditable rich-block fidelity. Upgrade lark-cli and retry.`,
        0,
        "",
      );
    }
    return withTitle({ body: markdown, format: "markdown", recognizedShape: true });
  }
  const documentContent = stringValue(document?.content);
  if (documentContent !== undefined) {
    return withTitle({ body: documentContent, format: requestedFormat, recognizedShape: true });
  }
  return withTitle({
    format: requestedFormat,
    recognizedShape:
      payload.title !== undefined ||
      payload.markdown !== undefined ||
      document?.title !== undefined ||
      document?.markdown !== undefined ||
      document?.content !== undefined,
  });
}

function extractDocsFetchRevisionId(payload: DocsFetchPayload): string | undefined {
  const document = payload.document && typeof payload.document === "object" ? payload.document : undefined;
  return stringValue(payload.revision_id) ??
    stringValue(payload.revisionId) ??
    stringValue(document?.revision_id) ??
    stringValue(document?.revisionId);
}

function assetArrays(payload: DocsFetchPayload): unknown[][] {
  const document = payload.document && typeof payload.document === "object" ? payload.document : undefined;
  return [
    payload.assets,
    payload.attachments,
    document?.assets,
    document?.attachments,
  ].filter((value): value is unknown[] => Array.isArray(value));
}

function assetBytes(record: Record<string, unknown>): Uint8Array | undefined {
  const base64 = recordStringValue(record, ["base64", "content_base64", "data_base64"]);
  if (base64 !== undefined) return Buffer.from(base64, "base64");
  const content = recordStringValue(record, ["content", "text", "data"]);
  if (content !== undefined) return Buffer.from(content, "utf8");
  return undefined;
}

function assetSource(record: Record<string, unknown>): Record<string, string> | undefined {
  const source: Record<string, string> = {};
  for (const [target, keys] of [
    ["id", ["id", "file_id", "token"]],
    ["url", ["url", "source_url", "download_url"]],
    ["title", ["title", "name", "filename", "file_name"]],
  ] as const) {
    const value = recordStringValue(record, keys);
    if (value !== undefined) source[target] = value;
  }
  return Object.keys(source).length > 0 ? source : undefined;
}

function extractDocsFetchAssets(payload: DocsFetchPayload): FetchFeishuDocAsset[] {
  const assets: FetchFeishuDocAsset[] = [];
  for (const group of assetArrays(payload)) {
    for (const item of group) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const path = recordStringValue(record, ["path", "filename", "file_name", "name"]);
      if (path === undefined) continue;
      const mediaType = recordStringValue(record, ["media_type", "mime_type", "type"]);
      const bytes = assetBytes(record);
      const source = assetSource(record);
      assets.push({
        path,
        ...(bytes !== undefined ? { bytes } : {}),
        ...(mediaType !== undefined ? { mediaType } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(bytes !== undefined ? { role: "evidence" as const } : {}),
      });
    }
  }
  return assets;
}

function emptyFidelityReport(): LarkCaptureFidelityReport {
  return {
    status: "complete",
    evidence_status: "complete",
    projection_status: "complete",
    discovered: {},
    converted: {},
    skipped: [],
    issues: [],
  };
}

function captureReportAsset(input: {
  fidelity: LarkCaptureFidelityReport;
  resourceMaterialization: LarkResourceMaterializationReport;
  resources: readonly LarkExternalResource[];
}): FetchFeishuDocAsset {
  const report = createLarkCaptureReport(input);
  return {
    path: "capture-report.json",
    bytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
    mediaType: "application/vnd.context.lark-capture-report+json",
    role: "audit",
    source: {
      kind: "capture-report",
      fidelity_status: input.fidelity.status,
      resource_status: input.resourceMaterialization.status,
    },
  };
}

interface FetchedDocsResponse {
  body: string;
  contentFormat: "xml" | "markdown" | undefined;
  title?: string;
  revisionId?: string;
  assets: FetchFeishuDocAsset[];
}

interface IdentityFetchResult {
  fetched: FetchedDocsResponse;
  identity: LarkAccessIdentity;
  fallback: boolean;
}

function larkErrorText(error: unknown): string {
  if (error instanceof LarkCliError) return `${error.message}\n${error.stderr}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * A bot retry is safe only when the user credential path is unavailable.
 * Permission and scope failures describe access to the requested source and
 * must remain visible rather than being bypassed with another identity.
 */
function userIdentityUnavailable(error: unknown): boolean {
  const message = larkErrorText(error);
  if (/permission[_ -]?denied|forbidden|missing[_ -]?scope|insufficient[_ -]?scope|access[_ -]?denied/iu.test(message)) {
    return false;
  }
  return /need_user_authorization|needs[_ -]?refresh|refresh\s+failed|user\s+(?:identity|oauth|credential|token).*(?:missing|unavailable|expired|failed)|(?:missing|no)\s+(?:stored\s+)?user\s+(?:credential|token|login)|strict\s+mode.*bot/iu.test(message);
}

async function fetchDocsResponse(
  input: FetchFeishuDocInput,
  docsFetchPlan: DocsFetchPlan,
  runner: LarkRunner,
  identity: LarkAccessIdentity,
): Promise<FetchedDocsResponse> {
  const chunks: string[] = [];
  let contentFormat: "xml" | "markdown" | undefined;
  let title: string | undefined;
  let revisionId: string | undefined;
  let unsupportedShape: string | undefined;
  const assets: FetchFeishuDocAsset[] = [];
  let nextOffset: number | undefined;

  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const args = ["docs", "+fetch", "--as", identity, "--doc", input.url, "--detail", "full", "--format", "json"];
    if (docsFetchPlan.apiVersion === "v2") args.push("--api-version", "v2");
    if (docsFetchPlan.docFormat === "xml") args.push("--doc-format", "xml");
    if (nextOffset !== undefined) args.push("--offset", String(nextOffset));

    const result = await runner(args);
    if (result.exitCode !== 0) {
      throw new LarkCliError(
        docsFetchFailureMessage(result.stderr, docsFetchPlan.apiVersion),
        result.exitCode,
        result.stderr,
      );
    }
    const payload = parseDocsFetchPayload(result.stdout);
    const extracted = extractDocsFetchContent(payload, docsFetchPlan.docFormat ?? "xml");
    if (contentFormat !== undefined && contentFormat !== extracted.format) {
      throw new LarkCliError("lark-cli docs +fetch changed content format between pages", 0, "");
    }
    contentFormat = extracted.format;
    if (page === 0 && extracted.title !== undefined) title = extracted.title;
    revisionId ??= extractDocsFetchRevisionId(payload);
    assets.push(...extractDocsFetchAssets(payload));
    if (extracted.body !== undefined && extracted.body.length > 0) {
      chunks.push(extracted.body);
    } else if (!extracted.recognizedShape && unsupportedShape === undefined) {
      unsupportedShape = payloadShapeSummary(payload);
    }
    if (payload.has_more !== true) break;
    if (typeof payload.next_offset !== "number") {
      throw new LarkCliError(
        `${LARK_BIN} docs +fetch returned has_more=true but no next_offset; cannot paginate further`,
        0,
        "",
      );
    }
    nextOffset = payload.next_offset;
    if (page === MAX_FETCH_PAGES - 1) {
      throw new LarkCliError(
        `${LARK_BIN} docs +fetch exceeded ${MAX_FETCH_PAGES} pagination calls; likely a server-side issue`,
        0,
        "",
      );
    }
  }

  const body = chunks.join("\n\n");
  if (body.trim().length === 0 && (title === undefined || title.length === 0)) {
    if (unsupportedShape !== undefined) {
      throw new LarkCliError(
        `${LARK_BIN} docs +fetch returned an unsupported payload shape (${unsupportedShape}). Expected data.markdown or data.document.content; this is a format adapter issue, not a permission error.`,
        0,
        "",
      );
    }
    throw new LarkCliError("document is empty — it may not exist or you lack permission", 0, "");
  }

  return {
    body,
    contentFormat,
    ...(title !== undefined ? { title } : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
    assets,
  };
}

async function fetchWithIdentity(
  input: FetchFeishuDocInput,
  docsFetchPlan: DocsFetchPlan,
  runner: LarkRunner,
): Promise<IdentityFetchResult> {
  const preference = input.identity ?? "auto";
  if (preference === "user" || preference === "bot") {
    return {
      fetched: await fetchDocsResponse(input, docsFetchPlan, runner, preference),
      identity: preference,
      fallback: false,
    };
  }
  try {
    return {
      fetched: await fetchDocsResponse(input, docsFetchPlan, runner, "user"),
      identity: "user",
      fallback: false,
    };
  } catch (userError) {
    if (!userIdentityUnavailable(userError)) throw userError;
    try {
      return {
        fetched: await fetchDocsResponse(input, docsFetchPlan, runner, "bot"),
        identity: "bot",
        fallback: true,
      };
    } catch (botError) {
      throw new LarkCliError(
        `user identity is unavailable and bot identity also failed: ${larkErrorText(botError)}`,
        botError instanceof LarkCliError ? botError.exitCode : 0,
        botError instanceof LarkCliError ? botError.stderr : "",
      );
    }
  }
}

function hasEmptySubPageList(projection: LarkDocxProjection): boolean {
  return projection.fidelity.issues.some((issue) => issue.code === LARK_EMPTY_SUB_PAGE_LIST_CODE);
}

/**
 * Fetch a feishu/lark document as structured Docx XML via `lark-cli docs +fetch`,
 * retain audit evidence, and produce a deterministic readable Markdown projection.
 *
 * Returns a single markdown string with the document title prepended as an
 * H1 heading. Paginates automatically when `has_more=true` (bounded by
 * `MAX_FETCH_PAGES` to avoid infinite loops on a misbehaving server).
 */
export async function fetchFeishuDocSnapshot(
  input: FetchFeishuDocInput,
  runner: LarkRunner = defaultRunner,
): Promise<FetchFeishuDocSnapshotResult> {
  const docsFetchPlan = await resolveDocsFetchPlan(input.docsApiVersion ?? "auto", runner);
  const identityFetch = await fetchWithIdentity(input, docsFetchPlan, runner);
  let fetched = identityFetch.fetched;
  const accessIdentity = identityFetch.identity;
  let projection: LarkDocxProjection | undefined;
  for (let attempt = 0; attempt < MAX_STRUCTURAL_FETCH_ATTEMPTS && fetched.contentFormat === "xml"; attempt++) {
    projection = projectLarkDocxXml({ xml: fetched.body, sourceUrl: input.url });
    if (!hasEmptySubPageList(projection) || attempt === MAX_STRUCTURAL_FETCH_ATTEMPTS - 1) break;
    fetched = await fetchDocsResponse(input, docsFetchPlan, runner, accessIdentity);
  }

  let body = fetched.body;
  let title = fetched.title;
  const revisionId = fetched.revisionId;
  const assets = [...fetched.assets];
  let fidelity = emptyFidelityReport();
  let resourceMaterialization: LarkResourceMaterializationReport = {
    status: "complete",
    discovered: {},
    materialized: {},
    reference_only: {},
    failed: {},
    items: [],
  };
  if (projection !== undefined) {
    body = projection.markdown;
    title ??= projection.title;
    fidelity = projection.fidelity;
    assets.push({
      path: "source.xml",
      bytes: Buffer.from(projection.auditXml, "utf8"),
      mediaType: "application/xml",
      role: "audit",
      source: {
        kind: "lark-docx-xml",
        raw_content_hash: projection.rawContentHash,
      },
    });
    const policy: LarkResourceMaterializationPolicy = {
      ...DEFAULT_RESOURCE_POLICY,
      ...input.resourcePolicy,
    };
    const materialized = await materializeLarkResources({
      resources: projection.resources,
      runner,
      policy,
      identity: accessIdentity,
      resolveSyncedReference: async (resource) => {
        const sourceToken = resource.attributes["src-token"];
        const blockId = resource.attributes["src-block-id"];
        if (sourceToken === undefined || blockId === undefined) {
          throw new LarkCliError("synced reference requires src-token and src-block-id", 0, "");
        }
        const synced = await fetchDocsResponse({ url: sourceToken }, docsFetchPlan, runner, accessIdentity);
        if (synced.contentFormat !== "xml") {
          throw new LarkCliError("synced reference source did not return XML", 0, "");
        }
        return projectLarkDocxXmlBlock({
          xml: synced.body,
          sourceUrl: sourceToken,
          blockId,
        });
      },
    });
    body = applyLarkResourceReplacements(body, projection.resources, materialized.replacements);
    assets.push(...materialized.assets.map((asset) => ({
      path: asset.path,
      bytes: asset.bytes,
      mediaType: asset.mediaType,
      role: asset.role,
      source: asset.source,
    })));
    resourceMaterialization = materialized.report;
  }
  assets.push(captureReportAsset({
    fidelity,
    resourceMaterialization,
    resources: projection?.resources ?? [],
  }));

  // Prepend title as H1 if the readable projection doesn't already lead with one —
  // downstream `extractTitle` uses the first H1 as the source title, and an
  // empty-title doc is ambiguous to the user.
  if (title !== undefined && title.length > 0 && !/^#\s/.test(body)) {
    return {
      markdown: `# ${title}\n\n${body}`,
      title,
      ...(revisionId !== undefined ? { revisionId } : {}),
      assets,
      fidelity,
      resourceMaterialization,
      accessIdentity,
      identityFallback: identityFetch.fallback,
    };
  }
  return {
    markdown: body,
    ...(title !== undefined ? { title } : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
    assets,
    fidelity,
    resourceMaterialization,
    accessIdentity,
    identityFallback: identityFetch.fallback,
  };
}

export async function fetchFeishuDoc(
  input: FetchFeishuDocInput,
  runner: LarkRunner = defaultRunner,
): Promise<string> {
  return (await fetchFeishuDocSnapshot(input, runner)).markdown;
}
