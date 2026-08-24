import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import {
  approvedPathForDocumentRevisionPath,
  documentRevisionPathForApprovedPath,
  isDocumentRevisionPath,
} from "./knowledgeFileClassification.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import {
  isRecord,
  renderDocumentOptimizationPage,
  sha256,
  withDocumentRevisionMetadata,
} from "./documentOptimizationModel.js";
import {
  DOCUMENT_OPTIMIZATION_CACHE_ROOT,
  DOCUMENT_OPTIMIZATION_POLICY,
} from "./documentOptimizationConfig.js";

const DECISION_CACHE_SCHEMA = "context.document-optimization-cache.v4";

interface DecisionCache {
  schema: typeof DECISION_CACHE_SCHEMA;
  kept_pages: string[];
}

export interface DocumentRevisionFile {
  relPath: string;
  absPath: string;
  approvedPath: string;
}

function cachePath(projectRoot: string): string {
  return join(projectRoot, DOCUMENT_OPTIMIZATION_CACHE_ROOT, "decisions.json");
}

export function documentOptimizationPageKeepKey(file: ApprovedKnowledgeFile): string {
  return sha256(JSON.stringify({
    approved_path: file.relPath,
    base_digest: sha256(file.content),
    policy: DOCUMENT_OPTIMIZATION_POLICY,
  }));
}

export async function readDocumentOptimizationKeptPages(
  projectRoot: string,
): Promise<Set<string>> {
  const path = cachePath(projectRoot);
  if (!existsSync(path)) return new Set();
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isRecord(value) || value.schema !== DECISION_CACHE_SCHEMA ||
      !Array.isArray(value.kept_pages) || !value.kept_pages.every((item) =>
        typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)
      )
    ) return new Set();
    return new Set(value.kept_pages);
  } catch {
    return new Set();
  }
}

export async function writeDocumentOptimizationKeptPages(
  projectRoot: string,
  pageKeys: Iterable<string>,
): Promise<void> {
  const path = cachePath(projectRoot);
  const keptPages = [...new Set(pageKeys)].sort();
  await mkdir(dirname(path), { recursive: true });
  const value: DecisionCache = {
    schema: DECISION_CACHE_SCHEMA,
    kept_pages: keptPages,
  };
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function documentRevisionPath(projectRoot: string, approvedPath: string): string {
  return join(projectRoot, "knowledge", documentRevisionPathForApprovedPath(approvedPath));
}

export async function listDocumentRevisionFiles(projectRoot: string): Promise<DocumentRevisionFile[]> {
  const root = join(projectRoot, "knowledge");
  if (!existsSync(root)) return [];
  const files: DocumentRevisionFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = relative(root, absPath).split(/[\\/]+/u).join("/");
      if (!isDocumentRevisionPath(relPath)) continue;
      const approvedPath = approvedPathForDocumentRevisionPath(relPath);
      if (approvedPath !== null) files.push({ relPath, absPath, approvedPath });
    }
  };
  await visit(root);
  return files.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

export async function readDocumentRevision(
  projectRoot: string,
  approvedPath: string,
): Promise<string | null> {
  const path = documentRevisionPath(projectRoot, approvedPath);
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function ensureDocumentRevision(input: {
  projectRoot: string;
  file: ApprovedKnowledgeFile;
}): Promise<{ path: string; content: string; created: boolean }> {
  const path = documentRevisionPath(input.projectRoot, input.file.relPath);
  const existing = await readDocumentRevision(input.projectRoot, input.file.relPath);
  if (existing !== null) return { path, content: existing, created: false };
  const content = withDocumentRevisionMetadata({
    content: input.file.content,
    approvedPath: input.file.relPath,
    baseDigest: sha256(input.file.content),
  });
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, content);
  return { path, content, created: true };
}

export async function removeDocumentRevision(projectRoot: string, approvedPath: string): Promise<void> {
  await rm(documentRevisionPath(projectRoot, approvedPath), { force: true });
}

export async function writeDocumentRevision(input: {
  projectRoot: string;
  file: ApprovedKnowledgeFile;
  replacements: ReadonlyMap<string, string>;
}): Promise<string | null> {
  if (input.replacements.size === 0) {
    await removeDocumentRevision(input.projectRoot, input.file.relPath);
    return null;
  }
  const rendered = renderDocumentOptimizationPage({ file: input.file, replacements: input.replacements });
  const content = withDocumentRevisionMetadata({
    content: rendered,
    approvedPath: input.file.relPath,
    baseDigest: sha256(input.file.content),
  });
  const path = documentRevisionPath(input.projectRoot, input.file.relPath);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, content);
  return path;
}
