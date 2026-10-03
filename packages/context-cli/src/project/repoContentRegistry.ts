import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { repoContentMount, repoContentRegistrySchema, type RepoContentEntry } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { insideRepo, optionalRepoGit, repoContentRealPath } from "./repoContentGit.js";

export type RegisteredRepoContent = RepoContentEntry & { id: string; mountPath: string; absolutePath: string };
export interface RepoContentRegistration {
  projectRoot: string;
  repoRoot: string;
  entries: RegisteredRepoContent[];
  content: string;
  git: boolean;
}
export function repoContentError(message: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `Invalid repo-content registry: ${message}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    next: "Correct repo-content.yaml, then run context source inspect --format json. Existing files are unchanged.",
  });
}
export function repoContentContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

export async function readRepoContentRegistry(projectRoot: string): Promise<RepoContentRegistration | undefined> {
  const root = await realpath(projectRoot);
  let content: string;
  try {
    const registryPath = join(root, "repo-content.yaml");
    if (!(await lstat(registryPath)).isFile()) throw repoContentError("repo-content.yaml must be a regular file");
    content = await readFile(registryPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const registry = repoContentRegistrySchema.parse(YAML.parse(content));
    const gitRoot = await optionalRepoGit(root, ["rev-parse", "--show-toplevel"]);
    const repoRoot = await realpath(gitRoot ?? root);
    const entries: RegisteredRepoContent[] = [];
    for (const [id, entry] of Object.entries(registry.entries)) {
      const mountPath = repoContentMount(entry);
      if (mountPath.split("/").length !== (entry.group ? 2 : 1) || (entry.group && !mountPath.startsWith(`${entry.group}/`))) {
        throw new TypeError(`Entry ${id}: mount must have at most one group and agree with group`);
      }
      const absolutePath = await repoContentRealPath(repoRoot, entry.path);
      if (insideRepo(absolutePath, root) || insideRepo(join(root, "repo-content"), absolutePath)) {
        throw new TypeError(`Entry ${id}: target would include the workspace or its link view`);
      }
      const submodule = gitRoot && await optionalRepoGit(repoRoot, ["ls-files", "--stage", "--", entry.path]);
      if (submodule?.split("\n").some(line => line.startsWith("160000 "))) {
        throw new TypeError(`Entry ${id}: target includes a submodule`);
      }
      for (const other of entries) {
        if (insideRepo(absolutePath, other.absolutePath) || insideRepo(other.absolutePath, absolutePath)) {
          throw new TypeError(`Entries ${id} and ${other.id} overlap; register a source once`);
        }
        if (repoContentContains(mountPath, other.mountPath) || repoContentContains(other.mountPath, mountPath)) {
          throw new TypeError(`Entries ${id} and ${other.id} have overlapping mounts; set distinct mounts`);
        }
      }
      entries.push({ ...entry, id, mountPath, absolutePath });
    }
    return { projectRoot: root, repoRoot, content, entries, git: gitRoot !== undefined };
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw repoContentError(error instanceof Error ? error.message : String(error));
  }
}

export function repoContentExcluded(entry: RepoContentEntry, repositoryPath: string): boolean {
  const path = repositoryPath === entry.path ? "" : repositoryPath.slice(entry.path.length + 1);
  return (entry.exclude ?? []).some(pattern => {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i]!;
      if (char === "*" && pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") { i++; source += "(?:.*/)?"; }
        else source += ".*";
      } else if (char === "*") source += "[^/]*";
      else if (char === "?") source += "[^/]";
      else source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
    return new RegExp(`^${source}$`, "u").test(path);
  });
}

export function repoContentEntryForPath(registry: RepoContentRegistration, path: string): RegisteredRepoContent | undefined {
  return registry.entries.find(entry => repoContentContains(entry.path, path) && !repoContentExcluded(entry, path));
}

export async function repoContentTargetExists(entry: RegisteredRepoContent): Promise<boolean> {
  try {
    const info = await lstat(resolve(entry.absolutePath));
    return entry.kind === "document" ? info.isFile() : info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
