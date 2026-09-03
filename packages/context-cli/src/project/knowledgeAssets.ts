import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { DocumentSnapshotAssetEntry, DocumentSnapshotManifest } from "@c4a/extract";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import {
  markdownInlineLinks,
  replaceMarkdownInlineLinkTargets,
} from "./markdownLinks.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";

export interface PreparedKnowledgeAsset {
  relPath: string;
  absPath: string;
  bytes: Uint8Array;
  contentHash: string;
}

export interface KnowledgeAssetProjection {
  content: string;
  assets: PreparedKnowledgeAsset[];
}

export interface KnowledgeAssetLinkCanonicalization {
  content: string;
  rewritten: number;
}

const RESOURCE_LOCATOR_RE = /<!--\s*(lark:[^\s]+)\s*-->/gu;

function posixPath(value: string): string {
  return value.split(sep).join("/");
}

function withoutHashPrefix(value: string): string {
  return value.replace(/^sha256:/u, "");
}

function safeKind(asset: DocumentSnapshotAssetEntry): string {
  const kind = asset.source?.kind?.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
  return kind !== undefined && kind.length > 0 ? kind : "resource";
}

function contentAddressedPath(asset: DocumentSnapshotAssetEntry): string {
  if (asset.content_hash === undefined) throw new TypeError(`resource asset has no content hash: ${asset.path}`);
  const extension = extname(asset.path).toLowerCase();
  const suffix = extension.length > 1 && extension.length <= 10 ? extension : "";
  return `knowledge/assets/${safeKind(asset)}/${withoutHashPrefix(asset.content_hash)}${suffix}`;
}

function relativeMarkdownTarget(fromPage: string, target: string): string {
  const rel = posixPath(relative(dirname(fromPage), target));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function decodedTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sourceAssetPath(documentPath: string, target: string): string | undefined {
  const decoded = decodedTarget(target);
  if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.startsWith("#") || decoded.startsWith("/")) return undefined;
  const normalized = posixPath(join(dirname(documentPath), decoded));
  if (normalized === "assets" || normalized.startsWith("assets/")) return normalized;
  return undefined;
}

function selectedAssets(input: {
  content: string;
  documentPath: string;
  manifest: DocumentSnapshotManifest;
}): { assets: DocumentSnapshotAssetEntry[]; directTargets: Map<string, string> } {
  const byPath = new Map((input.manifest.assets ?? []).map((asset) => [asset.path, asset]));
  const locators = new Set([...input.content.matchAll(RESOURCE_LOCATOR_RE)].map((match) => match[1] ?? ""));
  const directTargets = new Map<string, string>();
  const selected = new Map<string, DocumentSnapshotAssetEntry>();
  for (const link of markdownInlineLinks(input.content)) {
    const target = link.target;
    const path = sourceAssetPath(input.documentPath, target);
    if (path === undefined) continue;
    const asset = byPath.get(path);
    if (asset === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, `approved candidate references an unregistered source asset: ${path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "knowledge/resource-source-asset-missing",
        path,
        next: "Rerun the source capture before approving this candidate.",
      });
    }
    selected.set(asset.path, asset);
    directTargets.set(target, asset.path);
  }
  for (const asset of input.manifest.assets ?? []) {
    if (asset.role === "audit" || asset.source?.locator === undefined || !locators.has(asset.source.locator)) continue;
    selected.set(asset.path, asset);
  }
  return { assets: [...selected.values()], directTargets };
}

export async function projectKnowledgeAssets(input: {
  projectRoot: string;
  pageRelPath: string;
  content: string;
  sourceMaterializedAt: string;
  documentPath: string;
  manifest: DocumentSnapshotManifest;
}): Promise<KnowledgeAssetProjection> {
  const selection = selectedAssets({
    content: input.content,
    documentPath: input.documentPath,
    manifest: input.manifest,
  });
  const assets: PreparedKnowledgeAsset[] = [];
  const knowledgePathBySourcePath = new Map<string, string>();
  for (const asset of selection.assets) {
    if (asset.role === "audit") continue;
    if (asset.content_hash === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, `source resource is not materialized: ${asset.path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "knowledge/resource-not-materialized",
        path: asset.path,
        next: "Rerun the source capture and resolve resource materialization errors before Review.",
      });
    }
    const sourcePath = join(input.projectRoot, input.sourceMaterializedAt, asset.path);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(sourcePath);
    } catch {
      throw new ContextError(ExitCode.WorkspaceStateError, `source resource file is missing: ${asset.path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "knowledge/resource-file-missing",
        path: sourcePath,
        next: "Rerun the source capture before Review.",
      });
    }
    const relPath = contentAddressedPath(asset);
    knowledgePathBySourcePath.set(asset.path, relPath);
    assets.push({
      relPath,
      absPath: join(input.projectRoot, relPath),
      bytes,
      contentHash: asset.content_hash,
    });
  }
  const content = replaceMarkdownInlineLinkTargets(input.content, (link) => {
    const sourcePath = selection.directTargets.get(link.target);
    if (sourcePath === undefined) return undefined;
    const knowledgePath = knowledgePathBySourcePath.get(sourcePath);
    if (knowledgePath === undefined) return undefined;
    return relativeMarkdownTarget(input.pageRelPath, knowledgePath);
  });
  return { content, assets };
}

/**
 * Replaces source-snapshot and approved-projection paths with the same stable
 * content identity. This is for byte-fidelity comparison only; rendered
 * Markdown keeps its user-facing relative paths.
 */
export function canonicalizeKnowledgeAssetLinks(input: {
  content: string;
  documentPath: string;
  manifest: DocumentSnapshotManifest;
  pageRelPath?: string;
}): KnowledgeAssetLinkCanonicalization {
  const bySourcePath = new Map((input.manifest.assets ?? []).map((asset) => [asset.path, asset]));
  const byKnowledgePath = new Map((input.manifest.assets ?? []).flatMap((asset) =>
    asset.content_hash === undefined
      ? []
      : [[contentAddressedPath(asset), asset] as const]
  ));
  let rewritten = 0;
  const content = replaceMarkdownInlineLinkTargets(input.content, (link) => {
    const sourcePath = sourceAssetPath(input.documentPath, link.target);
    const projectedPath = input.pageRelPath === undefined
      ? undefined
      : posixPath(join(dirname(input.pageRelPath), decodedTarget(link.target)));
    const asset = (sourcePath === undefined ? undefined : bySourcePath.get(sourcePath)) ??
      (projectedPath === undefined ? undefined : byKnowledgePath.get(projectedPath));
    if (asset?.content_hash === undefined) return undefined;
    rewritten += 1;
    return `context-asset:${asset.content_hash}`;
  });
  return { content, rewritten };
}

export function knowledgeAssetReferences(input: {
  pageRelPath: string;
  content: string;
}): string[] {
  const references = new Set<string>();
  for (const link of markdownInlineLinks(input.content)) {
    const target = link.target;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("#")) continue;
    const resolved = posixPath(join(dirname(input.pageRelPath), decodedTarget(target)));
    if (resolved.startsWith("knowledge/assets/")) references.add(resolved);
  }
  return [...references].sort();
}

export function unprojectedSourceAssetLinks(content: string): Array<{ target: string; line?: number }> {
  return markdownInlineLinks(content).flatMap((link) => {
    const target = decodedTarget(link.target).split(/[?#]/u, 1)[0] ?? "";
    const normalized = posixPath(target);
    if (!/(?:^|\/)assets\/(?:[^/]+\/)?materialized\//u.test(normalized)) return [];
    return [{ target: link.target, ...(link.line === undefined ? {} : { line: link.line }) }];
  });
}

async function walkFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files;
}

export async function removeOrphanKnowledgeAssets(
  projectRoot: string,
  currentReferences?: ReadonlySet<string>,
): Promise<string[]> {
  const knowledgeRoot = join(projectRoot, "knowledge");
  const assetRoot = join(knowledgeRoot, "assets");
  if (!existsSync(assetRoot)) return [];
  const referenced = new Set(currentReferences ?? []);
  if (currentReferences === undefined) {
    for (const path of await walkFiles(knowledgeRoot)) {
      if (!isApprovedKnowledgeMarkdownPath(relative(knowledgeRoot, path)) || path.startsWith(`${assetRoot}${sep}`)) continue;
      const relPath = posixPath(relative(projectRoot, path));
      const content = await readFile(path, "utf8");
      for (const ref of knowledgeAssetReferences({ pageRelPath: relPath, content })) referenced.add(ref);
    }
  }
  const removed: string[] = [];
  for (const path of await walkFiles(assetRoot)) {
    const relPath = posixPath(relative(projectRoot, path));
    if (referenced.has(relPath)) continue;
    await rm(path, { force: true });
    removed.push(relPath);
  }
  return removed.sort();
}

export function resolveKnowledgeAssetPath(projectRoot: string, pageRelPath: string, target: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("#")) return undefined;
  const absolute = resolve(projectRoot, dirname(pageRelPath), decodedTarget(target));
  const root = resolve(projectRoot, "knowledge", "assets");
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) return undefined;
  return absolute;
}
