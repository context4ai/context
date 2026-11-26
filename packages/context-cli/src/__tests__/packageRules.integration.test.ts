import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";
import { withAlwaysApply } from "../project/packageBuildContent.js";

const article = (title: string, body: string) => ({
  markdown: `---\ntitle: ${title}\ndescription: ${title} for the team.\n---\n\n<!-- context:section id="body" -->\n${body}\n<!-- /context:section -->\n`,
  references: { sections: [{ id: "body", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
    locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
});

test("package rules: sizes only warn; exclude moves reference articles to guides and alwaysApply marks rules", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    const entry = (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source");
    const declare = (options: string) => writeFile(entryPath, entry.replace("packages: []",
      `packages: [kbPackage({ name: "rules-kb", template: { path: "src/package-templates/kb", vars: {} }${options} })]`));
    await declare("");
    await produceFixtureArticles(root, [
      { path: "standards/red-lines.md", question: "Which rules are binding?", sources: [DOCUMENT_REVISION_SOURCE_REF],
        ...article("Red lines", "Never deploy on Fridays.") },
      { path: "standards/config-keys.md", question: "Which configuration keys exist?", sources: [DOCUMENT_REVISION_SOURCE_REF],
        ...article("Configuration keys", Array.from({ length: 400 }, (_, index) => `| key_${index} | value of the configuration key ${index} |`).join("\n")) },
    ]);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });

    // A workspace SDK older than the CLI drops `rules` silently, so the warning asks to upgrade it first.
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { dependencies?: Record<string, string> };
    await writeFile(manifestPath, JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, "@c4a/context": "0.7.1" } }, null, 2));
    const first = (await buildProjectPackages(root)).packages[0]!;
    expect(first.rules?.version_alignment?.workspace_sdk.pinned).toBe("0.7.1");
    expect(first.rules?.next_action.instruction).toStartWith("First upgrade the workspace SDK");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const out = join(root, first.outDir);
    expect(existsSync(join(out, "rules/standards/config-keys.md"))).toBe(true);
    // Only a warning: the package is built unchanged and the report names the declaration to adjust.
    expect(first.rules).toMatchObject({ oversized: ["rules/standards/config-keys.md"], next_action: { file: "src/index.ts" } });
    expect(first.rules?.files.some(file => file.path.endsWith("index.md"))).toBe(false);
    expect(await readFile(join(out, "rules/standards/red-lines.md"), "utf8")).not.toContain("alwaysApply");

    await declare(', rules: { exclude: ["standards/config-keys.md"], alwaysApply: ["standards/red-lines.md"] }');
    const second = (await buildProjectPackages(root)).packages[0]!;
    expect(second.rules).toBeUndefined();
    expect(existsSync(join(out, "rules/standards/config-keys.md"))).toBe(false);
    expect(existsSync(join(out, "guides/standards/config-keys.md"))).toBe(true);
    expect(await readFile(join(out, "rules/standards/red-lines.md"), "utf8")).toMatch(/^---\nalwaysApply: true\n/u);
    expect(await readFile(join(out, "guides/standards/config-keys.md"), "utf8")).not.toContain("alwaysApply");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);

test("alwaysApply is set once, replacing a value the article declared", () => {
  expect(withAlwaysApply("---\ntitle: A\n---\nbody")).toBe("---\nalwaysApply: true\ntitle: A\n---\nbody");
  expect(withAlwaysApply("---\ntitle: A\nalwaysApply: false\n---\nbody")).toBe("---\ntitle: A\nalwaysApply: true\n---\nbody");
  expect(withAlwaysApply("no frontmatter")).toBe("no frontmatter");
});
