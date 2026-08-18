import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";
import { parse as parseYaml } from "yaml";

interface RushProjectConfig {
  packageName: string;
  projectFolder: string;
  subspaceName?: string;
  decoupledLocalDependencies?: string[];
  tags?: string[];
  shouldPublish?: boolean;
}

interface RushConfig {
  rushVersion: string;
  pnpmVersion?: string;
  nodeSupportedVersionRange?: string;
  projects: RushProjectConfig[];
}

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface RushWorkspaceDependency {
  packageName: string;
  kinds: string[];
  specifiers: string[];
  decoupled: boolean;
}

export interface RushOwnerBoundary {
  file: string;
  reviewers: string[];
}

export interface RushProjectIndex {
  packageName: string;
  packageNameMatches: boolean;
  projectFolder: string;
  subspaceName: string;
  tags: string[];
  shouldPublish: boolean;
  entrySignals: string[];
  workspaceDependencies: RushWorkspaceDependency[];
  owner: RushOwnerBoundary | null;
  packageJsonFile: string | null;
}

export interface RushWorkspaceIndex {
  rushFile: string;
  rushVersion: string;
  pnpmVersion: string | null;
  nodeSupportedVersionRange: string | null;
  selectedTags: string[];
  projects: RushProjectIndex[];
  ownerBoundaries: RushOwnerBoundary[];
}

export interface RushIndexOptions {
  tags?: readonly string[];
  includeAll?: boolean;
}

function parseJsonc<T>(file: string, text: string): T {
  const result = parseConfigFileTextToJson(file, text);
  if (result.error) throw new Error(`${file}: ${flattenDiagnosticMessageText(result.error.messageText, "\n")}`);
  return result.config as T;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function exportKeys(value: unknown): string[] {
  if (typeof value === "string" || Array.isArray(value)) return ["."];
  if (!value || typeof value !== "object") return [];
  const keys = Object.keys(value);
  const subpaths = keys.filter((key) => key === "." || key.startsWith("./"));
  return subpaths.length > 0 ? subpaths.sort() : ["."];
}

function entrySignals(packageJson: PackageJson): string[] {
  const signals: string[] = [];
  if (packageJson.main) signals.push(`main=${packageJson.main}`);
  if (packageJson.module) signals.push(`module=${packageJson.module}`);
  if (packageJson.types ?? packageJson.typings) signals.push(`types=${packageJson.types ?? packageJson.typings}`);
  const exports = exportKeys(packageJson.exports);
  if (exports.length > 0) signals.push(`exports=${exports.join(",")}`);
  if (typeof packageJson.bin === "string") signals.push(`bin=${packageJson.bin}`);
  if (packageJson.bin && typeof packageJson.bin === "object") {
    signals.push(`bin=${Object.entries(packageJson.bin).sort(([left], [right]) => left.localeCompare(right)).map(([name, file]) => `${name}:${file}`).join(",")}`);
  }
  return signals;
}

function workspaceDependencies(packageJson: PackageJson, packageNames: ReadonlySet<string>, decoupledNames: ReadonlySet<string>): RushWorkspaceDependency[] {
  const sections: Array<[string, Record<string, string> | undefined]> = [
    ["dependency", packageJson.dependencies],
    ["dev", packageJson.devDependencies],
    ["peer", packageJson.peerDependencies],
    ["optional", packageJson.optionalDependencies],
  ];
  const found = new Map<string, RushWorkspaceDependency>();
  for (const [kind, dependencies] of sections) {
    for (const [packageName, specifier] of Object.entries(dependencies ?? {})) {
      if (!packageNames.has(packageName)) continue;
      const current = found.get(packageName) ?? { packageName, kinds: [], specifiers: [], decoupled: decoupledNames.has(packageName) };
      current.kinds.push(kind);
      current.specifiers.push(specifier);
      found.set(packageName, current);
    }
  }
  return [...found.values()].sort((left, right) => left.packageName.localeCompare(right.packageName));
}

async function findOwnerBoundary(root: string, projectFolder: string): Promise<RushOwnerBoundary | null> {
  let current = path.resolve(root, projectFolder);
  const absoluteRoot = path.resolve(root);
  while (current === absoluteRoot || current.startsWith(`${absoluteRoot}${path.sep}`)) {
    const ownersFile = path.join(current, "OWNERS");
    if (await exists(ownersFile)) {
      const parsed = parseYaml(await readFile(ownersFile, "utf8")) as { reviewers?: unknown } | null;
      const reviewers = Array.isArray(parsed?.reviewers)
        ? parsed.reviewers.filter((value): value is string => typeof value === "string")
        : [];
      return { file: path.relative(absoluteRoot, ownersFile).split(path.sep).join("/"), reviewers: [...new Set(reviewers)].sort() };
    }
    if (current === absoluteRoot) break;
    current = path.dirname(current);
  }
  return null;
}

export async function indexRushWorkspace(repositoryRoot: string, options: RushIndexOptions = {}): Promise<RushWorkspaceIndex> {
  const root = path.resolve(repositoryRoot);
  const rushFile = "rush.json";
  const rush = parseJsonc<RushConfig>(rushFile, await readFile(path.join(root, rushFile), "utf8"));
  const selectedTags = [...new Set(options.tags ?? [])].sort();
  const selected = options.includeAll === true || selectedTags.length === 0
    ? rush.projects
    : rush.projects.filter((project) => selectedTags.some((tag) => project.tags?.includes(tag)));
  const packageNames = new Set(rush.projects.map((project) => project.packageName));
  const projects: RushProjectIndex[] = [];
  for (const project of selected) {
    const packageJsonFile = path.posix.join(project.projectFolder, "package.json");
    const absolutePackageJson = path.join(root, packageJsonFile);
    const hasPackageJson = await exists(absolutePackageJson);
    const packageJson = hasPackageJson ? parseJsonc<PackageJson>(packageJsonFile, await readFile(absolutePackageJson, "utf8")) : {};
    projects.push({
      packageName: project.packageName,
      packageNameMatches: packageJson.name === project.packageName,
      projectFolder: project.projectFolder,
      subspaceName: project.subspaceName ?? "default",
      tags: [...new Set(project.tags ?? [])].sort(),
      shouldPublish: project.shouldPublish === true,
      entrySignals: entrySignals(packageJson),
      workspaceDependencies: workspaceDependencies(packageJson, packageNames, new Set(project.decoupledLocalDependencies ?? [])),
      owner: await findOwnerBoundary(root, project.projectFolder),
      packageJsonFile: hasPackageJson ? packageJsonFile : null,
    });
  }
  const ownerBoundaries = [...new Map(projects.flatMap((project) => project.owner ? [[project.owner.file, project.owner] as const] : [])).values()]
    .sort((left, right) => left.file.localeCompare(right.file));
  return {
    rushFile,
    rushVersion: rush.rushVersion,
    pnpmVersion: rush.pnpmVersion ?? null,
    nodeSupportedVersionRange: rush.nodeSupportedVersionRange ?? null,
    selectedTags,
    projects: projects.sort((left, right) => left.projectFolder.localeCompare(right.projectFolder)),
    ownerBoundaries,
  };
}
