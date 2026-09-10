import { test } from "bun:test";
import { ARTICLE_VARIANT_SCENARIOS } from "./articleVariantScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";
for (const scenario of ARTICLE_VARIANT_SCENARIOS) {
  test(`article variant ${scenario.id} preserves scope and evidence through delivery`, () => runArticleScenario(scenario), 120000);
}
