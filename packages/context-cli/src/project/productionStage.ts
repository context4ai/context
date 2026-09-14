import { z } from "zod";
import { indexerProtocolDigest, indexerKnowledgeCollectionSchema } from "@c4a/context";
import { isSafeKnowledgeTargetPath, knowledgeTargetPathKey } from "./candidateLedger.js";

const name = z.string().trim().min(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const productionCapabilitiesSchema = z.object({
  multi_agent: z.boolean().default(false),
  skills: z.array(z.object({ name, entry: name.optional() }).strict()).default([]),
}).strict();

export const productionIndexerUsageSchema = z.object({
  scopes: z.array(name).min(1),
  skills: z.array(name).min(1),
  purpose: name,
}).strict();

const taskSource = z.object({ scope: name, baseline: digest }).strict();
export const productionTaskSchema = z.object({
  id,
  input: digest,
  article_id: name,
  path: name,
  question: name,
  sources: z.array(taskSource).min(1),
  base: digest.nullable(),
  batch: id,
  after: z.array(id).default([]),
  status: z.enum(["pending", "issued", "accepted", "excluded", "replaced", "blocked"]),
  reason: name.optional(),
  brief: z.string().optional(),
  accepted: z.object({ content_digest: digest, receipt: name }).strict().optional(),
}).strict();

/** This file describes temporary task state only. Graph still selects the
 * lifecycle phase; this state never decides review, publication or authority. */
export const productionStageSchema = z.object({
  id,
  purpose: name,
  // An authorized but unavailable source has no observed version yet. Tasks
  // still require a real digest; null never authorizes a writer.
  scopes: z.array(taskSource.extend({ baseline: digest.nullable() })),
  pending_scopes: z.array(name),
  tasks: z.array(productionTaskSchema),
  indexer_usage: z.array(productionIndexerUsageSchema).default([]),
  planning_complete: z.boolean().default(true),
  report_approved: z.boolean().default(false),
  delivery: z.array(id).min(1).optional(),
  gaps: z.array(z.object({ scope: name, reason: name }).strict()).default([]),
}).strict();

export type ProductionTask = z.infer<typeof productionTaskSchema>;
export type ProductionStage = z.infer<typeof productionStageSchema>;
export type ProductionCapabilities = z.infer<typeof productionCapabilitiesSchema>;

export function productionTaskInput(task: Omit<ProductionTask, "input">): string {
  // Batch placement, temporary Indexer choice, progress and unrelated tasks
  // never revoke a writer's unchanged task. Sources and target content do.
  return indexerProtocolDigest({ article_id: task.article_id, path: task.path,
    question: task.question, sources: [...task.sources].sort((a, b) => a.scope.localeCompare(b.scope)),
    base: task.base, ...(task.brief === undefined ? {} : { brief: task.brief }) });
}

const terminal = new Set<ProductionTask["status"]>(["accepted", "excluded", "replaced"]);

export function validateProductionStage(value: unknown): ProductionStage {
  const stage = productionStageSchema.parse(value);
  const tasks = new Map(stage.tasks.map(task => [task.id, task]));
  const scopes = new Map(stage.scopes.map(scope => [scope.scope, scope.baseline]));
  if (stage.delivery && (new Set(stage.delivery).size !== stage.delivery.length ||
      stage.delivery.some(id => tasks.get(id)?.status !== "accepted"))) {
    throw new TypeError("Delivery must select distinct accepted tasks from this stage");
  }
  if (tasks.size !== stage.tasks.length || scopes.size !== stage.scopes.length) {
    throw new TypeError("Stage task and scope identities must be unique");
  }
  if (new Set(stage.pending_scopes).size !== stage.pending_scopes.length ||
      stage.pending_scopes.some(scope => !scopes.has(scope)) || stage.gaps.some(gap => !scopes.has(gap.scope))) {
    throw new TypeError("Pending investigation and gaps must name authorized stage scopes");
  }
  if (stage.scopes.some(source => source.baseline === null &&
      (!stage.pending_scopes.includes(source.scope) || !stage.gaps.some(gap => gap.scope === source.scope)))) {
    throw new TypeError("An unavailable source requires an explicit gap and pending investigation");
  }
  for (const usage of stage.indexer_usage) {
    if (usage.scopes.some(scope => !scopes.has(scope))) throw new TypeError("Indexer usage cannot extend the authorized stage scope");
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(task: ProductionTask) {
    if (visiting.has(task.id)) throw new TypeError("Task dependencies must not contain a cycle");
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.after) {
      const previous = tasks.get(dependency);
      if (!previous) throw new TypeError(`Unknown dependency ${dependency} for task ${task.id}`);
      visit(previous);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  }
  for (const task of stage.tasks) {
    indexerKnowledgeCollectionSchema.parse(task.path.split("/")[0]);
    if (!isSafeKnowledgeTargetPath(task.path.split("/")[0]!, task.path)) throw new TypeError(`Unsafe article target for ${task.id}`);
    if (task.input !== productionTaskInput(task)) throw new TypeError(`Task input does not match its actual materials: ${task.id}`);
    if (new Set(task.sources.map(source => source.scope)).size !== task.sources.length ||
        (!terminal.has(task.status) && task.sources.some(source => !scopes.has(source.scope)))) throw new TypeError(`Task ${task.id} requires unique authorized sources`);
    if (new Set(task.after).size !== task.after.length) throw new TypeError(`Task ${task.id} repeats a dependency`);
    visit(task);
  }
  return stage;
}

export interface ProductionDispatch {
  mode: "single-agent" | "multi-agent";
  batches: Array<{ id: string; tasks: string[] }>;
  state: "active" | "waiting-user" | "blocked" | "ended";
}

/** Select tasks within an already authorized writing stage. No source or
 * Indexer identity boundary is added to the Agent's semantic grouping. */
export function dispatchProductionStage(stage: ProductionStage, capabilities: ProductionCapabilities): ProductionDispatch {
  if (!stage.planning_complete) return { mode: "single-agent", batches: [], state: "active" };
  if (!stage.report_approved) return { mode: "single-agent", batches: [], state: "waiting-user" };
  if (stage.delivery) return { mode: "single-agent", batches: [], state: "waiting-user" };
  const tasks = new Map(stage.tasks.map(task => [task.id, task]));
  const scopeBaselines = new Map(stage.scopes.map(scope => [scope.scope, scope.baseline]));
  const unavailableScopes = new Set(stage.gaps.map(gap => gap.scope));
  const available = stage.tasks.filter(task =>
    (task.status === "pending" || task.status === "issued") &&
    !task.sources.some(source => unavailableScopes.has(source.scope)) &&
    task.after.every(id => tasks.get(id)?.status === "accepted") &&
    task.sources.every(source => scopeBaselines.get(source.scope) === source.baseline));
  // Keep issued work ahead of unissued work on downgrade. The coordinator must
  // finish/handoff old workers; their input handles and directories stay valid.
  available.sort((a, b) => Number(b.status === "issued") - Number(a.status === "issued"));
  const selected = new Map<string, string[]>();
  const paths = new Set<string>();
  const articles = new Set<string>();
  for (const task of available) {
    if (!capabilities.multi_agent && selected.size > 0 && !selected.has(task.batch)) continue;
    if (paths.has(knowledgeTargetPathKey(task.path)) || articles.has(task.article_id)) continue;
    const group = selected.get(task.batch) ?? [];
    group.push(task.id);
    selected.set(task.batch, group);
    paths.add(knowledgeTargetPathKey(task.path));
    articles.add(task.article_id);
  }
  const batches = [...selected].map(([id, tasks]) => ({ id, tasks }));
  const complete = stage.tasks.every(task => terminal.has(task.status)) && stage.pending_scopes.length === 0 && stage.gaps.length === 0;
  return { mode: capabilities.multi_agent && batches.length > 1 ? "multi-agent" : "single-agent", batches,
    state: complete ? "ended" : batches.length || stage.pending_scopes.length ? "active" : "blocked" };
}

/** Agent changes a plan, not saved articles. Validate the entire replacement
 * before marking any old task replaced; caller atomically persists this value. */
export function reviseProductionPlan(input: {
  stage: ProductionStage;
  tasks: ProductionTask[];
  replaces?: string[];
  pending_scopes?: string[];
}): ProductionStage {
  const replaces = new Set(input.replaces ?? []);
  const known = new Map(input.stage.tasks.map(task => [task.id, task]));
  if (replaces.size > 0 && input.tasks.length === 0) throw new TypeError("Replacement requires the new task; exclusion is a separate scope decision");
  for (const id of replaces) {
    const task = known.get(id);
    if (!task || terminal.has(task.status)) throw new TypeError(`Task ${id} cannot be replaced; saved content requires an explicit revision`);
    if (input.stage.tasks.some(other => !replaces.has(other.id) && other.after.includes(id) && !terminal.has(other.status))) {
      throw new TypeError(`Replace dependent plans together with ${id}; do not silently abandon their dependency`);
    }
  }
  for (const task of input.tasks) {
    if (known.has(task.id)) throw new TypeError(`New task identity already exists: ${task.id}`);
    if (task.status !== "pending") throw new TypeError("A new plan task must be pending, not already accepted or issued");
    if (task.sources.some(source => !input.stage.scopes.some(scope => scope.scope === source.scope && scope.baseline === source.baseline))) {
      throw new TypeError(`New task ${task.id} must use the current authorized source baseline`);
    }
  }
  return validateProductionStage({ ...input.stage,
    pending_scopes: input.pending_scopes ?? input.stage.pending_scopes,
    tasks: [...input.stage.tasks.map(task => replaces.has(task.id) ? { ...task, status: "replaced" } : task), ...input.tasks] });
}
