import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export const DOCUMENT_OPTIMIZATION_ROOT = "overlays";
export const DOCUMENT_OPTIMIZATION_POLICY = "context.document-optimization.v2";
export const DOCUMENT_OPTIMIZATION_CACHE_ROOT = join(".tmp", "context-runtime", "document-optimization");

interface ContextPackageJson extends Record<string, unknown> {
  context?: Record<string, unknown>;
}

function packageJsonPath(projectRoot: string): string {
  return join(projectRoot, "package.json");
}

async function readPackageJson(projectRoot: string): Promise<ContextPackageJson> {
  const path = packageJsonPath(projectRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ContextError(ExitCode.WorkspaceStateError, "package.json is not readable JSON", {
      category: ErrorCategory.SchemaInvalid,
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "package.json must contain an object", {
      category: ErrorCategory.SchemaInvalid,
      path,
    });
  }
  const result = parsed as ContextPackageJson;
  if (
    result.context === null ||
    typeof result.context !== "object" ||
    Array.isArray(result.context) ||
    result.context.project !== true
  ) {
    throw new ContextError(ExitCode.WorkspaceStateError, "package.json is not a Context project", {
      category: ErrorCategory.WorkspaceNotFound,
      path,
    });
  }
  return result;
}

export function documentOptimizationRoot(projectRoot: string): string {
  return join(projectRoot, DOCUMENT_OPTIMIZATION_ROOT);
}

export function documentOptimizationCacheRoot(projectRoot: string): string {
  return join(projectRoot, DOCUMENT_OPTIMIZATION_CACHE_ROOT);
}

export async function isDocumentOptimizationEnabled(projectRoot: string): Promise<boolean> {
  const parsed = await readPackageJson(projectRoot);
  return parsed.context?.documentOptimization === true;
}

async function updateSetting(projectRoot: string, enabled: boolean): Promise<void> {
  const parsed = await readPackageJson(projectRoot);
  const context = parsed.context!;
  if (enabled) context.documentOptimization = true;
  else delete context.documentOptimization;
  await atomicWriteFile(packageJsonPath(projectRoot), `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function enableDocumentOptimization(projectRoot: string): Promise<void> {
  await updateSetting(projectRoot, true);
}

function recoveryTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

async function removeEmptyDirectories(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmptyDirectories(join(dir, entry.name));
  }
  if ((await readdir(dir)).length === 0) await rmdir(dir);
}

export async function disableDocumentOptimization(projectRoot: string): Promise<string | undefined> {
  const overlayRoot = documentOptimizationRoot(projectRoot);
  let recoveryPath: string | undefined;
  if (existsSync(overlayRoot)) {
    const recoveryRoot = join(projectRoot, ".tmp", "context-runtime", "recovery");
    const candidate = join(recoveryRoot, `document-optimization-${recoveryTimestamp()}`);
    const moved: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (path === join(overlayRoot, "document-optimization")) {
            const target = join(candidate, "legacy-v1");
            await mkdir(dirname(target), { recursive: true });
            await rename(path, target);
            moved.push(target);
          } else {
            await visit(path);
          }
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const content = await readFile(path, "utf8");
        if (!/\bcontext_overlay\s*:/u.test(content)) continue;
        const target = join(candidate, "overlays", relative(overlayRoot, path));
        await mkdir(dirname(target), { recursive: true });
        await rename(path, target);
        moved.push(target);
      }
    };
    await visit(overlayRoot);
    await removeEmptyDirectories(overlayRoot);
    if (moved.length > 0) recoveryPath = candidate;
  }
  await rm(documentOptimizationCacheRoot(projectRoot), { recursive: true, force: true });
  await updateSetting(projectRoot, false);
  return recoveryPath;
}
