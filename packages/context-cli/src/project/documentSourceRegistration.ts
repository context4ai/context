import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  DEFAULT_FILE_SOURCES_REGISTRY_PATH,
  DEFAULT_LARK_SOURCES_REGISTRY_PATH,
  fileSourceOriginInstallRoot,
  loadSourcesRegistry,
  parseFileSourcesRegistryDocument,
  type FileSourceLayout,
  type FileSourceOrigin,
} from "@c4a/context";
import YAML from "yaml";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  fileSourceAgentViewWithNextAction,
  larkSourceAgentViewWithNextAction,
} from "./sourceCommandViews.js";
import { withProjectWriteLock } from "./writeLock.js";

const SOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

export function isDateSourceNamespace(value: string): boolean {
  if (!/^\d{8}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function documentModuleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

export function defaultFileModule(local: string): string {
  const leaf = basename(local.trim());
  const extension = extname(leaf);
  const withoutExtension = extension.length > 0 ? leaf.slice(0, -extension.length) : leaf;
  return documentModuleSlug(withoutExtension) || "documents";
}

export function defaultLarkModule(input: {
  url?: string;
  docToken?: string;
  wikiToken?: string;
  title?: string;
}): string {
  if (input.title !== undefined) {
    const titleSlug = documentModuleSlug(input.title);
    if (titleSlug.length > 0) return titleSlug;
  }
  const opaqueSlug = (kind: string, identity: string) =>
    `${kind}-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
  if (input.url !== undefined) {
    try {
      const parsed = new URL(input.url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const token = segments.at(-1) ?? "document";
      const kind = segments.at(-2) === "wiki" ? "wiki" : segments.at(-2) === "docx" ? "doc" : "lark";
      return opaqueSlug(kind, token);
    } catch {
      return opaqueSlug("lark", input.url);
    }
  }
  if (input.wikiToken !== undefined) return opaqueSlug("wiki", input.wikiToken);
  if (input.docToken !== undefined) return opaqueSlug("doc", input.docToken);
  return "document";
}

async function realpathOrResolve(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function normalizeFileSourceLocal(projectRoot: string, value: string): Promise<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContextError(ExitCode.UserError, "source add file requires --local <path>", {
      category: ErrorCategory.UserInputInvalid,
      flag: "--local",
    });
  }

  const canonicalProjectRoot = await realpathOrResolve(projectRoot);
  const rawAbsolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(canonicalProjectRoot, trimmed);
  const absolute = await realpathOrResolve(rawAbsolute);
  const normalized = relative(canonicalProjectRoot, absolute).replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => part.length === 0 || part === ".")
  ) {
    throw new ContextError(ExitCode.UserError, `cannot safely store file source local path as project-relative path: ${value}`, {
      category: ErrorCategory.UserInputInvalid,
      flag: "--local",
    });
  }
  return normalized;
}

function assertSafeFileInclude(value: string): void {
  if (value.length === 0 || value.includes("\0") || isAbsolute(value)) {
    throw new ContextError(ExitCode.UserError, `file source include must be a committed relative glob: ${value}`, {
      category: ErrorCategory.UserInputInvalid,
      flag: "--include",
    });
  }
  if (value.includes("\\")) {
    throw new ContextError(ExitCode.UserError, `file source include must use POSIX separators: ${value}`, {
      category: ErrorCategory.UserInputInvalid,
      flag: "--include",
    });
  }
  if (value.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new ContextError(ExitCode.UserError, `file source include must not contain empty, dot, or traversal segments: ${value}`, {
      category: ErrorCategory.UserInputInvalid,
      flag: "--include",
    });
  }
}

async function readRegistryDocument(projectRoot: string, registryPath: string): Promise<unknown> {
  try {
    const content = await readFile(join(projectRoot, registryPath), "utf8");
    return content.trim().length === 0 ? { sources: [] } : YAML.parse(content) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { sources: [] };
    throw error;
  }
}

function upsertDocumentBatchModule(input: {
  sources: unknown[];
  namespace: string;
  module: string;
  entry: Record<string, unknown>;
}): unknown[] {
  const incompatible = input.sources.find((source) => {
    if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
    const record = source as Record<string, unknown>;
    return record.name === input.namespace && !Array.isArray(record.modules);
  });
  if (incompatible !== undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `document source '${input.namespace}' uses a flat registry entry where the current protocol requires a date batch with modules`,
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        code: "document-source-date-batch-shape-invalid",
        sourceName: input.namespace,
      },
    );
  }
  const batchIndex = input.sources.findIndex((source) => {
    if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
    const record = source as Record<string, unknown>;
    return record.name === input.namespace && Array.isArray(record.modules);
  });
  const batch = batchIndex >= 0
    ? input.sources[batchIndex] as Record<string, unknown>
    : { name: input.namespace, modules: [] };
  const modules = Array.isArray(batch.modules) ? batch.modules : [];
  const nextModules = [
    ...modules.filter((module) => {
      if (module === null || typeof module !== "object" || Array.isArray(module)) return true;
      const record = module as Record<string, unknown>;
      return record.name !== input.module && record.id !== input.module;
    }),
    input.entry,
  ];
  const nextBatch = { ...batch, name: input.namespace, modules: nextModules };
  if (batchIndex < 0) return [...input.sources, nextBatch];
  return input.sources.map((source, index) => index === batchIndex ? nextBatch : source);
}

function rawDocumentModule(input: {
  sources: unknown[];
  namespace: string;
  module: string;
}): Record<string, unknown> | undefined {
  const batch = input.sources.find((source) => {
    if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
    const record = source as Record<string, unknown>;
    return record.name === input.namespace && Array.isArray(record.modules);
  }) as Record<string, unknown> | undefined;
  const modules = Array.isArray(batch?.modules) ? batch.modules : [];
  const found = modules.find((module) => {
    if (module === null || typeof module !== "object" || Array.isArray(module)) return false;
    const record = module as Record<string, unknown>;
    return record.name === input.module || record.id === input.module;
  });
  return found !== undefined && found !== null && typeof found === "object" && !Array.isArray(found)
    ? { ...(found as Record<string, unknown>) }
    : undefined;
}

function assertDocumentBatchIdentity(input: {
  sourceType: "file" | "lark";
  name: string;
  namespace?: string;
  module?: string;
}): void {
  if (input.namespace === undefined && !SOURCE_NAME_PATTERN.test(input.name)) {
    throw new ContextError(ExitCode.UserError, `${input.sourceType} source name must be a lowercase path-safe slug: ${input.name}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.name,
    });
  }
  if (input.namespace !== undefined &&
    (!isDateSourceNamespace(input.namespace) || input.module === undefined || !SOURCE_NAME_PATTERN.test(input.module))) {
    throw new ContextError(ExitCode.UserError, `${input.sourceType} source batch identity must be YYYYMMDD/module: ${input.name}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.name,
    });
  }
}

function rawSourcesFromDocument(document: unknown): unknown[] {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return [];
  const sources = (document as { sources?: unknown[] }).sources;
  return Array.isArray(sources) ? sources : [];
}

function flatRawSource(sources: unknown[], name: string): unknown {
  return sources.find((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return record.name === name || record.id === name;
  });
}

export interface AddFileSourceInput {
  projectRoot: string;
  name: string;
  namespace?: string;
  module?: string;
  /** Required for a new source; an existing source keeps its registered path when omitted. */
  local?: string;
  include?: readonly string[];
  documentExtensions?: readonly string[];
  layout?: FileSourceLayout;
  /** `true` freezes, `false` unfreezes, undefined keeps the registered state. */
  frozen?: boolean;
  /** Merged into the registered origin; a new origin needs kind, id and version. */
  origin?: Partial<FileSourceOrigin>;
}

/** Keep installed origin content out of Git: only the registry and snapshots are committed. */
async function ensureOriginInstallRootIgnored(projectRoot: string, kind: string): Promise<boolean> {
  const line = `${fileSourceOriginInstallRoot(kind)}/`;
  const path = join(projectRoot, ".gitignore");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = "";
  }
  const lines = current.split(/\r?\n/u).map((value) => value.trim());
  if (lines.includes(line) || lines.includes(`/${line}`)) return false;
  await atomicWriteFile(path, `${current}${current.length === 0 || current.endsWith("\n") ? "" : "\n"}${line}\n`);
  return true;
}

function mergedFileSourceOrigin(
  existing: Record<string, unknown> | undefined,
  requested: Partial<FileSourceOrigin> | undefined,
): FileSourceOrigin | undefined {
  if (requested === undefined) return existing as FileSourceOrigin | undefined;
  const merged = { ...(existing ?? {}), ...Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== undefined)) };
  // A different kind or id is another origin; do not keep the old version or page.
  if (existing !== undefined && ((requested.kind !== undefined && requested.kind !== existing.kind) ||
    (requested.id !== undefined && requested.id !== existing.id))) {
    if (requested.version === undefined) delete merged.version;
    if (requested.url === undefined) delete merged.url;
  } else if (existing !== undefined && requested.version !== undefined && requested.version !== existing.version && requested.url === undefined) {
    delete merged.url;
  }
  for (const field of ["kind", "id", "version"] as const) {
    if (typeof merged[field] !== "string" || (merged[field] as string).length === 0) {
      throw new ContextError(ExitCode.UserError, `file source origin needs --origin-${field}`, {
        category: ErrorCategory.UserInputInvalid,
        flag: `--origin-${field}`,
      });
    }
  }
  return merged as FileSourceOrigin;
}

function nextFileSourceEntry(input: {
  existingEntry: Record<string, unknown>;
  name: string;
  local: string;
  input: AddFileSourceInput;
}): { entry: Record<string, unknown>; origin: FileSourceOrigin | undefined } {
  const { existingEntry, input: request } = input;
  const origin = mergedFileSourceOrigin(
    existingEntry.origin !== null && typeof existingEntry.origin === "object" ? existingEntry.origin as Record<string, unknown> : undefined,
    request.origin,
  );
  const entry: Record<string, unknown> = {
    ...existingEntry,
    name: input.name,
    local: input.local,
    ...(request.include !== undefined ? { include: request.include } : {}),
    ...(request.documentExtensions !== undefined ? { documentExtensions: request.documentExtensions } : {}),
    ...(request.layout !== undefined ? { layout: request.layout } : {}),
    ...(origin !== undefined ? { origin } : {}),
  };
  if (request.frozen === true) entry.frozen = true;
  if (request.frozen === false) delete entry.frozen;
  return { entry, origin };
}

export async function addFileSourceUnlocked(input: AddFileSourceInput): Promise<Record<string, unknown>> {
  assertDocumentBatchIdentity({ sourceType: "file", ...input });
  for (const include of input.include ?? []) assertSafeFileInclude(include);

  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const existing = registry.files.find((source) => source.name === input.name || source.id === input.name);
  const requestedLocal = input.local ?? existing?.local;
  if (requestedLocal === undefined) {
    throw new ContextError(ExitCode.UserError, "source add file requires --local <path>", {
      category: ErrorCategory.UserInputInvalid,
      flag: "--local",
    });
  }
  const local = await normalizeFileSourceLocal(input.projectRoot, requestedLocal);
  if (registry.repos.some((source) => source.name === input.name || source.id === input.name) ||
    registry.larks.some((source) => source.name === input.name || source.id === input.name)) {
    throw new ContextError(ExitCode.UserError, `source identifier already exists outside file registry: ${input.name}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.name,
    });
  }

  const sources = rawSourcesFromDocument(
    await readRegistryDocument(input.projectRoot, DEFAULT_FILE_SOURCES_REGISTRY_PATH),
  );
  const existingRaw = input.namespace !== undefined && input.module !== undefined
    ? rawDocumentModule({ sources, namespace: input.namespace, module: input.module })
    : flatRawSource(sources, input.name);
  const existingEntry = existingRaw !== undefined && existingRaw !== null && typeof existingRaw === "object" && !Array.isArray(existingRaw)
    ? { ...(existingRaw as Record<string, unknown>) }
    : {};
  if (existing !== undefined && existing.id !== existing.name && existingEntry.id === undefined) existingEntry.id = existing.id;
  const { entry: nextEntry, origin } = nextFileSourceEntry({
    existingEntry,
    name: input.module ?? existing?.module ?? existing?.name ?? input.name,
    local,
    input,
  });
  const nextSources = input.namespace !== undefined && input.module !== undefined
    ? upsertDocumentBatchModule({ sources, namespace: input.namespace, module: input.module, entry: nextEntry })
    : [...sources.filter((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
        const record = entry as Record<string, unknown>;
        return record.name !== input.name && record.id !== input.name;
      }), nextEntry];

  // Validate the whole registry (including origin install paths) before writing it.
  try {
    parseFileSourcesRegistryDocument({ sources: nextSources }, DEFAULT_FILE_SOURCES_REGISTRY_PATH);
  } catch (error) {
    throw new ContextError(ExitCode.UserError, error instanceof Error ? error.message : String(error), {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.name,
    });
  }
  await atomicWriteFile(join(input.projectRoot, DEFAULT_FILE_SOURCES_REGISTRY_PATH), YAML.stringify({ sources: nextSources }));
  const gitignoreUpdated = origin !== undefined && await ensureOriginInstallRootIgnored(input.projectRoot, origin.kind);
  const updated = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const entry = updated.files.find((source) => source.name === input.name || source.id === input.name);
  if (entry === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `file source '${input.name}' was not written`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceName: input.name,
    });
  }
  const view = await fileSourceAgentViewWithNextAction({ projectRoot: input.projectRoot, source: entry });
  return gitignoreUpdated ? { ...view, gitignore_added: `${fileSourceOriginInstallRoot(origin!.kind)}/` } : view;
}

function larkIdentityFlags(input: {
  url?: string;
  docToken?: string;
  wikiToken?: string;
}): Array<"url" | "docToken" | "wikiToken"> {
  return [
    input.url !== undefined ? "url" as const : undefined,
    input.docToken !== undefined ? "docToken" as const : undefined,
    input.wikiToken !== undefined ? "wikiToken" as const : undefined,
  ].filter((value): value is "url" | "docToken" | "wikiToken" => value !== undefined);
}

export interface AddLarkSourceInput {
  projectRoot: string;
  name: string;
  namespace?: string;
  module?: string;
  url?: string;
  docToken?: string;
  wikiToken?: string;
  title?: string;
}

export function assertLarkSourceIdentity(input: AddLarkSourceInput): void {
  assertDocumentBatchIdentity({ sourceType: "lark", ...input });
  if (larkIdentityFlags(input).length !== 1) {
    throw new ContextError(ExitCode.UserError, "source add lark requires exactly one of --url, --doc-token, or --wiki-token", {
      category: ErrorCategory.UserInputInvalid,
      flags: ["--url", "--doc-token", "--wiki-token"],
    });
  }
}

export async function addLarkSourceUnlocked(input: AddLarkSourceInput): Promise<Record<string, unknown>> {
  assertLarkSourceIdentity(input);

  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const existing = registry.larks.find((source) => source.name === input.name || source.id === input.name);
  if (registry.repos.some((source) => source.name === input.name || source.id === input.name) ||
    registry.files.some((source) => source.name === input.name || source.id === input.name)) {
    throw new ContextError(ExitCode.UserError, `source identifier already exists outside lark registry: ${input.name}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.name,
    });
  }

  const sources = rawSourcesFromDocument(
    await readRegistryDocument(input.projectRoot, DEFAULT_LARK_SOURCES_REGISTRY_PATH),
  );
  const existingRaw = input.namespace !== undefined && input.module !== undefined
    ? rawDocumentModule({ sources, namespace: input.namespace, module: input.module })
    : flatRawSource(sources, input.name);
  const existingEntry = existingRaw !== undefined && existingRaw !== null && typeof existingRaw === "object" && !Array.isArray(existingRaw)
    ? { ...(existingRaw as Record<string, unknown>) }
    : {};
  if (existing !== undefined && existing.id !== existing.name && existingEntry.id === undefined) existingEntry.id = existing.id;
  delete existingEntry.url;
  delete existingEntry.docToken;
  delete existingEntry.wikiToken;
  const nextEntry = {
    ...existingEntry,
    name: input.module ?? existing?.module ?? existing?.name ?? input.name,
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.docToken !== undefined ? { docToken: input.docToken } : {}),
    ...(input.wikiToken !== undefined ? { wikiToken: input.wikiToken } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
  };
  const nextSources = input.namespace !== undefined && input.module !== undefined
    ? upsertDocumentBatchModule({ sources, namespace: input.namespace, module: input.module, entry: nextEntry })
    : [...sources.filter((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
        const record = entry as Record<string, unknown>;
        return record.name !== input.name && record.id !== input.name;
      }), nextEntry];

  await atomicWriteFile(join(input.projectRoot, DEFAULT_LARK_SOURCES_REGISTRY_PATH), YAML.stringify({ sources: nextSources }));
  const updated = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const entry = updated.larks.find((source) => source.name === input.name || source.id === input.name);
  if (entry === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `lark source '${input.name}' was not written`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceName: input.name,
    });
  }
  return larkSourceAgentViewWithNextAction({ projectRoot: input.projectRoot, source: entry });
}

export async function addFileSource(input: AddFileSourceInput): Promise<Record<string, unknown>> {
  return withProjectWriteLock(input.projectRoot, "source-add-file", () => addFileSourceUnlocked(input));
}

export async function addLarkSource(input: AddLarkSourceInput): Promise<Record<string, unknown>> {
  return withProjectWriteLock(input.projectRoot, "source-add-lark", () => addLarkSourceUnlocked(input));
}
