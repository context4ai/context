import { test } from "bun:test";
import { ARTICLE_DOCUMENT_SCENARIOS } from "./articleDocumentScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

for (const scenario of ARTICLE_DOCUMENT_SCENARIOS) test(`article scenario ${scenario.id} preserves documented claims and evidence roles through approved KB output`,
  () => runArticleScenario(scenario), 180000);
