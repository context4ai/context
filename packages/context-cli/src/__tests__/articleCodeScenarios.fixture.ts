/** Anonymous source/Author transcripts for replaying real template selection.
 * They exercise information roles; they do not score an LLM or claim runtime
 * observations that the fixture does not contain. */
export interface ArticleScenario {
  id: string;
  profile: string;
  sourceType?: "file" | "note" | "sessions";
  source: string;
  sourcePath?: string;
  articles: Array<{ type: string; key?: string; symbols?: string[]; apiRows?: Array<[string, string]>; title: string; task: string; slots: Record<string, string> }>;
}

const webSource = `import React from "react";
export interface SaveButtonProps { disabled?: boolean; onSave(): void }
export function SaveButton({disabled = false, onSave}: SaveButtonProps) { return <button disabled={disabled} onClick={onSave}>Save</button>; }
export const theme = {spacing: "8px", foreground: "#222"};
export const locales = {en: {save: "Save"}, fr: {save: "Enregistrer"}};
export const permissions = {canEdit: (roles: string[]) => roles.includes("editor")};
export let selectedOrder: string | null = null;
export function selectOrder(id: string) { selectedOrder = id; }
export async function loadOrder(id: string) { const response = await fetch("/api/orders/" + encodeURIComponent(id)); if (!response.ok) throw new Error("order-load-failed"); return response.json(); }
export function OrderPage({id, roles}: {id: string; roles: string[]}) { return <main data-order-id={id}><SaveButton disabled={!permissions.canEdit(roles)} onSave={() => selectOrder(id)} /></main>; }
export const routes = [{path: "/orders/:id", component: OrderPage, loader: loadOrder}];
export const subapplications = [{name: "orders", entry: "/orders/:id", version: "fixture-1"}];
export const application = {routes, subapplications, locales};
// Development: bun run dev. Build: bun run build. No deployment receipt is included.
// Ownership: the sample-maintainers group is the documented contact, not a live directory lookup.
// Contract change: order IDs are encoded by loadOrder; backend error meanings require its contract.
`;

export const ARTICLE_CODE_SCENARIOS: ArticleScenario[] = [
  { id: "interactive-application", profile: "web-application", source: webSource, articles: [
    { type: "c01", title: "Order application entry", task: "Find the module responsible for an order page", slots: {
      scope: "The application export in src/index.tsx registers the order route, subapplication and locale map. Start there to identify this fixture's frontend boundary.",
      sources: "Continue at routes, OrderPage and loadOrder in src/index.tsx. Server authorization and production deployment are not established by this module." } },
    { type: "c03", title: "Order terminology and permissions", task: "Distinguish the editor role from a server authorization decision", slots: {
      distinctions: "permissions.canEdit in src/index.tsx returns true when the role list contains editor. OrderPage uses its negation to disable SaveButton.",
      references: "This proves a local UI condition. Inspect the server handler separately before treating the button state as authorization." } },
    { type: "c04", title: "Order integration map", task: "Follow the frontend request boundary", slots: {
      catalog: "loadOrder calls fetch with /api/orders/ plus the encoded ID. The routes export attaches loadOrder as its loader; the remote handler is outside this captured fixture.",
      boundaries: "Use src/index.tsx:loadOrder as the next code entry and obtain the backend API contract to explain remote errors." } },
    { type: "c05", title: "Order loading investigation", task: "Start diagnosing an order-load-failed error", slots: {
      symptoms: "loadOrder in src/index.tsx throws order-load-failed when the Response.ok flag is false. This is a code condition, not an observed incident.",
      diagnosis: "Inspect the ID passed to loadOrder, the encoded request URL, then the actual HTTP response. The fixture supplies no live response or verified root cause." } },
    { type: "c07", title: "Order source evidence", task: "Find the source coordinates and their limits", slots: {
      evidence: "The source comment in src/index.tsx names sample-maintainers as the documented contact. Recheck current ownership before assigning work.",
      entries: "Changes to ID encoding belong to loadOrder. Review its caller and backend contract together; this sample contains no published release evidence." } },
    { type: "f01", title: "Frontend application overview", task: "Locate page composition and shared facilities", slots: {
      architecture: "src/index.tsx exports application with routes, subapplications and locales. OrderPage composes SaveButton and uses permissions.canEdit.",
      references: "Start from application, then routes and OrderPage. The file is a bounded source sample and does not establish the host's bootstrap implementation." } },
    { type: "f02", title: "Order routing", task: "Locate the implementation behind /orders/:id", slots: {
      organization: "The routes array explicitly associates /orders/:id with OrderPage and loadOrder in src/index.tsx.",
      routes: "| Route | Page | Loader |\n| --- | --- | --- |\n| /orders/:id | OrderPage | loadOrder |",
      access: "The route parameter is passed as an ID. OrderPage disables editing for role lists without editor; inspect server authorization independently." } },
    { type: "f03", symbols: ["OrderPage", "SaveButtonProps", "loadOrder"], title: "Order page behavior", task: "Trace a Save interaction to local state", slots: {
      identity: "OrderPage in src/index.tsx receives id and roles. Its SaveButton onSave handler calls selectOrder(id).",
      access: "OrderPage delegates the disabled flag to permissions.canEdit(roles); only lists containing editor enable the button. This client condition does not prove server authorization.",
      references: "Next inspect src/index.tsx:OrderPage, permissions.canEdit and SaveButton.onSave, then selectOrder. Obtain the server contract before interpreting this local selection as a persisted save.",
      flow: "selectOrder assigns the module-level selectedOrder variable. No persistence request is made by that handler in this fixture." } },
    { type: "f04", title: "Selected order state", task: "Find who writes selectedOrder", slots: {
      ownership: "selectedOrder is a module-level string or null, initially null. selectOrder is its explicit writer in src/index.tsx.",
      references: "Follow OrderPage → SaveButton.onSave → selectOrder. No subscription, browser storage or server persistence implementation is supplied." } },
    { type: "f05", title: "Order API client", task: "Locate request construction and local error handling", slots: {
      clients: "loadOrder in src/index.tsx constructs /api/orders/{encoded-id}, performs fetch, checks Response.ok and returns response.json().",
      errors: "The only explicit local error is order-load-failed for a non-ok response. Consult the remote contract and actual response before assigning a business cause." } },
    { type: "f06", title: "Frontend order contracts", task: "Separate local props from the remote response contract", slots: {
      scope: "OrderPage's local input is {id: string; roles: string[]}. SaveButtonProps supplies disabled and onSave. loadOrder has no explicit response schema in this fixture.",
      references: "Use src/index.tsx for local definitions. Obtain the API's authoritative schema before documenting remote JSON fields." } },
    { type: "f07", title: "Order component map", task: "Locate the shared button used by the page", slots: {
      catalog: "OrderPage renders SaveButton. The button receives disabled from permissions.canEdit and delegates onSave to the page callback.",
      references: "Read SaveButtonProps and SaveButton in src/index.tsx for the component contract; read OrderPage for business-specific behavior." } },
    { type: "f08", title: "Order styling inputs", task: "Find declared style tokens and their application boundary", slots: {
      tokens: "The theme export in src/index.tsx declares spacing as 8px and foreground as #222. These are local token values, not a captured global design standard.",
      references: "Check src/index.tsx:theme and its actual consumers before diagnosing computed styles. This fixture does not apply the token object to a DOM style or global theme runtime." } },
    { type: "f09", title: "Order local development", task: "Find documented development commands", slots: {
      commands: "The comment in src/index.tsx documents bun run dev and bun run build. Confirm package scripts and tool installation before executing them.",
      verification: "A deployment receipt is absent. Do not report a successful build or rollout based only on the documented commands." } },
    { type: "f10", title: "Order host integration boundary", task: "Find the subapplication registration without inventing a host runtime", slots: {
      registration: "application includes subapplications, whose orders entry points at /orders/:id. The registration lives in src/index.tsx.",
      failures: "No host loader, remote container or shared dependency negotiation is implemented here. Continue from the registered entry to the authorized host source before assigning an integration failure." } },
    { type: "f11", title: "Order subapplication entry", task: "Find the registered subapplication route", slots: {
      catalog: "subapplications registers orders with entry /orders/:id and version fixture-1. The same route appears in routes.",
      details: "Continue at src/index.tsx:subapplications. No remote container, iframe or host activation implementation is present." } },
    { type: "f12", title: "Internal SaveButton", task: "Use the internal button without confusing it with order persistence", slots: {
      purpose: "SaveButton in src/index.tsx renders a native button, defaults disabled to false and delegates clicks to onSave.",
      behavior: "Pass disabled and an onSave callback through SaveButtonProps. OrderPage's callback only updates local selection; the component does not save an order remotely." } },
  ] },
  { id: "order-domain", profile: "domain-service", source: `
export interface Order { id: string; state: "draft" | "submitted"; ownerId: string }
export const orders = new Map<string, Order>();
export function submit(order: Order): Order { if (order.state !== "draft") throw new Error("invalid-transition"); return {...order, state: "submitted"}; }
export function save(order: Order) { orders.set(order.id, order); }
export function get(id: string) { return orders.get(id); }
`, articles: [
    { type: "s04", title: "Order domain model", task: "Explain the supported state transition", slots: {
      entities: "Order in src/index.ts has id, ownerId and a draft/submitted state union. ownerId is a field; no User entity relationship implementation is provided.",
      states: "submit accepts only draft and returns a copied Order with submitted state. Other input states throw invalid-transition. No reverse transition is implemented." } },
    { type: "s05", title: "Order storage model", task: "Locate storage keys and writes", slots: {
      models: "orders is an in-memory Map keyed by Order.id. save writes the current Order; get reads it by ID.",
      references: "Inspect src/index.ts:orders/save/get. No database, TTL, transaction or durability guarantee is established by this sample." } },
  ] },
  { id: "order-http-service", profile: "api-service", source: `
export interface OrderRequest { id: string }
export async function getOrder(request: OrderRequest) { return {id: request.id, state: "draft"}; }
export const routes = [{method: "GET", path: "/orders/:id", handler: getOrder}];
export const dependencies = {auditEndpoint: "/audit"};
`, articles: [
    { type: "s01", title: "Order service entry", task: "Find the service's registered endpoint", slots: {
      scope: "src/index.ts exposes a GET /orders/:id route and getOrder handler. The source is a handler registration sample, not deployment discovery.",
      sources: "Start at routes then getOrder. Host middleware and authorization are outside the sample." } },
    { type: "s02", title: "Order API catalog", task: "Find method, path and handler together", slots: {
      catalog: "| Method | Path | Handler |\n| --- | --- | --- |\n| GET | /orders/:id | getOrder |",
      references: "Registration is declared in src/index.ts:routes. Check the hosting router before assuming its public base URL." } },
    { type: "s03", title: "Get order endpoint", task: "Inspect the local handler contract", slots: {
      entry: "getOrder in src/index.ts receives OrderRequest with id: string.",
      response: "The implementation returns id from the input and the literal state draft. It contains no database lookup or declared business error in this sample." } },
    { type: "s06", title: "Order dependency boundary", task: "Distinguish a configured endpoint from an actual call", slots: {
      initialization: "dependencies.auditEndpoint declares /audit in src/index.ts. No function in the captured module calls it.",
      requests: "Search actual consumers of dependencies.auditEndpoint before claiming an audit RPC/HTTP dependency or runtime failure." } },
  ] },
  { id: "event-worker", profile: "event-consumer", source: `
export interface Queue { ack(id: string): Promise<void>; retry(id: string): Promise<void> }
export async function handle(id: string, run: () => Promise<void>, queue: Queue) { try { await run(); await queue.ack(id); } catch { await queue.retry(id); } }
export const subscription = {topic: "order-submitted", handler: handle};
`, articles: [
    { type: "s07", title: "Order event worker", task: "Locate acknowledgement and retry decisions", slots: {
      triggers: "subscription binds order-submitted to handle in src/index.ts. The queue's actual subscription runtime is outside this source.",
      retry: "handle awaits run, then ack; errors from either enter catch and call retry. The sample does not specify retry delay, cap, dead-letter routing or idempotency." } },
  ] },
];
