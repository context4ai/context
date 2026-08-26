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
  fragmentSectionState,
  renderDocumentOptimizationPage,
  type DocumentOptimizationFragment,
  type DocumentOptimizationSectionState,
  withDocumentOptimizationKeepState,
  withDocumentRevisionMetadata,
} from "./documentOptimizationModel.js";
import {
  compactApprovedKnowledgeMarkdown,
  persistApprovedMachineMetadata,
} from "./approvedKnowledgeMetadata.js";

export interface DocumentRevisionFile {
  relPath: string;
  absPath: string;
  approvedPath: string;
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
  fragments: readonly DocumentOptimizationFragment[];
}): Promise<{ path: string; content: string; created: boolean }> {
  const path = documentRevisionPath(input.projectRoot, input.file.relPath);
  const existing = await readDocumentRevision(input.projectRoot, input.file.relPath);
  if (existing !== null) return { path, content: existing, created: false };
  const content = withDocumentRevisionMetadata({
    content: input.file.content,
    approvedPath: input.file.relPath,
    sections: new Map(input.fragments.map((fragment) => [fragment.section_id, fragmentSectionState(fragment)])),
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
  fragments: readonly DocumentOptimizationFragment[];
}): Promise<string | null> {
  if (input.replacements.size === 0) {
    await removeDocumentRevision(input.projectRoot, input.file.relPath);
    return null;
  }
  const rendered = renderDocumentOptimizationPage({ file: input.file, replacements: input.replacements });
  const content = withDocumentRevisionMetadata({
    content: rendered,
    approvedPath: input.file.relPath,
    sections: new Map(input.fragments
      .filter((fragment) => input.replacements.has(fragment.fragment_id))
      .map((fragment) => [fragment.section_id, fragmentSectionState(fragment)])),
  });
  const path = documentRevisionPath(input.projectRoot, input.file.relPath);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, content);
  return path;
}

export async function writeDocumentOptimizationKeepState(input: {
  projectRoot: string;
  file: ApprovedKnowledgeFile;
  sections: ReadonlyMap<string, DocumentOptimizationSectionState>;
}): Promise<ApprovedKnowledgeFile> {
  const content = withDocumentOptimizationKeepState({
    content: input.file.content,
    approvedPath: input.file.relPath,
    sections: input.sections,
  });
  const persisted = await persistApprovedMachineMetadata({
    projectRoot: input.projectRoot,
    relPath: input.file.relPath,
    content,
  });
  const storedContent = persisted ? compactApprovedKnowledgeMarkdown(content) : content;
  const absPath = join(input.projectRoot, "knowledge", input.file.relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await atomicWriteFile(absPath, storedContent);
  return { ...input.file, absPath, content };
}
