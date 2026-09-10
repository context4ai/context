import { test } from "bun:test";
import { runArticleScenario } from "./articleScenarioWorkflow.fixture.js";
import { ARTICLE_CODE_SCENARIOS } from "./articleCodeScenarios.fixture.js";

test("design system overview and runtime adoption preserve distinct chapters through KB delivery", () => runArticleScenario({
  id: "design-system-overview-runtime", profile: "standard-policy", sourceType: "file",
  source: `# Example design system
This specification covers Web only. @example/ui implements the components; tokens.css owns color and spacing aliases.
Foundations cover color and spacing. Button is for actions; a Link navigates.
Import tokens.css before application overrides. ThemeProvider sets the global theme; a nested provider overrides its subtree.
Server and client must use the same initial theme during hydration. No native mapping or high-contrast validation is supplied.
For adoption use the maintained package guide, and check stylesheet order and initial theme before changing aliases.
`, articles: [
    { type: "l03", key: "system", title: "Example system map", task: "Find supported scope and adoption entries", slots: {
      scope: "manual.md scopes the specification to Web; it does not establish a native design system.",
      packages: "@example/ui implements components; tokens.css owns color and spacing aliases. No package version is specified.",
      foundations: "Color and spacing are documented foundations. Read tokens.css for alias definitions.",
      components: "Button is for actions and Link for navigation; inspect their component documentation for exact APIs.",
      configuration: "ThemeProvider chooses the global theme, with nested subtree overrides.",
      adoption: "Start from the package guide and verify stylesheet order and initial theme before changing aliases.",
      references: "manual.md is the supplied specification; tokens.css and the package guide are navigation targets, not independently read evidence.",
    } },
    { type: "l03", key: "runtime", title: "Theme runtime adoption", task: "Follow inheritance and hydration constraints", slots: {
      environment: "manual.md identifies ThemeProvider as the Web theme entry.",
      globals: "The outer ThemeProvider sets the global theme.",
      inheritance: "A nested provider overrides only its subtree, not the global setting.",
      resources: "Load tokens.css before application overrides.",
      ssr: "Server and client must select the same initial theme during hydration.",
      platforms: "Only Web is specified. Native mapping and high-contrast validation are not supplied.",
      verification: "Inspect stylesheet order and initial theme on server and client. These are documented checks, not a recorded passing test.",
    } },
  ],
}), 120000);

const application = ARTICLE_CODE_SCENARIOS.find(item => item.profile === "web-application")!;
test("subapplication details carry capabilities and navigation without inventing deployment", () => runArticleScenario({
  ...application, id: "subapplication-detail-chapters", articles: [{ type: "f11", title: "Order application entry", task: "Find the application's page and API", slots: {
    ownership: "src/index.tsx declares orders and its local route. This is a source declaration.",
    integration: "No remote activation receipt is supplied; inspect actual host registration before claiming deployment.",
    capabilities: "OrderPage and loadOrder are the page and data-loading entries in src/index.tsx.",
    navigation: "Follow /orders/:id to OrderPage, then loadOrder for the request boundary.",
    delivery: "The supplied source does not establish distinct build or release commands. Locate the owning package scripts before changing delivery settings.",
  } }],
}), 120000);
