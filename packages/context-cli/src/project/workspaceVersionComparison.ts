import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
const exec = promisify(execFile);

/** Git is a comparison baseline, never evidence of a successful deployment. */
export async function workspaceVersionComparison(root: string, version: string, paths: string[], requested?: string) {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
  // A workspace embedded in a larger repository compares only its own subtree;
  // release tags of that repository are not workspace versions.
  let embedded: boolean;
  try {
    embedded = await realpath((await git("rev-parse", "--show-toplevel")).trim()) !== await realpath(root);
  } catch {
    if (requested) throw new TypeError("A Git comparison base requires the workspace to be inside a Git repository");
    return { base_ref: null, base_commit: null, tagged: false, added: paths, updated: [] as string[], removed: [] as string[] };
  }
  const commit = async (ref: string) => {
    try { return (await git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`)).trim(); }
    catch { return null; }
  };
  const tag = `refs/tags/v${version}`;
  const tagged = embedded ? null : await commit(tag);
  const base_ref = requested ?? (tagged ? tag : "HEAD");
  const base_commit = await commit(base_ref);
  if (requested && !base_commit) throw new TypeError(`Unknown Git comparison base: ${requested}`);
  if (!base_commit) return { base_ref: null, base_commit: null, tagged: false, added: paths, updated: [] as string[], removed: [] as string[] };
  // Both listings are limited to and relative to the workspace directory.
  const tracked = new Set((await git("ls-tree", "-r", "--name-only", "-z", base_commit)).split("\0").filter(Boolean));
  const changed = new Set((await git("diff", "--name-only", "--relative", "--no-renames", "-z", base_commit, "--")).split("\0").filter(Boolean));
  const current = new Set(paths);
  return { base_ref, base_commit, tagged: !!tagged,
    added: paths.filter(path => !tracked.has(path)), updated: paths.filter(path => tracked.has(path) && changed.has(path)),
    removed: [...tracked].filter(path => !current.has(path) && changed.has(path)) };
}
