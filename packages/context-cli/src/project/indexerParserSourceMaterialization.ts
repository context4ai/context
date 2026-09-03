import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  INDEXER_PARSER_CAPABILITY_SPECS,
  indexerProtocolDigest,
  loadIndexerRegistry,
  loadSourcesRegistry,
  type IndexerProfileContract,
  type IndexerRegistryEntry,
  type RepoSourceRegistryEntry,
} from "@c4a/context";
import type { IndexerParserAuthorizedFile } from "./indexerParserExecutionPlanning.js";
import type { IndexerParserRuntimeEntryInput } from "./indexerParserRuntimeExecution.js";
import {
  projectIndexerReadTargets,
  type ProjectIndexerReadTarget,
} from "./indexerReadScopeAuthorization.js";
import { indexerRequirementSourceBoundaryDigest } from "./indexerRequirementProject.js";

const execFileAsync = promisify(execFile);

function sourceRefName(sourceRef: string): string | null {
  return sourceRef.startsWith("repo:") ? sourceRef.slice("repo:".length) : null;
}

function parserCandidateNames(input: {
  profile_contract: IndexerProfileContract;
  profile_id: string;
}): Set<string> {
  const profile = input.profile_contract.profiles.find((candidate) =>
    candidate.id === input.profile_id
  );
  if (profile === undefined) throw new TypeError(`unknown Indexer profile ${input.profile_id}`);
  const capabilities = new Set(profile.parser_requirements.map((item) => item.capability));
  return new Set(INDEXER_PARSER_CAPABILITY_SPECS
    .filter((spec) => capabilities.has(spec.capability))
    .flatMap((spec) => spec.extensions.map((extension) => extension.toLowerCase())));
}

function isParserCandidate(path: string, candidates: ReadonlySet<string>): boolean {
  const leaf = basename(path).toLowerCase();
  const extension = extname(leaf);
  if (extension === ".go" && leaf.endsWith("_test.go")) return false;
  return candidates.has(leaf) || candidates.has(extension);
}

async function trackedPaths(root: string, ref: string): Promise<string[]> {
  try {
    await execFileAsync("git", ["diff", "--quiet", ref, "--", "."], { cwd: root });
  } catch (error) {
    const exitCode = error !== null && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (exitCode === 1) {
      throw new TypeError(`materialized repository source differs from its pinned ref: ${root}`);
    }
    throw error;
  }
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--", "."], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return Buffer.from(stdout).toString("utf8").split("\0").filter(Boolean).sort();
}

async function assertPinnedSource(root: string, ref: string): Promise<void> {
  try {
    await execFileAsync("git", ["diff", "--quiet", ref, "--", "."], { cwd: root });
  } catch (error) {
    const exitCode = error !== null && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (exitCode === 1) {
      throw new TypeError(`materialized repository source differs from its pinned ref: ${root}`);
    }
    throw error;
  }
}

function safeSourcePath(root: string, normalizedPath: string): string {
  const absolute = resolve(root, normalizedPath);
  const rel = relative(root, absolute).replaceAll("\\", "/");
  if (rel.startsWith("../") || rel.includes("/../")) {
    throw new TypeError(`parser source path escapes its materialized root: ${normalizedPath}`);
  }
  return absolute;
}

function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function contentDigest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function contractScope(path: string, text: string | null): string | null {
  const extension = extname(path).toLowerCase();
  if (extension === ".gql" || extension === ".graphql") return "graphql";
  if (text === null || ![".json", ".yaml", ".yml"].includes(extension)) return null;
  if (extension === ".json") {
    try {
      const value = JSON.parse(text) as unknown;
      if (
        value !== null && typeof value === "object" && !Array.isArray(value) &&
        (typeof (value as Record<string, unknown>).openapi === "string" ||
          typeof (value as Record<string, unknown>).swagger === "string")
      ) return "openapi";
    } catch {
      return null;
    }
    return null;
  }
  return /^(?:openapi|swagger)\s*:\s*[^\s#]+/mu.test(text) ? "openapi" : null;
}

async function filesForTarget(input: {
  projectRoot: string;
  source: RepoSourceRegistryEntry;
  target: ProjectIndexerReadTarget;
  candidateNames: ReadonlySet<string>;
}): Promise<IndexerParserAuthorizedFile[]> {
  const root = join(input.projectRoot, input.source.materializedAt);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
    throw new TypeError(`repository source is not materialized as a directory: ${input.source.name}`);
  }
  if (input.target.module_refs.length > 1) {
    throw new TypeError(
      `Indexer source ${input.target.source_ref} names multiple modules without a registered path boundary`,
    );
  }
  const paths = (await trackedPaths(root, input.source.ref)).filter((path) =>
    isParserCandidate(path, input.candidateNames)
  );
  const moduleRef = input.target.module_refs[0] ?? null;
  const files: IndexerParserAuthorizedFile[] = [];
  for (const path of paths) {
    const bytes = await readFile(safeSourcePath(root, path));
    const text = decodeText(bytes);
    const scope = contractScope(path, text);
    files.push({
      source_ref: input.target.source_ref,
      module_ref: moduleRef,
      normalized_path: path,
      content_digest: contentDigest(bytes),
      ...(scope === null ? {} : { contract_scope: scope }),
      ...(text === null ? { media_kind: "binary" as const } : {}),
    });
  }
  await assertPinnedSource(root, input.source.ref);
  return files;
}

export interface ProjectIndexerParserFilesMaterialization {
  indexer: IndexerRegistryEntry;
  profile_id: string;
  files: IndexerParserAuthorizedFile[];
}

export interface ProjectIndexerParserSourceAuthority {
  indexer_digest: string;
  profile_id: string;
  source_registry_digest: string;
}

export async function inspectProjectIndexerParserSourceAuthority(input: {
  projectRoot: string;
  indexer_id: string;
}): Promise<ProjectIndexerParserSourceAuthority> {
  const [loadedRegistry, sources] = await Promise.all([
    loadIndexerRegistry(input.projectRoot),
    loadSourcesRegistry({ rootDir: input.projectRoot }),
  ]);
  const indexer = loadedRegistry.registry.indexers.find((candidate) =>
    candidate.id === input.indexer_id
  );
  if (indexer === undefined) throw new TypeError(`unknown Indexer ${input.indexer_id}`);
  const targets = projectIndexerReadTargets({
    registry: loadedRegistry.registry,
    indexer_id: input.indexer_id,
  });
  const checked = new Set<string>();
  for (const target of targets) {
    const name = sourceRefName(target.source_ref);
    if (name === null) continue;
    const source = sources.repos.find((candidate) =>
      candidate.name === name || candidate.id === name
    );
    if (source === undefined) {
      throw new TypeError(`Indexer read scope uses unknown source ${target.source_ref}`);
    }
    const root = join(input.projectRoot, source.materializedAt);
    const key = `${root}\u0000${source.ref}`;
    if (checked.has(key)) continue;
    await assertPinnedSource(root, source.ref);
    checked.add(key);
  }
  return {
    indexer_digest: indexerProtocolDigest(indexer),
    profile_id: indexer.profile.primary.id,
    source_registry_digest: indexerRequirementSourceBoundaryDigest(sources),
  };
}

export async function materializeProjectIndexerParserFiles(input: {
  projectRoot: string;
  indexer_id: string;
  profile_contract: IndexerProfileContract;
}): Promise<ProjectIndexerParserFilesMaterialization> {
  const [loadedRegistry, sources] = await Promise.all([
    loadIndexerRegistry(input.projectRoot),
    loadSourcesRegistry({ rootDir: input.projectRoot }),
  ]);
  const indexer = loadedRegistry.registry.indexers.find((candidate) =>
    candidate.id === input.indexer_id
  );
  if (indexer === undefined) throw new TypeError(`unknown Indexer ${input.indexer_id}`);
  const profileId = indexer.profile.primary.id;
  const candidateNames = parserCandidateNames({
    profile_contract: input.profile_contract,
    profile_id: profileId,
  });
  const targets = projectIndexerReadTargets({
    registry: loadedRegistry.registry,
    indexer_id: input.indexer_id,
  });
  const files: IndexerParserAuthorizedFile[] = [];
  for (const target of targets) {
    const name = sourceRefName(target.source_ref);
    if (name === null) continue;
    const source = sources.repos.find((candidate) =>
      candidate.name === name || candidate.id === name
    );
    if (source === undefined) throw new TypeError(`Indexer read scope uses unknown source ${target.source_ref}`);
    files.push(...await filesForTarget({
      projectRoot: input.projectRoot,
      source,
      target,
      candidateNames,
    }));
  }
  return {
    indexer,
    profile_id: profileId,
    files: files.sort((left, right) =>
      `${left.source_ref}\u0000${left.module_ref ?? ""}\u0000${left.normalized_path}`.localeCompare(
        `${right.source_ref}\u0000${right.module_ref ?? ""}\u0000${right.normalized_path}`,
      )
    ),
  };
}

function sourceRoot(input: {
  projectRoot: string;
  sources: readonly RepoSourceRegistryEntry[];
  sourceRef: string;
}): string {
  const name = sourceRefName(input.sourceRef);
  const source = name === null ? undefined : input.sources.find((candidate) =>
    candidate.name === name || candidate.id === name
  );
  if (source === undefined) throw new TypeError(`parser plan uses unknown source ${input.sourceRef}`);
  return join(input.projectRoot, source.materializedAt);
}

function normalizedVirtualPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  return normalized.length === 0 ? "." : normalized;
}

function sourceFileSystem(root: string, tracked: readonly string[]) {
  const files = new Set(tracked.map(normalizedVirtualPath));
  const directories = new Map<string, Set<string>>([[".", new Set()]]);
  for (const file of files) {
    const parts = file.split("/");
    let parent = ".";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!;
      const children = directories.get(parent) ?? new Set<string>();
      children.add(name);
      directories.set(parent, children);
      if (index < parts.length - 1) {
        parent = parent === "." ? name : `${parent}/${name}`;
        if (!directories.has(parent)) directories.set(parent, new Set());
      }
    }
  }
  const assertTrackedFile = (path: string): string => {
    const normalized = normalizedVirtualPath(path);
    if (!files.has(normalized)) {
      throw new TypeError(`parser attempted to read an untracked source file: ${normalized}`);
    }
    return normalized;
  };
  return {
    readFile: (path: string) => readFile(safeSourcePath(root, assertTrackedFile(path)), "utf8"),
    async readdir(path: string) {
      const normalized = normalizedVirtualPath(path);
      const children = directories.get(normalized);
      if (children === undefined) throw new TypeError(`unknown tracked source directory: ${normalized}`);
      return [...children].sort();
    },
    async exists(path: string) {
      const normalized = normalizedVirtualPath(path);
      return files.has(normalized) || directories.has(normalized);
    },
    async readJson<T = unknown>(path: string): Promise<T> {
      return JSON.parse(
        await readFile(safeSourcePath(root, assertTrackedFile(path)), "utf8"),
      ) as T;
    },
  };
}

async function preparedInput(input: {
  capability: string;
  root: string;
  sourceModule: string;
  scopedPaths: string[];
  trackedPaths: string[];
  loadedModule: Record<string, unknown>;
}): Promise<unknown> {
  const fs = sourceFileSystem(input.root, input.trackedPaths);
  if (input.capability === "parser.typescript" || input.capability === "parser.javascript") {
    const Plugin = input.loadedModule.TypeScriptPlugin;
    if (typeof Plugin !== "function") throw new TypeError(`${input.capability} package has no TypeScriptPlugin`);
    const plugin = new (Plugin as new () => {
      detectEntries: (manifest: unknown, fs: unknown) => Promise<{ entries: Array<{ path: string }> }>;
      extractSymbolsInScope: (entries: unknown[], paths: string[], fs: unknown) => Promise<unknown>;
    })();
    const manifestPath = "package.json";
    const manifest = {
      type: "package.json",
      path: manifestPath,
      content: await fs.readJson(manifestPath),
    };
    const detected = await plugin.detectEntries(manifest, fs);
    const allowed = new Set(input.scopedPaths);
    return plugin.extractSymbolsInScope(
      detected.entries.filter((entry) => allowed.has(entry.path)),
      input.scopedPaths,
      fs,
    );
  }
  if (input.capability === "parser.go") {
    const Plugin = input.loadedModule.GoPlugin;
    if (typeof Plugin !== "function") throw new TypeError("parser.go package has no GoPlugin");
    const plugin = new (Plugin as new () => {
      detectEntries: (manifest: unknown, fs: unknown) => Promise<{ entries: Array<{ path: string }> }>;
      extractSymbols: (entries: unknown[], fs: unknown) => Promise<unknown>;
    })();
    const manifestPath = "go.mod";
    const manifestContent = await fs.exists(manifestPath)
      ? await fs.readFile(manifestPath)
      : `module ${input.sourceModule}\n`;
    const manifest = {
      type: "go.mod",
      path: manifestPath,
      content: { raw: manifestContent },
    };
    const detected = await plugin.detectEntries(manifest, fs);
    const allowed = new Set(input.scopedPaths);
    return plugin.extractSymbols(detected.entries.filter((entry) => allowed.has(entry.path)), fs);
  }
  if (input.capability === "parser.rush") {
    const indexRushWorkspace = input.loadedModule.indexRushWorkspace;
    if (typeof indexRushWorkspace !== "function") {
      throw new TypeError("parser.rush package has no indexRushWorkspace");
    }
    return (indexRushWorkspace as (root: string) => Promise<unknown>)(input.root);
  }
  throw new TypeError(`unsupported prepared parser capability ${input.capability}`);
}

export async function materializeProjectIndexerParserEntryInput(input: {
  projectRoot: string;
  entry_digest: string;
  capability: string;
  source_ref: string;
  normalized_paths: string[];
  loaded_module: Record<string, unknown>;
}): Promise<IndexerParserRuntimeEntryInput> {
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const root = sourceRoot({
    projectRoot: input.projectRoot,
    sources: sources.repos,
    sourceRef: input.source_ref,
  });
  const sourceName = sourceRefName(input.source_ref);
  const source = sourceName === null ? undefined : sources.repos.find((candidate) =>
    candidate.name === sourceName || candidate.id === sourceName
  );
  if (source === undefined) throw new TypeError(`parser plan uses unknown source ${input.source_ref}`);
  const tracked = await trackedPaths(root, source.ref);
  const trackedSet = new Set(tracked);
  for (const path of input.normalized_paths) {
    if (!trackedSet.has(normalizedVirtualPath(path))) {
      throw new TypeError(`parser plan references an untracked source file: ${path}`);
    }
  }
  const files = Object.fromEntries(await Promise.all(input.normalized_paths.map(async (path) => [
    path,
    await readFile(safeSourcePath(root, path), "utf8"),
  ])));
  const needsPrepared = [
    "parser.typescript",
    "parser.javascript",
    "parser.go",
    "parser.rush",
  ].includes(input.capability);
  const result: IndexerParserRuntimeEntryInput = {
    entry_digest: input.entry_digest,
    files,
    ...(needsPrepared
      ? {
          prepared_input: await preparedInput({
            capability: input.capability,
            root,
            sourceModule: source.module,
            scopedPaths: input.normalized_paths,
            trackedPaths: tracked,
            loadedModule: input.loaded_module,
          }),
        }
      : {}),
  };
  await assertPinnedSource(root, source.ref);
  return result;
}
