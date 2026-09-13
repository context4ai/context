import { expect } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { prepareRevisionKnowledge } from "./initialRevisionKnowledge.fixture.js";
import { DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { approveCandidates } from "./projectDocumentRevisionStages.fixture.js";
import { readCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { acceptStarterPackageTemplates } from "../project/packageTemplateReview.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { submitProductionPlan } from "../project/productionPlanning.js";
import { completeProductionSubmission } from "../project/productionSubmission.js";
import { requestProductionDelivery } from "../project/productionDelivery.js";

/** Two delivered articles and two independent unfinished articles. The fixture
 * exercises partial delivery through the current protocol, not an old ledger. */
export async function maintenanceProductionWorkspace(roots: string[]) {
  const root = await prepareRevisionKnowledge(roots);
  const stage = (await readProductionStage(root))!;
  const directory = join(root, productionAgentDirectory(stage.id));
  await writeFile(join(directory, "submissions/remaining-plan.yaml"), YAML.stringify({
    stage: stage.id, capabilities: { multi_agent: false, skills: [] },
    articles: ["examples", "configuration"].map(name => ({ path: `architecture/${name}.md`,
      question: `Explain ${name} of the public entry point`, sources: [DOCUMENT_REVISION_SOURCE_REF], batch: "articles" })),
  }));
  await submitProductionPlan({ projectRoot: root, stage: stage.id, path: "submissions/remaining-plan.yaml" });
  expect((await readProductionStage(root))!.tasks.filter(task => task.status === "issued")).toHaveLength(2);
  await requestProductionDelivery(root);
  await approveCandidates(root, await readCandidateRecords(root));
  await closeProjectWorkspace(root);
  await acceptStarterPackageTemplates({ projectRoot: root });
  const views = YAML.parse(await readFile(join(root, "knowledge/structure.yaml"), "utf8")).articles as Array<{ path: string }>;
  expect(views).toHaveLength(2);
  return { root, views };
}

export async function submitMaintenanceProductionArticle(root: string, path: string, prose = "The public entry point exports answer with value 42.") {
  const stage = (await readProductionStage(root))!;
  const task = [...stage.tasks].reverse().find(task => task.path === path && task.status === "issued")!;
  expect(task).toBeDefined();
  const directory = join(root, productionAgentDirectory(stage.id));
  await writeFile(join(directory, "submissions/article.md"), `---\ntitle: Entry point\ndescription: Exported answer usage.\n---\n\n<!-- context:section id="overview" -->\n${prose}\n<!-- /context:section -->\n`);
  await writeFile(join(directory, "submissions/references.yaml"), YAML.stringify({ sections: [{ id: "overview",
    references: [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts", start_line: 1, end_line: 1 } }] }] }));
  await writeFile(join(directory, "submissions/submit.yaml"), YAML.stringify({ stage: stage.id,
    tasks: [{ task: task.id, input: task.input, content: "submissions/article.md", references: "submissions/references.yaml" }] }));
  const result = await completeProductionSubmission({ projectRoot: root, stage: stage.id, path: "submissions/submit.yaml" });
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(1);
}
