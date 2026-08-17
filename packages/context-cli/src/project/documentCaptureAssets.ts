import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { computeDocumentContentHash, normalizeSnapshotRelativePath, type DocumentSnapshotManifest } from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
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

function runtimeError(message: string, detail: Record<string, unknown>): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

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

function linkedAssetSnapshotPath(documentPath: string, target: string): string | undefined {
  const decoded = decodedAssetTarget(target);
  if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.startsWith("#") || decoded.startsWith("/")) return undefined;
  const normalized = normalizeSnapshotRelativePath(toPosixPath(join(dirname(documentPath), decoded)));
  return normalized === "assets" || normalized.startsWith("assets/") ? normalized : undefined;
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

export async function readLinkedCaptureAssets(input: {
  files: AssetSourceFile[];
  localRoot: string;
  sourceName: string;
}): Promise<SourceCaptureAsset[]> {
  const rootStat = await stat(input.localRoot);
  const boundaryRoot = rootStat.isFile() ? dirname(input.localRoot) : input.localRoot;
  const bySnapshotPath = new Map<string, SourceCaptureAsset>();
  for (const file of input.files) {
    const markdown = await readFile(file.absolutePath, "utf8");
    for (const link of markdownInlineLinks(markdown)) {
      const snapshotPath = linkedAssetSnapshotPath(file.snapshotPath, link.target);
      if (snapshotPath === undefined) continue;
      const absolutePath = resolve(dirname(file.absolutePath), decodedAssetTarget(link.target));
      if (!isWithinPath(boundaryRoot, absolutePath)) {
        throw runtimeError(`file source ${input.sourceName} asset escapes the source boundary: ${link.target}`, {
          sourceName: input.sourceName,
          path: link.target,
          next: "Move the asset under the file source boundary or replace the Markdown link with an external URL.",
        });
      }
      let bytes: Uint8Array;
      try {
        const assetStat = await stat(absolutePath);
        if (!assetStat.isFile()) throw new TypeError("asset target is not a file");
        bytes = await readFile(absolutePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw runtimeError(`file source ${input.sourceName} linked asset is unreadable: ${link.target}: ${message}`, {
          sourceName: input.sourceName,
          path: link.target,
          next: `Restore the linked asset or update the Markdown before rerunning context run capture:file:${input.sourceName}`,
        });
      }
      const contentHash = computeDocumentContentHash(bytes);
      const previous = bySnapshotPath.get(snapshotPath);
      if (previous !== undefined && previous.contentHash !== contentHash) {
        throw runtimeError(`file source ${input.sourceName} maps different assets to the same snapshot path: ${snapshotPath}`, {
          sourceName: input.sourceName,
          path: snapshotPath,
          next: "Use distinct relative asset paths in the source documents.",
        });
      }
      bySnapshotPath.set(snapshotPath, { absolutePath, snapshotPath, bytes, contentHash });
    }
  }
  return [...bySnapshotPath.values()].sort((left, right) => left.snapshotPath.localeCompare(right.snapshotPath));
}

export function fileSnapshotLinkedAssetMismatchDiagnostic(input: {
  projectRoot: string;
  materializedAt: string;
  manifest: DocumentSnapshotManifest;
}): string | null {
  const expected = new Set<string>();
  for (const file of input.manifest.files) {
    let markdown: string;
    try {
      markdown = readFileSync(join(input.projectRoot, input.materializedAt, file.path), "utf8");
    } catch {
      continue;
    }
    for (const link of markdownInlineLinks(markdown)) {
      const path = linkedAssetSnapshotPath(file.path, link.target);
      if (path !== undefined) expected.add(path);
    }
  }
  const captured = new Set((input.manifest.assets ?? [])
    .filter((asset) => asset.source?.kind === "file")
    .map((asset) => asset.path));
  const missing = [...expected].filter((path) => !captured.has(path)).sort()[0];
  if (missing !== undefined) return `snapshot linked asset is stale: manifest is missing ${missing}`;
  const stale = [...captured].filter((path) => !expected.has(path)).sort()[0];
  if (stale !== undefined) return `snapshot linked asset is stale: manifest still registers ${stale}`;
  return null;
}
