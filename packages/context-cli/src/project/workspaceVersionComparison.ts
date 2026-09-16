import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
const exec = promisify(execFile);

/** Git is a comparison baseline, never evidence of a successful deployment. */
export async function workspaceVersionComparison(root: string, version: string, paths: string[], requested?: string) {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
  try {
    if (await realpath((await git("rev-parse", "--show-toplevel")).trim()) !== await realpath(root)) throw new Error("Not an independent Git workspace");
  } catch {
    if (requested) throw new TypeError("A Git comparison base requires an independent Git workspace");
    return { base_ref: null, base_commit: null, tagged: false, added: paths, updated: [] as string[], removed: [] as string[] };
  }
  const commit = async (ref: string) => {
    try { return (await git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`)).trim(); }
    catch { return null; }
  };
  const tag = `refs/tags/v${version}`;
  const tagged = await commit(tag);
  const base_ref = requested ?? (tagged ? tag : "HEAD");
  const base_commit = await commit(base_ref);
  if (requested && !base_commit) throw new TypeError(`Unknown Git comparison base: ${requested}`);
  if (!base_commit) return { base_ref: null, base_commit: null, tagged: false, added: paths, updated: [] as string[], removed: [] as string[] };
  const tracked = new Set((await git("ls-tree", "-r", "--name-only", "-z", base_commit)).split("\0").filter(Boolean));
  const changed = new Set((await git("diff", "--name-only", "--no-renames", "-z", base_commit, "--")).split("\0").filter(Boolean));
  const current = new Set(paths);
  return { base_ref, base_commit, tagged: !!tagged,
    added: paths.filter(path => !tracked.has(path)), updated: paths.filter(path => tracked.has(path) && changed.has(path)),
    removed: [...tracked].filter(path => !current.has(path) && changed.has(path)) };
}
