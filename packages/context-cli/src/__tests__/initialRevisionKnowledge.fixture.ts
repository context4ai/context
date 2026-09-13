import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { produceFixtureArticles } from "./productionArticleWorkflow.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { buildFixturePackages as buildProjectPackages } from "./workspaceVersionDelivery.fixture.js";

export async function prepareRevisionKnowledge(roots: string[]) {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  await cp(join(import.meta.dir, "../../../context/templates/package-templates/kb"),
    join(root, "src/package-templates/kb"), { recursive: true });
  const entryPath = join(root, "src/index.ts");
  const entry = await readFile(entryPath, "utf8");
  await writeFile(entryPath, entry.replace("defineProject, source", "defineProject, kbPackage, source")
    .replace("packages: []", 'packages: [kbPackage({ name: "update-kb", template: { path: "src/package-templates/kb", vars: {} } })]'));
  await produceFixtureArticles(root, ["overview", "usage"].map(name => ({
    path: `architecture/${name}.md`, question: `Explain the ${name} of the exported answer`,
    sources: [DOCUMENT_REVISION_SOURCE_REF],
    markdown: `---\ntitle: Answer ${name}\ndescription: The exported answer and its usage.\n---\n\n<!-- context:section id="${name}" -->\n# Answer ${name}\n\nThe public entry point exports answer with value 42.\n<!-- /context:section -->\n`,
    references: { sections: [{ id: name, references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF,
      locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] },
  })));
  return root;
}

export async function initialRevisionKnowledge(roots: string[]) {
  const root = await prepareRevisionKnowledge(roots);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  await buildProjectPackages(root);
  return root;
}
