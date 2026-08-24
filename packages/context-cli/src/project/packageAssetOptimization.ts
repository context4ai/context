import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, extname } from "node:path";
import type { PackageAssetDefinition, PackageAssetOptimizationDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { PackageAssetFile } from "./packageAssets.js";

export const PACKAGE_ASSET_MAX_IMAGE_BYTES = 1 * 1024 * 1024;
export const PACKAGE_ASSET_MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

const DEFAULT_OPTIMIZATION_PROFILES: readonly PackageAssetOptimizationDefinition[] = [
  { processor: "sharp", mode: "webp", quality: 86, maxDimension: 2560 },
  { processor: "sharp", mode: "webp", quality: 80, maxDimension: 2200 },
  { processor: "sharp", mode: "webp", quality: 74, maxDimension: 1920 },
  { processor: "sharp", mode: "webp", quality: 66, maxDimension: 1600 },
  { processor: "sharp", mode: "webp", quality: 56, maxDimension: 1280 },
];

export type PackageAssetOptimizationState =
  | "not-needed"
  | "applied"
  | "configured-no-benefit";

export interface PackageAssetOptimizationSummary {
  state: PackageAssetOptimizationState;
  candidateFiles: number;
  originalBytes: number;
  outputBytes: number;
  savedBytes: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
  largestOutputBytes: number;
  processor?: "sharp";
  mode?: "lossless-webp" | "webp";
}

export interface PackageAssetOptimizationResult {
  assets: PackageAssetFile[];
  optimizedTargetByOriginal: ReadonlyMap<string, string>;
  summary: PackageAssetOptimizationSummary;
}

export interface PackageImageProcessor {
  optimize(
    bytes: Uint8Array,
    definition: PackageAssetOptimizationDefinition,
  ): Promise<Uint8Array>;
}

type SharpPipeline = {
  rotate(): SharpPipeline;
  resize(options: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }): SharpPipeline;
  webp(options: {
    effort: number;
    lossless?: boolean;
    quality?: number;
  }): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
};

type SharpFactory = (bytes: Uint8Array, options: { failOn: "error"; animated: true }) => SharpPipeline;

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 6) return false;
  const signature = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
  return signature === "GIF87a" || signature === "GIF89a";
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const box = Buffer.from(bytes.subarray(4, 12)).toString("ascii");
  return box === "ftypavif" || box === "ftypavis";
}

function isTiff(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  );
}

function isBmp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function isSvg(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).toString("utf8")
    .replace(/^\uFEFF/u, "")
    .trimStart();
  return prefix.startsWith("<svg") || (/^<\?xml\b/u.test(prefix) && /<svg\b/u.test(prefix));
}

export function isOptimizablePackageImage(asset: PackageAssetFile): boolean {
  const extension = extname(asset.packageRelPath).toLowerCase();
  if (extension === ".png") return isPng(asset.bytes);
  if (extension === ".jpg" || extension === ".jpeg") return isJpeg(asset.bytes);
  if (extension === ".webp") return isWebp(asset.bytes);
  if (extension === ".gif") return isGif(asset.bytes);
  if (extension === ".avif") return isAvif(asset.bytes);
  if (extension === ".tif" || extension === ".tiff") return isTiff(asset.bytes);
  if (extension === ".bmp") return isBmp(asset.bytes);
  if (extension === ".svg") return isSvg(asset.bytes);
  return false;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
}

function contentAddressedWebpPath(asset: PackageAssetFile, bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${dirname(asset.packageRelPath)}/${digest}.webp`;
}

async function loadSharpProcessor(): Promise<PackageImageProcessor> {
  const requireFromCli = createRequire(import.meta.url);
  let resolved: string;
  try {
    resolved = requireFromCli.resolve("sharp");
  } catch {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "Context CLI image support is unavailable",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-missing",
        processor: "sharp",
        next: "Reinstall or repair Context CLI, then rerun context build.",
      },
    );
  }
  const imported = await import(resolved) as {
    default?: SharpFactory;
  } & Partial<SharpFactory>;
  const sharp = imported.default ?? imported;
  if (typeof sharp !== "function") {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "Context CLI image support is incompatible",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-invalid",
        processor: "sharp",
        next: "Update or reinstall Context CLI, then rerun context build.",
      },
    );
  }
  return {
    async optimize(bytes, definition) {
      let pipeline = sharp(bytes, { failOn: "error", animated: true }).rotate();
      if (definition.maxDimension !== undefined) {
        pipeline = pipeline.resize({
          width: definition.maxDimension,
          height: definition.maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      pipeline = pipeline.webp(definition.mode === "webp"
        ? { effort: 6, quality: definition.quality ?? 85 }
        : { effort: 6, lossless: true });
      return pipeline.toBuffer();
    },
  };
}

export async function resolvePackageImageProcessor(
  _projectRoot: string,
  definition: PackageAssetDefinition | undefined,
): Promise<PackageImageProcessor | undefined> {
  if (definition?.delivery !== "bundle" || definition.optimize === undefined) return undefined;
  return loadSharpProcessor();
}

interface ImageVariant {
  bytes: Uint8Array;
  definition?: PackageAssetOptimizationDefinition;
}

async function adaptiveVariants(input: {
  asset: PackageAssetFile;
  processor: PackageImageProcessor;
  definitions: readonly PackageAssetOptimizationDefinition[];
}): Promise<ImageVariant[]> {
  const variants: ImageVariant[] = [{ bytes: input.asset.bytes }];
  let smallest = input.asset.bytes.byteLength;
  for (const definition of input.definitions) {
    const output = await input.processor.optimize(input.asset.bytes, definition);
    if (!isWebp(output)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "package asset optimizer returned invalid WebP bytes", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-output-invalid",
        path: input.asset.packageRelPath,
        next: "Repair or update Context CLI, then rerun context build.",
      });
    }
    if (output.byteLength >= smallest) continue;
    variants.push({ bytes: output, definition });
    smallest = output.byteLength;
  }
  return variants;
}

function budgetError(input: {
  outputBytes: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
  oversized: readonly PackageAssetFile[];
}): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, "bundled images cannot meet the package size budget", {
    category: ErrorCategory.WorkspaceStateInvalid,
    reason_code: "package.assets.image-budget-exceeded",
    output_bytes: input.outputBytes,
    max_image_bytes: input.maxImageBytes,
    max_total_image_bytes: input.maxTotalImageBytes,
    oversized_paths: input.oversized.map((asset) => asset.packageRelPath),
    next: "Reduce or replace the reported source images, then rerun context build.",
  });
}

export async function optimizePackageAssetFiles(input: {
  projectRoot: string;
  assets: readonly PackageAssetFile[];
  definition?: PackageAssetOptimizationDefinition;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  processor?: PackageImageProcessor;
}): Promise<PackageAssetOptimizationResult> {
  const maxImageBytes = input.maxImageBytes ?? PACKAGE_ASSET_MAX_IMAGE_BYTES;
  const maxTotalImageBytes = input.maxTotalImageBytes ?? PACKAGE_ASSET_MAX_TOTAL_IMAGE_BYTES;
  const candidates = input.assets.filter(isOptimizablePackageImage);
  const originalBytes = candidates.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  const needsBudgeting = candidates.some((asset) => asset.bytes.byteLength > maxImageBytes) ||
    originalBytes > maxTotalImageBytes;
  if (input.definition === undefined && !needsBudgeting) {
    return {
      assets: [...input.assets],
      optimizedTargetByOriginal: new Map(),
      summary: {
        state: "not-needed",
        candidateFiles: candidates.length,
        originalBytes,
        outputBytes: originalBytes,
        savedBytes: 0,
        maxImageBytes,
        maxTotalImageBytes,
        largestOutputBytes: Math.max(0, ...candidates.map((asset) => asset.bytes.byteLength)),
      },
    };
  }

  const processor = input.processor ?? await loadSharpProcessor();
  const definitions = input.definition === undefined ? DEFAULT_OPTIMIZATION_PROFILES : [input.definition];
  const variantsByPath = new Map<string, ImageVariant[]>();
  for (const asset of candidates) {
    variantsByPath.set(asset.packageRelPath, await adaptiveVariants({ asset, processor, definitions }));
  }

  const selectedIndex = new Map<string, number>();
  for (const asset of candidates) {
    const variants = variantsByPath.get(asset.packageRelPath)!;
    let index = input.definition !== undefined && variants.length > 1 ? 1 : 0;
    if (asset.bytes.byteLength > maxImageBytes) {
      const fitting = variants.findIndex((variant) => variant.bytes.byteLength <= maxImageBytes);
      if (fitting < 0) {
        throw budgetError({ outputBytes: originalBytes, maxImageBytes, maxTotalImageBytes, oversized: [asset] });
      }
      index = fitting;
    }
    selectedIndex.set(asset.packageRelPath, index);
  }

  const selectedBytes = (asset: PackageAssetFile): Uint8Array => {
    const variants = variantsByPath.get(asset.packageRelPath)!;
    return variants[selectedIndex.get(asset.packageRelPath) ?? 0]!.bytes;
  };
  let outputBytes = candidates.reduce((sum, asset) => sum + selectedBytes(asset).byteLength, 0);
  while (outputBytes > maxTotalImageBytes) {
    let best: { asset: PackageAssetFile; nextIndex: number; saving: number } | undefined;
    for (const asset of candidates) {
      const variants = variantsByPath.get(asset.packageRelPath)!;
      const currentIndex = selectedIndex.get(asset.packageRelPath) ?? 0;
      const nextIndex = currentIndex + 1;
      const next = variants[nextIndex];
      if (next === undefined) continue;
      const saving = variants[currentIndex]!.bytes.byteLength - next.bytes.byteLength;
      if (best === undefined || saving > best.saving) best = { asset, nextIndex, saving };
    }
    if (best === undefined) {
      throw budgetError({ outputBytes, maxImageBytes, maxTotalImageBytes, oversized: [] });
    }
    selectedIndex.set(best.asset.packageRelPath, best.nextIndex);
    outputBytes -= best.saving;
  }

  const optimizedByInputPath = new Map<string, PackageAssetFile>();
  const optimizedTargetByOriginal = new Map<string, string>();
  for (const asset of candidates) {
    const output = selectedBytes(asset);
    if (output.byteLength >= asset.bytes.byteLength) continue;
    const packageRelPath = contentAddressedWebpPath(asset, output);
    optimizedByInputPath.set(asset.packageRelPath, { ...asset, packageRelPath, bytes: output });
    optimizedTargetByOriginal.set(asset.packageRelPath, packageRelPath);
  }

  const assets = input.assets.map((asset) => optimizedByInputPath.get(asset.packageRelPath) ?? asset);
  outputBytes = candidates.reduce((sum, asset) =>
    sum + (optimizedByInputPath.get(asset.packageRelPath)?.bytes.byteLength ?? asset.bytes.byteLength), 0);
  const largestOutputBytes = Math.max(0, ...candidates.map((asset) =>
    optimizedByInputPath.get(asset.packageRelPath)?.bytes.byteLength ?? asset.bytes.byteLength));
  return {
    assets,
    optimizedTargetByOriginal,
    summary: {
      state: optimizedByInputPath.size > 0 ? "applied" : "configured-no-benefit",
      candidateFiles: candidates.length,
      originalBytes,
      outputBytes,
      savedBytes: originalBytes - outputBytes,
      maxImageBytes,
      maxTotalImageBytes,
      largestOutputBytes,
      processor: "sharp",
      mode: input.definition?.mode ?? "webp",
    },
  };
}
