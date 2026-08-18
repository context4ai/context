import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PackageAssetDefinition, PackageAssetOptimizationDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { PackageAssetFile } from "./packageAssets.js";

export const PACKAGE_ASSET_OPTIMIZATION_THRESHOLD_BYTES = 20 * 1024 * 1024;

export type PackageAssetOptimizationState =
  | "not-needed"
  | "recommended"
  | "applied"
  | "configured-no-benefit";

export interface PackageAssetOptimizationSummary {
  state: PackageAssetOptimizationState;
  candidateFiles: number;
  originalBytes: number;
  outputBytes: number;
  savedBytes: number;
  thresholdBytes: number;
  processor?: "sharp";
  mode?: "lossless-webp" | "webp";
  reasonCode?: "package.assets.optimization-recommended";
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

type SharpFactory = (bytes: Uint8Array, options: { failOn: "error" }) => SharpPipeline;

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isOptimizablePackageImage(asset: PackageAssetFile): boolean {
  const extension = extname(asset.packageRelPath).toLowerCase();
  if (extension === ".png") return isPng(asset.bytes);
  if (extension === ".jpg" || extension === ".jpeg") return isJpeg(asset.bytes);
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

async function loadSharpProcessor(projectRoot: string): Promise<PackageImageProcessor> {
  const requireFromWorkspace = createRequire(join(projectRoot, "package.json"));
  let resolved: string;
  try {
    resolved = requireFromWorkspace.resolve("sharp");
  } catch {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "configured package asset optimizer is not installed in this Context workspace",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-missing",
        processor: "sharp",
        next: "Run bun add -D sharp in the Context workspace, then rerun context build.",
      },
    );
  }
  const imported = await import(pathToFileURL(resolved).href) as {
    default?: SharpFactory;
  } & Partial<SharpFactory>;
  const sharp = imported.default ?? imported;
  if (typeof sharp !== "function") {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "the workspace sharp package does not expose a compatible image processor",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-invalid",
        processor: "sharp",
        next: "Install a current sharp package in the Context workspace, then rerun context build.",
      },
    );
  }
  return {
    async optimize(bytes, definition) {
      let pipeline = sharp(bytes, { failOn: "error" }).rotate();
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
  projectRoot: string,
  definition: PackageAssetDefinition | undefined,
): Promise<PackageImageProcessor | undefined> {
  if (definition?.delivery !== "bundle" || definition.optimize === undefined) return undefined;
  return loadSharpProcessor(projectRoot);
}

export async function optimizePackageAssetFiles(input: {
  projectRoot: string;
  assets: readonly PackageAssetFile[];
  definition?: PackageAssetOptimizationDefinition;
  thresholdBytes?: number;
  processor?: PackageImageProcessor;
}): Promise<PackageAssetOptimizationResult> {
  const thresholdBytes = input.thresholdBytes ?? PACKAGE_ASSET_OPTIMIZATION_THRESHOLD_BYTES;
  const candidates = input.assets.filter(isOptimizablePackageImage);
  const originalBytes = candidates.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  if (input.definition === undefined) {
    const recommended = originalBytes > thresholdBytes;
    return {
      assets: [...input.assets],
      optimizedTargetByOriginal: new Map(),
      summary: {
        state: recommended ? "recommended" : "not-needed",
        candidateFiles: candidates.length,
        originalBytes,
        outputBytes: originalBytes,
        savedBytes: 0,
        thresholdBytes,
        ...(recommended
          ? { reasonCode: "package.assets.optimization-recommended" as const }
          : {}),
      },
    };
  }

  const processor = input.processor ?? await loadSharpProcessor(input.projectRoot);
  const optimizedByInputPath = new Map<string, PackageAssetFile>();
  const optimizedTargetByOriginal = new Map<string, string>();
  for (const asset of candidates) {
    const output = await processor.optimize(asset.bytes, input.definition);
    if (!isWebp(output)) {
      throw new ContextError(ExitCode.WorkspaceStateError, "package asset optimizer returned invalid WebP bytes", {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package.assets.optimizer-output-invalid",
        path: asset.packageRelPath,
        next: "Repair or update the configured sharp installation, then rerun context build.",
      });
    }
    if (output.byteLength >= asset.bytes.byteLength) continue;
    const packageRelPath = contentAddressedWebpPath(asset, output);
    optimizedByInputPath.set(asset.packageRelPath, { ...asset, packageRelPath, bytes: output });
    optimizedTargetByOriginal.set(asset.packageRelPath, packageRelPath);
  }

  const assets = input.assets.map((asset) => optimizedByInputPath.get(asset.packageRelPath) ?? asset);
  const outputBytes = candidates.reduce((sum, asset) =>
    sum + (optimizedByInputPath.get(asset.packageRelPath)?.bytes.byteLength ?? asset.bytes.byteLength), 0);
  return {
    assets,
    optimizedTargetByOriginal,
    summary: {
      state: optimizedByInputPath.size > 0 ? "applied" : "configured-no-benefit",
      candidateFiles: candidates.length,
      originalBytes,
      outputBytes,
      savedBytes: originalBytes - outputBytes,
      thresholdBytes,
      processor: "sharp",
      mode: input.definition.mode ?? "lossless-webp",
    },
  };
}
