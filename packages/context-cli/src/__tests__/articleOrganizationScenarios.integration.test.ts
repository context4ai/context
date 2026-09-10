import { test } from "bun:test";
import { ARTICLE_DOCUMENT_SCENARIOS } from "./articleDocumentScenarios.fixture.js";
import { ARTICLE_CODE_SCENARIOS } from "./articleCodeScenarios.fixture.js";
import { ARTICLE_COMPONENT_SCENARIO } from "./articleComponentScenarios.fixture.js";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";

const cases = [
  { scenario: ARTICLE_DOCUMENT_SCENARIOS.find(item => item.id === "business-domain")!, proposed: "Frontend and backend", accepted: "Order business journey" },
  { scenario: ARTICLE_CODE_SCENARIOS.find(item => item.id === "order-http-service")!, proposed: "Source directories", accepted: "Service engineering" },
  { scenario: { ...ARTICLE_COMPONENT_SCENARIO, articles: ARTICLE_COMPONENT_SCENARIO.articles.filter(article => ["l05", "tag"].includes(article.key ?? article.type)) }, proposed: "Exports", accepted: "Component library" },
  { scenario: ARTICLE_DOCUMENT_SCENARIOS.find(item => item.id === "product-requirement")!, proposed: "Product documents", accepted: "Analyst tasks" },
  { scenario: { ...ARTICLE_COMPONENT_SCENARIO, articles: ARTICLE_COMPONENT_SCENARIO.articles.filter(article => article.type === "l03") }, proposed: "Token files", accepted: "Design foundations" },
  { scenario: ARTICLE_DOCUMENT_SCENARIOS.find(item => item.id === "quality-validation")!, proposed: "Test documents", accepted: "Quality and recorded outcomes" },
];
for (const { scenario, proposed, accepted } of cases) test(`organization ${accepted} carries recorded feedback into article identity mappings`,
  () => runArticleScenario({ ...scenario, id: `organization-${scenario.id}-${scenario.articles[0]!.key ?? scenario.articles[0]!.type}` }, { organization: { proposed, accepted } }), 180000);
