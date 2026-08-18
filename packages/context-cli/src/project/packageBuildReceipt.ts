import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import type { PackageAssetDeliverySummary } from "./packageAssetDelivery.js";
import { knowledgeInventory, type ApprovedKnowledgeFile } from "./packageIndexes.js";
import { toPosixPath } from "./packageTemplateUtils.js";

export interface PackageBuildFileChange {
  path: string;
  kind: "knowledge-page" | "index" | "file";
  group?: string;
}

export interface PackageOutputFile extends PackageBuildFileChange {
  sha256: string;
}

export interface PackageBuildChanges {
  added: PackageBuildFileChange[];
  updated: PackageBuildFileChange[];
  removed: PackageBuildFileChange[];
}

export interface PackageBuildSummary {
  name: string;
  kind: "kb" | "llms";
  outDir: string;
  inputs: number;
  files: number;
  resources: {
    files: number;
    bytes: number;
    delivery: PackageAssetDeliverySummary;
  };
  state: "created" | "updated" | "unchanged";
  changes: PackageBuildChanges;
}

const IGNORED_PACKAGE_FS_ENTRIES = new Set([".DS_Store"]);

export async function walkPackageFiles(root: string): Promise<Array<{ relPath: string; absPath: string }>> {
  if (!existsSync(root)) return [];
  const files: Array<{ relPath: string; absPath: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_PACKAGE_FS_ENTRIES.has(entry.name)) continue;
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({ relPath: toPosixPath(relative(root, absPath)), absPath });
    }
  };
  await visit(root);
  files.sort((left, right) => left.relPath.localeCompare(right.relPath));
  return files;
}

export function knowledgeOutputGroups(
  pkg: PackageDefinition,
  selected: readonly ApprovedKnowledgeFile[],
): Map<string, string> {
  const groups = new Map<string, string>();
  for (const item of knowledgeInventory(selected, "index.md", undefined, pkg).items) {
    groups.set(item.path, item.group === "root" ? item.okf_root : `${item.okf_root}/${item.group}`);
  }
  return groups;
}

function classifyOutputFile(path: string, knowledgeGroups: ReadonlyMap<string, string>): PackageBuildFileChange {
  const group = knowledgeGroups.get(path);
  if (group !== undefined) return { path, kind: "knowledge-page", group };
  if (path === "index.md" || path.endsWith("/index.md")) return { path, kind: "index" };
  return { path, kind: "file" };
}

export async function packageOutputSnapshot(
  projectRoot: string,
  pkg: PackageDefinition,
  knowledgeGroups: ReadonlyMap<string, string>,
  previousOutputs: readonly PackageOutputFile[] = [],
): Promise<PackageOutputFile[]> {
  const previousByPath = new Map(previousOutputs.map((file) => [file.path, file]));
  return Promise.all((await walkPackageFiles(join(projectRoot, pkg.outDir))).map(async (file) => {
    const current = classifyOutputFile(file.relPath, knowledgeGroups);
    const previous = previousByPath.get(file.relPath);
    const classification = current.kind === "file" && previous !== undefined
      ? { path: file.relPath, kind: previous.kind, ...(previous.group === undefined ? {} : { group: previous.group }) }
      : current;
    return {
      ...classification,
      sha256: createHash("sha256").update(await readFile(file.absPath)).digest("hex"),
    };
  }));
}

export async function packageOutputFingerprint(projectRoot: string, pkg: PackageDefinition): Promise<{
  fingerprint: string;
  files: number;
}> {
  const snapshot = await packageOutputSnapshot(projectRoot, pkg, new Map());
  return {
    fingerprint: createHash("sha256").update(JSON.stringify({
      outDirExists: existsSync(join(projectRoot, pkg.outDir)),
      files: snapshot.map(({ path, sha256 }) => ({ path, sha256 })),
    })).digest("hex"),
    files: snapshot.length,
  };
}

function outputFileChange(file: PackageOutputFile): PackageBuildFileChange {
  return {
    path: file.path,
    kind: file.kind,
    ...(file.group === undefined ? {} : { group: file.group }),
  };
}

export function packageBuildChanges(
  before: readonly PackageOutputFile[],
  after: readonly PackageOutputFile[],
): PackageBuildChanges {
  const beforeByPath = new Map(before.map((file) => [file.path, file]));
  const afterByPath = new Map(after.map((file) => [file.path, file]));
  return {
    added: after.filter((file) => !beforeByPath.has(file.path)).map(outputFileChange),
    updated: after
      .filter((file) => beforeByPath.has(file.path) && beforeByPath.get(file.path)?.sha256 !== file.sha256)
      .map(outputFileChange),
    removed: before.filter((file) => !afterByPath.has(file.path)).map(outputFileChange),
  };
}

function formatPackageChangeLines(label: string, changes: readonly PackageBuildFileChange[]): string[] {
  if (changes.length === 0) return [];
  const knowledgeCounts = new Map<string, number>();
  let indexes = 0;
  let files = 0;
  for (const change of changes) {
    if (change.kind === "knowledge-page") {
      const group = change.group ?? "knowledge";
      knowledgeCounts.set(group, (knowledgeCounts.get(group) ?? 0) + 1);
    } else if (change.kind === "index") {
      indexes++;
    } else {
      files++;
    }
  }
  const details = [...knowledgeCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `${group}: ${count} page(s)`);
  if (indexes > 0) details.push(`indexes: ${indexes}`);
  if (files > 0) details.push(`other files: ${files}`);
  return [`  ${label}:`, ...details.map((detail) => `    ${detail}`)];
}

export function formatPackageBuildSummary(pkg: PackageBuildSummary): string[] {
  const lines = [
    `- ${pkg.name} (${pkg.kind}, ${pkg.state}) -> \`${pkg.outDir}\``,
    `  inputs: ${pkg.inputs}`,
    `  files: ${pkg.files}`,
    `  resources: ${pkg.resources.files} file(s), ${pkg.resources.bytes} byte(s)`,
  ];
  const optimization = pkg.resources.delivery.optimization;
  if (optimization?.state === "recommended") {
    lines.push(
      `  asset optimization: recommended (${optimization.candidateFiles} image(s), ${optimization.originalBytes} byte(s))`,
      "  setup: choose bundle delivery, add sharp, and configure kbPackage().assets.optimize in src/index.ts",
    );
  } else if (optimization?.state === "applied") {
    lines.push(
      `  asset optimization: ${optimization.processor}/${optimization.mode}, saved ${optimization.savedBytes} byte(s)`,
    );
  } else if (pkg.resources.delivery.state === "git-raw") {
    const git = pkg.resources.delivery.git;
    lines.push(`  asset delivery: Git raw at ${git?.commit ?? git?.urlPrefix ?? "configured URL prefix"}`);
  } else if (pkg.resources.delivery.state === "omitted") {
    lines.push(`  asset delivery: omitted; ${pkg.resources.delivery.sourceFiles} reference(s) remain unresolved`);
  }
  if (pkg.state === "unchanged") return [...lines, "  changes: none"];
  return [
    ...lines,
    ...formatPackageChangeLines("added", pkg.changes.added),
    ...formatPackageChangeLines("updated", pkg.changes.updated),
    ...formatPackageChangeLines("removed", pkg.changes.removed),
  ];
}
