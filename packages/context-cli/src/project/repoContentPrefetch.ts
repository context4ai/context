import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadSourcesRegistry } from "@c4a/context";
import { redactRemoteCredentials, runGitWithProgress } from "../lib/gitProgress.js";

const execute = promisify(execFile);
const offline = { ...process.env, GIT_NO_LAZY_FETCH: "1" };
const FETCH_BATCH = 1000;
const PATH_BATCH = 500;

export interface RepositoryContentPreparation {
  source_ref: string;
  commit: string;
  /** Cited file contents that were not local before preparation. */
  missing: number;
  /** Contents still missing afterwards; the reason explains why. */
  unresolved: number;
  reason?: string;
}

async function git(root: string, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}) {
  const pending = execute("git", ["-C", root, ...args], { env: options.env ?? offline, timeout: options.timeout ?? 30_000, maxBuffer: 64 * 1024 * 1024 });
  if (options.input !== undefined) pending.child.stdin?.end(options.input);
  return (await pending).stdout;
}

/** The checkout directory and registered commit of a `repo:` source. */
export async function registeredRepository(projectRoot: string, registry: Awaited<ReturnType<typeof loadSourcesRegistry>>,
  sourceRef: string): Promise<{ root: string; ref: string } | undefined> {
  if (!sourceRef.startsWith("repo:")) return undefined;
  const name = sourceRef.slice("repo:".length);
  const entry = registry.repos.find(item => item.id === name || item.name === name);
  if (!entry) return undefined;
  try { return { root: await realpath(resolve(projectRoot, entry.materializedAt)), ref: entry.ref }; } catch { return undefined; }
}

/** A partial clone records its promisor remote as `remote.<name>.promisor`; older Git
 * also writes `extensions.partialClone`. Git downloads missing objects from that remote. */
async function promisorRemote(root: string): Promise<string | undefined> {
  const listed = await git(root, ["config", "--get-regexp", "^remote\\..*\\.promisor$"]).catch(() => "");
  for (const line of listed.split("\n")) {
    const match = /^remote\.(.+)\.promisor\s+(true|yes|on|1)$/iu.exec(line.trim());
    if (match) return match[1];
  }
  return (await git(root, ["config", "--get", "extensions.partialClone"]).catch(() => "")).trim() || undefined;
}

async function missingObjects(root: string, commit: string, paths: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < paths.length; index += PATH_BATCH) {
    const listed = await git(root, ["ls-tree", "-z", commit, "--", ...paths.slice(index, index + PATH_BATCH).map(path => `./${path}`)]).catch(() => "");
    for (const entry of listed.split("\0")) {
      const match = /^\d+ blob ([a-f0-9]+)\t/u.exec(entry);
      if (match) ids.push(match[1]!);
    }
  }
  if (!ids.length) return [];
  const checked = await git(root, ["cat-file", "--batch-check"], { input: `${[...new Set(ids)].join("\n")}\n` });
  return checked.split("\n").filter(line => line.endsWith(" missing")).map(line => line.split(" ")[0]!);
}


/** Download the contents of cited files that a partial clone has not fetched yet.
 * Only `update --pending` calls this; status, verify and production reads stay local.
 * Objects are added to the Git object store; the checkout and its files are unchanged. */
export async function prepareRepositoryContents(projectRoot: string,
  requests: ReadonlyArray<{ source_ref: string; commit?: string; paths: readonly string[] }>): Promise<RepositoryContentPreparation[]> {
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const results: RepositoryContentPreparation[] = [];
  for (const request of requests) {
    if (!request.paths.length) continue;
    const located = await registeredRepository(projectRoot, registry, request.source_ref);
    if (!located) continue;
    const { root } = located;
    const commit = request.commit ?? located.ref;
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit)) continue;
    const commitLocal = await git(root, ["cat-file", "-e", `${commit}^{commit}`]).then(() => true, () => false);
    if (!commitLocal) continue;
    const paths = [...new Set(request.paths)];
    const missing = await missingObjects(root, commit, paths);
    const result: RepositoryContentPreparation = { source_ref: request.source_ref, commit, missing: missing.length, unresolved: missing.length };
    if (missing.length) {
      const remote = await promisorRemote(root);
      if (!remote) result.reason = "the checkout is not a partial clone, so Git cannot download the missing contents on its own";
      else {
        try {
          for (let index = 0; index < missing.length; index += FETCH_BATCH) {
            // Runs as long as git reports progress; stalls and very long downloads are reported.
            await runGitWithProgress(["-C", root, "-c", "fetch.negotiationAlgorithm=noop", "fetch", "--no-tags", "--no-write-fetch-head",
              "--recurse-submodules=no", "--filter=blob:none", remote, ...missing.slice(index, index + FETCH_BATCH)],
            { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, label: `git fetch of ${request.source_ref} contents` });
          }
        } catch (error) { result.reason = redactRemoteCredentials(error instanceof Error ? error.message : String(error)).slice(0, 400); }
        result.unresolved = (await missingObjects(root, commit, paths)).length;
        if (!result.unresolved) delete result.reason;
      }
    }
    results.push(result);
  }
  return results;
}
