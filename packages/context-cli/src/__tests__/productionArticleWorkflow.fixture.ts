import { expect } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { productionPlanningRequest, submitProductionPlan } from "../project/productionPlanning.js";
import { prepareCurrentProductionStage } from "../project/productionStagePreparation.js";
import { readProductionStage } from "../project/productionStageStore.js";
import { productionAgentDirectory } from "../project/productionSubmissionFiles.js";
import { approveProductionReport, productionReportRevision } from "../project/productionReport.js";
import { completeProductionSubmission, type ProductionSubmissionResult } from "../project/productionSubmission.js";
import type { productionReferencesSchema } from "../project/productionArticle.js";
import type { z } from "zod";

export interface FixtureProductionArticle {
  path: string;
  question: string;
  sources: string[];
  markdown: string;
  references: z.infer<typeof productionReferencesSchema>;
}

/** Recorded Agent decisions through the actual file protocol. Source selection,
 * prose and citations belong to the caller; no template or Provider selection
 * is synthesized by this fixture. Approval models explicit fixture feedback. */
export async function produceFixtureArticles(root: string, articles: FixtureProductionArticle[], options: {
  submit?: (input: { projectRoot: string; stage: string; path: string }) => Promise<ProductionSubmissionResult>;
} = {}) {
  const request = await productionPlanningRequest(root);
  if (!request) throw new Error("Fixture needs canonical production requirements");
  await prepareCurrentProductionStage({ projectRoot: root, revision: request.revision });
  const initial = (await readProductionStage(root))!;
  const agent = join(root, productionAgentDirectory(initial.id));
  await mkdir(join(agent, "submissions"), { recursive: true });
  await writeFile(join(agent, "submissions/plan.yaml"), YAML.stringify({
    stage: initial.id,
    capabilities: { multi_agent: false, skills: [] },
    articles: articles.map(article => ({ path: article.path, question: article.question,
      sources: article.sources, batch: "articles" })),
  }));
  await submitProductionPlan({ projectRoot: root, stage: initial.id, path: "submissions/plan.yaml" });
  const planned = (await readProductionStage(root))!;
  expect(planned.report_approved).toBe(false);
  expect(planned.tasks.every(task => task.status === "pending")).toBe(true);
  await writeFile(join(agent, "submissions/report.yaml"), YAML.stringify({ stage: initial.id, decision: "approved" }));
  await approveProductionReport({ projectRoot: root, stage: initial.id,
    revision: productionReportRevision(planned), path: "submissions/report.yaml" });
  const issued = (await readProductionStage(root))!;
  const tasks = [];
  for (const article of articles) {
    const task = issued.tasks.find(task => task.path === article.path)!;
    expect(task.status).toBe("issued");
    const content = `submissions/${task.id}.md`;
    const references = `submissions/${task.id}.references.yaml`;
    await writeFile(join(agent, content), article.markdown);
    await writeFile(join(agent, references), YAML.stringify(article.references));
    tasks.push({ task: task.id, input: task.input, content, references });
  }
  await writeFile(join(agent, "submissions/articles.yaml"), YAML.stringify({ stage: initial.id, tasks }));
  const result = await (options.submit ?? completeProductionSubmission)({ projectRoot: root, stage: initial.id, path: "submissions/articles.yaml" });
  expect(result.failed).toEqual([]);
  expect(result.accepted).toHaveLength(articles.length);
  expect(result.stage_state).toBe("ended");
  return result;
}
