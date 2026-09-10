import { test } from "bun:test";
import { ARTICLE_CODE_PROFILE_SCENARIOS } from "./articleCodeProfileScenarios.fixture.js";
import { ARTICLE_COMPONENT_SCENARIO } from "./articleComponentScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

for (const scenario of [...ARTICLE_CODE_PROFILE_SCENARIOS, ARTICLE_COMPONENT_SCENARIO]) test(`code profile ${scenario.id} preserves its specialist responsibility through delivery`,
  () => runArticleScenario(scenario), 180000);
