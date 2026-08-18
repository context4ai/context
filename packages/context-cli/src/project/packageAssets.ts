import { readFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { packageKnowledgeOutputPath } from "./packageDistribution.js";
import { resolveKnowledgeAssetPath } from "./knowledgeAssets.js";
import {
  markdownInlineLinks,
  replaceMarkdownInlineLinkTargets,
} from "./markdownLinks.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";

export interface PackageAssetFile {
  knowledgeRelPath: string;
  packageRelPath: string;
  bytes: Uint8Array;
}

export interface PackageKnowledgeWithAssets {
  pageOutputPath: string;
  content: string;
  assets: PackageAssetFile[];
}

function posixPath(value: string): string {
  return value.split(sep).join("/");
}

function decodedTarget(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function packageAssetPath(projectRoot: string, absolute: string): { knowledgeRelPath: string; packageRelPath: string } {
  const knowledgeRelPath = posixPath(relative(projectRoot, absolute));
  const prefix = "knowledge/assets/";
  if (!knowledgeRelPath.startsWith(prefix)) throw new TypeError(`knowledge asset is outside ${prefix}: ${knowledgeRelPath}`);
  return {
    knowledgeRelPath,
    packageRelPath: `others/assets/${knowledgeRelPath.slice(prefix.length)}`,
  };
}

export function packageMarkdownTarget(pageOutputPath: string, assetOutputPath: string): string {
  const target = posixPath(relative(dirname(pageOutputPath), assetOutputPath));
  return target.startsWith(".") ? target : `./${target}`;
}

export async function projectPackageKnowledgeAssets(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  file: ApprovedKnowledgeFile;
  content: string;
  linkFromPath?: string;
}): Promise<PackageKnowledgeWithAssets> {
  const pageRelPath = `knowledge/${input.file.relPath}`;
  const pageOutputPath = packageKnowledgeOutputPath(input.pkg, input.file.relPath);
  const assetsBySource = new Map<string, PackageAssetFile>();
  const replacements = new Map<string, string>();
  for (const link of markdownInlineLinks(input.content)) {
    const target = link.target;
    const absolute = resolveKnowledgeAssetPath(input.projectRoot, pageRelPath, decodedTarget(target));
    if (absolute === undefined) continue;
    const paths = packageAssetPath(input.projectRoot, absolute);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(absolute);
    } catch {
      throw new ContextError(ExitCode.WorkspaceStateError, `knowledge resource is missing: ${paths.knowledgeRelPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        reason_code: "package/resource-file-missing",
        path: paths.knowledgeRelPath,
        next: "Rerun Review apply or restore knowledge/assets before building the package.",
      });
    }
    assetsBySource.set(paths.knowledgeRelPath, { ...paths, bytes });
    replacements.set(target, packageMarkdownTarget(input.linkFromPath ?? pageOutputPath, paths.packageRelPath));
  }
  const content = replaceMarkdownInlineLinkTargets(input.content, (link) => {
    return replacements.get(link.target);
  });
  return { pageOutputPath, content, assets: [...assetsBySource.values()] };
}
