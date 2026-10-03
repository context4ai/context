import { lstat, mkdir, readdir, readlink, symlink, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { optionalRepoGit } from "./repoContentGit.js";
import { withProjectWriteLock } from "./writeLock.js";
import { readRepoContentRegistry, repoContentTargetExists } from "./repoContentRegistry.js";

export interface RepoContentLinkResult {
  type: "repo-content";
  name: string;
  path: string;
  status: "ready" | "missing" | "mismatch" | "target-missing" | "conflict" | "removed" | "repaired" | "symlinks-disabled" | "invalid";
  message?: string;
}
export function repoContentLinksNeedRepair(results: readonly RepoContentLinkResult[]): boolean {
  return results.some(item => item.status === "missing" || item.status === "mismatch");
}
export async function ensureRepoContentLinks(projectRoot: string): Promise<RepoContentLinkResult[]> {
  return withProjectWriteLock(projectRoot, "ensure-repo-content", () => inspectRepoContentLinks(projectRoot, true));
}
async function info(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Namespace is a derived view. Never follow a view symlink while inspecting
 * or removing obsolete entries, and never replace an ordinary user file. */
export async function inspectRepoContentLinks(projectRoot: string, repair = false): Promise<RepoContentLinkResult[]> {
  let registry;
  try { registry = await readRepoContentRegistry(projectRoot); }
  catch (error) {
    return [{ type: "repo-content", name: "repo-content.yaml", path: join(projectRoot, "repo-content.yaml"),
      status: "invalid", message: `${error instanceof Error ? error.message : String(error)}. Correct the registry before repairing the view; existing links are unchanged.` }];
  }
  const view = join(registry?.projectRoot ?? projectRoot, "repo-content");
  const viewInfo = await info(view);
  if (viewInfo && !viewInfo.isDirectory()) return [{ type: "repo-content", name: "repo-content", path: view,
    status: "conflict", message: "The view root must be an ordinary directory; it was not replaced." }];
  const disabled = await optionalRepoGit(registry?.repoRoot ?? projectRoot, ["config", "--get", "core.symlinks"]) === "false";
  const results: RepoContentLinkResult[] = [];
  const expected = new Set(registry?.entries.map(entry => entry.mountPath) ?? []);
  async function obsolete(directory: string, prefix = "") {
    if (!await info(directory)) return;
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const mount = prefix + file.name;
      const path = join(directory, file.name);
      if (file.isSymbolicLink() && !expected.has(mount)) {
        if (repair && !disabled) await unlink(path);
        results.push({ type: "repo-content", name: mount, path,
          status: disabled ? "symlinks-disabled" : repair ? "removed" : "mismatch", message: "Link is not declared in repo-content.yaml." });
      } else if (file.isDirectory()) await obsolete(path, `${mount}/`);
    }
  }
  // Registry validation finishes before the first mutation.
  for (const entry of registry?.entries ?? []) {
    const path = join(view, entry.mountPath);
    const base = { type: "repo-content" as const, name: entry.id, path };
    if (!await repoContentTargetExists(entry)) {
      results.push({ ...base, status: "target-missing", message: `Check the registered path ${entry.path}, sparse checkout, or a possible move; no content was restored.` });
      continue;
    }
    const parent = dirname(path);
    const parentInfo = parent === view ? viewInfo : await info(parent);
    if (parentInfo && !parentInfo.isDirectory()) {
      results.push({ ...base, status: "conflict", message: "View parent is not an ordinary directory." }); continue;
    }
    const existing = await info(path);
    const target = relative(parent, entry.absolutePath).split("\\").join("/");
    if (existing?.isSymbolicLink() && await readlink(path) === target) {
      results.push({ ...base, status: "ready" }); continue;
    }
    if (disabled) {
      results.push({ ...base, status: "symlinks-disabled", message: `Use the registered real path ${entry.path}; do not read a Git symlink placeholder as content.` }); continue;
    }
    if (existing && !existing.isSymbolicLink()) {
      results.push({ ...base, status: "conflict", message: "An ordinary file or directory occupies this mount; it was not replaced." }); continue;
    }
    if (!repair) { results.push({ ...base, status: existing ? "mismatch" : "missing" }); continue; }
    try {
      await mkdir(parent, { recursive: true });
      if (existing) await unlink(path);
      await symlink(target, path, entry.kind === "document" ? "file" : "dir");
      results.push({ ...base, status: "repaired" });
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      results.push({ ...base, status: "symlinks-disabled", message: `Cannot create symlinks here; use ${entry.path}. No Git or system settings were changed.` });
    }
  }
  await obsolete(view);
  return results;
}
