import { placeApprovedReadingFixture } from "./knowledgeMapReview.fixture.js";
import { expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace } from "./projectDocumentRevisionV074.fixture.js";
import { completePartitionStage, completeAuthorStage, approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { currentIndexerStructureReview, completeCurrentIndexerStructureReview } from "./knowledgeMapReview.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildProjectPackages } from "../project/packageBuilder.js";

test("a successful package build retains body anchor diagnostics on unchanged rebuilds", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"), join(root, "src/package-templates/kb"), { recursive: true });
    const entryPath = join(root, "src/index.ts");
    await writeFile(entryPath, (await readFile(entryPath, "utf8")).replace("defineProject, source", "defineProject, kbPackage, source")
      .replace("packages: []", 'packages: [kbPackage({ name: "link-warnings", template: { path: "src/package-templates/kb", vars: {} } })]'));
    await completePartitionStage(root);
    const structure = (await currentIndexerStructureReview(root))!;
    await completeCurrentIndexerStructureReview({ projectRoot: root, revision: structure.revision, decision: "approved" });
    await completeAuthorStage(root, { markdown: "Use the public entry point. [Old section](#removed-section)" });
    await approveCandidates(root, await readCandidateRecords(root));
    await closeProjectWorkspace(root);
    await placeApprovedReadingFixture(root);
    await acceptStarterPackageTemplates({ projectRoot: root });
    const first = (await buildProjectPackages(root)).packages[0]!;
    expect(first.linkWarnings).toContainEqual({ code: "package-link-anchor-unresolved", path: expect.any(String), target: "#removed-section" });
    const second = (await buildProjectPackages(root)).packages[0]!;
    expect(second.state).toBe("unchanged");
    expect(second.linkWarnings).toEqual(first.linkWarnings);
    expect(await readFile(join(root, first.outDir, first.linkWarnings![0]!.path), "utf8")).toContain("#removed-section");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
