import { mkdir, mkdtemp, readFile, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { walkPackageFiles } from "./packageBuildReceipt.js";
import { validatePackageIndexLinks } from "./packageIndexes.js";
import { packageOutputDirs } from "./packageOutputPaths.js";

/** Validate a complete output before changing the preview. Keep unchanged files
 * in place; an interrupted publication is detected by the old fingerprint and
 * safely retried on the next build. */
export async function withStagedPackageOutput<T>(
  projectRoot: string,
  pkg: PackageDefinition,
  render: (stagedPackage: PackageDefinition) => Promise<T>
): Promise<T> {
  const tempRoot = join(projectRoot, ".tmp");
  await mkdir(tempRoot, { recursive: true });
  const stage = await mkdtemp(join(tempRoot, "package-build-"));
  const stagedPackage = { ...pkg, outDir: relative(projectRoot, join(stage, pkg.name)) };
  try {
    await mkdir(join(projectRoot, stagedPackage.outDir), { recursive: true });
    const value = await render(stagedPackage);
    await validatePackageIndexLinks({ projectRoot, pkg: stagedPackage });
    const destinations = packageOutputDirs(pkg);
    const staged = packageOutputDirs(stagedPackage);
    for (const [index, destination] of destinations.entries()) {
      const target = join(projectRoot, destination);
      const previous = await walkPackageFiles(target);
      const next = await walkPackageFiles(join(projectRoot, staged[index]!));
      const desired = new Set(next.map((file) => file.relPath));
      // Remove obsolete paths after validation, including files which now need
      // to become directories (and directories which now need to become files).
      for (const file of previous) {
        if (desired.has(file.relPath)) continue;
        await rm(file.absPath);
        let directory = dirname(file.absPath);
        while (directory !== target) {
          try {
            await rmdir(directory);
          } catch {
            break;
          }
          directory = dirname(directory);
        }
      }
      for (const file of next) {
        const output = join(target, file.relPath);
        const bytes = await readFile(file.absPath);
        const old = await readFile(output).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        if (old?.equals(bytes)) continue;
        await mkdir(dirname(output), { recursive: true });
        // Stage and destination share the project filesystem. Renaming each
        // completed file prevents readers observing a partially written file.
        await rename(file.absPath, output);
      }
    }
    return value;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
