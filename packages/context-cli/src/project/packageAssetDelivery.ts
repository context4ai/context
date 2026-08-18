import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { PackageAssetDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { PackageAssetFile } from "./packageAssets.js";
import {
  optimizePackageAssetFiles,
  type PackageAssetOptimizationSummary,
  type PackageImageProcessor,
} from "./packageAssetOptimization.js";

const execFileAsync = promisify(execFile);

export type PackageAssetDeliveryState = "bundled" | "git-raw" | "omitted";

export interface PackageAssetDeliverySummary {
  state: PackageAssetDeliveryState;
  sourceFiles: number;
  sourceBytes: number;
  outputFiles: number;
  outputBytes: number;
  optimization?: PackageAssetOptimizationSummary;
  git?: {
    remote?: string;
    commit?: string;
    urlPrefix: string;
  };
  reasonCode?: "package.assets.omitted-with-unresolved-links";
}

export interface PackageAssetDeliveryResult {
  assets: PackageAssetFile[];
  targetByOriginal: ReadonlyMap<string, string>;
  summary: PackageAssetDeliverySummary;
}

export interface PackageAssetDeliveryFingerprintInput {
  state: "git-raw";
  git?: PackageAssetDeliverySummary["git"];
  targets: Array<[string, string]>;
}

async function git(projectRoot: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "").trim()
      : "";
    throw new ContextError(ExitCode.WorkspaceStateError, "Git raw asset delivery cannot resolve repository state", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package.assets.git-state-unavailable",
      detail: stderr || String(error),
      next: "Place the Context workspace in a Git repository, or choose assets.delivery=\"bundle\" or \"omit\".",
    });
  }
}

function repositoryPath(repoRoot: string, projectRoot: string, asset: PackageAssetFile): string {
  const path = relative(repoRoot, join(projectRoot, asset.knowledgeRelPath)).split(sep).join("/");
  if (path === ".." || path.startsWith("../") || path.startsWith("/")) {
    throw new ContextError(ExitCode.WorkspaceStateError, "knowledge asset is outside the current Git repository", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package.assets.git-path-outside-repository",
      path: asset.knowledgeRelPath,
      next: "Move the Context workspace into the repository, or choose assets.delivery=\"bundle\".",
    });
  }
  return path;
}

function githubRawPrefix(remoteUrl: string): string | undefined {
  const scp = /^(?:git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl);
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    return `https://raw.githubusercontent.com/${scp[1]}/${scp[2]}/{commit}`;
  }
  try {
    const url = new URL(remoteUrl);
    if (url.hostname !== "github.com") return undefined;
    const segments = url.pathname.replace(/^\//u, "").replace(/\.git$/u, "").split("/");
    if (segments.length !== 2 || segments[0] === undefined || segments[1] === undefined) return undefined;
    return `https://raw.githubusercontent.com/${segments[0]}/${segments[1]}/{commit}`;
  } catch {
    return undefined;
  }
}

function rawUrl(prefix: string, commit: string, path: string): string {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${prefix.replaceAll("{commit}", commit).replace(/\/+$/u, "")}/${encodedPath}`;
}

async function deliverFromGit(input: {
  projectRoot: string;
  assets: readonly PackageAssetFile[];
  definition: Extract<PackageAssetDefinition, { delivery: "git-raw" }>;
}): Promise<PackageAssetDeliveryResult> {
  if (input.assets.length === 0) {
    return {
      assets: [],
      targetByOriginal: new Map(),
      summary: { state: "git-raw", sourceFiles: 0, sourceBytes: 0, outputFiles: 0, outputBytes: 0 },
    };
  }
  if (input.definition.urlPrefix !== undefined && !input.definition.urlPrefix.includes("{commit}")) {
    const targetByOriginal = new Map<string, string>();
    for (const asset of input.assets) {
      targetByOriginal.set(
        asset.packageRelPath,
        rawUrl(input.definition.urlPrefix, "", asset.knowledgeRelPath),
      );
    }
    const sourceBytes = input.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
    return {
      assets: [],
      targetByOriginal,
      summary: {
        state: "git-raw",
        sourceFiles: input.assets.length,
        sourceBytes,
        outputFiles: 0,
        outputBytes: 0,
        git: { urlPrefix: input.definition.urlPrefix },
      },
    };
  }
  if (input.definition.urlPrefix !== undefined) {
    const commit = (await git(input.projectRoot, ["rev-parse", "HEAD"])).trim();
    const targetByOriginal = new Map<string, string>();
    for (const asset of input.assets) {
      targetByOriginal.set(
        asset.packageRelPath,
        rawUrl(input.definition.urlPrefix, commit, asset.knowledgeRelPath),
      );
    }
    const sourceBytes = input.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
    return {
      assets: [],
      targetByOriginal,
      summary: {
        state: "git-raw",
        sourceFiles: input.assets.length,
        sourceBytes,
        outputFiles: 0,
        outputBytes: 0,
        git: { commit, urlPrefix: input.definition.urlPrefix },
      },
    };
  }
  const repoRoot = await realpath((await git(input.projectRoot, ["rev-parse", "--show-toplevel"])).trim());
  const projectRoot = await realpath(input.projectRoot);
  const commit = (await git(input.projectRoot, ["rev-parse", "HEAD"])).trim();
  const remote = input.definition.remote ?? "origin";
  const remoteUrl = (await git(input.projectRoot, ["remote", "get-url", remote])).trim();
  const urlPrefix = githubRawPrefix(remoteUrl);
  if (urlPrefix === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, "Git remote has no known raw URL convention", {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package.assets.git-raw-url-unsupported",
      remote,
      remoteUrl,
      next: "Set assets.urlPrefix to the repository's HTTPS raw root, or choose bundle delivery.",
    });
  }
  const linkPaths = input.assets.map((asset) => repositoryPath(repoRoot, projectRoot, asset));
  const targetByOriginal = new Map<string, string>();
  input.assets.forEach((asset, index) => {
    const path = linkPaths[index];
    if (path !== undefined) targetByOriginal.set(asset.packageRelPath, rawUrl(urlPrefix, commit, path));
  });
  const sourceBytes = input.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  return {
    assets: [],
    targetByOriginal,
    summary: {
      state: "git-raw",
      sourceFiles: input.assets.length,
      sourceBytes,
      outputFiles: 0,
      outputBytes: 0,
      git: { remote, commit, urlPrefix },
    },
  };
}

export async function packageAssetDeliveryFingerprintInput(input: {
  projectRoot: string;
  assets: readonly PackageAssetFile[];
  definition?: PackageAssetDefinition;
}): Promise<PackageAssetDeliveryFingerprintInput | null> {
  if (input.definition?.delivery !== "git-raw" || input.assets.length === 0) return null;
  const delivery = await deliverFromGit({
    projectRoot: input.projectRoot,
    assets: input.assets,
    definition: input.definition,
  });
  return {
    state: "git-raw",
    ...(delivery.summary.git === undefined ? {} : { git: delivery.summary.git }),
    targets: [...delivery.targetByOriginal.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

export async function deliverPackageAssetFiles(input: {
  projectRoot: string;
  assets: readonly PackageAssetFile[];
  definition?: PackageAssetDefinition;
  processor?: PackageImageProcessor;
}): Promise<PackageAssetDeliveryResult> {
  if (input.definition?.delivery === "git-raw") {
    return deliverFromGit({ projectRoot: input.projectRoot, assets: input.assets, definition: input.definition });
  }
  const sourceBytes = input.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  if (input.definition?.delivery === "omit") {
    return {
      assets: [],
      targetByOriginal: new Map(),
      summary: {
        state: "omitted",
        sourceFiles: input.assets.length,
        sourceBytes,
        outputFiles: 0,
        outputBytes: 0,
        reasonCode: "package.assets.omitted-with-unresolved-links",
      },
    };
  }
  const optimization = await optimizePackageAssetFiles({
    projectRoot: input.projectRoot,
    assets: input.assets,
    ...(input.definition?.delivery === "bundle" && input.definition.optimize !== undefined
      ? { definition: input.definition.optimize }
      : {}),
    ...(input.processor === undefined ? {} : { processor: input.processor }),
  });
  const outputBytes = optimization.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  return {
    assets: optimization.assets,
    targetByOriginal: optimization.optimizedTargetByOriginal,
    summary: {
      state: "bundled",
      sourceFiles: input.assets.length,
      sourceBytes,
      outputFiles: optimization.assets.length,
      outputBytes,
      optimization: optimization.summary,
    },
  };
}
