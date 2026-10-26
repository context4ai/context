import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { inspectPackageTemplateReview, refreshStarterTemplateDigest } from "./packageTemplateReview.js";
import { resolveContextPackageTemplatesRoot } from "./workspace.js";

export const LEGACY_QUERY_SKILL = "knowledge-query";
export const QUERY_SKILL = "context-knowledge-query";
const SEARCH_GUIDE = "others/context/search-guide.md";

export interface QuerySkillMigration {
  packageName: string;
  templatePath: string;
  language: "en" | "zh-CN";
}

async function skillLanguage(skillRoot: string): Promise<"en" | "zh-CN"> {
  const skill = await readFile(join(skillRoot, "SKILL.md"), "utf8").catch(() => "");
  return /\p{Script=Han}/u.test(skill) ? "zh-CN" : "en";
}

function shippedKbRoot(language: "en" | "zh-CN"): string {
  const shippedRoot = resolveContextPackageTemplatesRoot();
  return join(language === "zh-CN" ? join(dirname(shippedRoot), "package-templates.zh-CN") : shippedRoot, "kb");
}

async function treeFiles(root: string): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Node before 20.12 names the directory `path` instead of `parentPath`.
    const parent = (entry as { parentPath?: string; path?: string }).parentPath ?? (entry as { path?: string }).path ?? root;
    const path = join(parent, entry.name);
    files.set(relative(root, path).split("\\").join("/"), await readFile(path, "utf8"));
  }
  return files;
}

async function sameTree(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([treeFiles(left), treeFiles(right)]);
  return a.size === b.size && [...a].every(([path, content]) => b.get(path) === content);
}

/**
 * Replace the retired `knowledge-query` Skill in a kb package template with the
 * shipped `context-knowledge-query` Skill, in the old Skill's language, and add
 * the package search guide when it is missing.
 */
export async function migrateLegacyQuerySkill(projectRoot: string, pkg: PackageDefinition): Promise<QuerySkillMigration | undefined> {
  if (pkg.kind !== "package.kb") return undefined;
  const templateRoot = resolve(projectRoot, pkg.template.path);
  const legacyRoot = join(templateRoot, "skills", LEGACY_QUERY_SKILL);
  if (!existsSync(legacyRoot)) return undefined;

  const reviewState = (await inspectPackageTemplateReview(projectRoot, pkg)).state;
  const starterUntouched = reviewState === "review-required" || reviewState === "starter-accepted";
  const language = await skillLanguage(legacyRoot);
  const shippedKb = shippedKbRoot(language);
  const target = join(templateRoot, "skills", QUERY_SKILL);

  await rm(legacyRoot, { recursive: true, force: true });
  if (!existsSync(target)) await cp(join(shippedKb, "skills", QUERY_SKILL), target, { recursive: true });
  const guideTarget = join(templateRoot, ...SEARCH_GUIDE.split("/"));
  if (!existsSync(guideTarget)) {
    await mkdir(dirname(guideTarget), { recursive: true });
    await cp(join(shippedKb, ...SEARCH_GUIDE.split("/")), guideTarget);
  }
  if (starterUntouched) await refreshStarterTemplateDigest(templateRoot);
  return { packageName: pkg.name, templatePath: pkg.template.path, language };
}

export async function migrateLegacyQuerySkills(
  projectRoot: string,
  packages: readonly PackageDefinition[],
): Promise<QuerySkillMigration[]> {
  const results: QuerySkillMigration[] = [];
  for (const pkg of packages) {
    const result = await migrateLegacyQuerySkill(projectRoot, pkg);
    if (result !== undefined) results.push(result);
  }
  return results;
}

/**
 * The shared query Skill is owned by the CLI: every Context package ships the
 * same copy, and a package manager keeps one copy per version. When a kb
 * template's `context-knowledge-query` differs from the shipped Skill in the
 * same language, replace it so the packaged Skill always matches the Context
 * version it declares. Package-specific hints belong in the search guide.
 */
export async function refreshSharedQuerySkill(projectRoot: string, pkg: PackageDefinition): Promise<QuerySkillMigration | undefined> {
  if (pkg.kind !== "package.kb") return undefined;
  const templateRoot = resolve(projectRoot, pkg.template.path);
  const target = join(templateRoot, "skills", QUERY_SKILL);
  if (!existsSync(target)) return undefined;
  const language = await skillLanguage(target);
  const shipped = join(shippedKbRoot(language), "skills", QUERY_SKILL);
  if (await sameTree(target, shipped)) return undefined;
  const reviewState = (await inspectPackageTemplateReview(projectRoot, pkg)).state;
  await rm(target, { recursive: true, force: true });
  await cp(shipped, target, { recursive: true });
  if (reviewState === "review-required" || reviewState === "starter-accepted") await refreshStarterTemplateDigest(templateRoot);
  return { packageName: pkg.name, templatePath: pkg.template.path, language };
}

export async function refreshSharedQuerySkills(
  projectRoot: string,
  packages: readonly PackageDefinition[],
): Promise<QuerySkillMigration[]> {
  const results: QuerySkillMigration[] = [];
  for (const pkg of packages) {
    const result = await refreshSharedQuerySkill(projectRoot, pkg);
    if (result !== undefined) results.push(result);
  }
  return results;
}
