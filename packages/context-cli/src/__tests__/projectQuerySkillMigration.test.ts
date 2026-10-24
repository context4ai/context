import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { migrateLegacyQuerySkills } from "../project/packageQuerySkillMigration.js";
import { inspectPackageTemplateReview, writeStarterTemplateReviewMarker } from "../project/packageTemplateReview.js";

const TEMPLATE_PATH = "src/package-templates/kb";
const pkg = { kind: "package.kb", name: "sample-kb", template: { path: TEMPLATE_PATH } } as unknown as PackageDefinition;
const LEGACY_SKILL = {
  en: "---\nname: knowledge-query\n---\n\n# Knowledge Query\n\nProject-specific routing note.\n",
  "zh-CN": "---\nname: knowledge-query\n---\n\n# 知识查询\n\n项目专有的路由说明。\n",
};

async function workspaceWithLegacySkill(language: "en" | "zh-CN", options: { authorFile?: boolean; existingGuide?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "context-query-skill-migration-"));
  const templateRoot = join(root, ...TEMPLATE_PATH.split("/"));
  await mkdir(join(templateRoot, "skills", "knowledge-query", "scripts"), { recursive: true });
  await writeFile(join(templateRoot, "skills", "knowledge-query", "SKILL.md"), LEGACY_SKILL[language]);
  await writeFile(join(templateRoot, "skills", "knowledge-query", "scripts", "search.mjs"), "// legacy\n");
  await writeFile(join(templateRoot, "AGENTS.md"), "# Package\n");
  if (options.existingGuide !== undefined) {
    await mkdir(join(templateRoot, "others", "context"), { recursive: true });
    await writeFile(join(templateRoot, "others", "context", "search-guide.md"), options.existingGuide);
  }
  await writeStarterTemplateReviewMarker(templateRoot);
  if (options.authorFile) await writeFile(join(templateRoot, "README.md"), "edited by the author\n");
  return { root, templateRoot };
}

describe("knowledge-query to context-knowledge-query migration", () => {
  for (const language of ["en", "zh-CN"] as const) {
    test(`replaces the ${language} Skill and keeps an untouched starter untouched`, async () => {
      const { root, templateRoot } = await workspaceWithLegacySkill(language);
      try {
        expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("review-required");
        expect(await migrateLegacyQuerySkills(root, [pkg])).toEqual([
          { packageName: "sample-kb", templatePath: TEMPLATE_PATH, language },
        ]);
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

  test("keeps the author's other template files and an existing search guide", async () => {
    const { root, templateRoot } = await workspaceWithLegacySkill("en", { authorFile: true, existingGuide: "# Our terms\n" });
    try {
      expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("customized");
      expect(await migrateLegacyQuerySkills(root, [pkg])).toHaveLength(1);
      expect(await readFile(join(templateRoot, "README.md"), "utf8")).toBe("edited by the author\n");
      expect(await readFile(join(templateRoot, "others", "context", "search-guide.md"), "utf8")).toBe("# Our terms\n");
      expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("customized");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores templates without the old Skill and non-kb packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-query-skill-migration-none-"));
    try {
      const llms = { kind: "package.llms", name: "docs", template: { path: "src/package-templates/llms" } } as unknown as PackageDefinition;
      expect(await migrateLegacyQuerySkills(root, [pkg, llms])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
