import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface AtomicFileBatchWrite {
  path: string;
  bytes: string | Uint8Array;
}

async function existingFileKind(path: string): Promise<"file" | "directory" | "symlink" | "missing"> {
  try {
    const stats = await lstat(path);
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    if (stats.isSymbolicLink()) return "symlink";
    throw new TypeError(`atomic file batch target has an unsupported filesystem kind: ${path}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return "missing";
    }
    throw error;
  }
}

/**
 * Apply a related set of file replacements and removals as one rollback-safe
 * operation. All replacement bytes are staged before existing targets move.
 * If a filesystem operation fails, every target already touched is restored.
 */
export async function applyAtomicFileBatch(input: {
  transactionRoot: string;
  writes: readonly AtomicFileBatchWrite[];
  removals?: readonly string[];
}): Promise<void> {
  const writesByPath = new Map<string, AtomicFileBatchWrite>();
  for (const write of input.writes) {
    const path = resolve(write.path);
    if (writesByPath.has(path)) throw new TypeError(`atomic file batch contains duplicate write target: ${path}`);
    writesByPath.set(path, { path, bytes: write.bytes });
  }
  const removalPaths = new Set((input.removals ?? []).map((path) => resolve(path)));
  for (const path of writesByPath.keys()) removalPaths.delete(path);

  await mkdir(input.transactionRoot, { recursive: true });
  const transactionDir = await mkdtemp(join(input.transactionRoot, "batch-"));
  const stagedRoot = join(transactionDir, "staged");
  const backupRoot = join(transactionDir, "backup");
  const writes = [...writesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const affectedPaths = [...new Set([...writesByPath.keys(), ...removalPaths])].sort();
  const staged = new Map<string, string>();
  const backups = new Map<string, string>();
  const installed: string[] = [];
  let preserveTransaction = false;

  try {
    await mkdir(stagedRoot, { recursive: true });
    for (const [index, write] of writes.entries()) {
      const path = join(stagedRoot, String(index));
      await writeFile(path, write.bytes);
      staged.set(write.path, path);
    }

    for (const [index, path] of affectedPaths.entries()) {
      if (await existingFileKind(path) === "missing") continue;
      const backupPath = join(backupRoot, String(index));
      await mkdir(dirname(backupPath), { recursive: true });
      await rename(path, backupPath);
      backups.set(path, backupPath);
    }

    for (const write of writes) {
      await mkdir(dirname(write.path), { recursive: true });
      await rename(staged.get(write.path)!, write.path);
      installed.push(write.path);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const path of installed.reverse()) {
      await rm(path, { force: true }).catch((rollbackError) => {
        rollbackFailures.push(`remove ${path}: ${String(rollbackError)}`);
      });
    }
    for (const [path, backupPath] of [...backups.entries()].reverse()) {
      await mkdir(dirname(path), { recursive: true });
      await rename(backupPath, path).catch((rollbackError) => {
        rollbackFailures.push(`restore ${path}: ${String(rollbackError)}`);
      });
    }
    if (rollbackFailures.length > 0) {
      preserveTransaction = true;
      throw new Error(
        `atomic file batch failed and rollback was incomplete; recovery files remain at ${transactionDir}: ` +
        rollbackFailures.join("; "),
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (!preserveTransaction) await rm(transactionDir, { recursive: true, force: true });
  }
}
