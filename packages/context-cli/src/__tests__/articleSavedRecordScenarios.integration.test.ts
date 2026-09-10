import { test } from "bun:test";
import { ARTICLE_DOCUMENT_SCENARIOS } from "./articleDocumentScenarios.fixture.js";
import { ARTICLE_SPECIALIST_DOCUMENT_SCENARIOS } from "./articleSpecialistDocumentScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

const scenarios = [...ARTICLE_DOCUMENT_SCENARIOS, ARTICLE_SPECIALIST_DOCUMENT_SCENARIOS.find(scenario => scenario.profile === "incident-review")!];
for (const sourceType of ["note", "sessions"] as const) for (const scenario of scenarios) {
  test(`${sourceType} ${scenario.profile} preserves saved claims, uncertainty and corrections`, () => runArticleScenario({
    ...scenario, id: `${sourceType}-${scenario.id}`, sourceType,
    source: `${sourceType === "note" ? "Saved excerpt; original source not independently verified." : "Saved session summary; participants' recorded claims, not an execution trace."}\n\n${scenario.source}`,
  }), 180000);
}
