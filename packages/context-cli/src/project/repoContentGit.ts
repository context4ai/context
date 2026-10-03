import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { repoContentPathSchema } from "@c4a/context";

const exec = promisify(execFile);
export async function repoContentGit(root: string, args: string[]): Promise<string> {
  const result = await exec("git", ["-C", root, ...args], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 15000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  return result.stdout;
}
export async function optionalRepoGit(root: string, args: string[]): Promise<string | undefined> {
  try { return (await repoContentGit(root, args)).trim(); } catch { return undefined; }
}
export function insideRepo(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

/** Validate every existing component before reading. Nested repositories and
 * directory symlinks are not silently treated as files owned by this repo. */
export async function repoContentRealPath(root: string, path: string): Promise<string> {
  repoContentPathSchema.parse(path);
  const base = await realpath(root);
  let current = base;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) current = await realpath(current);
      if (!insideRepo(base, current)) throw new TypeError("Repository content escapes its Git repository");
      if ((info.isSymbolicLink() ? await stat(current) : info).isDirectory()) {
        let nested = false;
        try { await lstat(resolve(current, ".git")); nested = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (nested) throw new TypeError("Repository content cannot cross a nested repository or submodule");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}

export async function canReadRepoObjects(root: string): Promise<boolean> {
  const partial = await optionalRepoGit(root, ["config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"]);
  if (!partial) return true;
  // Feature probing does not read blobs. Older Git must use the working tree,
  // because ignoring GIT_NO_LAZY_FETCH could otherwise trigger network access.
  return (await optionalRepoGit(root, ["--no-lazy-fetch", "rev-parse", "--git-dir"])) !== undefined;
}
export async function readRepoContentAt(root: string, path: string, commit?: string): Promise<string> {
  repoContentPathSchema.parse(path);
  if (commit) {
    if (!/^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/u.test(commit) || !await canReadRepoObjects(root)) {
      throw new TypeError("The fixed repository object is unavailable offline");
    }
    const mode = await repoContentGit(root, ["ls-tree", commit, "--", path]);
    if (!/^100(?:644|755) blob /u.test(mode)) throw new TypeError("Evidence must identify a regular Git file");
    return repoContentGit(root, ["show", `${commit}:${path}`]);
  }
  const actual = await repoContentRealPath(root, path);
  if (!(await lstat(actual)).isFile()) throw new TypeError("Repository content must be a regular file");
  return readFile(actual, "utf8");
}
