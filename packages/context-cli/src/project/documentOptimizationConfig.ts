import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { isDocumentRevisionPath } from "./knowledgeFileClassification.js";

export const DOCUMENT_OPTIMIZATION_POLICY = "context.document-editorial-revision.v4";
export const DOCUMENT_OPTIMIZATION_CACHE_ROOT = join(".tmp", "context-runtime", "document-optimization");

const DOCUMENT_OPTIMIZATION_BASE_POLICY = "context.document-editorial-base.v1";
const DOCUMENT_OPTIMIZATION_SIGNAL_REVIEW_POLICY = "context.document-editorial-signal-review.v3";
const DOCUMENT_OPTIMIZATION_SIGNAL_POLICIES: Record<string, string> = {
  "brainstorm-without-decision": "v1",
  "adjacent-links": "v1",
  "duplicate-fragment": "v1",
  "empty-table-row": "v1",
  "heading-hierarchy-invalid": "v1",
  "heading-content-overloaded": "v1",
  "markdown-syntax-damaged": "v1",
  "conversion-artifact": "v1",
  "long-table-cell": "v1",
  "mixed-facts-and-draft": "v1",
  "placeholder-content": "v1",
  "raw-or-unlabeled-link": "v1",
  "sensitive-value-candidate": "v1",
  "strikethrough-only-block": "v1",
  "unanswered-question-set": "v1",
  "answered-question-set": "v1",
  "unstable-owner-reference": "v1",
  "volatile-query-url": "v1",
  "wide-table": "v1",
};

export function documentOptimizationPolicyDigest(signalCodes: readonly string[]): string {
  const policies = [...new Set(signalCodes)].sort().map((code) => [
    code,
    DOCUMENT_OPTIMIZATION_SIGNAL_POLICIES[code] ?? "unknown",
  ]);
  if (signalCodes.length > 0) policies.push(["signal-review", DOCUMENT_OPTIMIZATION_SIGNAL_REVIEW_POLICY]);
  return createHash("sha256").update(JSON.stringify({
    base: DOCUMENT_OPTIMIZATION_BASE_POLICY,
    policies,
  }), "utf8").digest("hex");
}

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

export async function disableDocumentOptimization(projectRoot: string): Promise<string | undefined> {
  const knowledgeRoot = join(projectRoot, "knowledge");
  let recoveryPath: string | undefined;
  if (existsSync(knowledgeRoot)) {
    const recoveryRoot = join(projectRoot, ".tmp", "context-runtime", "recovery");
    const candidate = join(recoveryRoot, `document-optimization-${recoveryTimestamp()}`);
    const moved: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(path);
          continue;
        }
        const relPath = relative(knowledgeRoot, path).split(/[\\/]+/u).join("/");
        if (!entry.isFile() || !isDocumentRevisionPath(relPath)) continue;
        const target = join(candidate, "knowledge", relPath);
        await mkdir(dirname(target), { recursive: true });
        await rename(path, target);
        moved.push(target);
      }
    };
    await visit(knowledgeRoot);
    if (moved.length > 0) recoveryPath = candidate;
  }
  await rm(documentOptimizationCacheRoot(projectRoot), { recursive: true, force: true });
  await updateSetting(projectRoot, false);
  return recoveryPath;
}
