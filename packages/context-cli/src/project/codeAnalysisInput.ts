import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export function safeCodeSourcePath(root: string, normalizedPath: string): string {
  const absolute = resolve(root, normalizedPath);
  const rel = relative(root, absolute).replaceAll("\\", "/");
  if (rel.startsWith("../") || rel.includes("/../")) {
    throw new TypeError(`parser source path escapes its materialized root: ${normalizedPath}`);
  }
  return absolute;
}

export function normalizedVirtualPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  return normalized.length === 0 ? "." : normalized;
}

function sourceFileSystem(root: string, tracked: readonly string[], texts: Record<string, string>, readSource?: (path: string) => Promise<string>) {
  const files = new Set(tracked.map(normalizedVirtualPath));
  const directories = new Map<string, Set<string>>([[".", new Set()]]);
  for (const file of files) {
    const parts = file.split("/");
    let parent = ".";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!;
      const children = directories.get(parent) ?? new Set<string>();
      children.add(name);
      directories.set(parent, children);
      if (index < parts.length - 1) {
        parent = parent === "." ? name : `${parent}/${name}`;
        if (!directories.has(parent)) directories.set(parent, new Set());
      }
    }
  }
  const assertTrackedFile = (path: string): string => {
    const normalized = normalizedVirtualPath(path);
    if (!files.has(normalized)) {
      throw new TypeError(`parser attempted to read an untracked source file: ${normalized}`);
    }
    return normalized;
  };
  return {
    readFile: async (path: string) => {
      const normalized = assertTrackedFile(path);
      return Object.hasOwn(texts, normalized) ? texts[normalized]!
        : readSource ? readSource(normalized) : readFile(safeCodeSourcePath(root, normalized), "utf8");
    },
    async readdir(path: string) {
      const normalized = normalizedVirtualPath(path);
      const children = directories.get(normalized);
      if (children === undefined) throw new TypeError(`unknown tracked source directory: ${normalized}`);
      return [...children].sort();
    },
    async exists(path: string) {
      const normalized = normalizedVirtualPath(path);
      return files.has(normalized) || directories.has(normalized);
    },
    async readJson<T = unknown>(path: string): Promise<T> {
      return JSON.parse(
        await this.readFile(path),
      ) as T;
    },
  };
}

/** Execute an already selected analysis capability over explicit file paths.
 * This helper has no Provider registry, lifecycle, ownership or receipt state.
 * The caller must supply the authorized tracked boundary and fixed input text. */
export async function prepareCodeAnalysisInput(input: {
  capability: string;
  root: string;
  sourceModule: string;
  scopedPaths: string[];
  trackedPaths: string[];
  loadedModule: Record<string, unknown>;
  texts: Record<string, string>;
  readSource?: (path: string) => Promise<string>;
}): Promise<unknown> {
  const fs = sourceFileSystem(input.root, input.trackedPaths, input.texts, input.readSource);
  if (input.capability === "parser.typescript" || input.capability === "parser.javascript") {
    const Plugin = input.loadedModule.TypeScriptPlugin;
    if (typeof Plugin !== "function") throw new TypeError(`${input.capability} package has no TypeScriptPlugin`);
    const plugin = new (Plugin as new () => {
      detectEntries: (manifest: unknown, fs: unknown) => Promise<{ entries: Array<{ path: string }> }>;
      extractSymbolsInScope: (entries: unknown[], paths: string[], fs: unknown) => Promise<unknown>;
    })();
    const manifestPath = "package.json";
    // Component/source subdirectories need no package manifest. Do not probe
    // parent directories or promote their local exports to package-public APIs.
    const detected = await fs.exists(manifestPath)
      ? await plugin.detectEntries({
        type: "package.json",
        path: manifestPath,
        content: await fs.readJson(manifestPath),
      }, fs)
      : { entries: [] };
    return plugin.extractSymbolsInScope(
      // Public identity belongs to the registered package, not the reading
      // batch. Trace its real entries but only analyze selected declarations.
      detected.entries,
      input.scopedPaths,
      fs,
    );
  }
  if (input.capability === "parser.go") {
    const Plugin = input.loadedModule.GoPlugin;
    if (typeof Plugin !== "function") throw new TypeError("parser.go package has no GoPlugin");
    const plugin = new (Plugin as new () => {
      detectEntries: (manifest: unknown, fs: unknown) => Promise<{ entries: Array<{ path: string }> }>;
      extractSymbols: (entries: unknown[], fs: unknown) => Promise<unknown>;
    })();
    const manifestPath = "go.mod";
    const manifestContent = await fs.exists(manifestPath)
      ? await fs.readFile(manifestPath)
      : `module ${input.sourceModule}\n`;
    const manifest = {
      type: "go.mod",
      path: manifestPath,
      content: { raw: manifestContent },
    };
    const detected = await plugin.detectEntries(manifest, fs);
    const allowed = new Set(input.scopedPaths);
    return plugin.extractSymbols(detected.entries.filter((entry) => allowed.has(entry.path)), fs);
  }
  if (input.capability === "parser.rush") {
    const indexRushWorkspace = input.loadedModule.indexRushWorkspace;
    if (typeof indexRushWorkspace !== "function") {
      throw new TypeError("parser.rush package has no indexRushWorkspace");
    }
    return (indexRushWorkspace as (root: string) => Promise<unknown>)(input.root);
  }
  throw new TypeError(`unsupported prepared parser capability ${input.capability}`);
}
