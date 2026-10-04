import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";

test("a successful package build retains navigation diagnostics on unchanged rebuilds", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    await writeFile(entryPath, (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "link-warnings", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await produceFixtureArticles(root, [{
      path: "architecture/entry.md", question: "How is the public entry used?",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      markdown: '---\ntitle: Public entry\ndescription: Public entry navigation.\n---\n\n<!-- context:section id="entry" -->\nUse the public entry point. [Old section](#removed-section) [External](context:import/guide)\n<!-- /context:section -->\n',
      references: { sections: [{ id: "entry", references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
        locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
    }]);
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const first = (await buildProjectPackages(root)).packages[0]!;
    expect(first.linkWarnings).toContainEqual({ code: "package-link-anchor-unresolved", path: expect.any(String), target: "#removed-section" });
    expect(first.linkWarnings).toContainEqual(expect.objectContaining({ code: "package-import-unresolved", target: "context:import/guide" }));
    const second = (await buildProjectPackages(root)).packages[0]!;
    expect(second.state).toBe("unchanged");
    expect(second.linkWarnings).toEqual(first.linkWarnings);
    const page = join(root, first.outDir, first.linkWarnings!.find(warning => warning.code === "package-link-anchor-unresolved")!.path);
    expect(await readFile(page, "utf8")).toContain("#removed-section");
    expect(await readFile(page, "utf8")).toContain("External (unresolved import: guide)");
    await writeFile(join(root, "imports.yaml"), 'protocol: context.imports/v1\nimports:\n  guide:\n    url: https://example.org/guide\n');
    const repaired = (await buildProjectPackages(root)).packages[0]!;
    expect(repaired.linkWarnings?.some(warning => warning.code === "package-import-unresolved")).toBe(false);
    expect(await readFile(page, "utf8")).toContain("https://example.org/guide");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
