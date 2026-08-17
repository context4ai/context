import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { SCAN_EXCLUDED_DIRS, type PathFilterConfig } from "@c4a/core";
import { createPathMatcher } from "@c4a/core";

export { SCAN_EXCLUDED_DIRS } from "@c4a/core";

const execFileAsync = promisify(execFile);

/** Check if a directory name should be skipped during scanning. */
export const isScanExcludedDir = (name: string): boolean =>
  SCAN_EXCLUDED_DIRS.has(name) ||
  (name.startsWith(".") && name !== ".") ||
  name.endsWith(".egg-info");

const DEFAULT_EXCLUDED_FILE_PATTERNS = [
  /\.test\.ts$/i,
  /\.spec\.ts$/i,
  /\.d\.ts$/i,
];

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx"]);

export type ModuleScanResult = {
  name: string;
  path: string;
  files: string[];
  fileCount: number;
  totalLines: number;
};

export type ModuleBoundaryResult = {
  name: string;
  path: string;
  manifest: string;
  version?: string;
};

const toPosixPath = (value: string) => value.split(sep).join("/");

const shouldExcludeFile = (fileName: string) =>
  DEFAULT_EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(fileName));

const isSupportedSourceFile = (fileName: string) =>
  SUPPORTED_EXTENSIONS.has(extname(fileName));

const gitScopeArgs = (prefix: string): string[] => {
  const scope = prefix.replace(/\/+$/u, "");
  return scope.length > 0 ? ["--", scope] : [];
};

const stripGitPrefix = (filePath: string, prefix: string): string | null => {
  if (!prefix) return filePath;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
};

/**
 * List source files via git, without walking the filesystem.
 *
 * Two modes:
 * - **ref provided** (pinned Git source): `git ls-tree -r --name-only <ref>`.
 *   Pure git-object read, instant regardless of worktree size.
 * - **no ref** (local worktree): `git ls-tree HEAD` + `git diff --name-status HEAD`
 *   + `git status --porcelain` (untracked `??` entries).
 *   Merges committed + staged + unstaged + untracked files.
 *   None of these commands walk ignored directories.
 *
 * Returns relative paths (relative to rootDir), or null if not inside a git repo.
 */
const tryGitListFiles = async (
  rootDir: string,
  ref?: string,
): Promise<Set<string> | null> => {
  try {
    const { stdout: gitRootRaw } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: rootDir,
    });
    const gitRoot = gitRootRaw.trim();
    const resolvedRoot = resolve(rootDir);
    const resolvedGitRoot = resolve(gitRoot);
    const prefix = resolvedRoot === resolvedGitRoot
      ? ""
      : toPosixPath(relative(resolvedGitRoot, resolvedRoot)) + "/";

    const treeRef = ref ?? "HEAD";
    // Validate ref to prevent shell injection — only allow hex commit hashes and HEAD
    if (treeRef !== "HEAD" && !/^[0-9a-fA-F]{4,40}$/.test(treeRef)) {
      return null;
    }
    const scopeArgs = gitScopeArgs(prefix);
    const { stdout: treeOutput } = await execFileAsync(
      "git",
      ["ls-tree", "-r", "--name-only", treeRef, ...scopeArgs],
      { cwd: gitRoot, maxBuffer: 64 * 1024 * 1024 },
    );

    const fileSet = new Set<string>();
    for (const line of treeOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const relPath = stripGitPrefix(trimmed, prefix);
      if (relPath) fileSet.add(relPath);
    }

    // When no explicit ref, merge worktree changes (staged + unstaged + untracked)
    if (!ref) {
      // Staged & unstaged modifications / adds / deletes
      const { stdout: diffOutput } = await execFileAsync(
        "git",
        ["diff", "--name-status", "HEAD", ...scopeArgs],
        { cwd: gitRoot, maxBuffer: 16 * 1024 * 1024 },
      );
      for (const line of diffOutput.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split("\t");
        const status = parts[0]?.[0];
        const filePath = status === "R" || status === "C"
          ? parts[2]
          : parts[1] ?? trimmed.slice(1).trim();
        if (!filePath) continue;

        const relPath = stripGitPrefix(filePath, prefix);
        if (!relPath) continue;

        if (status === "D") {
          fileSet.delete(relPath);
        } else {
          fileSet.add(relPath);
        }
      }

      // Untracked files (never walks gitignored dirs)
      const { stdout: statusOutput } = await execFileAsync(
        "git",
        ["status", "--porcelain", "-uall", ...scopeArgs],
        { cwd: gitRoot, maxBuffer: 16 * 1024 * 1024 },
      );
      for (const line of statusOutput.split("\n")) {
        if (!line.startsWith("?? ")) continue;
        const filePath = line.slice(3).trim();
        if (!filePath || filePath.endsWith("/")) continue;

        const relPath = stripGitPrefix(filePath, prefix);
        if (relPath) fileSet.add(relPath);
      }
    }

    return fileSet;
  } catch {
    return null;
  }
};

function filterGitSourceFiles(
  baseDir: string,
  gitFiles: ReadonlySet<string>,
  excludeDirs?: Set<string>,
  pathFilter?: PathFilterConfig,
): string[] {
  const results: string[] = [];
  const codePathMatcher = pathFilter
    ? createPathMatcher(pathFilter.code)
    : null;

  const matchesCode = (relPath: string, fileName: string): boolean => {
    if (codePathMatcher) return codePathMatcher(relPath);
    return isSupportedSourceFile(fileName) && !shouldExcludeFile(fileName);
  };

  for (const relPath of gitFiles) {
    const fileName = relPath.split("/").pop() ?? "";
    if (!matchesCode(relPath, fileName)) continue;

    const segments = relPath.split("/");
    let excluded = false;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (isScanExcludedDir(seg)) {
        excluded = true;
        break;
      }
      if (excludeDirs) {
        const dirPath = resolve(baseDir, segments.slice(0, i + 1).join("/"));
        if (excludeDirs.has(dirPath)) {
          excluded = true;
          break;
        }
      }
    }
    if (!excluded) results.push(toPosixPath(relPath));
  }
  return results.sort();
}

export const scanSourceFiles = async (
  rootDir: string,
  excludeDirs?: Set<string>,
  ref?: string,
  pathFilter?: PathFilterConfig,
): Promise<string[]> => {
  const results: string[] = [];
  const baseDir = resolve(rootDir);

  // When pathFilter is provided, use its code rules instead of hardcoded defaults
  const codePathMatcher = pathFilter
    ? createPathMatcher(pathFilter.code)
    : null;

  const matchesCode = (relPath: string, fileName: string): boolean => {
    if (codePathMatcher) return codePathMatcher(relPath);
    // Fallback to hardcoded defaults
    return isSupportedSourceFile(fileName) && !shouldExcludeFile(fileName);
  };

  // Try git-based scan first (no filesystem walk)
  const gitFiles = await tryGitListFiles(baseDir, ref);
  if (gitFiles && gitFiles.size > 0) {
    return filterGitSourceFiles(baseDir, gitFiles, excludeDirs, pathFilter);
  }

  // Fallback: readdir-based scan (non-git directories)
  const visit = async (currentDir: string) => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (isScanExcludedDir(entry.name)) continue;
        if (excludeDirs?.has(resolve(fullPath))) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = toPosixPath(relative(baseDir, fullPath));
      if (!matchesCode(relativePath, entry.name)) continue;
      results.push(relativePath);
    }
  };

  await visit(baseDir);
  return results.sort();
};

const countFileLines = async (filePath: string): Promise<number> => {
  const contents = await readFile(filePath, "utf-8");
  if (contents === "") return 0;
  const lines = contents.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length;
};

/** Manifest file names that mark a directory as a module boundary. */
const MANIFEST_FILES = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
];

/** Check if a directory contains any recognized manifest file. */
const findManifestFile = async (dirPath: string): Promise<string | null> => {
  for (const file of MANIFEST_FILES) {
    try {
      await access(join(dirPath, file));
      return file;
    } catch {
      // continue
    }
  }
  return null;
};

/** Read module name from a manifest file. Returns null if not parseable. */
const readModuleName = async (dirPath: string, manifestFile: string): Promise<string | null> => {
  try {
    const content = await readFile(join(dirPath, manifestFile), "utf-8");
    if (manifestFile === "package.json") {
      const parsed = JSON.parse(content) as { name?: string };
      return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
    }
    if (manifestFile === "pyproject.toml" || manifestFile === "Cargo.toml") {
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      return match?.[1] ?? null;
    }
    if (manifestFile === "setup.py") {
      const match = content.match(/name\s*=\s*["']([^"']+)["']/);
      return match?.[1] ?? null;
    }
    if (manifestFile === "go.mod") {
      const match = content.match(/^\s*module\s+([^\s]+)\s*$/m);
      return match?.[1] ?? null;
    }
    if (manifestFile === "pom.xml") {
      const projectContent = content.match(/<project\b[\s\S]*<\/project>/i)?.[0] ?? content;
      const withoutParent = projectContent.replace(/<parent\b[\s\S]*?<\/parent>/i, "");
      const group = withoutParent.match(/<groupId>\s*([^<]+?)\s*<\/groupId>/i)?.[1];
      const artifact = withoutParent.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/i)?.[1];
      if (group && artifact) return `${group}:${artifact}`;
      return artifact ?? null;
    }
  } catch {
    return null;
  }
  return null;
};

/** Read module version from a manifest file. Returns null if not present. */
const readModuleVersion = async (dirPath: string, manifestFile: string): Promise<string | null> => {
  try {
    const content = await readFile(join(dirPath, manifestFile), "utf-8");
    if (manifestFile === "package.json") {
      const parsed = JSON.parse(content) as { version?: unknown };
      return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
    }
    if (manifestFile === "pyproject.toml" || manifestFile === "Cargo.toml") {
      const match = content.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
      return match?.[1] ?? null;
    }
    if (manifestFile === "setup.py") {
      const match = content.match(/version\s*=\s*["']([^"']+)["']/);
      return match?.[1] ?? null;
    }
    if (manifestFile === "pom.xml") {
      return content.match(/<version>\s*([^<]+?)\s*<\/version>/i)?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
};

const MANIFEST_NAMES = new Set(MANIFEST_FILES.map((f) => f.toLowerCase()));

/**
 * Find all directories under rootDir that contain a manifest file.
 *
 * When a git file list is available, extracts manifest paths from it (no fs walk).
 * Falls back to readdir walk with blacklist for non-git directories.
 *
 * Does not descend into directories that are themselves module roots
 * (their children belong to that sub-module).
 */
const findSubModuleDirs = async (
  rootDir: string,
  excludeDirs?: Set<string>,
  gitFiles?: Set<string> | null,
  pathFilter?: PathFilterConfig,
): Promise<string[]> => {
  const root = resolve(rootDir);

  // Build a matcher from pathFilter code.exclude to skip excluded module dirs.
  // e.g. exclude ["**/my-sandbox/**"] → any manifest inside my-sandbox is skipped.
  const isExcludedPath = pathFilter?.code?.exclude?.length
    ? createPathMatcher({ include: ["**/*"], exclude: pathFilter.code.exclude })
    : null;

  // Git-based: extract dirs containing manifest files from the file list
  if (gitFiles && gitFiles.size > 0) {
    const manifestDirs = new Set<string>();
    for (const relPath of gitFiles) {
      const parts = relPath.split("/");
      const fileName = parts[parts.length - 1]!;
      if (!MANIFEST_NAMES.has(fileName.toLowerCase())) continue;
      // Directory containing this manifest (relative to rootDir)
      const dirRel = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      if (dirRel === ".") continue; // root manifest handled separately
      // Skip if any file in this dir would be excluded by pathFilter
      if (isExcludedPath && !isExcludedPath(dirRel + "/package.json")) continue;
      manifestDirs.add(dirRel);
    }

    // Filter out nested: if "a/b" and "a/b/c" both exist, keep only "a/b"
    // (anything inside "a/b" belongs to that sub-module)
    const sorted = [...manifestDirs].sort();
    const results: string[] = [];
    for (const dir of sorted) {
      const fullPath = resolve(root, dir);
      if (excludeDirs?.has(fullPath)) continue;
      // Check no already-added parent is a prefix of this dir
      const isNested = results.some((parent) => {
        const parentRel = relative(root, parent);
        return dir.startsWith(parentRel + "/");
      });
      if (isNested) continue;
      results.push(fullPath);
    }
    return results;
  }

  // Fallback: readdir walk with blacklist
  const results: string[] = [];
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isScanExcludedDir(entry.name)) continue;
      const fullPath = resolve(dir, entry.name);
      if (excludeDirs?.has(fullPath)) continue;
      // Skip dirs matching pathFilter code.exclude
      if (isExcludedPath) {
        const relDir = toPosixPath(relative(root, fullPath));
        if (!isExcludedPath(relDir + "/package.json")) continue;
      }
      if (await findManifestFile(fullPath)) {
        results.push(fullPath);
        continue;
      }
      await walk(fullPath);
    }
  };
  await walk(root);
  return results;
};

/**
 * Build a single ModuleScanResult for a module directory.
 * childModuleDirs are excluded from the file scan.
 */
const buildModule = async (
  repoRoot: string,
  moduleDir: string,
  moduleName: string,
  childModuleDirs: Set<string>,
  ref?: string,
  pathFilter?: PathFilterConfig,
  gitFiles?: Set<string> | null,
): Promise<ModuleScanResult> => {
  const excludes = childModuleDirs.size > 0 ? childModuleDirs : undefined;
  const moduleFiles = gitFiles !== undefined && gitFiles !== null && gitFiles.size > 0
    ? filterGitSourceFiles(resolve(moduleDir), gitFiles, excludes, pathFilter)
    : await scanSourceFiles(moduleDir, excludes, ref, pathFilter);
  const modulePath = toPosixPath(relative(repoRoot, moduleDir)) || ".";
  const totalLines = await Promise.all(
    moduleFiles.map((file) => countFileLines(join(moduleDir, file)))
  );
  const files = modulePath === "."
    ? moduleFiles
    : moduleFiles.map((file) => toPosixPath(join(modulePath, file)));
  return {
    name: moduleName,
    path: modulePath,
    files,
    fileCount: files.length,
    totalLines: totalLines.reduce((sum, value) => sum + value, 0),
  };
};

function scopedGitFiles(gitFiles: Set<string> | null, scopeRel: string): Set<string> | null {
  if (gitFiles === null) return null;
  const normalizedScope = toPosixPath(scopeRel).replace(/\/+$/u, "");
  if (!normalizedScope || normalizedScope === ".") return gitFiles;
  const prefix = `${normalizedScope}/`;
  const scoped = new Set<string>();
  for (const file of gitFiles) {
    if (file.startsWith(prefix)) scoped.add(file.slice(prefix.length));
  }
  return scoped;
}

export const detectModules = async (repoPath: string, ref?: string, pathFilter?: PathFilterConfig): Promise<ModuleScanResult[]> => {
  const repoRoot = resolve(repoPath);
  const modules: ModuleScanResult[] = [];

  // Get git file list once, reuse for both module discovery and file scanning
  const gitFiles = await tryGitListFiles(repoRoot, ref);

  // Find all sub-directories with manifests (these are child modules)
  const subModuleDirs = await findSubModuleDirs(repoRoot, undefined, gitFiles, pathFilter);
  const subModuleDirSet = new Set(subModuleDirs.map((d) => resolve(d)));

  // Root module: always include if root has a manifest.
  // In monorepos, root-level files (scripts, docs, configs) that don't belong to
  // any child module are captured here. Child module dirs are excluded by buildModule.
  const rootManifest = await findManifestFile(repoRoot);
  if (rootManifest) {
    const rootName = await readModuleName(repoRoot, rootManifest) ?? basename(repoRoot);
    modules.push(await buildModule(repoRoot, repoRoot, rootName, subModuleDirSet, ref, pathFilter, gitFiles));
  }

  // Child modules
  for (const subDir of subModuleDirs) {
    const manifest = await findManifestFile(subDir);
    if (!manifest) continue; // should not happen, but guard
    const name = await readModuleName(subDir, manifest) ?? basename(subDir);
    // For nested sub-modules, filter gitFiles to this subDir's scope
    const subDirRel = toPosixPath(relative(repoRoot, subDir));
    const subGitFiles = scopedGitFiles(gitFiles, subDirRel);
    const nested = await findSubModuleDirs(subDir, subModuleDirSet, subGitFiles, pathFilter);
    const nestedSet = new Set(nested.map((d) => resolve(d)));
    modules.push(await buildModule(repoRoot, subDir, name, nestedSet, ref, pathFilter, subGitFiles));
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Detect module/package boundaries without scanning source files or counting
 * lines. This is intended for planning and human scope confirmation. It reuses
 * the same git-backed manifest discovery path as detectModules(), so large
 * monorepos avoid ad hoc filesystem walks when git metadata is available.
 */
export const detectModuleBoundaries = async (
  repoPath: string,
  ref?: string,
  pathFilter?: PathFilterConfig,
): Promise<ModuleBoundaryResult[]> => {
  const repoRoot = resolve(repoPath);
  const gitFiles = await tryGitListFiles(repoRoot, ref);
  const subModuleDirs = await findSubModuleDirs(repoRoot, undefined, gitFiles, pathFilter);
  const boundaries: ModuleBoundaryResult[] = [];

  const rootManifest = await findManifestFile(repoRoot);
  if (rootManifest) {
    const version = await readModuleVersion(repoRoot, rootManifest);
    boundaries.push({
      name: await readModuleName(repoRoot, rootManifest) ?? basename(repoRoot),
      path: ".",
      manifest: rootManifest,
      ...(version !== null ? { version } : {}),
    });
  }

  for (const subDir of subModuleDirs) {
    const manifest = await findManifestFile(subDir);
    if (!manifest) continue;
    const version = await readModuleVersion(subDir, manifest);
    boundaries.push({
      name: await readModuleName(subDir, manifest) ?? basename(subDir),
      path: toPosixPath(relative(repoRoot, subDir)) || ".",
      manifest,
      ...(version !== null ? { version } : {}),
    });
  }

  return boundaries.sort((left, right) => left.path.localeCompare(right.path));
};

/**
 * Build a ModuleScanResult for a single module directory without scanning
 * the entire repository. Much faster than detectModules() when the caller
 * already knows which directories to index.
 *
 * @param repoPath - Repository root (used for relative path calculation)
 * @param modulePath - Relative posix path of the module (e.g. "packages/api"), or "." for root
 */
export const detectModuleAt = async (
  repoPath: string,
  modulePath: string,
  ref?: string,
  pathFilter?: PathFilterConfig,
): Promise<ModuleScanResult | null> => {
  const repoRoot = resolve(repoPath);
  const moduleDir = modulePath === "." ? repoRoot : resolve(repoRoot, modulePath);
  // Check if this module path is excluded by pathFilter
  if (modulePath !== "." && pathFilter?.code?.exclude?.length) {
    const matcher = createPathMatcher({ include: ["**/*"], exclude: pathFilter.code.exclude });
    // Test a representative file path inside this module
    if (!matcher(modulePath + "/index.ts")) return null;
  }
  const manifest = await findManifestFile(moduleDir);
  if (!manifest) return null;
  const name = await readModuleName(moduleDir, manifest) ?? basename(moduleDir);
  const gitFiles = await tryGitListFiles(moduleDir, ref);
  const nested = await findSubModuleDirs(moduleDir, undefined, gitFiles, pathFilter);
  const nestedSet = new Set(nested.map((d) => resolve(d)));
  return buildModule(repoRoot, moduleDir, name, nestedSet, ref, pathFilter, gitFiles);
};
