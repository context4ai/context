import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseDocumentSourceLocator } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  projectKnowledgeAssets,
  removeOrphanKnowledgeAssets,
  type PreparedKnowledgeAsset,
  unprojectedSourceAssetLinks,
} from "./knowledgeAssets.js";
import { isKnowledgeAssetPath, walkMarkdown } from "./verifyProjectFiles.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import {
  defaultDocumentManifest,
  defaultDocumentMaterializedAt,
  getCommittedEvidenceIndex,
  loadSourceRegistryLookup,
  registeredDocumentSource,
  type EvidenceIndexCache,
} from "./verifySourceRefs.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";

export interface KnowledgeAssetRepairResult {
  repairedPages: string[];
  writtenAssets: string[];
  removedAssets: string[];
}

function sourceLocators(frontmatter: Record<string, unknown>): string[] {
  return [...new Set([
    ...(typeof frontmatter.resource === "string" ? [frontmatter.resource] : []),
    ...(Array.isArray(frontmatter.sources)
      ? frontmatter.sources.filter((value): value is string => typeof value === "string")
      : []),
  ])];
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
  for (const file of await walkMarkdown(join(projectRoot, "knowledge"))) {
    if (isKnowledgeAssetPath(file.relPath)) continue;
    const content = await readFile(file.absPath, "utf8");
    if (unprojectedSourceAssetLinks(content).length > 0) affected.push({ ...file, content });
  }
  if (affected.length === 0) {
    return { repairedPages: [], writtenAssets: [], removedAssets: [] };
  }

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

  const cache: EvidenceIndexCache = { entries: new Map(), ignoredPaths: new Map() };
  const pages: Array<{ relPath: string; absPath: string; content: string }> = [];
  const assets = new Map<string, PreparedKnowledgeAsset>();
  for (const file of affected) {
    const { content } = file;
    const frontmatter = parseFrontmatterLoose(content);
    let projectedContent = content;
    for (const source of sourceLocators(frontmatter)) {
      const locator = parseDocumentSourceLocator(source);
      if (locator === null) continue;
      const registryEntry = registeredDocumentSource(sourceRegistry, locator.sourceType, locator.sourceName);
      if (registryEntry === undefined) continue;
      const materializedAt = registryEntry.materializedAt ??
        defaultDocumentMaterializedAt(locator.sourceType, locator.sourceName);
      const manifestPath = registryEntry.snapshot?.manifest ?? defaultDocumentManifest(materializedAt);
      const evidence = await getCommittedEvidenceIndex({
        projectRoot,
        sourceType: locator.sourceType,
        sourceName: locator.sourceName,
        materializedAt,
        manifestPath,
        cache,
      });
      const projection = await projectKnowledgeAssets({
        projectRoot,
        pageRelPath: `knowledge/${file.relPath}`,
        content: projectedContent,
        sourceMaterializedAt: evidence.index.materialized_at,
        documentPath: locator.documentPath,
        manifest: evidence.manifest,
      });
      projectedContent = projection.content;
      for (const asset of projection.assets) assets.set(asset.relPath, asset);
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
