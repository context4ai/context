import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readlink, realpath, rm, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DEFAULT_REPO_SOURCES_REGISTRY_PATH } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  inspectRepoSourceModules,
  resolveRepoSourceLocalPath,
  resolveRepoSourceScopedPath,
  type RepoSourceModuleInspectResult,
} from "./repoSourceModules.js";
import {
  assertRepoDateNamespace,
  assertRepoModuleName,
  defaultRepoMaterializedAt,
  readRepoRegistry,
  selectRepoSources,
  writeRepoRegistry,
  type RepoSourceRecord,
} from "./repoSourceRegistry.js";
import { withProjectWriteLock } from "./writeLock.js";

export type { RepoSourceModuleInspectResult, RepoSourceModuleSuggestion } from "./repoSourceModules.js";
export type { RepoSourceRecord } from "./repoSourceRegistry.js";

const execFileAsync = promisify(execFile);

export interface AddRepoSourceInput {
  projectRoot: string;
  namespace: string;
  module: string;
  local?: string;
  remote?: string;
  ref?: string;
}

export interface RepoSourceStatus {
  name: string;
  namespace: string;
  module: string;
  local?: string;
  remote: string;
  ref: string;
  materializedAt: string;
  materialized: boolean;
  localExists: boolean;
  subpath?: string;
  scopeExists?: boolean;
  gitRepo: boolean;
  head?: string;
  pinnedScopeHash?: string;
  scopeHash?: string;
  scopeMatches: boolean;
  ready: boolean;
  diagnostics: string[];
  agent_hints: string[];
}

export interface AddRepoSourceResult {
  registryPath: string;
  source: RepoSourceRecord;
  status: RepoSourceStatus;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveLocalPath(projectRoot: string, local: string | undefined): string | null {
  if (!local) return null;
  return isAbsolute(local) ? local : resolve(projectRoot, local);
}

function normalizeSubpath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
  return normalized.length > 0 ? normalized : undefined;
}

function scopedLocalPath(rootAbs: string, subpath: string | undefined): string {
  return subpath === undefined ? rootAbs : resolve(rootAbs, subpath);
}

async function localPathForRegistry(input: {
  projectRoot: string;
  originalLocal: string;
  gitRootAbs: string;
}): Promise<string> {
  const projectGitRoot = await resolveGitRoot(input.projectRoot);
  const sameRepository = projectGitRoot !== null &&
    await realpath(projectGitRoot) === await realpath(input.gitRootAbs);
  return !isAbsolute(input.originalLocal) || sameRepository
    ? (relative(input.projectRoot, input.gitRootAbs) || ".")
    : input.gitRootAbs;
}

async function inferNamedLocalPath(projectRoot: string, module: string): Promise<string | undefined> {
  const candidates = [
    resolve(projectRoot, module),
    resolve(dirname(projectRoot), module),
  ];
  const matches = new Map<string, string>();
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const canonical = await realpath(candidate).catch(() => null);
    if (canonical === null) continue;
    const stats = await lstat(canonical).catch(() => null);
    if (stats?.isDirectory() !== true || await resolveGitRoot(canonical) === null) continue;
    matches.set(canonical, relative(projectRoot, candidate) || ".");
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readGitOriginRemote(cwd: string): Promise<string | null> {
  const directConfigPath = join(cwd, ".git", "config");
  let config = await readFile(directConfigPath, "utf8").catch(() => "");
  if (config.length === 0) {
    const gitDir = await resolveGitDir(cwd);
    if (gitDir === null) return null;
    config = await readFile(join(gitDir, "config"), "utf8").catch(() => "");
  }
  let inOriginBlock = false;
  for (const line of config.split(/\r?\n/u)) {
    const section = /^\s*\[(.+)\]\s*$/u.exec(line);
    if (section !== null) {
      inOriginBlock = section[1] === 'remote "origin"';
      continue;
    }
    if (!inOriginBlock) continue;
    const match = /^\s*url\s*=\s*(.+?)\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[1].trim().length > 0) return match[1].trim();
  }
  return null;
}

async function resolveGitRoot(cwd: string): Promise<string | null> {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveGitDir(cwd: string): Promise<string | null> {
  const dotGit = join(cwd, ".git");
  if (!existsSync(dotGit)) return null;
  const stats = await lstat(dotGit);
  if (stats.isDirectory()) return dotGit;
  if (!stats.isFile()) return null;
  const raw = await readFile(dotGit, "utf8").catch(() => "");
  const match = /^gitdir:\s*(.+)\s*$/iu.exec(raw.trim());
  if (match?.[1] === undefined) return null;
  return isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1]);
}

async function readGitHead(cwd: string): Promise<string | null> {
  const gitDir = await resolveGitDir(cwd);
  if (gitDir === null) return null;
  const headRaw = (await readFile(join(gitDir, "HEAD"), "utf8").catch(() => "")).trim();
  if (/^[a-f0-9]{40}$/iu.test(headRaw)) return headRaw.toLowerCase();
  const match = /^ref:\s*(.+)\s*$/iu.exec(headRaw);
  const refPath = match?.[1];
  if (refPath === undefined) return null;
  const looseRef = (await readFile(join(gitDir, refPath), "utf8").catch(() => "")).trim();
  if (/^[a-f0-9]{40}$/iu.test(looseRef)) return looseRef.toLowerCase();
  const packedRefs = await readFile(join(gitDir, "packed-refs"), "utf8").catch(() => "");
  for (const line of packedRefs.split(/\r?\n/u)) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, name] = line.trim().split(/\s+/u);
    if (name === refPath && sha !== undefined && /^[a-f0-9]{40}$/iu.test(sha)) return sha.toLowerCase();
  }
  return null;
}

async function ensureMaterializedSymlink(input: {
  projectRoot: string;
  materializedAt: string;
  localAbs: string;
  diagnostics: string[];
}): Promise<boolean> {
  const linkPath = join(input.projectRoot, input.materializedAt);
  await mkdir(dirname(linkPath), { recursive: true });
  if (existsSync(linkPath)) {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) {
      input.diagnostics.push(`materialized path exists and is not a symlink: ${input.materializedAt}`);
      return false;
    }
    const current = await readlink(linkPath);
    const currentAbs = resolve(dirname(linkPath), current);
    if (currentAbs === input.localAbs) return true;
    await rm(linkPath);
  }
  const relTarget = relative(dirname(linkPath), input.localAbs) || ".";
  await symlink(relTarget, linkPath);
  return true;
}

async function diagnoseMaterializedSymlink(input: {
  projectRoot: string;
  materializedAt: string;
  localAbs: string;
  diagnostics: string[];
  agent_hints: string[];
  sourceName: string;
}): Promise<boolean> {
  const linkPath = join(input.projectRoot, input.materializedAt);
  if (!existsSync(linkPath)) {
    input.diagnostics.push(`materialized path is missing: ${input.materializedAt}`);
    input.agent_hints.push(`Run context source ensure ${input.sourceName} to materialize the local source link.`);
    return false;
  }

  const stats = await lstat(linkPath);
  if (!stats.isSymbolicLink()) {
    input.diagnostics.push(`materialized path exists and is not a symlink: ${input.materializedAt}`);
    return false;
  }

  const current = await readlink(linkPath);
  const currentAbs = resolve(dirname(linkPath), current);
  if (currentAbs !== input.localAbs) {
    input.diagnostics.push(`materialized path points to ${current}, expected local checkout ${relative(dirname(linkPath), input.localAbs) || "."}`);
    input.agent_hints.push(`Run context source ensure ${input.sourceName} to refresh the local source link.`);
    return false;
  }

  return true;
}

function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/iu.test(value);
}

function isShortCommitSha(value: string): boolean {
  return /^[0-9a-f]{4,39}$/iu.test(value);
}

async function normalizeInputRef(input: {
  projectRoot: string;
  sourceName: string;
  ref: string;
  local?: string;
}): Promise<string> {
  if (isFullCommitSha(input.ref)) return input.ref.toLowerCase();
  if (!isShortCommitSha(input.ref)) {
    throw new ContextError(ExitCode.UserError, `repo source ref must be a commit sha, not a branch or tag: ${input.ref}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.sourceName,
      ref: input.ref,
      next: "Use a full 40-character commit sha, or pass a short sha that can be resolved from the local checkout.",
    });
  }

  const localAbs = resolveLocalPath(input.projectRoot, input.local);
  if (localAbs === null) {
    throw new ContextError(ExitCode.UserError, `short repo source ref requires a local checkout to resolve: ${input.ref}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.sourceName,
      ref: input.ref,
      next: "Pass --local <path> with a git checkout, or use a full 40-character commit sha.",
    });
  }
  if (!existsSync(localAbs)) {
    throw new ContextError(ExitCode.UserError, `short repo source ref cannot be resolved because local path is missing: ${input.local}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.sourceName,
      ref: input.ref,
      next: "Use an existing local checkout or a full 40-character commit sha.",
    });
  }

  const gitRoot = await resolveGitRoot(localAbs);
  if (gitRoot === null) {
    throw new ContextError(ExitCode.UserError, `short repo source ref cannot be resolved because local path is not a git repository: ${input.local}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.sourceName,
      ref: input.ref,
    });
  }

  const head = await readGitHead(gitRoot);
  if (head !== null && head.startsWith(input.ref.toLowerCase())) return head;

  const resolved = await gitOutput(gitRoot, ["rev-parse", "--verify", `${input.ref}^{commit}`]);
  if (resolved === null || !isFullCommitSha(resolved)) {
    throw new ContextError(ExitCode.UserError, `short repo source ref cannot be resolved to a commit: ${input.ref}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: input.sourceName,
      ref: input.ref,
      next: "Use a full 40-character commit sha from the local checkout.",
    });
  }
  return resolved.toLowerCase();
}

async function gitTreeHash(input: {
  gitRoot: string;
  ref: string | undefined;
  subpath: string | undefined;
}): Promise<string | undefined> {
  if (input.ref === undefined || !isFullCommitSha(input.ref)) return undefined;
  const treeish = input.subpath === undefined
    ? `${input.ref}^{tree}`
    : `${input.ref}:${input.subpath}`;
  const hash = await gitOutput(input.gitRoot, ["rev-parse", "--verify", treeish]);
  return hash !== null && /^[0-9a-f]{40}$/iu.test(hash) ? hash.toLowerCase() : undefined;
}

function validPinnedRef(ref: string, diagnostics: string[]): boolean {
  if (!isFullCommitSha(ref)) {
    diagnostics.push(`registry ref must be a full 40-character commit sha: ${ref}`);
    return false;
  }
  return true;
}

async function normalizeAddInput(input: AddRepoSourceInput, existing: RepoSourceRecord | undefined): Promise<RepoSourceRecord> {
  const sourceName = `${input.namespace}/${input.module}`;
  const explicitRemote = nonEmpty(input.remote);
  const explicitRef = nonEmpty(input.ref);
  const inferredLocal = input.local === undefined && existing?.local === undefined &&
      (explicitRemote === null || explicitRef === null)
    ? await inferNamedLocalPath(input.projectRoot, input.module)
    : undefined;
  const originalLocal = input.local ?? existing?.local ?? inferredLocal;
  const localWasResolvedFromInput = input.local !== undefined || inferredLocal !== undefined;
  let local = originalLocal;
  let subpath = localWasResolvedFromInput ? undefined : existing?.subpath;
  let gitRootAbs: string | null = null;
  let originalLocalAbs: string | null = null;

  if (originalLocal !== undefined) {
    originalLocalAbs = resolveLocalPath(input.projectRoot, originalLocal);
    if (originalLocalAbs !== null && existsSync(originalLocalAbs)) {
      gitRootAbs = await resolveGitRoot(originalLocalAbs);
      if (gitRootAbs !== null && localWasResolvedFromInput) {
        const detectedSubpath = normalizeSubpath(relative(gitRootAbs, originalLocalAbs));
        local = await localPathForRegistry({
          projectRoot: input.projectRoot,
          originalLocal,
          gitRootAbs,
        });
        subpath = detectedSubpath;
      }
    }
  }

  if (input.local !== undefined && (explicitRemote === null || explicitRef === null)) {
    if (originalLocalAbs === null || !existsSync(originalLocalAbs)) {
      throw new ContextError(ExitCode.UserError, `repo source local path does not exist: ${input.local}`, {
        category: ErrorCategory.UserInputInvalid,
        sourceName,
        local: input.local,
        ...(originalLocalAbs !== null ? { resolvedLocal: originalLocalAbs } : {}),
        next: "Pass an existing --local <path> resolved from the Context project root, or provide both --remote <url> and --ref <full-sha> for a source that is not materialized locally.",
      });
    }
    if (gitRootAbs === null) {
      throw new ContextError(ExitCode.UserError, `repo source local path is not inside a Git checkout: ${input.local}`, {
        category: ErrorCategory.UserInputInvalid,
        sourceName,
        local: input.local,
        resolvedLocal: originalLocalAbs,
        next: "Pass --local <path> inside a Git checkout so Context can infer origin and HEAD, or provide both --remote <url> and --ref <full-sha>.",
      });
    }
  }

  const remote = explicitRemote ??
    nonEmpty(gitRootAbs !== null ? await gitOutput(gitRootAbs, ["remote", "get-url", "origin"]) : null) ??
    nonEmpty(gitRootAbs !== null ? await readGitOriginRemote(gitRootAbs) : null) ??
    existing?.git.remote;
  if (remote == null || remote.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `repo source remote is required: ${sourceName}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName,
      next: "Pass --remote <url>, or pass --local <path> inside a git checkout with origin configured.",
    });
  }

  const rawRef = explicitRef ??
    (gitRootAbs !== null ? await readGitHead(gitRootAbs) : null) ??
    existing?.git.ref;
  if (rawRef == null || rawRef.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `repo source ref is required: ${sourceName}`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName,
      next: "Pass --ref <sha>, or pass --local <path> inside a git checkout.",
    });
  }

  const ref = await normalizeInputRef({
    projectRoot: input.projectRoot,
    sourceName,
    ref: rawRef,
    ...(local !== undefined ? { local } : {}),
  });

  return {
    name: sourceName,
    namespace: input.namespace,
    module: input.module,
    ...(local !== undefined ? { local } : {}),
    ...(subpath !== undefined ? { subpath } : {}),
    git: {
      remote,
      ref,
    },
  };
}

interface RepoCheckoutInspection {
  gitRepo: boolean;
  head?: string;
  pinnedScopeHash?: string;
  scopeHash?: string;
  scopedAbs?: string;
}

async function inspectRepoCheckout(input: {
  source: RepoSourceRecord;
  localAbs: string | null;
  localExists: boolean;
  subpath: string | undefined;
  scopeExists: boolean;
  scopedAbs: string | null;
  diagnostics: string[];
  agentHints: string[];
}): Promise<RepoCheckoutInspection> {
  if (input.localAbs === null) {
    input.diagnostics.push("local path is not declared");
    input.agentHints.push("repo-local-checkout-required");
    return { gitRepo: false };
  }
  if (!input.localExists) {
    input.diagnostics.push(`local path is missing: ${input.source.local}`);
    input.agentHints.push("repo-local-checkout-missing");
    return { gitRepo: false };
  }

  const gitRoot = await resolveGitRoot(input.localAbs);
  if (gitRoot === null) {
    input.diagnostics.push(`local path is not a git repository: ${input.source.local}`);
    return { gitRepo: false };
  }
  if (!input.scopeExists || input.scopedAbs === null) {
    input.diagnostics.push(`source subpath is missing: ${input.subpath ?? "."}`);
    return { gitRepo: true };
  }

  const head = await readGitHead(gitRoot) ?? await gitOutput(gitRoot, ["rev-parse", "HEAD"]) ?? undefined;
  if (!validPinnedRef(input.source.git.ref, input.diagnostics)) {
    return { gitRepo: true, ...(head !== undefined ? { head } : {}), scopedAbs: input.scopedAbs };
  }
  const [pinnedScopeHash, scopeHash] = await Promise.all([
    gitTreeHash({ gitRoot, ref: input.source.git.ref, subpath: input.subpath }),
    gitTreeHash({ gitRoot, ref: head, subpath: input.subpath }),
  ]);
  if (pinnedScopeHash === undefined) {
    input.diagnostics.push(`source boundary ${input.subpath ?? "."} is missing at pinned ref ${input.source.git.ref}`);
    input.agentHints.push("repo-pinned-boundary-invalid");
  }
  if (scopeHash === undefined) {
    input.diagnostics.push(`source boundary ${input.subpath ?? "."} is missing at HEAD ${head ?? "<unknown>"}`);
  }
  return {
    gitRepo: true,
    ...(head !== undefined ? { head } : {}),
    ...(pinnedScopeHash !== undefined ? { pinnedScopeHash } : {}),
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    scopedAbs: input.scopedAbs,
  };
}

async function inspectRepoSource(input: {
  projectRoot: string;
  source: RepoSourceRecord;
  materialize: boolean;
}): Promise<RepoSourceStatus> {
  const source = input.source;
  const materializedAt = source.materializedAt ?? defaultRepoMaterializedAt(source);
  const diagnostics: string[] = [];
  const agent_hints: string[] = [];
  const localAbs = resolveLocalPath(input.projectRoot, source.local);
  const localExists = localAbs !== null && existsSync(localAbs);
  const subpath = normalizeSubpath(source.subpath);
  const scopedAbs = localAbs === null ? null : scopedLocalPath(localAbs, subpath);
  const scopeExists = scopedAbs !== null && existsSync(scopedAbs);
  let materialized = existsSync(join(input.projectRoot, materializedAt));
  const checkout = await inspectRepoCheckout({
    source,
    localAbs,
    localExists,
    subpath,
    scopeExists,
    scopedAbs,
    diagnostics,
    agentHints: agent_hints,
  });
  if (checkout.scopedAbs !== undefined) {
    materialized = input.materialize
      ? await ensureMaterializedSymlink({
          projectRoot: input.projectRoot,
          materializedAt,
          localAbs: checkout.scopedAbs,
          diagnostics,
        })
      : await diagnoseMaterializedSymlink({
          projectRoot: input.projectRoot,
          materializedAt,
          localAbs: checkout.scopedAbs,
          diagnostics,
          agent_hints,
          sourceName: source.name,
        });
  }

  const scopeMatches = checkout.pinnedScopeHash !== undefined && checkout.scopeHash !== undefined &&
    checkout.pinnedScopeHash === checkout.scopeHash;
  if (checkout.gitRepo && checkout.pinnedScopeHash !== undefined && checkout.scopeHash !== undefined && !scopeMatches) {
    diagnostics.push(
      `source boundary ${subpath ?? "."} hash ${checkout.scopeHash} at HEAD ${checkout.head ?? "<unknown>"} does not match pinned ref ${source.git.ref} hash ${checkout.pinnedScopeHash}`,
    );
    agent_hints.push("repo-source-boundary-changed");
  }

  return {
    name: source.name,
    namespace: source.namespace,
    module: source.module,
    ...(source.local !== undefined ? { local: source.local } : {}),
    ...(subpath !== undefined ? { subpath } : {}),
    remote: source.git.remote,
    ref: source.git.ref,
    materializedAt,
    materialized,
    localExists,
    ...(subpath !== undefined ? { scopeExists } : {}),
    gitRepo: checkout.gitRepo,
    ...(checkout.head !== undefined ? { head: checkout.head } : {}),
    ...(checkout.pinnedScopeHash !== undefined ? { pinnedScopeHash: checkout.pinnedScopeHash } : {}),
    ...(checkout.scopeHash !== undefined ? { scopeHash: checkout.scopeHash } : {}),
    scopeMatches,
    ready: localExists && scopeExists && checkout.gitRepo && scopeMatches && materialized && diagnostics.length === 0,
    diagnostics,
    agent_hints,
  };
}

export async function diagnoseRepoSource(input: {
  projectRoot: string;
  source: RepoSourceRecord;
}): Promise<RepoSourceStatus> {
  return inspectRepoSource({
    projectRoot: input.projectRoot,
    source: input.source,
    materialize: false,
  });
}

export async function ensureRepoSource(input: {
  projectRoot: string;
  source: RepoSourceRecord;
}): Promise<RepoSourceStatus> {
  return inspectRepoSource({
    projectRoot: input.projectRoot,
    source: input.source,
    materialize: true,
  });
}

export async function addRepoSourceUnlocked(input: AddRepoSourceInput): Promise<AddRepoSourceResult> {
  assertRepoDateNamespace(input.namespace);
  assertRepoModuleName(input.module);
  const sourceName = `${input.namespace}/${input.module}`;
  const registry = await readRepoRegistry(input.projectRoot);
  const moduleConflict = registry.repos.find((source) =>
    source.module === input.module && source.namespace !== input.namespace
  );
  if (moduleConflict !== undefined) {
    throw new ContextError(
      ExitCode.UserError,
      `repo module ${JSON.stringify(input.module)} is already registered in date batch ${moduleConflict.namespace}; module names are project-wide code-index identities`,
      {
        category: ErrorCategory.SchemaInvalid,
        sourceId: moduleConflict.name,
        next: `Update the existing source with context source add repo ${moduleConflict.namespace} --module ${input.module} instead of registering the same module under another date.`,
      },
    );
  }
  const index = registry.repos.findIndex((source) => source.name === sourceName || source.id === sourceName);
  const existing = index === -1 ? undefined : registry.repos[index];
  const next = await normalizeAddInput(input, existing);
  const source = index === -1 ? next : { ...registry.repos[index], ...next };
  if (index === -1) registry.repos.push(source);
  else registry.repos[index] = source;
  await writeRepoRegistry(input.projectRoot, registry);
  const status = await ensureRepoSource({ projectRoot: input.projectRoot, source });
  return {
    registryPath: DEFAULT_REPO_SOURCES_REGISTRY_PATH,
    source,
    status,
  };
}

export async function addRepoSource(input: AddRepoSourceInput): Promise<AddRepoSourceResult> {
  return withProjectWriteLock(input.projectRoot, "source-add-repo", () => addRepoSourceUnlocked(input));
}

export async function ensureRepoSources(input: {
  projectRoot: string;
  name?: string;
}): Promise<RepoSourceStatus[]> {
  const registry = await readRepoRegistry(input.projectRoot);
  const selected = selectRepoSources(registry.repos, input.name);
  if (input.name !== undefined && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.name,
    });
  }
  return Promise.all(selected.map((source) => ensureRepoSource({ projectRoot: input.projectRoot, source })));
}

export async function diagnoseRepoSources(input: {
  projectRoot: string;
  name?: string;
}): Promise<RepoSourceStatus[]> {
  const registry = await readRepoRegistry(input.projectRoot);
  const selected = selectRepoSources(registry.repos, input.name);
  if (input.name !== undefined && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.name,
    });
  }
  return Promise.all(selected.map((source) => diagnoseRepoSource({ projectRoot: input.projectRoot, source })));
}

export async function listRepoSources(projectRoot: string): Promise<RepoSourceRecord[]> {
  return (await readRepoRegistry(projectRoot)).repos;
}

export async function inspectRepoSources(input: {
  projectRoot: string;
  name?: string;
}): Promise<RepoSourceModuleInspectResult[]> {
  const registry = await readRepoRegistry(input.projectRoot);
  const selected = selectRepoSources(registry.repos, input.name);

  if (input.name !== undefined && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.name}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.name,
    });
  }

  const results: RepoSourceModuleInspectResult[] = [];
  for (const source of selected) {
    const status = await diagnoseRepoSource({ projectRoot: input.projectRoot, source });
    const localAbs = resolveRepoSourceLocalPath(input.projectRoot, source.local);
    const scopedAbs = localAbs === null ? null : resolveRepoSourceScopedPath(localAbs, source.subpath);
    results.push(await inspectRepoSourceModules({
      projectRoot: input.projectRoot,
      source,
      status,
      scopedAbs,
    }));
  }
  return results;
}
