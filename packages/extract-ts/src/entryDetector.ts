import { PackageKind } from "@c4a/core";
import type { EntryDetectionResult, FileSystem, ManifestInfo } from "@c4a/extract";
import { resolveEntrySourcePath } from "./pathUtils.js";

type JsonRecord = Record<string, unknown>;
type EntryTarget = { subpath: string; targetPaths: string[]; type: "library" | "cli" };

const CONDITION_PRIORITY = [
  "types",
  "typings",
  "import",
  "require",
  "module",
  "browser",
  "node",
  "default",
  "main",
];

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const unique = <T>(items: T[]) => [...new Set(items)];

const resolveConditionalTargets = (value: unknown, mainFallback: string | null): string[] => {
  const direct = readString(value);
  if (direct) return [direct];

  if (Array.isArray(value)) {
    return unique(value.flatMap((item) => resolveConditionalTargets(item, null)));
  }

  const record = asRecord(value);
  const targets: string[] = [];
  for (const key of CONDITION_PRIORITY) {
    if (!(key in record)) continue;
    targets.push(...resolveConditionalTargets(record[key], null));
  }
  if (mainFallback) targets.push(mainFallback);
  return unique(targets);
};

const collectExportTargets = (pkg: JsonRecord): EntryTarget[] => {
  const exportsField = pkg.exports;
  const mainFallback = readString(pkg.main);

  if (!exportsField) {
    return mainFallback ? [{ subpath: ".", targetPaths: [mainFallback], type: "library" }] : [];
  }

  const exportsRecord = asRecord(exportsField);
  const exportKeys = Object.keys(exportsRecord);
  const hasSubpathMap = exportKeys.some((key) => key.startsWith("."));

  const direct = !hasSubpathMap ? resolveConditionalTargets(exportsField, mainFallback) : [];
  if (direct.length > 0) {
    return [{ subpath: ".", targetPaths: direct, type: "library" }];
  }

  const targets: EntryTarget[] = [];
  for (const [subpath, rawValue] of Object.entries(exportsRecord)) {
    const targetPaths = resolveConditionalTargets(rawValue, null);
    if (targetPaths.length === 0) continue;
    targets.push({ subpath, targetPaths, type: "library" });
  }
  return targets;
};

const collectBinTargets = (pkg: JsonRecord): EntryTarget[] => {
  const binField = pkg.bin;
  const direct = readString(binField);
  if (direct) {
    return [{ subpath: "./bin", targetPaths: [direct], type: "cli" }];
  }

  return Object.entries(asRecord(binField)).flatMap(([name, value]) => {
    const targetPath = readString(value);
    return targetPath ? [{ subpath: `./bin/${name}`, targetPaths: [targetPath], type: "cli" as const }] : [];
  });
};

const detectPackageKind = (pkg: JsonRecord): PackageKind => {
  if (pkg.exports || pkg.main) return PackageKind.Lib;
  if (pkg.bin) return PackageKind.Cli;

  const scripts = asRecord(pkg.scripts);
  if (readString(scripts.dev) || readString(scripts.start)) {
    return PackageKind.Service;
  }

  return PackageKind.Lib;
};

const expandWorkspacePattern = async (
  rootDir: string,
  pattern: string,
  fs: FileSystem,
) => {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    const baseDir = prefix ? `${rootDir}/${prefix}` : rootDir;
    const entries = await fs.readdir(baseDir);
    return entries.map((entry) => `${baseDir}/${entry}`.replace(/^\.\//, ""));
  }

  return [`${rootDir}/${pattern}`.replace(/^\.\//, "")];
};

const detectSubPackages = async (
  rootDir: string,
  pkg: JsonRecord,
  fs: FileSystem,
) => {
  const workspaceConfig = asRecord(pkg.workspaces);
  const workspaces = [
    ...asStringArray(pkg.workspaces),
    ...asStringArray(workspaceConfig.packages),
  ];
  if (workspaces.length === 0) return undefined;

  const subPackages: EntryDetectionResult[] = [];
  for (const pattern of workspaces) {
    const candidates = await expandWorkspacePattern(rootDir, pattern, fs);
    for (const candidate of candidates) {
      const manifestPath = `${candidate}/package.json`.replace(/^\.\//, "");
      if (!(await fs.exists(manifestPath))) continue;

      const manifestContent = await fs.readJson<JsonRecord>(manifestPath);
      const childManifest: ManifestInfo = {
        type: "package.json",
        path: manifestPath,
        content: manifestContent,
      };
      subPackages.push(await detectEntries(childManifest, fs));
    }
  }

  return subPackages.length > 0 ? subPackages : undefined;
};

export const detectEntries = async (
  manifest: ManifestInfo,
  fs: FileSystem,
): Promise<EntryDetectionResult> => {
  if (manifest.type !== "package.json") {
    throw new Error(`TypeScriptPlugin only supports package.json manifests, got ${manifest.type}`);
  }

  const pkg = asRecord(manifest.content);
  const packageDir = manifest.path.includes("/")
    ? manifest.path.slice(0, manifest.path.lastIndexOf("/"))
    : "";

  const entryTargets = [...collectExportTargets(pkg), ...collectBinTargets(pkg)];
  const entries = [];
  for (const entryTarget of entryTargets) {
    const allowIndexFallback = entryTarget.subpath === ".";
    for (const targetPath of entryTarget.targetPaths) {
      const resolvedPath = await resolveEntrySourcePath(packageDir, targetPath, fs, { allowIndexFallback });
      if (!resolvedPath) continue;
      entries.push({
        path: resolvedPath,
        subpath: entryTarget.subpath,
        type: entryTarget.type,
      });
      break;
    }
  }

  const subPackages = await detectSubPackages(packageDir || ".", pkg, fs);

  return {
    package: {
      name: readString(pkg.name) ?? "unknown-package",
      kind: detectPackageKind(pkg),
      language: "typescript",
      version: readString(pkg.version) ?? undefined,
    },
    entries,
    ...(subPackages ? { subPackages } : {}),
  };
};
