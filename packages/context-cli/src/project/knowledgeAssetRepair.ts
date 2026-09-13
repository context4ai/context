import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseDocumentSourceLocator } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  canonicalizeKnowledgeAssetLinks,
  projectKnowledgeAssets,
  removeOrphanKnowledgeAssets,
  type PreparedKnowledgeAsset,
  unprojectedSourceAssetLinks,
} from "./knowledgeAssets.js";
import { isKnowledgeAssetPath, walkApprovedMarkdown } from "./verifyProjectFiles.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { validateArticleStructureEntries } from "@c4a/context";
import {
  defaultDocumentManifest,
  defaultDocumentMaterializedAt,
  getCommittedEvidenceIndex,
  loadSourceRegistryLookup,
  registeredDocumentSource,
  type EvidenceIndexCache,
  type SourceRegistryLookup,
} from "./assetSourceRegistry.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

export interface KnowledgeAssetRepairResult {
  repairedPages: string[];
  writtenAssets: string[];
  removedAssets: string[];
}

function moduleSourceIdentity(source: string): {
  sourceType: "file" | "lark" | "note" | "sessions";
  sourceName: string;
} | null {
  const match = /^(file|lark|note|sessions):(.+)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return {
    sourceType: match[1] as "file" | "lark" | "note" | "sessions",
    sourceName: match[2],
  };
}

function isMissingSourceAsset(error: unknown): boolean {
  return error instanceof ContextError &&
    error.detail?.reason_code === "knowledge/resource-source-asset-missing";
}

async function validSourceRegistry(projectRoot: string): Promise<SourceRegistryLookup> {
  const registryIssues: ProjectVerifyIssue[] = [];
  const sourceRegistry = await loadSourceRegistryLookup(projectRoot, registryIssues);
  if (registryIssues.some((issue) => issue.severity === "error")) {
    throw new ContextError(ExitCode.WorkspaceStateError, "cannot repair resource projections while source registry is invalid", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "knowledge/resource-projection-repair-source-invalid",
      issues: registryIssues,
      next: "Repair the source registry, then rerun context close --format json.",
    });
  }
  return sourceRegistry;
}

async function sourceProjectionDocuments(input: {
  projectRoot: string;
  source: string;
  sourceRegistry: SourceRegistryLookup;
  cache: EvidenceIndexCache;
  documentPath?: string;
}) {
  const locator = parseDocumentSourceLocator(input.source);
  const moduleIdentity = moduleSourceIdentity(input.source);
  const locatorRegistryEntry = locator === null
    ? undefined
    : registeredDocumentSource(input.sourceRegistry, locator.sourceType, locator.sourceName);
  const moduleRegistryEntry = moduleIdentity === null
    ? undefined
    : registeredDocumentSource(
        input.sourceRegistry,
        moduleIdentity.sourceType,
        moduleIdentity.sourceName,
      );
  const registryEntry = locatorRegistryEntry ?? moduleRegistryEntry;
  if (registryEntry === undefined) return undefined;
  const sourceType = locatorRegistryEntry === undefined
    ? moduleIdentity!.sourceType
    : locator!.sourceType;
  const sourceName = locatorRegistryEntry === undefined
    ? moduleIdentity!.sourceName
    : locator!.sourceName;
  const materializedAt = registryEntry.materializedAt ??
    defaultDocumentMaterializedAt(sourceType, sourceName);
  const manifestPath = registryEntry.snapshot?.manifest ?? defaultDocumentManifest(materializedAt);
  const evidence = await getCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType,
    sourceName,
    materializedAt,
    manifestPath,
    cache: input.cache,
  });
  return {
    evidence,
    documentPaths: input.documentPath !== undefined
      ? evidence.index.documents.filter(document => document.path === input.documentPath).map(document => document.path)
      : locatorRegistryEntry === undefined
      ? evidence.index.documents.map((document) => document.path)
      : [locator!.documentPath],
  };
}

export async function canonicalizeApprovedKnowledgeAssetPair(input: {
  projectRoot: string;
  pageRelPath: string;
  expectedContent: string;
  approvedContent: string;
  sourceLocators: readonly string[];
}): Promise<{ expectedContent: string; approvedContent: string }> {
  if (unprojectedSourceAssetLinks(input.expectedContent).length === 0) {
    return {
      expectedContent: input.expectedContent,
      approvedContent: input.approvedContent,
    };
  }
  const sourceRegistry = await validSourceRegistry(input.projectRoot);
  const cache: EvidenceIndexCache = { entries: new Map(), ignoredPaths: new Map() };
  let expectedContent = input.expectedContent;
  let approvedContent = input.approvedContent;
  for (const source of [...new Set(input.sourceLocators)]) {
    const projection = await sourceProjectionDocuments({
      projectRoot: input.projectRoot,
      source,
      sourceRegistry,
      cache,
    });
    if (projection === undefined) continue;
    for (const documentPath of projection.documentPaths) {
      expectedContent = canonicalizeKnowledgeAssetLinks({
        content: expectedContent,
        documentPath,
        manifest: projection.evidence.manifest,
      }).content;
      approvedContent = canonicalizeKnowledgeAssetLinks({
        content: approvedContent,
        documentPath,
        manifest: projection.evidence.manifest,
        pageRelPath: input.pageRelPath,
      }).content;
    }
  }
  return { expectedContent, approvedContent };
}

async function bytesEqual(path: string, expected: Uint8Array): Promise<boolean> {
  if (!existsSync(path)) return false;
  const actual = await readFile(path);
  return actual.length === expected.length && actual.equals(Buffer.from(expected));
}

export async function repairApprovedKnowledgeAssetProjections(
  projectRoot: string,
): Promise<KnowledgeAssetRepairResult> {
  const affected: Array<{ relPath: string; absPath: string; content: string }> = [];
  for (const file of await walkApprovedMarkdown(join(projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const content = await readFile(file.absPath, "utf8");
    if (unprojectedSourceAssetLinks(content).length > 0) affected.push({ ...file, content });
  }
  if (affected.length === 0) {
    return { repairedPages: [], writtenAssets: [], removedAssets: await removeOrphanKnowledgeAssets(projectRoot) };
  }

  const sourceRegistry = await validSourceRegistry(projectRoot);
  const cache: EvidenceIndexCache = { entries: new Map(), ignoredPaths: new Map() };
  const pages: Array<{ relPath: string; absPath: string; content: string }> = [];
  const assets = new Map<string, PreparedKnowledgeAsset>();
  const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
  const articles = new Map(validateArticleStructureEntries(metadata.structure?.articles ?? []).map(article => [article.path, article]));
  for (const file of affected) {
    const { content } = file;
    const references = articles.get(file.relPath)?.sections.flatMap(section => section.references) ?? [];
    const locations = new Map(references.map(reference => [JSON.stringify([reference.source_ref, reference.locator.path]), reference]));
    let projectedContent = content;
    for (const reference of locations.values()) {
      const projectionSource = await sourceProjectionDocuments({
        projectRoot,
        source: reference.source_ref,
        documentPath: reference.locator.path,
        sourceRegistry,
        cache,
      });
      if (projectionSource === undefined) continue;
      for (const documentPath of projectionSource.documentPaths) {
        try {
          const projection = await projectKnowledgeAssets({
            projectRoot,
            pageRelPath: `knowledge/${file.relPath}`,
            content: projectedContent,
            sourceMaterializedAt: projectionSource.evidence.index.materialized_at,
            documentPath,
            manifest: projectionSource.evidence.manifest,
          });
          projectedContent = projection.content;
          for (const asset of projection.assets) assets.set(asset.relPath, asset);
          if (unprojectedSourceAssetLinks(projectedContent).length === 0) break;
        } catch (error) {
          if (!isMissingSourceAsset(error)) throw error;
        }
      }
    }
    const unresolved = unprojectedSourceAssetLinks(projectedContent);
    if (unresolved.length > 0) {
      throw new ContextError(ExitCode.WorkspaceStateError, `approved resource projection could not be repaired: ${file.relPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "knowledge/resource-projection-repair-unresolved",
        path: file.relPath,
        targets: unresolved.map((item) => item.target),
        next: "Restore the registered source snapshot, then rerun context close --format json.",
      });
    }
    if (projectedContent !== content) {
      pages.push({ relPath: file.relPath, absPath: file.absPath, content: projectedContent });
    }
  }

  const writtenAssets: string[] = [];
  for (const asset of assets.values()) {
    if (await bytesEqual(asset.absPath, asset.bytes)) continue;
    await mkdir(dirname(asset.absPath), { recursive: true });
    await writeFile(asset.absPath, asset.bytes);
    writtenAssets.push(asset.relPath);
  }
  for (const page of pages) await writeFile(page.absPath, page.content, "utf8");
  const removedAssets = await removeOrphanKnowledgeAssets(projectRoot);
  return {
    repairedPages: pages.map((page) => page.relPath).sort(),
    writtenAssets: writtenAssets.sort(),
    removedAssets,
  };
}
