import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PathFilterConfig } from "@c4a/core";
import type {
  EntryFile,
  EntryDetectionResult,
  ExtractionPlugin,
  FileSystem,
  ManifestInfo,
  SourceInfo,
} from "./protocol.js";
import { ExtractionPluginRegistry } from "./registry.js";
import type { ExtractionResult, SymbolInfo } from "./types.js";
import { detectModuleAt, detectModules, type ModuleScanResult } from "./scanner.js";
import { ExtractionInputError, NO_ENTRY_DETECTED } from "./errors.js";

export const PACKAGE_JSON = "package.json";
export const GO_MOD = "go.mod";

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

export interface RepositoryExtractionProgressEvent {
  phase: "scanning" | "parsing" | "uploading";
  progress: number;
  module_name?: string;
  module_path?: string;
  message?: string;
}

export interface RepositoryExtractionInput {
  repoPath: string;
  modules?: string[];
  ref?: string;
  commitHash?: string | null;
  moduleCommits?: Record<string, string | null | undefined>;
  pathFilter?: PathFilterConfig;
  entrySelection?: RepositoryEntrySelection;
  plugins: ExtractionPlugin[];
  onProgress?: (event: RepositoryExtractionProgressEvent) => void;
}

export type RepositoryEntrySelection =
  | { mode: "auto" }
  | { mode: "configured"; entries: readonly string[] }
  | { mode: "scan" };

export interface RepositoryExtractionModuleResult {
  module: ModuleScanResult;
  sourceInfo: SourceInfo;
  entryDetection: EntryDetectionResult;
  moduleDoc?: string;
  extraction: ExtractionResult;
}

export interface RepositoryExtractionModuleError {
  module_name: string;
  module_path: string;
  error: string;
}

export interface RepositoryExtractionResult {
  repoPath: string;
  results: RepositoryExtractionModuleResult[];
  moduleErrors: RepositoryExtractionModuleError[];
}

function safeSourceRelativePath(value: string): string {
  const slashPath = value.trim().replace(/\\/gu, "/");
  const normalized = path.posix.normalize(slashPath).replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    throw new Error(`Extraction entry must be a source-relative file path: ${value}`);
  }
  return normalized;
}

function moduleRelativeEntryPath(modulePath: string, sourcePath: string): string {
  if (modulePath === ".") return sourcePath;
  const prefix = `${normalizeRelativePath(modulePath)}/`;
  if (!sourcePath.startsWith(prefix)) {
    throw new Error(`Extraction entry is outside the selected module ${modulePath}: ${sourcePath}`);
  }
  return sourcePath.slice(prefix.length);
}

function entrySubpath(filePath: string, index: number): string {
  if (index === 0) return ".";
  const withoutExtension = filePath.replace(/\.(?:d\.)?(?:ts|tsx|mts|cts|go)$/u, "");
  return `./${withoutExtension}`;
}

function selectedEntryFiles(input: {
  module: ModuleScanResult;
  detected: EntryDetectionResult;
  selection?: RepositoryEntrySelection;
}): EntryFile[] {
  const selection = input.selection ?? { mode: "auto" };
  const includedSourceFiles = new Set(input.module.files.map(safeSourceRelativePath));

  if (selection.mode === "auto") {
    if (input.detected.entries.length === 0) {
      throw new ExtractionInputError(
        NO_ENTRY_DETECTED,
        `No ${input.detected.package.language} entry files were detected from the module manifest. Configure entries in the Context project, or use scan mode; do not modify the source repository solely for Context.`,
        { mode: "auto", module: input.module.path },
      );
    }
    for (const entry of input.detected.entries) {
      const sourcePath = input.module.path === "."
        ? safeSourceRelativePath(entry.path)
        : safeSourceRelativePath(`${input.module.path}/${entry.path}`);
      if (!includedSourceFiles.has(sourcePath)) {
        throw new Error(
          `Auto-detected entry is outside extractTs include: ${sourcePath}. Update include or configure entries in the Context project.`,
        );
      }
    }
    return input.detected.entries;
  }

  const sourceEntries = selection.mode === "scan"
    ? [...includedSourceFiles].sort()
    : [...new Set(selection.entries.map(safeSourceRelativePath))];
  if (sourceEntries.length === 0) {
      throw new ExtractionInputError(
        NO_ENTRY_DETECTED,
        selection.mode === "scan"
        ? `No ${input.detected.package.language} files match the extraction include for scan mode.`
        : "Extraction entries must contain at least one source-relative file path.",
      { mode: selection.mode, module: input.module.path },
    );
  }

  return sourceEntries.map((sourcePath, index) => {
    if (!includedSourceFiles.has(sourcePath)) {
      throw new Error(
        `Configured extraction entry is missing or outside extractTs include: ${sourcePath}. Update entries or include in the Context project.`,
      );
    }
    const modulePath = moduleRelativeEntryPath(input.module.path, sourcePath);
    return {
      path: modulePath,
      subpath: entrySubpath(modulePath, index),
      type: "library",
    };
  });
}

export const normalizeRelativePath = (value: string): string => {
  const normalized = toPosixPath(value).replace(/^\.\/+/, "").replace(/\/+/g, "/");
  return normalized || ".";
};

export const resolveRepoRelativePath = (modulePath: string, value: string): string => {
  if (!value.trim()) return value;
  const normalizedValue = normalizeRelativePath(value);
  if (modulePath === ".") return normalizedValue;
  return `${normalizeRelativePath(modulePath)}/${normalizedValue}`;
};

export const resolveModuleDir = (repoPath: string, modulePath: string): string =>
  modulePath === "." ? repoPath : path.join(repoPath, modulePath);

export const resolveModuleFsPath = (moduleDir: string, filePath: string): string => {
  const candidate = path.isAbsolute(filePath) ? filePath : path.resolve(moduleDir, filePath);
  const relativePath = path.relative(moduleDir, candidate);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes module root: ${filePath}`);
  }
  return candidate;
};

export const createModuleFileSystem = (moduleDir: string): FileSystem => ({
  async readFile(filePath) {
    return readFile(resolveModuleFsPath(moduleDir, filePath), "utf-8");
  },
  async readdir(dirPath) {
    return readdir(resolveModuleFsPath(moduleDir, dirPath));
  },
  async exists(filePath) {
    try {
      const fileStat = await stat(resolveModuleFsPath(moduleDir, filePath));
      return fileStat.isFile();
    } catch {
      return false;
    }
  },
  async readJson<T = unknown>(filePath: string) {
    const content = await readFile(resolveModuleFsPath(moduleDir, filePath), "utf-8");
    return JSON.parse(content) as T;
  },
});

export const loadSourceInfo = async (
  modulePath: string,
  fs: FileSystem,
): Promise<SourceInfo> => {
  const manifests: ManifestInfo[] = [];
  if (await fs.exists(PACKAGE_JSON)) {
    manifests.push({
      type: "package.json",
      path: PACKAGE_JSON,
      content: await fs.readJson<Record<string, unknown>>(PACKAGE_JSON),
    });
  }
  if (await fs.exists(GO_MOD)) {
    manifests.push({
      type: "go.mod",
      path: GO_MOD,
      content: { raw: await fs.readFile(GO_MOD) },
    });
  }

  const detectedLanguages = [
    ...(manifests.some((manifest) => manifest.type === GO_MOD) ? ["go"] : []),
    ...(manifests.some((manifest) => manifest.type === PACKAGE_JSON) ? ["typescript"] : []),
  ];
  return {
    path: normalizeRelativePath(modulePath),
    manifests,
    ...(detectedLanguages.length === 1 ? { language: detectedLanguages[0] } : {}),
  };
};

function manifestForPlugin(source: SourceInfo, plugin: ExtractionPlugin): ManifestInfo | undefined {
  if (plugin.manifestTypes !== undefined) {
    return source.manifests.find((manifest) => plugin.manifestTypes?.includes(manifest.type));
  }
  return source.manifests.length === 1 ? source.manifests[0] : undefined;
}

export const prefixSymbolPaths = (
  symbol: SymbolInfo,
  modulePath: string,
): SymbolInfo => ({
  ...symbol,
  ...(symbol.file.trim() ? { file: resolveRepoRelativePath(modulePath, symbol.file) } : {}),
  ...(symbol.members ? { members: symbol.members.map((member) => prefixSymbolPaths(member, modulePath)) } : {}),
});

export const prefixEntryDetectionPaths = (
  entryDetection: EntryDetectionResult,
  modulePath: string,
): EntryDetectionResult => ({
  ...entryDetection,
  entries: entryDetection.entries.map((entry) => ({
    ...entry,
    path: resolveRepoRelativePath(modulePath, entry.path),
  })),
  ...(entryDetection.subPackages
    ? { subPackages: entryDetection.subPackages.map((item) => prefixEntryDetectionPaths(item, modulePath)) }
    : {}),
});

export const prefixExtractionPaths = (
  extraction: ExtractionResult,
  modulePath: string,
  commitHash: string | null,
): ExtractionResult => ({
  ...extraction,
  meta: {
    ...extraction.meta,
    commitHash,
  },
  files: extraction.files.map((file) => ({
    ...file,
    path: resolveRepoRelativePath(modulePath, file.path),
  })),
  symbols: extraction.symbols.map((symbol) => prefixSymbolPaths(symbol, modulePath)),
});

export const normalizeExtractionPaths = (
  extraction: ExtractionResult,
  entryDetection: EntryDetectionResult,
  modulePath: string,
  commitHash: string | null,
): { extraction: ExtractionResult; entryDetection: EntryDetectionResult } => ({
  entryDetection: prefixEntryDetectionPaths(entryDetection, modulePath),
  extraction: prefixExtractionPaths(extraction, modulePath, commitHash),
});

const extractLeadingJsDoc = (source: string): string | undefined => {
  const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//u);
  if (!match?.[1]) return undefined;
  const doc = match[1]
    .replace(/^\s*\* ?/gmu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .trim();
  return doc.length > 0 ? doc : undefined;
};

const extractModuleDoc = async (
  entryDetection: EntryDetectionResult,
  fs: FileSystem,
): Promise<string | undefined> => {
  const entries = [...entryDetection.entries].sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of entries) {
    try {
      const doc = extractLeadingJsDoc(await fs.readFile(entry.path));
      if (doc) return doc;
    } catch {
      // Missing entry files are reported by the plugin extraction path.
    }
  }
  return undefined;
};

const noModuleError = (modulePath: string, repoPath: string): RepositoryExtractionModuleError => ({
  module_name: modulePath,
  module_path: modulePath,
  error:
    `No indexable code module detected at "${modulePath}" under ${repoPath}. ` +
    "A supported module must have a recognized manifest such as package.json or go.mod.",
});

const resolveRequestedModules = async (
  repoPath: string,
  modulePaths: string[] | undefined,
  ref: string | undefined,
  pathFilter: PathFilterConfig | undefined,
): Promise<{ modules: ModuleScanResult[]; moduleErrors: RepositoryExtractionModuleError[] }> => {
  if (!modulePaths || modulePaths.length === 0) {
    const modules = await detectModules(repoPath, ref, pathFilter);
    return {
      modules,
      moduleErrors: modules.length === 0 ? [noModuleError(".", repoPath)] : [],
    };
  }

  const modules: ModuleScanResult[] = [];
  const moduleErrors: RepositoryExtractionModuleError[] = [];
  for (const modulePath of modulePaths) {
    const normalizedPath = normalizeRelativePath(modulePath);
    const detected = await detectModuleAt(repoPath, normalizedPath, ref, pathFilter);
    if (!detected) {
      moduleErrors.push(noModuleError(normalizedPath, repoPath));
      continue;
    }
    modules.push(detected);
  }
  return { modules, moduleErrors };
};

export const runRepositoryExtraction = async (
  input: RepositoryExtractionInput,
): Promise<RepositoryExtractionResult> => {
  const repoPath = path.resolve(input.repoPath);
  input.onProgress?.({ phase: "scanning", progress: 0, message: "detecting modules" });

  const { modules, moduleErrors } = await resolveRequestedModules(
    repoPath,
    input.modules,
    input.ref,
    input.pathFilter,
  );

  const registry = new ExtractionPluginRegistry();
  for (const plugin of input.plugins) {
    registry.register(plugin);
  }

  const results: RepositoryExtractionModuleResult[] = [];
  for (const [index, module] of modules.entries()) {
    const moduleDir = resolveModuleDir(repoPath, module.path);
    const fs = createModuleFileSystem(moduleDir);
    const sourceInfo = await loadSourceInfo(module.path, fs);
    const plugin = registry.resolve(sourceInfo);
    if (!plugin) {
      moduleErrors.push({
        module_name: module.name,
        module_path: module.path,
        error: `No extraction plugin available for module "${module.name}"`,
      });
      continue;
    }

    const manifest = manifestForPlugin(sourceInfo, plugin);
    if (!manifest) {
      moduleErrors.push({
        module_name: module.name,
        module_path: module.path,
        error: plugin.manifestTypes === undefined && sourceInfo.manifests.length > 1
          ? `Extraction plugin "${plugin.id}" must declare manifestTypes for mixed-manifest module "${module.name}"`
          : `Module "${module.name}" has no manifest supported by extraction plugin "${plugin.id}"`,
      });
      continue;
    }

    input.onProgress?.({
      phase: "scanning",
      progress: Math.round((index / Math.max(modules.length, 1)) * 100),
      module_name: module.name,
      module_path: module.path,
    });
    const detectedEntries = await plugin.detectEntries(manifest, fs);
    const entryDetection: EntryDetectionResult = {
      ...detectedEntries,
      entries: selectedEntryFiles({
        module,
        detected: detectedEntries,
        ...(input.entrySelection !== undefined ? { selection: input.entrySelection } : {}),
      }),
    };

    input.onProgress?.({ phase: "parsing", progress: 20, module_name: module.name, module_path: module.path });
    const moduleDoc = await extractModuleDoc(entryDetection, fs);
    const rawExtraction = await plugin.extractSymbols(entryDetection.entries, fs);
    const commitHash = input.moduleCommits?.[module.path] ?? input.commitHash ?? rawExtraction.meta.commitHash ?? null;
    const normalized = normalizeExtractionPaths(rawExtraction, entryDetection, module.path, commitHash);

    input.onProgress?.({ phase: "uploading", progress: 100, module_name: module.name, module_path: module.path });
    results.push({
      module,
      sourceInfo,
      entryDetection: normalized.entryDetection,
      ...(moduleDoc ? { moduleDoc } : {}),
      extraction: normalized.extraction,
    });
  }

  return { repoPath, results, moduleErrors };
};
