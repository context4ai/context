import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseRushJsonc } from "./rushJsonc.js";
import {
  loadRushWorkspaceFacts,
  type RushBuildCommandIndex,
  type RushBuildPhaseIndex,
  type RushReleaseUnitIndex,
  type RushSubspaceIndex,
  type RushWorkspaceFactDiagnostic,
  type RushWorkspaceFactProject,
} from "./rushWorkspaceFacts.js";

interface RushProjectConfig {
  packageName: string;
  projectFolder: string;
  subspaceName?: string;
  decoupledLocalDependencies?: string[];
  tags?: string[];
  shouldPublish?: boolean;
  versionPolicyName?: string;
  publishFolder?: string;
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
  scripts?: Record<string, string>;
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
  workspaceDependents: string[];
  owner: RushOwnerBoundary | null;
  packageJsonFile: string | null;
  versionPolicyName: string | null;
  publishFolder: string | null;
  releaseUnitRef: string | null;
}

export interface RushWorkspaceIndex {
  rushFile: string;
  rushVersion: string;
  pnpmVersion: string | null;
  nodeSupportedVersionRange: string | null;
  selectedTags: string[];
  projects: RushProjectIndex[];
  ownerBoundaries: RushOwnerBoundary[];
  subspacesFile: string | null;
  subspacesEnabled: boolean;
  preventSelectingAllSubspaces: boolean;
  subspaces: RushSubspaceIndex[];
  commandLineFile: string | null;
  buildPhases: RushBuildPhaseIndex[];
  buildCommands: RushBuildCommandIndex[];
  versionPoliciesFile: string | null;
  releaseUnits: RushReleaseUnitIndex[];
  diagnostics: RushWorkspaceFactDiagnostic[];
}

export interface RushIndexOptions {
  tags?: readonly string[];
  includeAll?: boolean;
}

export {
  rushWorkspaceIndexToEvidenceAdapterMaterialization,
  rushWorkspaceIndexToEvidenceAdapterResult,
  type RushEvidenceAdapterInvocation,
} from "./evidenceAdapter.js";
export type {
  RushBuildCommandIndex,
  RushBuildPhaseImplementation,
  RushBuildPhaseIndex,
  RushReleaseUnitIndex,
  RushSubspaceIndex,
  RushWorkspaceFactDiagnostic,
} from "./rushWorkspaceFacts.js";

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
  const rush = parseRushJsonc<RushConfig>(
    rushFile,
    await readFile(path.join(root, rushFile), "utf8"),
  );
  const selectedTags = [...new Set(options.tags ?? [])].sort();
  const selected = options.includeAll === true || selectedTags.length === 0
    ? rush.projects
    : rush.projects.filter((project) => selectedTags.some((tag) => project.tags?.includes(tag)));
  const packageNames = new Set(rush.projects.map((project) => project.packageName));
  const projects: RushProjectIndex[] = [];
  const factProjects: RushWorkspaceFactProject[] = [];
  for (const project of selected) {
    const packageJsonFile = path.posix.join(project.projectFolder, "package.json");
    const absolutePackageJson = path.join(root, packageJsonFile);
    const hasPackageJson = await exists(absolutePackageJson);
    const packageJson = hasPackageJson
      ? parseRushJsonc<PackageJson>(
        packageJsonFile,
        await readFile(absolutePackageJson, "utf8"),
      )
      : {};
    const shouldPublish = project.shouldPublish === true;
    const versionPolicyName = project.versionPolicyName ?? null;
    projects.push({
      packageName: project.packageName,
      packageNameMatches: packageJson.name === project.packageName,
      projectFolder: project.projectFolder,
      subspaceName: project.subspaceName ?? "default",
      tags: [...new Set(project.tags ?? [])].sort(),
      shouldPublish,
      entrySignals: entrySignals(packageJson),
      workspaceDependencies: workspaceDependencies(packageJson, packageNames, new Set(project.decoupledLocalDependencies ?? [])),
      workspaceDependents: [],
      owner: await findOwnerBoundary(root, project.projectFolder),
      packageJsonFile: hasPackageJson ? packageJsonFile : null,
      versionPolicyName,
      publishFolder: project.publishFolder ?? null,
      releaseUnitRef: null,
    });
    factProjects.push({
      packageName: project.packageName,
      subspaceName: project.subspaceName ?? "default",
      shouldPublish,
      versionPolicyName,
      scripts: packageJson.scripts ?? {},
    });
  }
  const selectedProjectNames = new Set(projects.map((project) => project.packageName));
  const dependents = new Map<string, string[]>();
  for (const project of projects) {
    for (const dependency of project.workspaceDependencies) {
      if (!selectedProjectNames.has(dependency.packageName)) continue;
      const current = dependents.get(dependency.packageName) ?? [];
      current.push(project.packageName);
      dependents.set(dependency.packageName, current);
    }
  }
  const workspaceFacts = await loadRushWorkspaceFacts({ root, projects: factProjects });
  const indexedProjects = projects.map((project) => ({
    ...project,
    workspaceDependents: [...new Set(dependents.get(project.packageName) ?? [])].sort(),
    releaseUnitRef: workspaceFacts.projectReleaseUnitRefs[project.packageName] ?? null,
  })).sort((left, right) => left.projectFolder.localeCompare(right.projectFolder));
  const ownerBoundaries = [...new Map(projects.flatMap((project) => project.owner ? [[project.owner.file, project.owner] as const] : [])).values()]
    .sort((left, right) => left.file.localeCompare(right.file));
  return {
    rushFile,
    rushVersion: rush.rushVersion,
    pnpmVersion: rush.pnpmVersion ?? null,
    nodeSupportedVersionRange: rush.nodeSupportedVersionRange ?? null,
    selectedTags,
    projects: indexedProjects,
    ownerBoundaries,
    subspacesFile: workspaceFacts.subspacesFile,
    subspacesEnabled: workspaceFacts.subspacesEnabled,
    preventSelectingAllSubspaces: workspaceFacts.preventSelectingAllSubspaces,
    subspaces: workspaceFacts.subspaces,
    commandLineFile: workspaceFacts.commandLineFile,
    buildPhases: workspaceFacts.buildPhases,
    buildCommands: workspaceFacts.buildCommands,
    versionPoliciesFile: workspaceFacts.versionPoliciesFile,
    releaseUnits: workspaceFacts.releaseUnits,
    diagnostics: workspaceFacts.diagnostics,
  };
}
