import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { indexGoSource } from "./parser.js";
import type { GoIndexOptions, GoRepositoryIndex } from "./types.js";

const DEFAULT_EXCLUDED_DIRECTORIES = [".git", "node_modules", "vendor"] as const;

function normalizePath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//u, "");
}

function isIncluded(relativePath: string, includes: readonly string[]): boolean {
  if (includes.length === 0 || includes.includes(".")) return true;
  return includes.some((entry) => {
    const prefix = normalizePath(entry).replace(/\/$/u, "");
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  });
}

function isGeneratedSource(source: string): boolean {
  return /^\/\/ Code generated .* DO NOT EDIT\.$/mu.test(source.slice(0, 4096));
}

export async function indexGoRepository(repositoryRoot: string, options: GoIndexOptions = {}): Promise<GoRepositoryIndex> {
  const root = path.resolve(repositoryRoot);
  const include = [...new Set(options.include ?? [])].map(normalizePath).sort();
  const excludeDirectories = [...new Set([
    ...DEFAULT_EXCLUDED_DIRECTORIES,
    ...(options.excludeDirectories ?? []),
  ])].sort();
  const excluded = new Set(excludeDirectories);
  const includeTests = options.includeTests ?? false;
  const includeGenerated = options.includeGenerated ?? false;
  const exportedOnly = options.exportedOnly ?? false;
  const sourceFiles: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizePath(path.relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        await visit(absolutePath);
      } else if (entry.isFile() && relativePath.endsWith(".go") && isIncluded(relativePath, include)) {
        sourceFiles.push(relativePath);
      }
    }
  };

  await visit(root);
  sourceFiles.sort();
  let skippedTestFiles = 0;
  let skippedGeneratedFiles = 0;
  const files = [];
  for (const relativePath of sourceFiles) {
    if (!includeTests && relativePath.endsWith("_test.go")) {
      skippedTestFiles += 1;
      continue;
    }
    const source = await readFile(path.join(root, relativePath), "utf8");
    if (!includeGenerated && isGeneratedSource(source)) {
      skippedGeneratedFiles += 1;
      continue;
    }
    files.push(indexGoSource(source, relativePath, { exportedOnly }));
  }

  return {
    root,
    options: {
      exportedOnly,
      includeTests,
      includeGenerated,
      include,
      excludeDirectories,
    },
    stats: {
      discoveredFiles: sourceFiles.length,
      analyzedFiles: files.length,
      skippedTestFiles,
      skippedGeneratedFiles,
      parseErrors: files.reduce((sum, file) => sum + file.parseErrors, 0),
      symbols: files.reduce((sum, file) => sum + file.symbols.length, 0),
      calls: files.reduce((sum, file) => sum + file.calls.length, 0),
      routes: files.reduce((sum, file) => sum + file.routes.length, 0),
    },
    files,
  };
}
