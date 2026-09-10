import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";

export const ARTICLE_CODE_PROFILE_SCENARIOS: ArticleScenario[] = [
  { id: "workspace-container", profile: "monorepo-container", source: `export const workspaces = [{name: "web", entry: "apps/web"}, {name: "worker", entry: "apps/worker"}];
export function workspaceEntry(name: string) { return workspaces.find(item => item.name === name)?.entry; }
`, articles: [{ type: "c01", title: "Workspace capability map", task: "Find the relevant module before investigating", slots: {
    index: "workspaces in src/index.ts names web at apps/web and worker at apps/worker. This is the container's declared map; their implementation files are outside this fixture.",
    tasks: "Use workspaceEntry to locate a declared entry, then read that module's authorized source. This container does not establish either application's runtime behavior." } }] },
  { id: "public-sdk", profile: "sdk-library", source: `export interface ClientOptions {baseUrl: string; headers?: Record<string,string>}
export function createClient(options: ClientOptions) { return { async getOrder(id: string) { const response = await fetch(options.baseUrl + "/orders/" + encodeURIComponent(id), {headers: options.headers}); if (!response.ok) throw new Error("request-failed"); return response.json(); } }; }
`, articles: [{ type: "l01", title: "Order SDK integration", task: "Use the SDK and identify its request boundary", slots: {
    usage: "createClient in src/index.ts requires baseUrl and optionally accepts headers. getOrder encodes the ID and issues fetch to /orders/{id}.",
    limits: "Non-OK responses throw request-failed. No retry, response schema validation or automatic authentication is implemented here; inspect the remote API contract for response meaning." } }] },
  { id: "command-tool", profile: "cli-tool", source: `export function run(args: string[], output: (value: string) => void) { if (args[0] !== "inspect") { output("Usage: inspect <id>"); return 2; } if (!args[1]) { output("Missing id"); return 2; } output(JSON.stringify({id: args[1], mode: "inspection"})); return 0; }
`, articles: [{ type: "l01", title: "Inspection command reference", task: "Know arguments, output and failure behavior", slots: {
    usage: "run in src/index.ts accepts inspect followed by an ID and writes a JSON inspection record through its output callback.",
    contracts: "Unknown commands and missing IDs return 2; successful inspection returns 0. This exported runner does not show process.exit wiring or access a remote service." } }] },
  { id: "host-plugin", profile: "plugin-extension", source: `export interface Host { onRequest(handler: (id: string) => void): () => void; log(message: string): void }
export function register(host: Host) { return host.onRequest(id => host.log(id)); }
`, articles: [{ type: "l04", title: "Request logging plugin", task: "Identify host contract and cleanup ownership", slots: {
    registration: "register in src/index.ts subscribes through Host.onRequest and returns the host-provided unsubscribe function.",
    context: "The plugin logs request IDs through Host.log. No ordering guarantee or global singleton is declared.",
    cleanup: "The caller must invoke the returned unsubscribe when detaching the plugin. Inspect the host's subscription implementation for lifecycle failures." } }] },
  { id: "gateway-facade", profile: "gateway-facade", source: `export interface OrderService { get(id: string): Promise<{id: string; status: string}> }
export async function orderView(service: OrderService, id: string) { const order = await service.get(id); return {id: order.id, editable: order.status === "draft"}; }
export const routes = [{method: "GET", path: "/order-view/:id", handler: orderView}];
`, articles: [{ type: "s03", title: "Order view facade", task: "Trace the facade's first call and projection", slots: {
    entry: "src/index.ts declares GET /order-view/:id with orderView. It awaits the injected OrderService.get(id).",
    downstream: "The facade projects id and editable from status === draft. The service implementation, transport and authorization are not shown; continue at the authorized OrderService implementation." } }] },
  { id: "scheduled-worker", profile: "background-runtime", source: `export const schedule = "0 * * * *";
export async function runScheduled(scan: () => Promise<string[]>, process: (id: string) => Promise<void>) { for (const id of await scan()) await process(id); }
`, articles: [{ type: "s07", title: "Scheduled scan task", task: "Separate declared schedule from execution and retries", slots: {
    triggers: "src/index.ts declares schedule 0 * * * * and exports runScheduled. No scheduler installation or timezone is supplied.",
    processing: "runScheduled scans IDs and awaits each process call sequentially. A rejected call propagates and stops this run; retry or compensation is not implemented in this function." } }] },
  { id: "task-executor", profile: "background-runtime", source: `export interface Task {id: string; run(): Promise<void>}
export async function execute(tasks: Task[], onFailure: (id: string, error: unknown) => void) { for (const task of tasks) { try { await task.run(); } catch(error) { onFailure(task.id, error); } } }
`, articles: [{ type: "s07", title: "Task executor lifecycle", task: "Find task failure continuation", slots: {
    triggers: "execute in src/index.ts receives explicit Task objects. No cron, message subscription or automatic trigger is registered.",
    retry: "Each task failure invokes onFailure and the loop continues if that callback returns normally. There is no retry counter or durable checkpoint; a throwing onFailure also propagates." } }] },
  { id: "record-reconciliation", profile: "data-sync-reconciliation", source: `export interface RecordValue {id: string; revision: number}
export async function reconcile(incoming: RecordValue[], current: Map<string, RecordValue>, save: (record: RecordValue) => Promise<void>) { for (const record of incoming) { if ((current.get(record.id)?.revision ?? -1) < record.revision) await save(record); } }
`, articles: [{ type: "s07", title: "Revision reconciliation", task: "Locate conflict selection and incomplete batch behavior", slots: {
    reconciliation: "reconcile in src/index.ts saves incoming records only when their revision exceeds the current Map entry. Equal and older revisions are skipped.",
    retry: "A rejected save propagates; earlier successful writes are not rolled back by this function. It neither mutates the current Map nor establishes a durable cursor. Inspect the injected save boundary for retries and transactions." } }] },
  { id: "record-storage", profile: "storage-repository", source: `export interface Order {id: string; status: string}
export class OrderRepository { private orders = new Map<string, Order>(); get(id: string) { return this.orders.get(id); } put(order: Order) { this.orders.set(order.id, order); } delete(id: string) { return this.orders.delete(id); } }
`, articles: [{ type: "s05", title: "In-memory order repository", task: "Find persistence limitations and access methods", slots: {
    models: "OrderRepository in src/index.ts stores Order objects with id and status in a private Map. get, put and delete use the ID as key.",
    consistency: "This is process-local memory. No database persistence, TTL, transaction or cross-process consistency is implemented. Inspect callers for ownership and lifetime before using it as durable storage." } }] },
  { id: "remote-adapter", profile: "adapter-integration", source: `export interface Transport {send(path: string, body: unknown): Promise<unknown>}
export function createAdapter(transport: Transport) { return {submit(id: string) { return transport.send("/submit", {order_id: id}); }}; }
`, articles: [{ type: "s06", title: "Submission adapter boundary", task: "Find the actual mapping and unproven remote behavior", slots: {
    requests: "createAdapter in src/index.ts maps submit(id) to injected Transport.send('/submit', {order_id: id}).",
    failures: "The adapter returns the transport promise without retry or error translation. Locate the selected Transport implementation and remote contract; this wrapper does not establish the final server route or runtime response." } }] },
  { id: "authoritative-contract", profile: "contract-source", source: `export interface GetOrderRequest { id: string }
export interface GetOrderResponse { id: string; status: "draft" | "submitted" }
export interface OrderApi { getOrder(request: GetOrderRequest): Promise<GetOrderResponse> }
`, articles: [{ type: "s02", title: "Order declaration contract", task: "Locate request and response authority", slots: {
    catalog: "OrderApi.getOrder in src/index.ts accepts GetOrderRequest and resolves GetOrderResponse with draft or submitted status.",
    authority: "These interfaces declare a contract. No handler, storage call, HTTP method or runtime validator exists in this source. Follow the authorized implementation separately." } }] },
  { id: "generated-client", profile: "derived-generated-source", source: `// Generated from contracts/order.schema.json. Do not edit this generated surface.
export interface GeneratedOrder {id: string; status: string}
export function getOrderPath(id: string) { return "/orders/" + encodeURIComponent(id); }
`, articles: [{ type: "c07", title: "Generated client provenance", task: "Find the authoritative change entry", slots: {
    evidence: "src/index.ts declares that this surface is generated from contracts/order.schema.json. That schema is not included in the fixture; the comment is a provenance pointer, not proof of its contents.",
    entries: "getOrderPath builds an encoded path and GeneratedOrder declares fields. Neither is business execution evidence. Read the authorized schema and generation configuration before modifying the generated surface." } }] },
];
