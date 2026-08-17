import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  DEFAULT_FILE_SOURCES_REGISTRY_PATH,
  DEFAULT_LARK_SOURCES_REGISTRY_PATH,
  loadSourcesRegistry,
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
  local: string;
  include?: readonly string[];
}

export async function addFileSourceUnlocked(input: AddFileSourceInput): Promise<Record<string, unknown>> {
  assertDocumentBatchIdentity({ sourceType: "file", ...input });
  const local = await normalizeFileSourceLocal(input.projectRoot, input.local);
  for (const include of input.include ?? []) assertSafeFileInclude(include);

  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const existing = registry.files.find((source) => source.name === input.name || source.id === input.name);
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
  const nextEntry = {
    ...existingEntry,
    name: input.module ?? existing?.module ?? existing?.name ?? input.name,
    local,
    ...(input.include !== undefined ? { include: input.include } : {}),
  };
  const nextSources = input.namespace !== undefined && input.module !== undefined
    ? upsertDocumentBatchModule({ sources, namespace: input.namespace, module: input.module, entry: nextEntry })
    : [...sources.filter((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
        const record = entry as Record<string, unknown>;
        return record.name !== input.name && record.id !== input.name;
      }), nextEntry];

  await atomicWriteFile(join(input.projectRoot, DEFAULT_FILE_SOURCES_REGISTRY_PATH), YAML.stringify({ sources: nextSources }));
  const updated = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const entry = updated.files.find((source) => source.name === input.name || source.id === input.name);
  if (entry === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `file source '${input.name}' was not written`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceName: input.name,
    });
  }
  return fileSourceAgentViewWithNextAction({ projectRoot: input.projectRoot, source: entry });
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

export async function addLarkSourceUnlocked(input: AddLarkSourceInput): Promise<Record<string, unknown>> {
  assertDocumentBatchIdentity({ sourceType: "lark", ...input });
  if (larkIdentityFlags(input).length !== 1) {
    throw new ContextError(ExitCode.UserError, "source add lark requires exactly one of --url, --doc-token, or --wiki-token", {
      category: ErrorCategory.UserInputInvalid,
      flags: ["--url", "--doc-token", "--wiki-token"],
    });
  }

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
