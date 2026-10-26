import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { migrateLegacyQuerySkills, refreshSharedQuerySkills } from "../project/packageQuerySkillMigration.js";
import { inspectPackageTemplateReview, writeStarterTemplateReviewMarker } from "../project/packageTemplateReview.js";
import { resolveContextPackageTemplatesRoot } from "../project/workspace.js";

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

describe("shared context-knowledge-query refresh", () => {
  const shippedSkill = (language: "en" | "zh-CN") => {
    const root = resolveContextPackageTemplatesRoot();
    return join(language === "zh-CN" ? join(dirname(root), "package-templates.zh-CN") : root, "kb", "skills", "context-knowledge-query");
  };

  async function workspaceWithSkill(language: "en" | "zh-CN", edit: (skillRoot: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "context-query-skill-refresh-"));
    const templateRoot = join(root, ...TEMPLATE_PATH.split("/"));
    const skillRoot = join(templateRoot, "skills", "context-knowledge-query");
    await mkdir(join(templateRoot, "skills"), { recursive: true });
    await cp(shippedSkill(language), skillRoot, { recursive: true });
    await writeFile(join(templateRoot, "AGENTS.md"), "# Package\n");
    await writeStarterTemplateReviewMarker(templateRoot);
    await edit(skillRoot);
    return { root, templateRoot, skillRoot };
  }

  for (const language of ["en", "zh-CN"] as const) {
    test(`replaces an older ${language} copy with the shipped Skill in the same language`, async () => {
      const { root, skillRoot } = await workspaceWithSkill(language, async (skill) => {
        await writeFile(join(skill, "SKILL.md"), (await readFile(join(skill, "SKILL.md"), "utf8")).replace(/\n## [^\n]+\n/u, "\n"));
        await writeFile(join(skill, "scripts", "stale.mjs"), "// removed by the refresh\n");
      });
      try {
        expect(await refreshSharedQuerySkills(root, [pkg])).toEqual([{ packageName: "sample-kb", templatePath: TEMPLATE_PATH, language }]);
        expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(await readFile(join(shippedSkill(language), "SKILL.md"), "utf8"));
        expect(existsSync(join(skillRoot, "scripts", "stale.mjs"))).toBe(false);
        expect((await inspectPackageTemplateReview(root, pkg)).state).toBe("review-required");
        expect(await refreshSharedQuerySkills(root, [pkg])).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  test("leaves a current copy, the search guide and templates without the Skill alone", async () => {
    const { root, templateRoot } = await workspaceWithSkill("en", async () => {});
    try {
      await mkdir(join(templateRoot, "others", "context"), { recursive: true });
      await writeFile(join(templateRoot, "others", "context", "search-guide.md"), "# Our terms\n");
      expect(await refreshSharedQuerySkills(root, [pkg])).toEqual([]);
      expect(await readFile(join(templateRoot, "others", "context", "search-guide.md"), "utf8")).toBe("# Our terms\n");
      await rm(join(templateRoot, "skills"), { recursive: true, force: true });
      const llms = { kind: "package.llms", name: "docs", template: { path: "src/package-templates/llms" } } as unknown as PackageDefinition;
      expect(await refreshSharedQuerySkills(root, [pkg, llms])).toEqual([]);
      expect(existsSync(join(templateRoot, "skills"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
