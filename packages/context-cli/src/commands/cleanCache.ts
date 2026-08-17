import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveCacheHome } from "../incremental/cache.js";

async function countFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    count += entry.isDirectory() ? await countFiles(full) : 1;
  }
  return count;
}

export async function inspectAllRetrievalCache(): Promise<{
  cacheRoot: string;
  projects: number;
  files: number;
  projectIds: string[];
}> {
  const cacheHome = resolveCacheHome();
  const cacheRoot = join(cacheHome, "retrieval");
  const projectIds = existsSync(cacheRoot)
    ? (await readdir(cacheRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const files = await countFiles(cacheRoot);
  return { cacheRoot, projects: projectIds.length, files, projectIds };
}

export async function cleanAllRetrievalCache(): Promise<{
  action: "cleaned";
  removedProjects: number;
  removedFiles: number;
}> {
  const inspected = await inspectAllRetrievalCache();
  await rm(inspected.cacheRoot, { recursive: true, force: true });
  return {
    action: "cleaned",
    removedProjects: inspected.projects,
    removedFiles: inspected.files,
  };
}
