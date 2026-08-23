import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kbPackage } from "@c4a/context";
import {
  packageDistributionTemplateVars,
  packageKnowledgeOutputPath,
  packageTemplateOutputPath,
} from "../project/packageDistribution.js";
import {
  createApprovedProject,
  invokeCliInDir,
  runCliInDir,
} from "./projectBuildVerifyV060Helpers.js";

describe("flat knowledge package distribution", () => {
  test("uses flat OKF roots by default", () => {
    const pkg = kbPackage({
      name: "reference-kb",
      template: "src/package-templates/kb",
    });

    expect(pkg.distribution).toBeUndefined();
    expect(packageTemplateOutputPath(pkg, "skills/knowledge-query/SKILL.md"))
      .toBe("skills/knowledge-query/SKILL.md");
    expect(packageTemplateOutputPath(pkg, "wikis/index.md"))
      .toBe("wikis/index.md");
    expect(packageKnowledgeOutputPath(pkg, "codegraph/module/symbol.md"))
      .toBe("wikis/codegraph/module/symbol.md");
    expect(packageDistributionTemplateVars({ pkg })).toMatchObject({
      knowledgeNamespace: "",
      namespacedKnowledge: false,
      wikisRoot: "wikis",
      guidesRoot: "guides",
      rulesRoot: "rules",
      featsRoot: "feats",
    });
  });

  test("accepts a legacy namespace without changing output paths", () => {
    const pkg = kbPackage({
      name: "reference-kb",
      template: "src/package-templates/kb",
      distribution: { knowledgeNamespace: "personal-user.123/reference" },
    });

    expect(packageTemplateOutputPath(pkg, "skills/knowledge-query/SKILL.md"))
      .toBe("skills/knowledge-query/SKILL.md");
    expect(packageTemplateOutputPath(pkg, "skills/android-query/SKILL.md"))
      .toBe("skills/android-query/SKILL.md");
    expect(packageTemplateOutputPath(pkg, "wikis/index.md"))
      .toBe("wikis/index.md");
    expect(packageKnowledgeOutputPath(pkg, "codegraph/module/symbol.md"))
      .toBe("wikis/codegraph/module/symbol.md");
    expect(packageKnowledgeOutputPath(pkg, "architecture/module/overview.md"))
      .toBe("guides/architecture/module/overview.md");
    expect(packageKnowledgeOutputPath(pkg, "standards/module/constraint.md"))
      .toBe("rules/standards/module/constraint.md");
    expect(packageKnowledgeOutputPath(pkg, "feats/module/capability.md"))
      .toBe("feats/module/capability.md");
    expect(packageDistributionTemplateVars({
      pkg,
      logicalTemplateRelPath: "skills/knowledge-query/SKILL.md",
    })).toMatchObject({
      knowledgeNamespace: "personal-user.123/reference",
      namespacedKnowledge: false,
      skillName: "knowledge-query",
      skillPath: "skills/knowledge-query/SKILL.md",
      wikisRoot: "wikis",
      guidesRoot: "guides",
      rulesRoot: "rules",
      featsRoot: "feats",
    });
  });

  test("builds each package with flat roots even when legacy namespaces differ", async () => {
    const fixture = await createApprovedProject();
    try {
      const entryPath = join(fixture.project, "src", "index.ts");
      const entry = readFileSync(entryPath, "utf8");
      const original = [
        "    kbPackage({",
        '      name: "sample-kb",',
        '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
        "    }),",
      ].join("\n");
      const replacement = [
        "    kbPackage({",
        '      name: "alpha-kb",',
        '      distribution: { knowledgeNamespace: "alpha/reference" },',
        "      navigation: { foldDirectoryIndexes: false },",
        '      template: { path: "src/package-templates/kb", vars: { displayName: "Alpha Docs" } },',
        "    }),",
        "    kbPackage({",
        '      name: "beta-kb",',
        '      distribution: { knowledgeNamespace: "beta/reference" },',
        "      navigation: { foldDirectoryIndexes: false },",
        '      template: { path: "src/package-templates/kb", vars: { displayName: "Beta Docs" } },',
        "    }),",
      ].join("\n");
      expect(entry).toContain(original);
      writeFileSync(entryPath, entry.replace(original, replacement), "utf8");

      for (const [name, namespace] of [
        ["alpha-kb", ["alpha", "reference"]],
        ["beta-kb", ["beta", "reference"]],
      ] as const) {
        const legacyRoot = join(fixture.project, "dist", name, "wikis", ...namespace);
        mkdirSync(legacyRoot, { recursive: true });
        writeFileSync(join(legacyRoot, "legacy.md"), "obsolete layout\n", "utf8");
      }

      await runCliInDir(fixture.project, ["build", "--format", "json"]);

      for (const name of ["alpha-kb", "beta-kb"] as const) {
        const root = join(fixture.project, "dist", name);
        const skillPath = join(root, "skills", "knowledge-query", "SKILL.md");
        const wikiRoot = join(root, "wikis");
        const skill = readFileSync(skillPath, "utf8");
        expect(skill).toContain("name: knowledge-query");
        expect(skill).toContain("`wikis/index.md`");
        expect(skill).not.toContain("{{");
        expect(existsSync(join(wikiRoot, "index.md"))).toBe(true);
        expect(existsSync(join(root, "wikis", `${fixture.approvedId}.md`))).toBe(true);
        expect(existsSync(join(root, "wikis", name === "alpha-kb" ? "alpha" : "beta")))
          .toBe(false);
        expect(readFileSync(join(wikiRoot, "codegraph", "sample-a", "index.md"), "utf8"))
          .toContain("Approved knowledge pages under wikis/codegraph/sample-a.");

        const inventory = JSON.parse(
          readFileSync(join(root, "context-build-inventory.json"), "utf8"),
        ) as {
          package: {
            distribution: {
              layout: string;
              knowledge_namespace: string | null;
              roots: Record<string, string>;
            };
          };
          approved_knowledge: {
            files: Array<{ dist_path: string; okf_root_path: string }>;
          };
        };
        expect(inventory.package.distribution).toEqual({
          layout: "flat",
          knowledge_namespace: null,
          roots: {
            wikis: "wikis",
            guides: "guides",
            rules: "rules",
            feats: "feats",
          },
        });
        expect(inventory.approved_knowledge.files[0]).toMatchObject({
          dist_path: `wikis/${fixture.approvedId}.md`,
          okf_root_path: "wikis",
        });
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("legacy namespace changes do not make an otherwise identical package stale", async () => {
    const fixture = await createApprovedProject();
    try {
      const entryPath = join(fixture.project, "src", "index.ts");
      writeFileSync(
        entryPath,
        readFileSync(entryPath, "utf8").replace(
          '      name: "sample-kb",',
          '      name: "sample-kb",\n      distribution: { knowledgeNamespace: "legacy/alpha" },',
        ),
        "utf8",
      );
      await runCliInDir(fixture.project, ["build", "--format", "json"]);

      writeFileSync(
        entryPath,
        readFileSync(entryPath, "utf8").replace("legacy/alpha", "legacy/beta"),
        "utf8",
      );

      const status = await runCliInDir(fixture.project, ["status"]);
      expect(status).not.toContain("route.build.package-stale");
      expect(status).toContain("package sample-kb: ready");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("treats a package manifest from before the current builder protocol as stale", async () => {
    const fixture = await createApprovedProject();
    try {
      await runCliInDir(fixture.project, ["build", "--format", "json"]);
      const manifestPath = join(
        fixture.project,
        ".tmp",
        "context-runtime",
        "packages",
        "sample-kb.json",
      );
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      expect(manifest.builder_protocol).toBe("v16-document-optimization-overlays");
      manifest.builder_protocol = "v14-git-asset-identity";
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      expect(await runCliInDir(fixture.project, ["status"]))
        .toContain("state: route.build.package-stale");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects an author-maintained Skill name that differs from its directory", async () => {
    const fixture = await createApprovedProject();
    try {
      const entryPath = join(fixture.project, "src", "index.ts");
      writeFileSync(
        entryPath,
        readFileSync(entryPath, "utf8").replace(
          '      name: "sample-kb",',
          '      name: "sample-kb",\n      distribution: { knowledgeNamespace: "sample/docs" },',
        ),
        "utf8",
      );
      const skillPath = join(
        fixture.project,
        "src",
        "package-templates",
        "kb",
        "skills",
        "knowledge-query",
        "SKILL.md",
      );
      writeFileSync(
        skillPath,
        readFileSync(skillPath, "utf8").replace("name: {{skillName}}", "name: other-query"),
        "utf8",
      );

      const result = await invokeCliInDir(fixture.project, ["build", "--format", "json"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("package/skill-name-mismatch");
      expect(result.stderr).toContain("knowledge-query");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("builds an author-prefixed Skill independently from the knowledge namespace", async () => {
    const fixture = await createApprovedProject();
    try {
      const entryPath = join(fixture.project, "src", "index.ts");
      writeFileSync(
        entryPath,
        readFileSync(entryPath, "utf8").replace(
          '      name: "sample-kb",',
          '      name: "sample-kb",\n      distribution: { knowledgeNamespace: "sample/docs" },',
        ),
        "utf8",
      );
      const skillsRoot = join(fixture.project, "src", "package-templates", "kb", "skills");
      renameSync(join(skillsRoot, "knowledge-query"), join(skillsRoot, "module-query"));

      await runCliInDir(fixture.project, ["build", "--format", "json"]);

      const root = join(fixture.project, "dist", "sample-kb");
      const skill = readFileSync(join(root, "skills", "module-query", "SKILL.md"), "utf8");
      expect(skill).toContain("name: module-query");
      expect(skill).toContain("`wikis/index.md`");
      expect(existsSync(join(root, "skills", "sample-docs-module-query"))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
