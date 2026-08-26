import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
]);

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/{2,}/gu, "/");
}

function extension(value: string): string {
  const name = value.toLowerCase();
  if (name.endsWith(".mdx")) return ".mdx";
  if (name.endsWith(".md")) return ".md";
  return "";
}

function isRootDocument(relativePath: string): boolean {
  const normalized = normalizePath(relativePath).toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  if (segments.length === 1) {
    return /^(?:readme|agents|contributing|architecture|developing|development)(?:\.[^.]+)?\.mdx?$/u.test(basename);
  }
  return segments.length === 2 && segments[0] === "docs" && /^(?:readme|index)\.mdx?$/u.test(basename);
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = normalizePath(relativeDirectory.length === 0
        ? entry.name
        : `${relativeDirectory}/${entry.name}`);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
          await visit(join(absoluteDirectory, entry.name), relativePath);
        }
        continue;
      }
      if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extension(entry.name))) files.push(relativePath);
    }
  };
  await visit(root, "");
  return files.sort();
}

function matchesDeclaredDocument(target: string, declared: ReadonlySet<string>): boolean {
  const normalizedTarget = normalizePath(target).toLowerCase();
  for (const value of declared) {
    const normalizedValue = normalizePath(value).toLowerCase();
    if (
      normalizedValue === normalizedTarget ||
      normalizedTarget.endsWith(`/${normalizedValue}`) ||
      normalizedValue.endsWith(`/${normalizedTarget}`)
    ) return true;
  }
  return false;
}

export function markdownPathsFromEvidence(evidence: readonly string[]): string[] {
  const paths: string[] = [];
  for (const item of evidence) {
    for (const match of item.matchAll(/(?:^|[\s('"`])([^\s'"`()]+\.mdx?)(?=$|[\s)'"`,:])/giu)) {
      if (match[1] !== undefined) paths.push(normalizePath(match[1]));
    }
  }
  return [...new Set(paths)].sort();
}

export async function inspectCodeIndexDocuments(input: {
  moduleRoot: string;
  modulePrefix: string;
  declaredDocuments: readonly string[];
}): Promise<{
  documentTargets: string[];
  rootDocumentTargets: string[];
  readDocumentTargets: string[];
}> {
  const relativeDocuments = await collectMarkdownFiles(input.moduleRoot);
  const prefix = normalizePath(input.modulePrefix) === "." ? "" : normalizePath(input.modulePrefix);
  const documentTargets = relativeDocuments.map((relativePath) =>
    prefix.length === 0 ? relativePath : `${prefix}/${relativePath}`
  );
  const rootDocumentTargets = documentTargets.filter((_, index) => isRootDocument(relativeDocuments[index]!));
  const declared = new Set(input.declaredDocuments.map((value) => normalizePath(value)));
  const readDocumentTargets = documentTargets.filter((target) => matchesDeclaredDocument(target, declared));
  return { documentTargets, rootDocumentTargets, readDocumentTargets };
}
