import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackageDefinition, TemplateVarValue } from "@c4a/context";
import {
  PACKAGE_BUILD_INVENTORY_PATH,
  type PackageSelectionReason,
  type SelectedApprovedKnowledgeFile,
} from "./packageBuildInventory.js";
import {
  packageDistributionTemplateVars,
  packageKnowledgeOutputPath,
  packageOkfRootPath,
  packageTemplateOutputPath,
} from "./packageDistribution.js";
import { knowledgeInventory, type ApprovedKnowledgeFile } from "./packageIndexes.js";
import { packageNavigation } from "./packageNavigation.js";
import { isKnowledgeCollection, okfRootForCollection } from "./okfTypes.js";
import { projectPackageKnowledgeMarkdown } from "./packageKnowledgeProjection.js";
import {
  projectPackageKnowledgeAssets,
  type PackageAssetFile,
  type PackageKnowledgeWithAssets,
} from "./packageAssets.js";
import { packageMarkdownTarget } from "./packageAssets.js";
import type { PackageImageProcessor } from "./packageAssetOptimization.js";
import {
  deliverPackageAssetFiles,
  type PackageAssetDeliveryResult,
  type PackageAssetDeliverySummary,
} from "./packageAssetDelivery.js";
import { replaceMarkdownInlineLinkTargets } from "./markdownLinks.js";
import {
  assertSafeRenderedPath,
  packageKind,
  renderTemplateText,
  toPosixPath,
  type TemplateFile,
} from "./packageTemplateUtils.js";

function globToRegExp(pattern: string): RegExp {
  const normalized = toPosixPath(pattern);
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3).replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`^${prefix}(?:/.*)?$`, "u");
  }
  let out = "^";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      index++;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char?.replace(/[.+^${}()|[\]\\]/gu, "\\$&") ?? "";
    }
  }
  return new RegExp(`${out}$`, "u");
}

function matchesAny(path: string, patterns: readonly string[] | undefined): boolean {
  return patterns?.some((pattern) => pattern === path || globToRegExp(pattern).test(path)) === true;
}

function matchingPatterns(path: string, patterns: readonly string[] | undefined): string[] {
  return patterns?.filter((pattern) => pattern === path || globToRegExp(pattern).test(path)) ?? [];
}

function selectionReasonsForFile(file: ApprovedKnowledgeFile, pkg: PackageDefinition): PackageSelectionReason[] | null {
  const internalCollection = file.relPath.split("/")[0];
  if (!isKnowledgeCollection(internalCollection)) return null;
  const reasons: PackageSelectionReason[] = [];
  if (pkg.select?.collections?.length && !pkg.select.collections.includes(internalCollection)) return null;
  if (pkg.select?.collections?.length) reasons.push({ kind: "collection", value: internalCollection });
  const okfRoot = okfRootForCollection(internalCollection);
  if (pkg.select?.okfRoots?.length && !pkg.select.okfRoots.includes(okfRoot)) return null;
  if (pkg.select?.okfRoots?.length) reasons.push({ kind: "okf_root", value: okfRoot });
  const includeMatches = matchingPatterns(file.relPath, pkg.select?.include);
  if (pkg.select?.include?.length && includeMatches.length === 0) return null;
  reasons.push(...includeMatches.map((pattern) => ({ kind: "include" as const, value: pattern })));
  if (matchesAny(file.relPath, pkg.select?.exclude)) return null;
  return reasons.length > 0 ? reasons : [{ kind: "default", value: "all" }];
}

export function selectPackageKnowledge(
  files: readonly ApprovedKnowledgeFile[],
  pkg: PackageDefinition,
): SelectedApprovedKnowledgeFile[] {
  return files.flatMap((file) => {
    const selectedBy = selectionReasonsForFile(file, pkg);
    return selectedBy === null ? [] : [{ ...file, selectedBy }];
  });
}

export function packageTemplateVars(input: {
  pkg: PackageDefinition;
  bundle: string;
  knowledgeCount: number;
  knowledgeTimestamp: string;
  selected: readonly ApprovedKnowledgeFile[];
  buildInventory?: Record<string, unknown>;
  knowledgeStructure?: Record<string, unknown> | null;
  templateRelPath?: string;
  logicalTemplateRelPath?: string;
}): Record<string, TemplateVarValue> {
  const inventory = knowledgeInventory(
    input.selected,
    input.templateRelPath ?? `${packageOkfRootPath(input.pkg, "wikis")}/index.md`,
    packageNavigation(input.pkg),
    input.pkg,
  );
  const buildInventory = input.buildInventory ?? {};
  const knowledgeStructure = input.knowledgeStructure ?? null;
  return {
    ...input.pkg.template.vars,
    ...packageDistributionTemplateVars({
      pkg: input.pkg,
      ...(input.logicalTemplateRelPath === undefined ? {} : { logicalTemplateRelPath: input.logicalTemplateRelPath }),
    }),
    packageName: input.pkg.name,
    packageKind: packageKind(input.pkg),
    knowledge: input.bundle,
    approvedKnowledge: input.bundle,
    knowledgeCount: input.knowledgeCount,
    knowledgeTimestamp: input.knowledgeTimestamp,
    knowledgeItems: inventory.items,
    knowledgeGroups: inventory.groups,
    knowledgeTreeNodes: inventory.treeNodes,
    knowledgeTree: inventory.treeMarkdown,
    knowledgeItemsMarkdown: inventory.itemsMarkdown,
    knowledgeGroupsMarkdown: inventory.groupsMarkdown,
    buildInventory,
    buildInventoryJson: JSON.stringify(buildInventory, null, 2),
    buildInventoryPath: PACKAGE_BUILD_INVENTORY_PATH,
    knowledgeStructure,
    knowledgeStructureJson: knowledgeStructure === null ? "null" : JSON.stringify(knowledgeStructure, null, 2),
    knowledgeStructurePath: "knowledge/structure.yaml",
  };
}

export async function packageKnowledgeBundle(
  projectRoot: string,
  pkg: PackageDefinition,
  files: readonly ApprovedKnowledgeFile[],
): Promise<string> {
  const projected = await Promise.all(files.map(async (file) => {
    const content = packageKind(pkg) === "llms"
      ? (await projectPackageKnowledgeAssets({
          projectRoot,
          pkg,
          file,
          content: file.content,
          linkFromPath: "llms.txt",
        })).content
      : file.content;
    const distPath = packageKnowledgeOutputPath(pkg, file.relPath);
    const lines = [`# ${distPath}`, ""];
    if (file.relPath !== distPath) lines.push(`<!-- approved_path: ${file.relPath} -->`, "");
    lines.push(projectPackageKnowledgeMarkdown(content).trim());
    return lines.join("\n");
  }));
  return projected.join("\n\n---\n\n");
}

export function approvedKnowledgeTimestamp(files: readonly ApprovedKnowledgeFile[]): string {
  const timestamps = files
    .map((file) => /^timestamp:\s*"?([^"\n]+)"?\s*$/mu.exec(file.content)?.[1])
    .filter((timestamp): timestamp is string => timestamp !== undefined && !Number.isNaN(Date.parse(timestamp)));
  if (timestamps.length === 0) return "1970-01-01T00:00:00.000Z";
  return timestamps.map((timestamp) => new Date(timestamp).toISOString()).sort().at(-1) ?? "1970-01-01T00:00:00.000Z";
}

export async function writeRenderedPackageTemplate(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  files: readonly TemplateFile[];
  bundle: string;
  knowledgeTimestamp: string;
  selected: readonly ApprovedKnowledgeFile[];
  buildInventory: Record<string, unknown>;
  knowledgeStructure: Record<string, unknown> | null;
}): Promise<{ files: number; consumesKnowledge: boolean }> {
  let written = 0;
  let consumesKnowledge = false;
  for (const file of input.files) {
    if (/\{\{\s*(?:knowledge|approvedKnowledge)\s*\}\}/u.test(file.content)) consumesKnowledge = true;
    const pathVars = packageTemplateVars({
      ...input,
      knowledgeCount: input.selected.length,
      templateRelPath: packageTemplateOutputPath(input.pkg, file.relPath),
      logicalTemplateRelPath: file.relPath,
    });
    const renderedLogicalRelPath = renderTemplateText(file.relPath, pathVars);
    const renderedRelPath = packageTemplateOutputPath(input.pkg, renderedLogicalRelPath);
    assertSafeRenderedPath(renderedRelPath, "package template path");
    const contentVars = packageTemplateVars({
      ...input,
      knowledgeCount: input.selected.length,
      templateRelPath: renderedRelPath,
      logicalTemplateRelPath: renderedLogicalRelPath,
    });
    const outputPath = join(input.projectRoot, input.pkg.outDir, renderedRelPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderTemplateText(file.content, contentVars), "utf8");
    written++;
  }
  return { files: written, consumesKnowledge };
}

export interface PreparedPackageKnowledge {
  projectedPages: PackageKnowledgeWithAssets[];
  delivered: PackageAssetDeliveryResult;
}

export async function prepareSelectedPackageKnowledge(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  files: readonly ApprovedKnowledgeFile[];
  assetProcessor?: PackageImageProcessor;
}): Promise<PreparedPackageKnowledge> {
  const assets = new Map<string, PackageAssetFile>();
  const projectedPages = await Promise.all(input.files.map(async (file) => {
    const projected = await projectPackageKnowledgeAssets({ ...input, file, content: file.content });
    for (const asset of projected.assets) assets.set(asset.packageRelPath, asset);
    return projected;
  }));
  const delivered = await deliverPackageAssetFiles({
    projectRoot: input.projectRoot,
    assets: [...assets.values()],
    ...(input.pkg.kind === "package.kb" && input.pkg.assets !== undefined
      ? { definition: input.pkg.assets }
      : {}),
    ...(input.assetProcessor === undefined ? {} : { processor: input.assetProcessor }),
  });
  return { projectedPages, delivered };
}

export async function writeSelectedPackageKnowledge(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  files: readonly ApprovedKnowledgeFile[];
  assetProcessor?: PackageImageProcessor;
  prepared?: PreparedPackageKnowledge;
}): Promise<{
  pages: number;
  resources: number;
  resourceBytes: number;
  assetDelivery: PackageAssetDeliverySummary;
}> {
  const { projectedPages, delivered } = input.prepared ?? await prepareSelectedPackageKnowledge(input);
  for (const projected of projectedPages) {
    assertSafeRenderedPath(projected.pageOutputPath, "knowledge path");
    const outputPath = join(input.projectRoot, input.pkg.outDir, projected.pageOutputPath);
    const rewritten = replaceMarkdownInlineLinkTargets(projected.content, (link) => {
      for (const [inputPath, outputPath] of delivered.targetByOriginal) {
        if (link.target === packageMarkdownTarget(projected.pageOutputPath, inputPath)) {
          return /^https:\/\//u.test(outputPath)
            ? outputPath
            : packageMarkdownTarget(projected.pageOutputPath, outputPath);
        }
      }
      return undefined;
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, projectPackageKnowledgeMarkdown(rewritten), "utf8");
  }
  const deliveredAssets = new Map(delivered.assets.map((asset) => [asset.packageRelPath, asset]));
  for (const asset of deliveredAssets.values()) {
    assertSafeRenderedPath(asset.packageRelPath, "package resource path");
    const outputPath = join(input.projectRoot, input.pkg.outDir, asset.packageRelPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, asset.bytes);
  }
  return {
    pages: projectedPages.length,
    resources: deliveredAssets.size,
    resourceBytes: [...deliveredAssets.values()].reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
    assetDelivery: delivered.summary,
  };
}

export async function appendLlmsKnowledge(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  bundle: string;
  knowledgeCount: number;
  templateConsumesKnowledge: boolean;
}): Promise<number> {
  if (packageKind(input.pkg) !== "llms" || input.templateConsumesKnowledge || input.knowledgeCount === 0) return 0;
  const outputPath = join(input.projectRoot, input.pkg.outDir, "llms.txt");
  const existed = existsSync(outputPath);
  const existing = existed ? await readFile(outputPath, "utf8") : "";
  const content = existing.trim().length > 0
    ? `${existing.trimEnd()}\n\n---\n\n${input.bundle}\n`
    : `${input.bundle}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  return existed ? 0 : 1;
}
