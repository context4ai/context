import { existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  DEFAULT_REPO_SOURCES_REGISTRY_PATH,
  loadSourcesRegistry,
  type RepoSourceRegistryEntry,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";

const SOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const REPO_DATE_NAMESPACE_PATTERN = /^\d{8}$/u;

export interface RepoSourceRecord {
  name: string;
  namespace: string;
  module: string;
  id?: string;
  local?: string;
  subpath?: string;
  materializedAt?: string;
  git: {
    remote: string;
    ref: string;
  };
}

interface RepoSourceRegistryFile {
  repos: RepoSourceRecord[];
}

export function assertRepoModuleName(name: string): void {
  if (!SOURCE_NAME_PATTERN.test(name)) {
    throw new ContextError(ExitCode.UserError, `repo source name must be a lowercase path-safe slug: ${name}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: name,
    });
  }
}

export function assertRepoDateNamespace(name: string): void {
  if (!REPO_DATE_NAMESPACE_PATTERN.test(name)) {
    throw invalidRepoDateNamespace(name);
  }
  const year = Number(name.slice(0, 4));
  const month = Number(name.slice(4, 6));
  const day = Number(name.slice(6, 8));
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw invalidRepoDateNamespace(name);
  }
}

function invalidRepoDateNamespace(name: string): ContextError {
  return new ContextError(ExitCode.UserError, `repo source batch must be a valid YYYYMMDD date: ${name}`, {
    category: ErrorCategory.UserInputInvalid,
    namespace: name,
  });
}

export function selectRepoSources(
  sources: readonly RepoSourceRecord[],
  selector: string | undefined,
): RepoSourceRecord[] {
  if (selector === undefined) return [...sources];
  const exact = sources.filter((source) => source.name === selector || source.id === selector);
  return exact.length > 0
    ? exact
    : sources.filter((source) => source.namespace === selector);
}

function registryEntryToRecord(entry: RepoSourceRegistryEntry): RepoSourceRecord {
  return {
    name: entry.name,
    namespace: entry.namespace,
    module: entry.module,
    id: entry.id,
    ...(entry.local !== undefined ? { local: entry.local } : {}),
    ...(entry.subpath !== undefined ? { subpath: entry.subpath } : {}),
    materializedAt: entry.materializedAt,
    git: {
      remote: entry.remote,
      ref: entry.ref,
    },
  };
}

function registryPath(projectRoot: string): string {
  return join(projectRoot, DEFAULT_REPO_SOURCES_REGISTRY_PATH);
}

export function defaultRepoMaterializedAt(
  source: Pick<RepoSourceRecord, "namespace" | "module">,
): string {
  return `sources/repo/${source.namespace}/${source.module}`;
}

export async function readRepoRegistry(projectRoot: string): Promise<RepoSourceRegistryFile> {
  const path = registryPath(projectRoot);
  if (!existsSync(path)) return { repos: [] };
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  return {
    repos: registry.repos.map(registryEntryToRecord),
  };
}

export async function writeRepoRegistry(
  projectRoot: string,
  registry: RepoSourceRegistryFile,
): Promise<void> {
  const path = registryPath(projectRoot);
  const namespaces = new Map<string, ReturnType<typeof registryRecordToYaml>[]>();
  for (const record of registry.repos) {
    const modules = namespaces.get(record.namespace) ?? [];
    modules.push(registryRecordToYaml(record));
    namespaces.set(record.namespace, modules);
  }
  await atomicWriteFile(path, YAML.stringify({
    sources: [...namespaces].map(([name, modules]) => ({ name, modules })),
  }));
}

function registryRecordToYaml(record: RepoSourceRecord): Omit<RepoSourceRecord, "namespace" | "module"> {
  const output: Omit<RepoSourceRecord, "namespace" | "module"> = {
    name: record.module,
    ...(record.local !== undefined ? { local: record.local } : {}),
    ...(record.subpath !== undefined ? { subpath: record.subpath } : {}),
    git: {
      remote: record.git.remote,
      ref: record.git.ref,
    },
  };

  const defaultId = `${record.namespace}/${record.module}`;
  if (record.id !== undefined && record.id !== defaultId) {
    output.id = record.id.startsWith(`${record.namespace}/`)
      ? record.id.slice(record.namespace.length + 1)
      : record.id;
  }

  if (record.materializedAt !== undefined && record.materializedAt !== defaultRepoMaterializedAt(record)) {
    output.materializedAt = record.materializedAt;
  }

  return output;
}
