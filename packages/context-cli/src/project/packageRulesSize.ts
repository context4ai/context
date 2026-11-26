import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PACKAGE_RULE_LIMITS, type PackageDefinition } from "@c4a/context";
import { walkPackageFiles } from "./packageBuildReceipt.js";
import { inspectSdkAlignment, type SdkAlignment } from "./sdkAlignment.js";

export type PackageRulesReport = {
  total_kb: number;
  limits: { fileKb: number; totalKb: number };
  files: Array<{ path: string; kb: number; always_apply: boolean }>;
  oversized: string[];
  total_exceeded: boolean;
  message: string;
  next_action: { file: string; instruction: string };
  /** The workspace SDK is older than the CLI; SDKs before `rules` existed drop the option silently. */
  version_alignment?: SdkAlignment;
};

const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;

/** Sizes of the package's `rules/` files, directory index pages excluded. Reported only when a
 * limit is exceeded. The build never changes or blocks the package because of it: which articles
 * are rules is the author's decision, made in the package declaration. */
export async function inspectPackageRules(projectRoot: string, pkg: PackageDefinition): Promise<PackageRulesReport | undefined> {
  if (pkg.kind !== "package.kb") return undefined;
  const limits = { ...DEFAULT_PACKAGE_RULE_LIMITS, ...pkg.rules?.limits };
  const files: PackageRulesReport["files"] = [];
  let total = 0;
  for (const file of await walkPackageFiles(join(projectRoot, pkg.outDir, "rules"))) {
    if (!/\.mdx?$/iu.test(file.relPath)) continue;
    const content = await readFile(file.absPath, "utf8");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1] ?? "";
    if (/^type:\s*["']?Knowledge Directory["']?\s*$/mu.test(frontmatter)) continue;
    const bytes = Buffer.byteLength(content);
    total += bytes;
    files.push({ path: `rules/${file.relPath}`, kb: kb(bytes), always_apply: /^alwaysApply:\s*true\s*$/mu.test(frontmatter) });
  }
  const oversized = files.filter(file => file.kb > limits.fileKb).map(file => file.path);
  const totalKb = kb(total);
  if (oversized.length === 0 && totalKb <= limits.totalKb) return undefined;
  const alignment = await inspectSdkAlignment(projectRoot);
  const instruction = "Read the listed rule articles and decide with the user which are binding rules: keep those short and list the ones every session needs in the package's rules.alwaysApply; move reference material (dictionaries, tables, methodology) to guides/ with rules.exclude. Adjust rules.limits if larger rules are intended. Then rebuild.";
  return {
    total_kb: totalKb,
    limits,
    files: files.sort((left, right) => right.kb - left.kb),
    oversized,
    total_exceeded: totalKb > limits.totalKb,
    message: `Package rules total ${totalKb} KB${oversized.length ? `; ${oversized.length} file(s) exceed ${limits.fileKb} KB` : ""}. AI tools may load package rules into every session.`,
    next_action: {
      file: "src/index.ts",
      instruction: alignment
        ? `First upgrade the workspace SDK as version_alignment describes: an older SDK ignores the rules option. ${instruction}`
        : instruction,
    },
    ...(alignment ? { version_alignment: alignment } : {}),
  };
}
