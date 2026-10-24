import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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

async function legacyLanguage(legacyRoot: string): Promise<"en" | "zh-CN"> {
  const skill = await readFile(join(legacyRoot, "SKILL.md"), "utf8").catch(() => "");
  return /\p{Script=Han}/u.test(skill) ? "zh-CN" : "en";
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
  const language = await legacyLanguage(legacyRoot);
  const shippedRoot = resolveContextPackageTemplatesRoot();
  const shippedKb = join(language === "zh-CN" ? join(dirname(shippedRoot), "package-templates.zh-CN") : shippedRoot, "kb");
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
