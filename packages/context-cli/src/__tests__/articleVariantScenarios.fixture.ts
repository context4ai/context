import { ARTICLE_CODE_SCENARIOS, type ArticleScenario } from "./articleCodeScenarios.fixture.js";
import { ARTICLE_DOCUMENT_SCENARIOS } from "./articleDocumentScenarios.fixture.js";

const VARIANT_SCENARIOS: ArticleScenario[] = [
  { id: "pure-token-library", profile: "component-library", sourcePath: "tokens.css", source: `:root { --palette-blue: #2244aa; --focus-ring: var(--palette-blue); --space-sm: 4px; }
[data-theme="night"] { --palette-blue: #aaccff; }
`, articles: [{ type: "l03", title: "CSS token library", task: "Find token definitions without requiring a component export", slots: {
    catalog: "tokens.css defines --palette-blue, --focus-ring and --space-sm. --focus-ring aliases --palette-blue; the night selector overrides the palette value.",
    platforms: "These are CSS definitions. No native platform map, component compliance or runtime theme selection is established. Inspect the consumer's stylesheet import and data-theme owner next." } }] },
  { id: "engineering-and-model-aggregation", profile: "technical-guide", sourceType: "file", source: `# Cross-service engineering reference
Catalog service owns its Product entity and products table. Billing service owns a distinct Product pricing projection and products table in a separate database.
Catalog Product has draft and published states; publish validates a title before changing draft to published. Billing Product has active and retired states; no transition implementation is supplied.
Catalog writes use a local transaction; Billing pricing snapshots expire after one day. There is no shared transaction or shared table identity.
Catalog declares an HTTP call to Billing price lookup. Billing consumes a PriceChanged event. The guide records declarations and responsibilities, not a production trace.
Build entry: bun run build. Test entry: bun run test. These are documented commands, not execution receipts. Local development uses an isolated environment; delivery requires its deployment checklist. Compatibility policy requires preserving existing request fields.
Engineering policy: changes to an API require the contract review checklist before merge. A checklist entry is not a test pass or deployment receipt.
`, articles: [
    { type: "s04", title: "Cross-service Product models", task: "Keep same-name entities and state evidence separate", slots: {
      entities: "manual.md names Catalog Product and Billing Product as separate entities. Catalog owns draft/published; Billing owns active/retired.",
      states: "Only Catalog's title-validated draft-to-published transition is documented. Billing transition implementation is absent; retain its service boundary instead of merging the models." } },
    { type: "s05", title: "Cross-service products storage", task: "Locate distinct same-name tables and transaction scope", slots: {
      models: "Catalog.products and Billing.products belong to separate databases in manual.md. Identical table names do not establish shared storage.",
      consistency: "Catalog writes use a local transaction. Billing pricing snapshots expire after one day; no shared transaction is established." } },
    { type: "s06", title: "Cross-service dependency map", task: "Preserve HTTP and event roles without claiming a trace", slots: {
      requests: "manual.md declares Catalog's HTTP Billing price lookup and Billing's PriceChanged consumption. Keep the two roles attached to their respective services.",
      failures: "This is a documented dependency map, not production trace evidence. Inspect Catalog's client and Billing's consumer registration to prove implementation and delivery behavior." } },
    { type: "d04", title: "Contract review engineering policy", task: "Retain development policy alongside operational guides", slots: {
      scope: "This guide covers the Catalog and Billing development workflow.",
      commands: "manual.md documents bun run build and bun run test; check the project scripts before execution.",
      delivery: "Use the isolated environment for development and the deployment checklist for delivery. No deployment result is supplied.",
      conventions: "Preserve existing request fields and complete contract review before merge.",
      environment: "manual.md requires an API contract review checklist before merge.",
      verification: "Locate the change's checklist record before claiming compliance. A checklist entry does not prove a passing test or deployment." } },
  ] },
  { id: "multi-platform-library-guide", profile: "user-and-developer-guide", sourceType: "file", source: `# Example UI packages and adoption
@example/ui-web provides Web Button and notification; @example/ui-native provides Native Button, with no notification API documented.
Install the package matching the target platform. Web requires a stylesheet import and theme provider; Native requires its documented provider and platform resources.
Do not copy Web CSS token names into Native without a mapping. The mapping is not supplied here.
During Web version 2 adoption replace global dismiss with the notification handle's close method; verify disposal before rollout. No rollout result is recorded.
`, articles: [{ type: "l05", title: "Multi-platform UI library entry", task: "Choose the right package and keep compatibility limits visible", slots: {
    catalog: "manual.md distinguishes @example/ui-web Button/notification from @example/ui-native Button. Native notification is not documented.",
    setup: "Choose the platform package. Web needs stylesheet and theme provider; Native needs its own provider/resources. No cross-platform token mapping is supplied.",
    compatibility: "Web version 2 uses the notification handle's close method instead of global dismiss. Verify disposal before rollout; no successful migration is recorded." } }] },
];

export const ARTICLE_VARIANT_SCENARIOS: ArticleScenario[] = VARIANT_SCENARIOS.flatMap(scenario =>
  scenario.id === "engineering-and-model-aggregation" ? [
    { ...scenario, id: "domain-model-aggregation", profile: "domain-reference", articles: scenario.articles.filter(article => article.type === "s04") },
    { ...scenario, articles: scenario.articles.filter(article => article.type !== "s04") },
  ] : [scenario]);


const application = ARTICLE_CODE_SCENARIOS.find(scenario => scenario.profile === "web-application")!;
ARTICLE_VARIANT_SCENARIOS.push({ ...application, id: "subapplication-directory-and-detail", articles: [
  { ...application.articles.find(article => article.type === "f11")!, key: "directory" },
  { type: "f11", key: "orders-detail", title: "Order subapplication integration", task: "Trace the registered subapplication into its local route and page", slots: {
    scope: "src/index.tsx registers orders at /orders/:id, version fixture-1. This is a local subapplication declaration, not a deployment receipt.",
    integration: "Follow routes to OrderPage and loadOrder. No remote container or host activation is supplied; do not treat SaveButton or a page overlay as an independently hosted application." } },
] });
const quality = ARTICLE_DOCUMENT_SCENARIOS.find(scenario => scenario.id === "quality-validation")!;
ARTICLE_VARIANT_SCENARIOS.push({ ...quality, id: "lasting-strategy-and-change-plan", articles: [
  { type: "q02", key: "strategy", title: "Long-term order quality strategy", task: "Find enduring validation responsibilities", slots: {
    scope: "manual.md defines long-term draft editing, submission validation and role-boundary coverage.",
    risks: "Concurrent submission is a candidate scenario, not a formal executed case. Preserve that boundary when extending the strategy." } },
  { type: "q02", key: "change-plan", title: "Fixture-2 change validation", task: "Separate one change's test work from long-term strategy", slots: {
    scope: "manual.md states that fixture-2 additionally requires filter rename preserving conditions. Its environment is sandbox-a; this is a version-specific plan.",
    acceptance: "fixture-run-2 records ORD-01 passing and ORD-02 failing. Fix and rerun ORD-02 before approval; the plan is not a passed result." } },
] });
