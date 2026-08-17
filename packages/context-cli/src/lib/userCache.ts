import { contentHash } from "@c4a/core";
import { existsSync, realpathSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { workspaceLocationFromCtxDir } from "./workspaceLayout.js";

export interface WorkspaceUserCacheCleanResult {
  action: "cleaned";
  projectId: string;
  cachePath: string;
  removedFiles: number;
  removedCachePaths?: string[];
}

export interface WorkspaceUserCacheInput {
  cacheHome?: string;
  defaultCacheHome?: string;
}

function isMissingPathError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function countFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += await countFiles(full);
      } else {
        count += 1;
      }
    }
  } catch (err) {
    if (isMissingPathError(err)) return 0;
    throw err;
  }
  return count;
}

export function workspaceUserCacheProjectId(ctxDir: string): string {
  const location = workspaceLocationFromCtxDir(ctxDir);
  const identityRoot = location.layout === "embedded" && basename(location.ctxDir) !== ".context"
    ? location.ctxDir
    : location.workspaceRoot;
  let stableRoot = identityRoot;
  try {
    stableRoot = realpathSync.native(identityRoot);
  } catch {
    stableRoot = identityRoot;
  }
  return contentHash(stableRoot).slice(0, 32);
}

export function workspaceLocalUserCacheRoot(ctxDir: string): string {
  return join(ctxDir, ".tmp", "context-cli");
}

export function workspaceUserCacheRoot(ctxDir: string, input: WorkspaceUserCacheInput = {}): string {
  void input;
  return workspaceLocalUserCacheRoot(ctxDir);
}

export async function cleanWorkspaceUserCache(
  ctxDir: string,
  input: WorkspaceUserCacheInput = {},
): Promise<WorkspaceUserCacheCleanResult> {
  const candidatePaths = [workspaceLocalUserCacheRoot(ctxDir)];
  let removedFiles = 0;
  const removedCachePaths: string[] = [];
  for (const path of candidatePaths) {
    removedFiles += await countFiles(path);
    try {
      await rm(path, { recursive: true, force: true });
      removedCachePaths.push(path);
    } catch (err) {
      if (!isMissingPathError(err)) throw err;
    }
  }
  const cachePath = workspaceUserCacheRoot(ctxDir, input);
  return {
    action: "cleaned",
    projectId: workspaceUserCacheProjectId(ctxDir),
    cachePath,
    removedFiles,
    removedCachePaths,
  };
}
