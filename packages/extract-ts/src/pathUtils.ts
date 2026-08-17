import { posix } from "node:path";
import type { FileSystem } from "@c4a/extract";
import { resolveTsConfigCandidates, type TsConfigPathResolver } from "./tsconfigPaths.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const BUILD_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
const DECLARATION_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];
const KNOWN_CODE_SUFFIXES = [
  ...DECLARATION_EXTENSIONS,
  ".esm.js",
  ".cjs.js",
  ".umd.js",
  ".amd.js",
  ".iife.js",
  ".system.js",
  ".min.js",
  ...SOURCE_EXTENSIONS,
  ...BUILD_EXTENSIONS,
];

/**
 * Known build output root directories. Order doesn't matter — all are checked.
 * These are the top-level directory names that indicate "this is compiled output,
 * look for the source under src/ instead".
 */
const BUILD_OUTPUT_ROOTS = new Set(["dist", "lib", "build", "output", "out"]);

/**
 * Known build-format subdirectories that appear between the output root and
 * the actual file structure. e.g. dist/es/index.js → "es" is a format dir,
 * the real structure starts at "index.js".
 *
 * When we see `dist/<format>/path`, we try `src/path`.
 * When we see `dist/path` (no format dir), we also try `src/path`.
 */
const BUILD_FORMAT_DIRS = new Set([
  "es", "esm", "cjs", "umd", "amd", "iife", "system",
  "commonjs", "module", "mjs",
  "web", "node", "browser",
  "lib", "types",
]);

const unique = <T>(items: T[]) => [...new Set(items)];

const normalizeRelativePath = (value: string) => {
  const normalized = posix.normalize(value.replace(/\\/g, "/"));
  return normalized.replace(/^\.\//, "");
};

const stripResourceQuery = (value: string) => value.split(/[?#]/u)[0] ?? value;

const hasUnsupportedExplicitExtension = (value: string) => {
  const basename = posix.basename(value);
  if (!basename.includes(".")) return false;
  return !KNOWN_CODE_SUFFIXES.some((extension) => value.endsWith(extension));
};

const removeKnownExtension = (value: string) => {
  for (const extension of KNOWN_CODE_SUFFIXES) {
    if (value.endsWith(extension)) {
      return value.slice(0, -extension.length);
    }
  }
  return value;
};

/**
 * Map a build output path to candidate source paths.
 *
 * Strategy:
 * 1. Parse segments: `dist/es/components/Button` → root="dist", segments=["es","components","Button"]
 * 2. If root is a known build output dir:
 *    a. If first segment is a known format dir → strip it: `src/components/Button`
 *    b. Otherwise → replace root only: `src/es/components/Button`  (might be real dir)
 *    c. Always try root replacement: `src/components/Button` or `src/es/components/Button`
 * 3. Fallback: `src/index` (bare entry point)
 */
const buildToSourcePaths = (withoutExtension: string): string[] => {
  const parts = withoutExtension.split("/");
  if (parts.length < 2) return [];

  const root = parts[0]!;
  if (!BUILD_OUTPUT_ROOTS.has(root)) return [];

  const results: string[] = [];
  const rest = parts.slice(1);

  // If second segment is a build format dir, strip it
  if (rest.length >= 2 && BUILD_FORMAT_DIRS.has(rest[0]!)) {
    const stripped = rest.slice(1).join("/");
    results.push(`src/${stripped}`);
  }

  // Always try replacing just the root with src/
  const fullRest = rest.join("/");
  results.push(`src/${fullRest}`);

  return unique(results);
};

const createCandidatePaths = (
  value: string,
  options: { allowIndexFallback?: boolean } = {},
) => {
  const normalized = normalizeRelativePath(stripResourceQuery(value));
  if (hasUnsupportedExplicitExtension(normalized)) return [];

  const withoutExtension = removeKnownExtension(normalized);
  const mappedSourcePaths = buildToSourcePaths(withoutExtension);
  const directFirst = SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension));

  const bases = directFirst
    ? unique([normalized, withoutExtension, ...mappedSourcePaths])
    : unique([...mappedSourcePaths, normalized, withoutExtension]);

  const candidates = new Set<string>();
  for (const base of bases) {
    // Only add bare path if it already has a source extension (i.e. it's a
    // file, not a directory). Bare extensionless paths like "components" would
    // match directories and cause EISDIR when read later.
    if (SOURCE_EXTENSIONS.some((ext) => base.endsWith(ext))) {
      candidates.add(base);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.add(`${base}${extension}`);
      candidates.add(posix.join(base, `index${extension}`));
    }
    if (BUILD_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
      for (const extension of SOURCE_EXTENSIONS) {
        candidates.add(removeKnownExtension(normalized) + extension);
      }
    }
  }

  // Fallback: always try src/index as last resort
  if (options.allowIndexFallback ?? true) {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.add(`src/index${extension}`);
    }
  }

  return [...candidates].map(normalizeRelativePath);
};

export const isRelativeModuleSpecifier = (value: string) =>
  value.startsWith("./") || value.startsWith("../");

export const resolveEntrySourcePath = async (
  packageDir: string,
  targetPath: string,
  fs: FileSystem,
  options: { allowIndexFallback?: boolean } = {},
) => {
  for (const candidate of createCandidatePaths(targetPath, options)) {
    const fullPath = packageDir ? posix.join(packageDir, candidate) : candidate;
    if (await fs.exists(fullPath)) {
      return fullPath;
    }
  }
  return null;
};

export const resolveImportSourcePath = async (
  fromFile: string,
  specifier: string,
  fs: FileSystem,
  resolver?: TsConfigPathResolver,
) => {
  if (!isRelativeModuleSpecifier(specifier)) {
    if (resolver === undefined) return null;
    for (const target of resolveTsConfigCandidates(specifier, resolver)) {
      for (const candidate of createCandidatePaths(target, { allowIndexFallback: false })) {
        if (await fs.exists(candidate)) return normalizeRelativePath(candidate);
      }
    }
    return null;
  }

  const baseDir = posix.dirname(fromFile);
  for (const candidate of createCandidatePaths(specifier)) {
    const fullPath = baseDir === "." ? candidate : posix.join(baseDir, candidate);
    if (await fs.exists(fullPath)) {
      return normalizeRelativePath(fullPath);
    }
  }
  return null;
};
