import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export type SourceType = "repo" | "file" | "lark";
export type DocumentSourceType = Extract<SourceType, "file" | "lark">;
export const DEFAULT_REPO_SOURCES_REGISTRY_PATH = "sources/repo/index.yaml";
export const DEFAULT_FILE_SOURCES_REGISTRY_PATH = "sources/file/index.yaml";
export const DEFAULT_LARK_SOURCES_REGISTRY_PATH = "sources/lark/index.yaml";
const SOURCE_TYPES: readonly SourceType[] = ["repo", "file", "lark"];
const SOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const REPO_DATE_NAMESPACE_PATTERN = /^\d{8}$/u;

export type RepoSourceDefinition = {
  kind: "source.repo";
  id: string;
  name: string;
  namespace: string;
  module: string;
  local?: string;
  subpath?: string;
  materializedAt: string;
  git: {
    remote: string;
    ref: string;
  };
};

export type FileSourceDefinition = {
  kind: "source.file";
  id: string;
  name: string;
  namespace?: string;
  module?: string;
  local?: string;
  materializedAt: string;
  include?: readonly string[];
  snapshot?: {
    manifest: string;
  };
};

export type LarkSourceDefinition = {
  kind: "source.lark";
  id: string;
  name: string;
  namespace?: string;
  module?: string;
  materializedAt: string;
  url?: string;
  docToken?: string;
  wikiToken?: string;
  title?: string;
  snapshot?: {
    manifest: string;
  };
};

export type TypedSourceReference<TType extends SourceType = SourceType> = {
  kind: "source.ref";
  type: TType;
  name: string;
  materializedAt: string;
};

export type RegistrySourceReference = {
  kind: "source.ref";
  name: string;
  materializedAt: string;
};

export type SourceReference<TType extends SourceType = SourceType> = TypedSourceReference<TType>;

export type RepoSourceReference = RegistrySourceReference | TypedSourceReference<"repo">;
export type FileSourceReference = RegistrySourceReference | TypedSourceReference<"file">;
export type LarkSourceReference = RegistrySourceReference | TypedSourceReference<"lark">;
export type DocumentSourceReference = FileSourceReference | LarkSourceReference;

export type SourceCollectionReference<TType extends SourceType = SourceType> = {
  kind: "source.collection";
  type: TType;
};

export type RepoSourceRegistryEntry = {
  id: string;
  name: string;
  namespace: string;
  module: string;
  local?: string;
  subpath?: string;
  materializedAt: string;
  remote: string;
  ref: string;
};

export type FileSourceRegistryEntry = {
  id: string;
  name: string;
  namespace?: string;
  module?: string;
  local?: string;
  materializedAt: string;
  include?: readonly string[];
  snapshot?: {
    manifest: string;
  };
};

export type LarkSourceRegistryEntry = {
  id: string;
  name: string;
  namespace?: string;
  module?: string;
  materializedAt: string;
  url?: string;
  docToken?: string;
  wikiToken?: string;
  title?: string;
  snapshot?: {
    manifest: string;
  };
};

export type RepoSourcesRegistry = {
  kind: "sources.registry.repo";
  registryPath: string;
  absolutePath: string;
  repos: readonly RepoSourceRegistryEntry[];
};

export type SourcesRegistry = {
  kind: "sources.registry";
  registryPaths: {
    repo: string;
    file: string;
    lark: string;
  };
  absolutePaths: {
    repo: string;
    file: string;
    lark: string;
  };
  repos: readonly RepoSourceRegistryEntry[];
  files: readonly FileSourceRegistryEntry[];
  larks: readonly LarkSourceRegistryEntry[];
};

export type LoadSourcesRegistryOptions = {
  rootDir?: string;
  registryPath?: string;
  repoRegistryPath?: string;
  fileRegistryPath?: string;
  larkRegistryPath?: string;
};

export type SourceDefinition =
  | RepoSourceDefinition
  | FileSourceDefinition
  | LarkSourceDefinition
  | RegistrySourceReference
  | SourceReference;
export type DocumentSourceDefinition =
  | FileSourceDefinition
  | LarkSourceDefinition
  | DocumentSourceReference;
export type RepoProjectSourceDefinition = RepoSourceDefinition | RepoSourceReference | SourceCollectionReference<"repo">;
export type ProjectSourceDefinition = SourceDefinition | SourceCollectionReference;

function assertSourceType(value: string, field: string): asserts value is SourceType {
  if (!(SOURCE_TYPES as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${SOURCE_TYPES.join(", ")}: ${value}`);
  }
}

export function source(name: string): RegistrySourceReference;
export function source(namespace: string, module: string): RepoSourceReference;
export function source(namespace: string, module: string, options: { type: "repo" }): RepoSourceReference;
export function source(namespace: string, module: string, options: { type: "file" }): FileSourceReference;
export function source(namespace: string, module: string, options: { type: "lark" }): LarkSourceReference;
export function source(name: string, options: { type: "repo" }): RepoSourceReference;
export function source(name: string, options: { type: "file" }): FileSourceReference;
export function source(name: string, options: { type: "lark" }): LarkSourceReference;
export function source(
  name: string,
  options?: string | { type?: SourceType },
  moduleOptions?: { type?: SourceType },
): RegistrySourceReference | SourceReference {
  if (typeof options === "string") {
    const moduleName = options;
    const type = moduleOptions?.type ?? "repo";
    assertSourceType(type, "source type");
    return {
      kind: "source.ref",
      type,
      name: `${name}/${moduleName}`,
      materializedAt: type === "repo" ? `sources/repo/${name}/${moduleName}` : `sources/${type}/${name}`,
    };
  }
  const type = options?.type;
  if (type === undefined) {
    return {
      kind: "source.ref",
      name,
      materializedAt: `sources/${name}`,
    };
  }

  assertSourceType(type, "source type");

  return {
    kind: "source.ref",
    type,
    name,
    materializedAt: `sources/${type}/${name}`,
  };
}

const repoSourceModuleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  local: z.string().min(1).optional(),
  subpath: z.string().min(1).optional(),
  materializedAt: z.string().min(1).optional(),
  git: z.object({
    remote: z.string().min(1),
    ref: z.string().min(1),
  }).strict().optional(),
}).strict();

const repoSourceRegistryEntrySchema = z.object({
  name: z.string().min(1),
  modules: z.array(repoSourceModuleSchema).min(1),
}).strict();

const sourceSnapshotSchema = z.object({
  manifest: z.string().min(1),
}).strict();

const fileSourceRegistryEntrySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  local: z.string().min(1).optional(),
  include: z.array(z.string().min(1)).optional(),
  materializedAt: z.string().min(1).optional(),
  snapshot: sourceSnapshotSchema.optional(),
}).strict();

const fileSourceBatchSchema = z.object({
  name: z.string().min(1),
  modules: z.array(fileSourceRegistryEntrySchema).min(1),
}).strict();

const larkSourceRegistryEntrySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  materializedAt: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  docToken: z.string().min(1).optional(),
  wikiToken: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  snapshot: sourceSnapshotSchema.optional(),
}).strict();

const larkSourceBatchSchema = z.object({
  name: z.string().min(1),
  modules: z.array(larkSourceRegistryEntrySchema).min(1),
}).strict();

const repoSourcesRegistrySchema = z.object({
  sources: z.array(repoSourceRegistryEntrySchema).default([]),
}).strict();

const fileSourcesRegistrySchema = z.object({
  sources: z.array(z.union([fileSourceRegistryEntrySchema, fileSourceBatchSchema])).default([]),
}).strict();

const larkSourcesRegistrySchema = z.object({
  sources: z.array(z.union([larkSourceRegistryEntrySchema, larkSourceBatchSchema])).default([]),
}).strict();

const formatRegistryIssues = (issues: readonly z.ZodIssue[]): string => issues
  .map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  })
  .join("; ");

const isAbsoluteRegistryPath = (value: string): boolean =>
  value.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(value);

const assertSourceName = (sourceType: SourceType, name: string, registryPath: string): void => {
  if (!SOURCE_NAME_PATTERN.test(name)) {
    throw new TypeError(`${sourceType} source name must be a lowercase path-safe slug in ${registryPath}: ${name}`);
  }
};

const assertDateSourceNamespace = (sourceType: SourceType, name: string, registryPath: string): void => {
  if (!REPO_DATE_NAMESPACE_PATTERN.test(name)) {
    throw new TypeError(`${sourceType} source batch must be a valid YYYYMMDD date in ${registryPath}: ${name}`);
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
    throw new TypeError(`${sourceType} source batch must be a valid YYYYMMDD date in ${registryPath}: ${name}`);
  }
};

const assertRegistryRelativePath = (sourceType: SourceType, name: string, field: string, value: string, registryPath: string): void => {
  if (value.length === 0 || value.includes("\0") || isAbsoluteRegistryPath(value)) {
    throw new TypeError(`${sourceType} source "${name}" in ${registryPath} has invalid ${field}; use a committed relative path`);
  }
  if (value.split(/[\\/]/u).some((part) => part.length === 0 || part === ".")) {
    throw new TypeError(`${sourceType} source "${name}" in ${registryPath} has invalid ${field}; use a committed relative path`);
  }
};

const assertWorkspaceRelativePath = (
  sourceType: SourceType,
  name: string,
  field: string,
  value: string,
  registryPath: string,
): void => {
  if (value.length === 0 || value.includes("\0") || isAbsoluteRegistryPath(value)) {
    throw new TypeError(`${sourceType} source "${name}" in ${registryPath} has invalid ${field}; use a workspace-relative path without traversal`);
  }
  if (value.split(/[\\/]/u).some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new TypeError(`${sourceType} source "${name}" in ${registryPath} has invalid ${field}; use a workspace-relative path without traversal`);
  }
};

const assertDocumentSourcePath = (
  sourceType: DocumentSourceType,
  name: string,
  field: string,
  value: string,
  registryPath: string,
  options: { allowBase?: boolean } = {},
): void => {
  assertWorkspaceRelativePath(sourceType, name, field, value, registryPath);
  const normalized = value.replaceAll("\\", "/");
  const [namespace, module, ...rest] = name.split("/");
  const batchName = module !== undefined && rest.length === 0 && REPO_DATE_NAMESPACE_PATTERN.test(namespace ?? "")
    ? namespace
    : name;
  const base = `sources/${sourceType}/${batchName}`;
  if (normalized === base && options.allowBase === true) return;
  if (!normalized.startsWith(`${base}/`)) {
    throw new TypeError(`${sourceType} source "${name}" in ${registryPath} has invalid ${field}; expected path under ${base}`);
  }
};

const assertDocumentIncludePath = (
  sourceType: DocumentSourceType,
  name: string,
  field: string,
  value: string,
  registryPath: string,
): void => {
  assertWorkspaceRelativePath(sourceType, name, field, value, registryPath);
};

const parseRepoSourcesRegistry = (
  input: unknown,
  registryPath: string,
  absolutePath: string,
): RepoSourcesRegistry => {
  const parsed = repoSourcesRegistrySchema.safeParse(input);

  if (!parsed.success) {
    throw new TypeError(
      `Invalid repo sources registry ${registryPath}: ${formatRegistryIssues(parsed.error.issues)}`,
    );
  }

  const seenSourceKeys = new Set<string>();
  const moduleNamespaces = new Map<string, string>();
  const repos = parsed.data.sources.flatMap((namespaceEntry) => {
    assertDateSourceNamespace("repo", namespaceEntry.name, registryPath);
    const namespace = namespaceEntry.name;
    return namespaceEntry.modules.map((entry) => {
    assertSourceName("repo", entry.name, registryPath);
    if (entry.id !== undefined) assertSourceName("repo", entry.id, registryPath);
    const existingNamespace = moduleNamespaces.get(entry.name);
    if (existingNamespace !== undefined && existingNamespace !== namespace) {
      throw new TypeError(
        `Duplicate repo module ${JSON.stringify(entry.name)} across date batches ${existingNamespace} and ${namespace} in ${registryPath}; repo module names are project-wide code-index identities`,
      );
    }
    moduleNamespaces.set(entry.name, namespace);
    const name = `${namespace}/${entry.name}`;
    const id = `${namespace}/${entry.id ?? entry.name}`;
    for (const key of new Set([name, id])) {
      if (seenSourceKeys.has(key)) {
        throw new TypeError(`Duplicate repo source identifier "${key}" in ${registryPath}`);
      }
      seenSourceKeys.add(key);
    }

    const remote = entry.git?.remote;
    const ref = entry.git?.ref;

    if (!remote) {
      throw new TypeError(`Repo source "${name}" in ${registryPath} is missing remote`);
    }

    if (!ref) {
      throw new TypeError(`Repo source "${name}" in ${registryPath} is missing ref`);
    }

    const materializedAt = entry.materializedAt ?? `sources/repo/${namespace}/${entry.name}`;
    assertWorkspaceRelativePath("repo", name, "materializedAt", materializedAt, registryPath);

    const normalized: RepoSourceRegistryEntry = {
      id,
      name,
      namespace,
      module: entry.name,
      materializedAt,
      remote,
      ref,
    };

    if (entry.local) {
      normalized.local = entry.local;
    }
    if (entry.subpath) {
      assertWorkspaceRelativePath("repo", name, "subpath", entry.subpath, registryPath);
      normalized.subpath = entry.subpath;
    }

    return normalized;
    });
  });

  return {
    kind: "sources.registry.repo",
    registryPath,
    absolutePath,
    repos,
  };
};

const parseFileSourcesRegistry = (
  input: unknown,
  registryPath: string,
): readonly FileSourceRegistryEntry[] => {
  const parsed = fileSourcesRegistrySchema.safeParse(input);

  if (!parsed.success) {
    throw new TypeError(
      `Invalid file sources registry ${registryPath}: ${formatRegistryIssues(parsed.error.issues)}`,
    );
  }

  const seenSourceKeys = new Set<string>();
  return parsed.data.sources.flatMap((sourceEntry) => {
    const namespace = "modules" in sourceEntry ? sourceEntry.name : undefined;
    if (namespace !== undefined) assertDateSourceNamespace("file", namespace, registryPath);
    const entries = "modules" in sourceEntry ? sourceEntry.modules : [sourceEntry];
    return entries.map((entry) => {
    assertSourceName("file", entry.name, registryPath);
    const name = namespace === undefined ? entry.name : `${namespace}/${entry.name}`;
    if (entry.local !== undefined) {
      assertRegistryRelativePath("file", name, "local", entry.local, registryPath);
    }
    const materializedAt = entry.materializedAt ?? `sources/file/${namespace ?? name}`;
    assertDocumentSourcePath("file", name, "materializedAt", materializedAt, registryPath, { allowBase: true });
    for (const [index, include] of (entry.include ?? []).entries()) {
      assertDocumentIncludePath("file", name, `include[${index}]`, include, registryPath);
    }
    const snapshot = entry.snapshot ?? (namespace !== undefined
      ? { manifest: `sources/file/${namespace}/manifest.json` }
      : undefined);
    if (snapshot !== undefined) {
      assertDocumentSourcePath("file", name, "snapshot.manifest", snapshot.manifest, registryPath);
    }
    const id = namespace === undefined ? entry.id ?? entry.name : `${namespace}/${entry.id ?? entry.name}`;
    for (const key of new Set([name, id])) {
      if (seenSourceKeys.has(key)) {
        throw new TypeError(`Duplicate file source identifier "${key}" in ${registryPath}`);
      }
      seenSourceKeys.add(key);
    }

    return {
      id,
      name,
      ...(namespace !== undefined ? { namespace, module: entry.name } : {}),
      materializedAt,
      ...(entry.local !== undefined ? { local: entry.local } : {}),
      ...(entry.include !== undefined ? { include: entry.include } : {}),
      ...(snapshot !== undefined ? { snapshot } : {}),
    };
    });
  });
};

const parseLarkSourcesRegistry = (
  input: unknown,
  registryPath: string,
): readonly LarkSourceRegistryEntry[] => {
  const parsed = larkSourcesRegistrySchema.safeParse(input);

  if (!parsed.success) {
    throw new TypeError(
      `Invalid lark sources registry ${registryPath}: ${formatRegistryIssues(parsed.error.issues)}`,
    );
  }

  const seenSourceKeys = new Set<string>();
  return parsed.data.sources.flatMap((sourceEntry) => {
    const namespace = "modules" in sourceEntry ? sourceEntry.name : undefined;
    if (namespace !== undefined) assertDateSourceNamespace("lark", namespace, registryPath);
    const entries = "modules" in sourceEntry ? sourceEntry.modules : [sourceEntry];
    return entries.map((entry) => {
    assertSourceName("lark", entry.name, registryPath);
    const name = namespace === undefined ? entry.name : `${namespace}/${entry.name}`;
    const identityCount = [
      entry.url !== undefined,
      entry.docToken !== undefined,
      entry.wikiToken !== undefined,
    ].filter(Boolean).length;
    if (identityCount !== 1) {
      throw new TypeError(`Lark source "${name}" in ${registryPath} must declare exactly one of url, docToken, or wikiToken`);
    }

    const materializedAt = entry.materializedAt ?? `sources/lark/${namespace ?? name}`;
    assertDocumentSourcePath("lark", name, "materializedAt", materializedAt, registryPath, { allowBase: true });
    const snapshot = entry.snapshot ?? (namespace !== undefined
      ? { manifest: `sources/lark/${namespace}/manifest.json` }
      : undefined);
    if (snapshot !== undefined) {
      assertDocumentSourcePath("lark", name, "snapshot.manifest", snapshot.manifest, registryPath);
    }

    const id = namespace === undefined ? entry.id ?? entry.name : `${namespace}/${entry.id ?? entry.name}`;
    for (const key of new Set([name, id])) {
      if (seenSourceKeys.has(key)) {
        throw new TypeError(`Duplicate lark source identifier "${key}" in ${registryPath}`);
      }
      seenSourceKeys.add(key);
    }

    return {
      id,
      name,
      ...(namespace !== undefined ? { namespace, module: entry.name } : {}),
      materializedAt,
      ...(entry.url !== undefined ? { url: entry.url } : {}),
      ...(entry.docToken !== undefined ? { docToken: entry.docToken } : {}),
      ...(entry.wikiToken !== undefined ? { wikiToken: entry.wikiToken } : {}),
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      ...(snapshot !== undefined ? { snapshot } : {}),
    };
    });
  });
};

const readYamlIfPresent = async (absolutePath: string, emptyValue: unknown): Promise<unknown> => {
  try {
    const content = await readFile(absolutePath, "utf8");
    return content.trim().length === 0 ? emptyValue : parse(content) as unknown;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyValue;
    }
    throw error;
  }
};

const assertGlobalSourceUniqueness = (registry: SourcesRegistry): void => {
  const seen = new Map<string, SourceType>();
  for (const [sourceType, entries] of [
    ["repo", registry.repos],
    ["file", registry.files],
    ["lark", registry.larks],
  ] as const) {
    for (const entry of entries) {
      for (const key of new Set([entry.name, entry.id])) {
        const previous = seen.get(key);
        if (previous !== undefined) {
          throw new TypeError(`Duplicate source identifier "${key}" across ${previous} and ${sourceType} registries`);
        }
        seen.set(key, sourceType);
      }
    }
  }
};

export const loadSourcesRegistry = async (
  options: LoadSourcesRegistryOptions = {},
): Promise<SourcesRegistry> => {
  const rootDir = options.rootDir ?? process.cwd();
  const repoRegistryPath = options.repoRegistryPath ?? options.registryPath ?? DEFAULT_REPO_SOURCES_REGISTRY_PATH;
  const fileRegistryPath = options.fileRegistryPath ?? DEFAULT_FILE_SOURCES_REGISTRY_PATH;
  const larkRegistryPath = options.larkRegistryPath ?? DEFAULT_LARK_SOURCES_REGISTRY_PATH;
  const repoAbsolutePath = resolve(rootDir, repoRegistryPath);
  const fileAbsolutePath = resolve(rootDir, fileRegistryPath);
  const larkAbsolutePath = resolve(rootDir, larkRegistryPath);

  const repoRegistry = parseRepoSourcesRegistry(
    await readYamlIfPresent(repoAbsolutePath, { sources: [] }),
    repoRegistryPath,
    repoAbsolutePath,
  );
  const files = parseFileSourcesRegistry(
    await readYamlIfPresent(fileAbsolutePath, { sources: [] }),
    fileRegistryPath,
  );
  const larks = parseLarkSourcesRegistry(
    await readYamlIfPresent(larkAbsolutePath, { sources: [] }),
    larkRegistryPath,
  );

  const registry: SourcesRegistry = {
    kind: "sources.registry",
    registryPaths: {
      repo: repoRegistryPath,
      file: fileRegistryPath,
      lark: larkRegistryPath,
    },
    absolutePaths: {
      repo: repoAbsolutePath,
      file: fileAbsolutePath,
      lark: larkAbsolutePath,
    },
    repos: repoRegistry.repos,
    files,
    larks,
  };
  assertGlobalSourceUniqueness(registry);
  return registry;
};

export const resolveSourceReference = (
  reference: RepoSourceDefinition | RepoSourceReference,
  registry: Pick<SourcesRegistry, "repos" | "registryPaths">,
): RepoSourceDefinition => {
  if (reference.kind === "source.repo") {
    return reference;
  }
  if ("type" in reference && reference.type !== "repo") {
    throw new TypeError(`Repo source reference expected, got ${reference.type}: ${reference.name}`);
  }

  const entry = registry.repos.find((repoSource) => (
    repoSource.name === reference.name || repoSource.id === reference.name
  ));

  if (!entry) {
    throw new TypeError(`Repo source "${reference.name}" is not declared in ${registry.registryPaths.repo}`);
  }

  const resolved: RepoSourceDefinition = {
    kind: "source.repo",
    id: entry.id,
    name: entry.name,
    namespace: entry.namespace,
    module: entry.module,
    materializedAt: entry.materializedAt,
    git: {
      remote: entry.remote,
      ref: entry.ref,
    },
  };

  if (entry.local) {
    resolved.local = entry.local;
  }
  if (entry.subpath) {
    assertWorkspaceRelativePath("repo", entry.name, "subpath", entry.subpath, registry.registryPaths.repo);
    resolved.subpath = entry.subpath;
  }

  return resolved;
};

export const allSources = <TType extends SourceType>(type: TType): readonly [SourceCollectionReference<TType>] => {
  assertSourceType(type, "source collection type");
  return [{
    kind: "source.collection",
    type,
  }];
};
