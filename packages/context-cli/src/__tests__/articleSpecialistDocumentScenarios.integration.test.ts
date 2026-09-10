import { test } from "bun:test";
import { ARTICLE_SPECIALIST_DOCUMENT_SCENARIOS } from "./articleSpecialistDocumentScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

for (const scenario of ARTICLE_SPECIALIST_DOCUMENT_SCENARIOS) test(`specialist document ${scenario.id} retains its source authority through delivery`,
  () => runArticleScenario(scenario), 180000);
