import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { migrateLegacyQuerySkills } from "../project/packageQuerySkillMigration.js";
import { inspectPackageTemplateReview, writeStarterTemplateReviewMarker } from "../project/packageTemplateReview.js";

const FIXTURES = join(import.meta.dir, "fixtures", "legacy-knowledge-query");
const TEMPLATE_PATH = "src/package-templates/kb";
const pkg = { kind: "package.kb", name: "sample-kb", template: { path: TEMPLATE_PATH } } as unknown as PackageDefinition;

async function workspaceWithLegacySkill(language: "en" | "zh-CN", options: { edit?: boolean; extraTemplateFile?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "context-query-skill-migration-"));
  const templateRoot = join(root, ...TEMPLATE_PATH.split("/"));
  await cp(join(FIXTURES, language), join(templateRoot, "skills", "knowledge-query"), { recursive: true });
  await writeFile(join(templateRoot, "AGENTS.md"), "# Package\n");
  if (options.edit) {
    const skill = join(templateRoot, "skills", "knowledge-query", "SKILL.md");
    await writeFile(skill, `${await readFile(skill, "utf8")}\nProject-specific routing note.\n`);
  }
  await writeStarterTemplateReviewMarker(templateRoot);
  if (options.extraTemplateFile) await writeFile(join(templateRoot, "README.md"), "edited by the author\n");
  return { root, templateRoot };
}

describe("legacy knowledge-query migration", () => {
  for (const language of ["en", "zh-CN"] as const) {
    test(`replaces an unedited ${language} Skill and keeps an untouched starter untouched`, async () => {
      const { root, templateRoot } = await workspaceWithLegacySkill(language);
      try {
        expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("review-required");
        const migrations = await migrateLegacyQuerySkills(root, [pkg]);
        expect(migrations).toEqual([{ packageName: "sample-kb", state: "migrated", language, templatePath: TEMPLATE_PATH }]);
        expect(existsSync(join(templateRoot, "skills", "knowledge-query"))).toBe(false);
        const skill = await readFile(join(templateRoot, "skills", "context-knowledge-query", "SKILL.md"), "utf8");
        expect(skill).toContain('shared: "true"');
        expect(skill).toContain(language === "zh-CN" ? "# Context 知识查询" : "# Context Knowledge Query");
        expect(existsSync(join(templateRoot, "skills", "context-knowledge-query", "scripts", "search.mjs"))).toBe(true);
        expect(existsSync(join(templateRoot, "others", "context", "search-guide.md"))).toBe(true);
        expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("review-required");
        expect(await migrateLegacyQuerySkills(root, [pkg])).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("replaces an unedited Skill inside an otherwise customized template", async () => {
    const { root, templateRoot } = await workspaceWithLegacySkill("en", { extraTemplateFile: true });
    try {
      expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("customized");
      expect((await migrateLegacyQuerySkills(root, [pkg]))[0]?.state).toBe("migrated");
      expect(existsSync(join(templateRoot, "README.md"))).toBe(true);
      expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("customized");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("leaves an edited Skill to its author and reports it", async () => {
    const { root, templateRoot } = await workspaceWithLegacySkill("en", { edit: true });
    try {
      const before = await readFile(join(templateRoot, "skills", "knowledge-query", "SKILL.md"), "utf8");
      expect(await migrateLegacyQuerySkills(root, [pkg])).toEqual([
        { packageName: "sample-kb", state: "customized", templatePath: TEMPLATE_PATH },
      ]);
      expect(await readFile(join(templateRoot, "skills", "knowledge-query", "SKILL.md"), "utf8")).toBe(before);
      expect(existsSync(join(templateRoot, "skills", "context-knowledge-query"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores templates without the legacy Skill and non-kb packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-query-skill-migration-none-"));
    try {
      const llms = { kind: "package.llms", name: "docs", template: { path: "src/package-templates/llms" } } as unknown as PackageDefinition;
      expect(await migrateLegacyQuerySkills(root, [pkg, llms])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
