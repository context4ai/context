import { test } from "bun:test";
import { ARTICLE_CODE_SCENARIOS } from "./articleCodeScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

for (const scenario of ARTICLE_CODE_SCENARIOS) test(`article scenario ${scenario.id} preserves distinct reader tasks through approved KB output`,
  () => runArticleScenario(scenario), 180000);
