import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_LARK_SOURCES_REGISTRY_PATH,
  loadSourcesRegistry,
  parseLarkSourcesRegistry,
  type LarkSourceRegistryEntry,
} from "@c4a/context";
import YAML from "yaml";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  assertLarkSourceIdentity,
  type AddLarkSourceInput,
} from "./documentSourceRegistration.js";
import { larkSourceAgentViewWithNextAction } from "./sourceCommandViews.js";

type RawEntry = Record<string, unknown>;
export type LarkBatchRegistrationItem = Omit<AddLarkSourceInput, "projectRoot" | "namespace" | "name" | "module"> & {
  module: string;
};

export interface LarkBatchRegistration {
  /** Stage one validated item. It is durable only after flush succeeds. */
  add(item: LarkBatchRegistrationItem): Promise<Record<string, unknown>>;
  /** Atomically commit the staged valid prefix. The object remains reusable. */
  flush(): Promise<void>;
}

function identityKeys(entry: { id: string; name: string }): Set<string> {
  return new Set([entry.name, entry.id]);
}

/**
 * The caller must hold the project write lock throughout this object's lifetime.
 * Recreate it after any registration performed outside this object.
 */
export async function createLarkBatchRegistration(
  projectRoot: string,
  namespace: string,
): Promise<LarkBatchRegistration> {
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const registryPath = join(projectRoot, DEFAULT_LARK_SOURCES_REGISTRY_PATH);
  let committedSources: RawEntry[];
  try {
    const text = await readFile(registryPath, "utf8");
    committedSources = text.trim().length === 0 ? [] : (YAML.parse(text) as { sources?: RawEntry[] }).sources ?? [];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    committedSources = [];
  }

  let batchIndex = committedSources.findIndex(source => source.name === namespace && Array.isArray(source.modules));
  const incompatible = committedSources.some(source => source.name === namespace && !Array.isArray(source.modules));
  const initialModules = (batchIndex < 0 ? [] : committedSources[batchIndex]!.modules) as RawEntry[];
  const modules = new Map(initialModules.map(entry => [entry.name as string, entry]));
  const moduleKeys = new Map<string, RawEntry>();
  for (const entry of initialModules) {
    moduleKeys.set(entry.name as string, entry);
    if (typeof entry.id === "string") moduleKeys.set(entry.id, entry);
  }

  const larkKeys = new Map<string, LarkSourceRegistryEntry>();
  for (const entry of registry.larks) for (const key of identityKeys(entry)) larkKeys.set(key, entry);
  const otherKeys = new Map<string, "repo" | "file">();
  for (const [type, entries] of [["repo", registry.repos], ["file", registry.files]] as const) {
    for (const entry of entries) for (const key of identityKeys(entry)) otherKeys.set(key, type);
  }
  let pending = false;

  return {
    async add(item) {
      const name = `${namespace}/${item.module}`;
      assertLarkSourceIdentity({ projectRoot, namespace, name, ...item });
      if (otherKeys.has(name)) {
        throw new ContextError(ExitCode.UserError, `source identifier already exists outside lark registry: ${name}`, {
          category: ErrorCategory.UserInputInvalid,
          sourceName: name,
        });
      }
      if (incompatible) {
        throw new ContextError(ExitCode.WorkspaceStateError,
          `document source '${namespace}' uses a flat registry entry where the current protocol requires a date batch with modules`, {
            category: ErrorCategory.WorkspaceStateInvalid,
            code: "document-source-date-batch-shape-invalid",
            sourceName: namespace,
          });
      }

      const existing = larkKeys.get(name);
      const previousRaw = moduleKeys.get(item.module);
      const existingEntry = { ...previousRaw };
      if (existing !== undefined && existing.id !== existing.name && existingEntry.id === undefined) existingEntry.id = existing.id;
      delete existingEntry.url;
      delete existingEntry.docToken;
      delete existingEntry.wikiToken;
      const nextEntry: RawEntry = {
        ...existingEntry,
        name: item.module,
        ...(item.url !== undefined ? { url: item.url } : {}),
        ...(item.docToken !== undefined ? { docToken: item.docToken } : {}),
        ...(item.wikiToken !== undefined ? { wikiToken: item.wikiToken } : {}),
        ...(item.title !== undefined ? { title: item.title } : {}),
      };
      // Validate one entry with the SDK's exact schema/path/identity rules, not
      // the growing registry. No in-memory state changes before all checks pass.
      const parsed = parseLarkSourcesRegistry({ sources: [{ name: namespace, modules: [nextEntry] }] },
        DEFAULT_LARK_SOURCES_REGISTRY_PATH)[0]!;
      const previous = previousRaw === undefined ? undefined : larkKeys.get(`${namespace}/${String(previousRaw.name)}`);
      for (const key of identityKeys(parsed)) {
        const otherType = otherKeys.get(key);
        if (otherType !== undefined) {
          throw new TypeError(`Duplicate source identifier "${key}" across ${otherType} and lark registries`);
        }
        const conflict = larkKeys.get(key);
        if (conflict !== undefined && conflict !== previous) {
          throw new TypeError(`Duplicate lark source identifier "${key}" in ${DEFAULT_LARK_SOURCES_REGISTRY_PATH}`);
        }
      }
      const result = await larkSourceAgentViewWithNextAction({ projectRoot, source: parsed });
      if (previousRaw !== undefined) {
        modules.delete(previousRaw.name as string);
        moduleKeys.delete(previousRaw.name as string);
        if (typeof previousRaw.id === "string") moduleKeys.delete(previousRaw.id);
      }
      if (previous !== undefined) for (const key of identityKeys(previous)) larkKeys.delete(key);
      modules.set(item.module, nextEntry);
      moduleKeys.set(item.module, nextEntry);
      if (typeof nextEntry.id === "string") moduleKeys.set(nextEntry.id, nextEntry);
      for (const key of identityKeys(parsed)) larkKeys.set(key, parsed);
      pending = true;
      return result;
    },
    async flush() {
      if (!pending) return;
      const batch = {
        ...(batchIndex < 0 ? {} : committedSources[batchIndex]),
        name: namespace,
        modules: [...modules.values()],
      };
      const nextSources = batchIndex < 0
        ? [...committedSources, batch]
        : committedSources.map((source, index) => index === batchIndex ? batch : source);
      if (!isDeepStrictEqual(nextSources, committedSources)) {
        await atomicWriteFile(registryPath, YAML.stringify({ sources: nextSources }));
        committedSources = nextSources;
        if (batchIndex < 0) batchIndex = committedSources.length - 1;
      }
      pending = false;
    },
  };
}
