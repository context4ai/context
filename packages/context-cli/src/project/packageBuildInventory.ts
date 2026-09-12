import { reuseCommandFileRead } from "./commandReadCache.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readProcessedScopes, validateArticleStructureEntries, type PackageDefinition } from "@c4a/context";
import { parse as parseYaml } from "yaml";
import { knowledgeInventory, type ApprovedKnowledgeFile } from "./packageIndexes.js";
import { packageNavigation } from "./packageNavigation.js";
import {
  packageOkfRootPath,
} from "./packageDistribution.js";
import { packageKind } from "./packageTemplateUtils.js";
import type { ProjectVerifyResult } from "./verifyTypes.js";

export const PACKAGE_BUILD_INVENTORY_PATH = "context-build-inventory.json";

export interface PackageSelectionReason {
  kind: "default" | "collection" | "okf_root" | "include";
  value: string;
}

export type SelectedApprovedKnowledgeFile = ApprovedKnowledgeFile & {
  selectedBy?: PackageSelectionReason[];
};

export interface KnowledgeStructureInfo {
  path: string;
  content: string | null;
  sha256: string | null;
  parsed: Record<string, unknown> | null;
  articles: number;
}

export function knowledgeStructurePath(projectRoot: string): string {
  return join(projectRoot, "knowledge", "structure.yaml");
}

async function readOptionalText(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

export async function readKnowledgeStructure(projectRoot: string): Promise<KnowledgeStructureInfo> {
  const snapshot = await reuseCommandFileRead({ key: "approved-knowledge-structure",
    paths: [knowledgeStructurePath(projectRoot)], read: () => readKnowledgeStructureUncached(projectRoot) });
  // Callers preparing a Review may edit their local parsed view. Sharing that
  // mutable object would leak uncommitted changes into later status reads.
  return { ...snapshot, parsed: structuredClone(snapshot.parsed) };
}

async function readKnowledgeStructureUncached(projectRoot: string): Promise<KnowledgeStructureInfo> {
  const path = "knowledge/structure.yaml";
  const content = await readOptionalText(knowledgeStructurePath(projectRoot));
  if (content === null) {
    return { path, content: null, sha256: null, parsed: null, articles: 0 };
  }
  const parsed = parseYaml(content) as unknown;
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  readProcessedScopes(record);
  return {
    path,
    content,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    parsed: record,
    articles: validateArticleStructureEntries(record?.articles ?? []).length,
  };
}

function hashScopedStructure(parsed: Record<string, unknown> | null): string | null {
  if (parsed === null) return null;
  return createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
}

export function packageScopedKnowledgeStructure(input: {
  selected: readonly SelectedApprovedKnowledgeFile[];
  structure: KnowledgeStructureInfo;
}): KnowledgeStructureInfo {
  const parsed = input.structure.parsed;
  if (parsed === null) return input.structure;
  const paths = new Set(input.selected.map(file => file.relPath));
  const articles = validateArticleStructureEntries(parsed.articles ?? []).filter(article => paths.has(article.path));
  const scoped = { ...(typeof parsed.schema_version === "string" ? { schema_version: parsed.schema_version } : {}),
    articles };
  return { path: input.structure.path, content: JSON.stringify(scoped), sha256: hashScopedStructure(scoped),
    parsed: scoped, articles: articles.length };
}

export function packageBuildInventory(input: {
  pkg: PackageDefinition;
  selected: readonly SelectedApprovedKnowledgeFile[];
  structure: KnowledgeStructureInfo;
  verifyEvidenceStatus: ProjectVerifyResult["evidenceStatus"] | null;
}): Record<string, unknown> {
  const inventory = knowledgeInventory(
    input.selected,
    `${packageOkfRootPath(input.pkg, "wikis")}/index.md`,
    packageNavigation(input.pkg),
    input.pkg,
  );
  const selectedByApprovedPath = new Map(input.selected.map((file) => [file.relPath, file.selectedBy ?? []]));
  const selectedByForApprovedPath = (path: string): PackageSelectionReason[] => selectedByApprovedPath.get(path) ?? [];
  const uniqueSelectedBy = (paths: readonly string[]): PackageSelectionReason[] => {
    const seen = new Set<string>();
    const reasons: PackageSelectionReason[] = [];
    for (const path of paths) {
      for (const reason of selectedByForApprovedPath(path)) {
        const key = `${reason.kind}\u0000${reason.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        reasons.push(reason);
      }
    }
    return reasons;
  };
  const itemsByCollection = new Map<string, typeof inventory.items>();
  for (const item of inventory.items) {
    const existing = itemsByCollection.get(item.internalCollection) ?? [];
    existing.push(item);
    itemsByCollection.set(item.internalCollection, existing);
  }
  const collectionSummaries = [...itemsByCollection.entries()]
    .map(([collection, items]) => {
      return {
        collection,
        internal_collection: collection,
        okf_root: items[0]?.okf_root ?? collection,
        count: items.length,
        selected_by: uniqueSelectedBy(items.map((item) => item.sourcePath)),
      };
    })
    .sort((left, right) => left.collection.localeCompare(right.collection));
  return {
    schema_version: "context.package-build-inventory.v1",
    package: {
      name: input.pkg.name,
      kind: packageKind(input.pkg),
      out_dir: input.pkg.outDir,
      distribution: {
        layout: "flat",
        knowledge_namespace: null,
        roots: {
          wikis: packageOkfRootPath(input.pkg, "wikis"),
          guides: packageOkfRootPath(input.pkg, "guides"),
          rules: packageOkfRootPath(input.pkg, "rules"),
          feats: packageOkfRootPath(input.pkg, "feats"),
        },
      },
      select: input.pkg.select ?? null,
      navigation: input.pkg.kind === "package.kb" ? packageNavigation(input.pkg) : null,
    },
    approved_knowledge: {
      count: input.selected.length,
      files: inventory.items.map((item) => ({
        path: item.path,
        collection: item.internalCollection,
        internal_collection: item.internalCollection,
        okf_root: item.okf_root,
        okf_root_path: item.okf_root_path,
        approved_path: item.sourcePath,
        dist_path: item.path,
        selected_by: selectedByForApprovedPath(item.sourcePath),
        path_within_collection: item.pathWithinCollection,
        title: item.title,
        type: item.type,
        group: item.group,
        source: item.source,
        ...(item.production_metadata === undefined
          ? {}
          : { production_metadata: item.production_metadata }),
      })),
      groups: inventory.groups.map((group) => ({
        name: group.name,
        collection: group.collection,
        internal_collection: group.internalCollection,
        okf_root: group.okf_root,
        okf_root_path: group.okf_root_path,
        count: group.count,
        has_index: group.hasIndex,
        index_path: group.hasIndex ? group.indexPath : null,
        selected_by: uniqueSelectedBy(group.items.map((item) => item.sourcePath)),
      })),
      collections: collectionSummaries,
    },
    structure: {
      path: input.structure.path,
      scope: "selected-package",
      present: input.structure.content !== null,
      sha256: input.structure.sha256,
      articles: input.structure.articles,
    },
  };
}

export async function writePackageBuildInventory(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  inventory: Record<string, unknown>;
}): Promise<number> {
  const outputPath = join(input.projectRoot, input.pkg.outDir, PACKAGE_BUILD_INVENTORY_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(input.inventory, null, 2)}\n`, "utf8");
  return 1;
}
