import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectPackageTemplateReviews } from "../project/packageTemplateReview.js";
import { loadContextProjectModule } from "../project/workspace.js";
import { invokeCliInDir, runCliInDir } from "./projectBuildVerifyV060Helpers.js";

describe("package starter template review", () => {
  test("requires explicit acceptance only while a generated starter remains unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "context-template-review-"));
    const project = join(root, "project");
    try {
      await runCliInDir(root, ["init", "project"]);
      writeFileSync(join(project, "src", "index.ts"), [
        'import { defineProject, kbPackage } from "@c4a/context";',
        "",
        "export default defineProject({",
        "  sources: [],",
        "  phases: [],",
        "  packages: [kbPackage({",
        '    name: "sample-kb",',
        '    template: { path: "src/package-templates/kb", vars: {} },',
        "  })],",
        "});",
        "",
      ].join("\n"), "utf8");

      const loaded = await loadContextProjectModule(project);
      expect(await inspectPackageTemplateReviews(project, loaded.project.packages)).toEqual([
        expect.objectContaining({ packageName: "sample-kb", state: "review-required" }),
      ]);

      const blocked = await invokeCliInDir(project, ["build", "--format", "json"]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("package template review is required");

      const acceptance = JSON.parse(await runCliInDir(project, [
        "package", "template", "accept", "--all", "--format", "json",
      ])) as { accepted: string[] };
      expect(acceptance.accepted).toEqual(["sample-kb"]);
      expect(await inspectPackageTemplateReviews(project, loaded.project.packages)).toEqual([
        expect.objectContaining({ packageName: "sample-kb", state: "starter-accepted" }),
      ]);

      const templatePath = join(project, "src", "package-templates", "kb", "wikis", "index.md");
      writeFileSync(templatePath, `${readFileSync(templatePath, "utf8")}\n<!-- local customization -->\n`, "utf8");
      expect(await inspectPackageTemplateReviews(project, loaded.project.packages)).toEqual([
        expect.objectContaining({ packageName: "sample-kb", state: "customized" }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
