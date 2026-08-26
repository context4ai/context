import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readlink, realpath, rm, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { diagnoseRepoSource, ensureRepoSource } from "./repoSources.js";
import {
  readRepoRegistry,
  selectRepoSources,
  writeRepoRegistry,
  type RepoSourceRecord,
} from "./repoSourceRegistry.js";
import { withProjectWriteLock } from "./writeLock.js";

const execFileAsync = promisify(execFile);
const RECOVERY_SCHEMA = "context.repository-source-recovery.v1";

export interface RepositoryRecoveryRequest {
  source: string;
  mode: "local" | "clone";
  path?: string;
}

export interface RepositoryRecoveryPayload {
  schema: typeof RECOVERY_SCHEMA;
  repositories: RepositoryRecoveryRequest[];
}

export interface RepositoryRecoveryGroup {
  id: string;
  remote: string;
  ref: string;
  sources: string[];
  required_subpaths: string[];
  declared_local_paths: string[];
  suggested_clone_target: string;
  ready: boolean;
}

function userInputError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseRepositoryRecoveryPayload(value: unknown): RepositoryRecoveryPayload {
  const root = record(value);
  if (root === null || root.schema !== RECOVERY_SCHEMA || !Array.isArray(root.repositories)) {
    throw userInputError(`repository recovery payload must match ${RECOVERY_SCHEMA}`, {
      expected_schema: RECOVERY_SCHEMA,
    });
  }
  if (root.repositories.length === 0) {
    throw userInputError("repository recovery payload requires at least one repository decision");
  }
  const repositories = root.repositories.map((item, index): RepositoryRecoveryRequest => {
    const input = record(item);
    const source = typeof input?.source === "string" ? input.source.trim() : "";
    const mode = input?.mode;
    const path = typeof input?.path === "string" ? input.path.trim() : undefined;
    if (source.length === 0 || (mode !== "local" && mode !== "clone")) {
      throw userInputError(`repository recovery decision ${index + 1} requires source and mode`, {
        index,
        valid_modes: ["local", "clone"],
      });
    }
    if (mode === "local" && (path === undefined || path.length === 0)) {
      throw userInputError(`repository recovery decision ${index + 1} uses local mode and requires path`, {
        index,
      });
    }
    return {
      source,
      mode,
      ...(path === undefined || path.length === 0 ? {} : { path }),
    };
  });
  return { schema: RECOVERY_SCHEMA, repositories };
}

function trimRepositorySuffix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
}

function repositoryPathIdentity(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "").replace(/\.git$/iu, "");
  const windowsPath = /^[a-z]:[\\/]/iu.test(trimmed);
  const urlSyntax = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed);
  if (!windowsPath && urlSyntax) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.length > 0) return trimRepositorySuffix(url.pathname);
      return url.pathname.replace(/\/+$/u, "").replace(/\.git$/iu, "");
    } catch {
      return trimmed;
    }
  }
  const scp = windowsPath ? null : /^(?:[^@/:]+@)?[^/:]+:(.+)$/u.exec(trimmed);
  if (scp?.[1] !== undefined) return trimRepositorySuffix(scp[1]);
  return trimmed;
}

function repositorySlug(remote: string): string {
  const raw = basename(remote.replace(/\/+$/u, "").replace(/\.git$/iu, ""));
  const slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "repository";
}

function groupId(source: Pick<RepoSourceRecord, "git">): string {
  return `${repositorySlug(source.git.remote)}-${source.git.ref.slice(0, 12)}`;
}

function groupKey(source: Pick<RepoSourceRecord, "git">): string {
  return `${repositoryPathIdentity(source.git.remote)}\u0000${source.git.ref.toLowerCase()}`;
}

function suggestedCloneTarget(source: Pick<RepoSourceRecord, "git">): string {
  return `.tmp/repo/${groupId(source)}`;
}

function recoverySubpaths(sources: readonly RepoSourceRecord[]): string[] {
  if (sources.some((source) => source.subpath === undefined)) return [];
  return [...new Set(sources.flatMap((source) => source.subpath === undefined ? [] : [source.subpath]))].sort();
}

export async function repositoryRecoveryPlan(input: {
  projectRoot: string;
  source?: string;
}): Promise<{
  schema: "context.repository-source-recovery-plan.v1";
  groups: RepositoryRecoveryGroup[];
  pending_groups: number;
  decision_schema: typeof RECOVERY_SCHEMA;
  next_action: { command: string; input: string } | null;
}> {
  const registry = await readRepoRegistry(input.projectRoot);
  const selected = selectRepoSources(registry.repos, input.source);
  if (input.source !== undefined && selected.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source is not registered: ${input.source}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: input.source,
    });
  }
  const grouped = new Map<string, RepoSourceRecord[]>();
  for (const source of selected) {
    const records = grouped.get(groupKey(source)) ?? [];
    records.push(source);
    grouped.set(groupKey(source), records);
  }
  const groups: RepositoryRecoveryGroup[] = [];
  for (const records of grouped.values()) {
    const representative = records[0];
    if (representative === undefined) continue;
    const statuses = await Promise.all(records.map((source) =>
      diagnoseRepoSource({ projectRoot: input.projectRoot, source })
    ));
    groups.push({
      id: groupId(representative),
      remote: representative.git.remote,
      ref: representative.git.ref,
      sources: records.map((source) => source.name).sort(),
      required_subpaths: records.some((source) => source.subpath === undefined)
        ? ["."]
        : recoverySubpaths(records),
      declared_local_paths: [...new Set(records.flatMap((source) => source.local === undefined ? [] : [source.local]))].sort(),
      suggested_clone_target: suggestedCloneTarget(representative),
      ready: statuses.every((status) => status.ready),
    });
  }
  groups.sort((left, right) => left.id.localeCompare(right.id));
  const pendingGroups = groups.filter((group) => !group.ready).length;
  return {
    schema: "context.repository-source-recovery-plan.v1",
    groups,
    pending_groups: pendingGroups,
    decision_schema: RECOVERY_SCHEMA,
    next_action: pendingGroups === 0
      ? null
      : {
          command: "context source restore --input .tmp/agent-payloads/repository-source-recovery.json --format json",
          input: ".tmp/agent-payloads/repository-source-recovery.json",
        },
  };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const detail = error !== null && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "").trim()
      : error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.ExternalToolError, `git ${args[0] ?? "command"} failed`, {
      category: ErrorCategory.ExternalToolFailed,
      cwd,
      reason: detail,
    });
  }
}

async function resolveGitRoot(path: string): Promise<string> {
  const root = await git(path, ["rev-parse", "--show-toplevel"]);
  if (root.length === 0 || !existsSync(root)) {
    throw userInputError(`local repository path is not a Git checkout: ${path}`, { path });
  }
  return realpath(root);
}

async function verifyCheckout(input: {
  checkout: string;
  remote: string;
  ref: string;
  subpaths: readonly string[];
}): Promise<void> {
  const actualRemote = await git(input.checkout, ["remote", "get-url", "origin"]);
  const expectedRepository = repositoryPathIdentity(input.remote);
  const actualRepository = repositoryPathIdentity(actualRemote);
  if (actualRepository !== expectedRepository) {
    throw userInputError("local repository origin does not match the registered source", {
      expected_remote: input.remote,
      actual_remote: actualRemote,
      expected_repository: expectedRepository,
      actual_repository: actualRepository,
      checkout: input.checkout,
    });
  }
  await git(input.checkout, ["cat-file", "-e", `${input.ref}^{commit}`]);
  for (const subpath of input.subpaths) {
    await git(input.checkout, ["cat-file", "-e", `${input.ref}:${subpath}`]);
  }
}

async function cloneCheckout(input: {
  projectRoot: string;
  remote: string;
  ref: string;
  subpaths: readonly string[];
  target?: string;
}): Promise<string> {
  const target = resolve(input.projectRoot, input.target ?? `.tmp/repo/${repositorySlug(input.remote)}-${input.ref.slice(0, 12)}`);
  if (existsSync(target)) {
    throw userInputError(`clone target already exists: ${target}`, {
      target,
      next: `Use local mode with path ${JSON.stringify(target)} after inspecting the existing checkout.`,
    });
  }
  await mkdir(dirname(target), { recursive: true });
  const cloneArgs = ["clone", "--no-checkout", "--depth=1", "--filter=blob:none", input.remote, target];
  try {
    await execFileAsync("git", cloneArgs, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  } catch {
    await rm(target, { recursive: true, force: true });
    try {
      await execFileAsync("git", ["clone", "--no-checkout", "--depth=1", input.remote, target], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      const detail = error !== null && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "").trim()
        : error instanceof Error ? error.message : String(error);
      throw new ContextError(ExitCode.ExternalToolError, `cannot clone registered repository: ${input.remote}`, {
        category: ErrorCategory.ExternalToolFailed,
        remote: input.remote,
        target,
        reason: detail,
      });
    }
  }
  try {
    try {
      await git(target, ["fetch", "--depth=1", "--filter=blob:none", "origin", input.ref]);
    } catch {
      await git(target, ["fetch", "--depth=1", "origin", input.ref]);
    }
    const sparseDirectories = input.subpaths.length > 0 && (await Promise.all(
      input.subpaths.map((subpath) => git(target, ["cat-file", "-t", `${input.ref}:${subpath}`])),
    )).every((type) => type === "tree");
    if (sparseDirectories) {
      await git(target, ["sparse-checkout", "init", "--cone"]);
      await git(target, ["sparse-checkout", "set", ...input.subpaths]);
    }
    await git(target, ["checkout", "--detach", input.ref]);
    await verifyCheckout({ checkout: target, remote: input.remote, ref: input.ref, subpaths: input.subpaths });
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function bindLocalAlias(input: {
  projectRoot: string;
  declaredLocal: string;
  checkout: string;
}): Promise<void> {
  if (isAbsolute(input.declaredLocal)) return;
  const projectRoot = await realpath(input.projectRoot);
  const alias = resolve(projectRoot, input.declaredLocal);
  const stats = await lstat(alias).catch(() => null);
  if (stats !== null) {
    if (stats.isSymbolicLink()) {
      const actual = resolve(dirname(alias), await readlink(alias));
      const actualReal = await realpath(actual).catch(() => null);
      if (actualReal !== null && actualReal === await realpath(input.checkout)) return;
      await rm(alias);
    } else {
      const actual = await realpath(alias);
      if (actual === await realpath(input.checkout)) return;
      throw userInputError(`declared local repository path already exists: ${input.declaredLocal}`, {
        local: input.declaredLocal,
        checkout: input.checkout,
        next: "Choose the existing checkout explicitly or move the conflicting path outside Context.",
      });
    }
  }
  await mkdir(dirname(alias), { recursive: true });
  await symlink(relative(dirname(alias), input.checkout) || ".", alias);
}

function selectPhysicalGroup(sources: readonly RepoSourceRecord[], selector: string): RepoSourceRecord[] {
  const direct = selectRepoSources(sources, selector);
  const byGroupId = sources.filter((source) => groupId(source) === selector);
  const matched = direct.length > 0 ? direct : byGroupId;
  if (matched.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `repo source or recovery group is not registered: ${selector}`, {
      category: ErrorCategory.SourceNotFound,
      sourceId: selector,
    });
  }
  const keys = [...new Set(matched.map(groupKey))];
  if (keys.length !== 1) {
    throw userInputError(`repository recovery selector matches multiple physical repositories: ${selector}`, {
      selector,
      groups: matched.map(groupId),
      next: "Use one recovery group id from context source recovery-plan.",
    });
  }
  const key = keys[0];
  return sources.filter((source) => groupKey(source) === key);
}

export async function restoreRepositorySources(input: {
  projectRoot: string;
  payload: RepositoryRecoveryPayload;
}): Promise<{
  schema: "context.repository-source-recovery-result.v1";
  restored: Array<{
    group: string;
    mode: "local" | "clone";
    checkout: string;
    sources: string[];
    ready: boolean;
    diagnostics: string[];
  }>;
  next_action: { command: string };
}> {
  return withProjectWriteLock(input.projectRoot, "source-restore-repositories", async () => {
    const registry = await readRepoRegistry(input.projectRoot);
    const requestedGroups = new Set<string>();
    const restored: Array<{
      group: string;
      mode: "local" | "clone";
      checkout: string;
      sources: string[];
      ready: boolean;
      diagnostics: string[];
    }> = [];
    let registryChanged = false;
    for (const request of input.payload.repositories) {
      const sources = selectPhysicalGroup(registry.repos, request.source);
      const representative = sources[0];
      if (representative === undefined) continue;
      const key = groupKey(representative);
      if (requestedGroups.has(key)) {
        throw userInputError(`repository recovery payload repeats physical repository group: ${groupId(representative)}`, {
          group: groupId(representative),
        });
      }
      requestedGroups.add(key);
      const subpaths = recoverySubpaths(sources);
      const checkout = request.mode === "clone"
        ? await cloneCheckout({
            projectRoot: input.projectRoot,
            remote: representative.git.remote,
            ref: representative.git.ref,
            subpaths,
            ...(request.path === undefined ? {} : { target: request.path }),
          })
        : await resolveGitRoot(resolve(input.projectRoot, request.path!));
      await verifyCheckout({
        checkout,
        remote: representative.git.remote,
        ref: representative.git.ref,
        subpaths,
      });
      for (const source of sources) {
        if (source.local !== undefined && !isAbsolute(source.local)) {
          await bindLocalAlias({ projectRoot: input.projectRoot, declaredLocal: source.local, checkout });
          continue;
        }
        const nextLocal = relative(input.projectRoot, checkout).startsWith("..")
          ? checkout
          : relative(input.projectRoot, checkout) || ".";
        if (source.local !== nextLocal) {
          source.local = nextLocal;
          registryChanged = true;
        }
      }
      const statuses = await Promise.all(sources.map((source) =>
        ensureRepoSource({ projectRoot: input.projectRoot, source })
      ));
      restored.push({
        group: groupId(representative),
        mode: request.mode,
        checkout,
        sources: sources.map((source) => source.name).sort(),
        ready: statuses.every((status) => status.ready),
        diagnostics: statuses.flatMap((status) =>
          status.diagnostics.map((diagnostic) => `${status.name}: ${diagnostic}`)
        ),
      });
    }
    if (registryChanged) await writeRepoRegistry(input.projectRoot, registry);
    return {
      schema: "context.repository-source-recovery-result.v1",
      restored,
      next_action: { command: "context status --format json" },
    };
  });
}
