import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  computeDocumentContentHash,
  normalizeSnapshotRelativePath,
  type DocumentCaptureAssetGap,
  type DocumentSnapshotManifest,
} from "@c4a/extract";
import type { FileSourceLayout } from "@c4a/context";
import { markdownInlineLinks } from "./markdownLinks.js";

interface AssetSourceFile {
  absolutePath: string;
  snapshotPath: string;
}

export interface SourceCaptureAsset {
  absolutePath: string;
  snapshotPath: string;
  bytes: Uint8Array;
  contentHash: string;
}

/** Linked files a `tree` capture keeps beside the documents; larger media stays a link only. */
const TREE_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico",
  ".json", ".yaml", ".yml", ".csv",
]);
export const MAX_CAPTURE_ASSET_BYTES = 5 * 1024 * 1024;

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).filter((part) => part.length > 0).join("/");
}

function decodedAssetTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWithinPath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/u)[0] !== "..");
}

function linkedAssetSnapshotPath(documentPath: string, target: string, layout: FileSourceLayout = "flat"): string | undefined {
  const decoded = decodedAssetTarget(target).replace(/[?#].*$/u, "");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.length === 0 || decoded.startsWith("/")) return undefined;
  const joined = join(dirname(documentPath), decoded);
  if (joined.split(/[\\/]/u)[0] === "..") return undefined;
  const candidate = toPosixPath(joined);
  if (layout === "tree") {
    if (!TREE_ASSET_EXTENSIONS.has(extname(candidate).toLowerCase())) return undefined;
  } else if (candidate !== "assets" && !candidate.startsWith("assets/")) {
    return undefined;
  }
  try {
    return normalizeSnapshotRelativePath(candidate);
  } catch {
    return undefined;
  }
}

export async function writeCaptureAssetIfChanged(path: string, content: Uint8Array): Promise<void> {
  try {
    const current = await readFile(path);
    if (current.byteLength === content.byteLength && current.equals(content)) return;
  } catch {
    // Missing or unreadable target will be overwritten below.
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export interface LinkedCaptureAssets {
  assets: SourceCaptureAsset[];
  /** Links that were not captured; capture continues and the link stays as written. */
  gaps: DocumentCaptureAssetGap[];
}

export async function readLinkedCaptureAssets(input: {
  files: AssetSourceFile[];
  localRoot: string;
  sourceName: string;
  layout?: FileSourceLayout;
  /** Snapshot paths already taken by documents or the manifest; links to them are not assets. */
  reservedPaths?: ReadonlySet<string>;
}): Promise<LinkedCaptureAssets> {
  const layout = input.layout ?? "flat";
  const rootStat = await stat(input.localRoot);
  const boundaryRoot = await realpath(rootStat.isFile() ? dirname(input.localRoot) : input.localRoot);
  const bySnapshotPath = new Map<string, SourceCaptureAsset>();
  const gaps = new Map<string, DocumentCaptureAssetGap>();
  const addGap = (gap: DocumentCaptureAssetGap): void => {
    gaps.set(`${gap.document}\0${gap.target}`, gap);
  };
  for (const file of input.files) {
    const markdown = await readFile(file.absolutePath, "utf8");
    for (const link of markdownInlineLinks(markdown)) {
      const target = decodedAssetTarget(link.target).replace(/[?#].*$/u, "");
      const absolutePath = resolve(dirname(file.absolutePath), target);
      const snapshotPath = linkedAssetSnapshotPath(file.snapshotPath, link.target, layout);
      if (snapshotPath === undefined) {
        // In a flat snapshot only assets/ links are kept; tree snapshots report links that leave the source.
        if (layout === "tree" && !/^[a-z][a-z0-9+.-]*:/iu.test(target) && target.length > 0 && !target.startsWith("/") &&
          TREE_ASSET_EXTENSIONS.has(extname(target).toLowerCase())) {
          addGap({ document: file.snapshotPath, target: link.target, reason: "outside" });
        }
        continue;
      }
      if (input.reservedPaths?.has(snapshotPath) === true) continue;
      let resolvedPath: string;
      try {
        // Resolve symbolic links so a link inside the source cannot copy a file from outside it.
        resolvedPath = await realpath(absolutePath);
      } catch {
        addGap({ document: file.snapshotPath, target: link.target, path: snapshotPath, reason: "missing" });
        continue;
      }
      if (!isWithinPath(boundaryRoot, resolvedPath)) {
        addGap({ document: file.snapshotPath, target: link.target, path: snapshotPath, reason: "outside" });
        continue;
      }
      let bytes: Uint8Array;
      try {
        const assetStat = await stat(resolvedPath);
        if (!assetStat.isFile()) throw new TypeError("asset target is not a file");
        if (assetStat.size > MAX_CAPTURE_ASSET_BYTES) {
          addGap({ document: file.snapshotPath, target: link.target, path: snapshotPath, reason: "too-large" });
          continue;
        }
        bytes = await readFile(resolvedPath);
      } catch {
        addGap({ document: file.snapshotPath, target: link.target, path: snapshotPath, reason: "missing" });
        continue;
      }
      const contentHash = computeDocumentContentHash(bytes);
      const previous = bySnapshotPath.get(snapshotPath);
      if (previous !== undefined && previous.contentHash !== contentHash) {
        addGap({ document: file.snapshotPath, target: link.target, reason: "conflict" });
        continue;
      }
      bySnapshotPath.set(snapshotPath, { absolutePath, snapshotPath, bytes, contentHash });
    }
  }
  return {
    assets: [...bySnapshotPath.values()].sort((left, right) => left.snapshotPath.localeCompare(right.snapshotPath)),
    gaps: [...gaps.values()].sort((left, right) =>
      left.document.localeCompare(right.document) || left.target.localeCompare(right.target)),
  };
}

/** One readable line per gap for capture diagnostics. */
export function captureAssetGapDiagnostics(sourceName: string, gaps: readonly DocumentCaptureAssetGap[]): string[] {
  if (gaps.length === 0) return [];
  const sample = gaps.slice(0, 5).map((gap) => `${gap.document} -> ${gap.target} (${gap.reason})`).join("; ");
  return [`file source ${sourceName} kept ${gaps.length} linked asset(s) as links only: ${sample}${gaps.length > 5 ? "; ..." : ""}`];
}

export function fileSnapshotLinkedAssetMismatchDiagnostic(input: {
  projectRoot: string;
  materializedAt: string;
  manifest: DocumentSnapshotManifest;
}): string | null {
  const layout = input.manifest.metadata?.capture?.layout ?? "flat";
  const documentPaths = new Set(input.manifest.files.map((file) => file.path));
  const gapPaths = new Set((input.manifest.metadata?.capture?.assetGaps ?? []).flatMap((gap) => gap.path === undefined ? [] : [gap.path]));
  const captured = new Set((input.manifest.assets ?? [])
    .filter((asset) => asset.source?.kind === "file")
    .map((asset) => asset.path));
  const expected = new Set<string>();
  for (const file of input.manifest.files) {
    let markdown: string;
    try {
      markdown = readFileSync(join(input.projectRoot, input.materializedAt, file.path), "utf8");
    } catch {
      continue;
    }
    for (const link of markdownInlineLinks(markdown)) {
      const path = linkedAssetSnapshotPath(file.path, link.target, layout);
      if (path === undefined || documentPaths.has(path) || path === "manifest.json") continue;
      // A recorded gap excuses only a path that was not captured through another link.
      if (gapPaths.has(path) && !captured.has(path)) continue;
      expected.add(path);
    }
  }
  const missing = [...expected].filter((path) => !captured.has(path)).sort()[0];
  if (missing !== undefined) return `snapshot linked asset is stale: manifest is missing ${missing}`;
  const stale = [...captured].filter((path) => !expected.has(path)).sort()[0];
  if (stale !== undefined) return `snapshot linked asset is stale: manifest still registers ${stale}`;
  return null;
}
