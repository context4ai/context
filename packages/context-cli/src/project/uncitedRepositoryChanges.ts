import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadSourcesRegistry } from "@c4a/context";
import { registeredRepository } from "./repoContentPrefetch.js";

const execute = promisify(execFile);
const offline = { ...process.env, GIT_NO_LAZY_FETCH: "1" };
const GROUP_LIMIT = 100;
// Lock files and unambiguous generated output never become knowledge on their own.
// Ambiguous names such as build/, out/ or generated/ stay listed for the agent to judge.
const LOCK_FILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|uv\.lock)$/u;
const GENERATED = /(?:^|\/)(?:node_modules|dist|coverage|__snapshots__|__generated__)\/|\.(?:min\.(?:js|css)|map|snap)$|\.pb\.go$|_pb2\.py$|\.generated\.[a-z]+$/u;

export interface UncitedChangeGroup { directory: string; added: number; modified: number; deleted: number; new_directory?: true }
export interface UncitedChanges {
  source_ref: string; from: string; to: string;
  groups: UncitedChangeGroup[];
  /** Lock files and generated output left out of the groups. */
  excluded_files: number;
  omitted_groups?: number;
  /** Set when the two commits could not be compared; the changes are then unknown, not absent. */
  unavailable?: string;
}

const parent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";

/** Changed files between the processed and the new commit that no approved page cites,
 * grouped by directory. Reads Git trees only, so partial clones need no downloads.
 * Files under a directory the old commit lacks are grouped under its top new directory. */
export async function uncitedRepositoryChanges(projectRoot: string,
  requests: ReadonlyArray<{ source_ref: string; from: string; to: string; cited: ReadonlySet<string> }>): Promise<UncitedChanges[]> {
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const results: UncitedChanges[] = [];
  for (const request of requests) {
    if (request.from === request.to) continue;
    const located = await registeredRepository(projectRoot, registry, request.source_ref);
    if (!located) continue;
    const git = (args: string[]) => execute("git", ["-C", located.root, ...args],
      { env: offline, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }).then(value => value.stdout, () => undefined);
    // Paths relative to the source directory, matching citation paths.
    const diff = await git(["diff", "--name-status", "-z", "--no-renames", "--relative", request.from, request.to, "--", "."]);
    const oldTrees = await git(["ls-tree", "-r", "-d", "-z", "--name-only", request.from, "--", "."]);
    if (diff === undefined || oldTrees === undefined) {
      results.push({ source_ref: request.source_ref, from: request.from, to: request.to, groups: [], excluded_files: 0,
        unavailable: "The processed and new commits could not be compared in the local checkout, so uncited changes are unknown." });
      continue;
    }
    const existing = new Set(oldTrees.split("\0").filter(Boolean));
    const groups = new Map<string, UncitedChangeGroup>();
    let excluded = 0;
    const fields = diff.split("\0");
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const status = fields[index]!, path = fields[index + 1]!;
      if (request.cited.has(path)) continue;
      if (LOCK_FILE.test(path) || GENERATED.test(path)) { excluded++; continue; }
      let directory = parent(path);
      let fresh = false;
      if (status === "A") {
        // Climb to the top directory that did not exist before.
        for (let current = directory; current !== "." && !existing.has(current); current = parent(current)) { directory = current; fresh = true; }
      }
      const group = groups.get(directory) ?? { directory, added: 0, modified: 0, deleted: 0, ...(fresh ? { new_directory: true as const } : {}) };
      if (status === "A") group.added++; else if (status === "D") group.deleted++; else group.modified++;
      groups.set(directory, group);
    }
    if (!groups.size && !excluded) continue;
    // New directories first, then by size: the likeliest new knowledge leads.
    const sorted = [...groups.values()].sort((left, right) => Number(Boolean(right.new_directory)) - Number(Boolean(left.new_directory))
      || (right.added + right.modified + right.deleted) - (left.added + left.modified + left.deleted) || left.directory.localeCompare(right.directory));
    results.push({ source_ref: request.source_ref, from: request.from, to: request.to, groups: sorted.slice(0, GROUP_LIMIT),
      excluded_files: excluded, ...(sorted.length > GROUP_LIMIT ? { omitted_groups: sorted.length - GROUP_LIMIT } : {}) });
  }
  return results;
}
