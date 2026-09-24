import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { indexerProtocolDigest } from "@c4a/context";
import { inspectProductionRequirements, productionSourceIsExcluded, type ProductionRequirements } from "./productionRequirements.js";
import { prepareProductionPlanningMaterials } from "./productionPlanningMaterials.js";
import { productionSourceBaseline } from "./productionSubmission.js";
import { productionCapabilitiesSchema, productionIndexerUsageSchema, productionTaskInput, validateProductionStage, reviseProductionPlan, type ProductionStage } from "./productionStage.js";
import { materializeProductionStage, readProductionStage, productionStageDirectory,
  productionSourceFile, writeProductionProjection } from "./productionStageStore.js";
import { productionAgentDirectory, readProductionFile, type FixedProductionFile } from "./productionSubmissionFiles.js";
import { withProjectWriteLock } from "./writeLock.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { productionApprovedTargetsIndex, productionArticleTargetDigest, readProductionArticleTarget } from "./productionArticleTarget.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { productionExistingArticleNavigation } from "./productionExistingArticles.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import { readMaintenance } from "./maintenanceStorage.js";
import { withProductionFeedback } from "./productionFeedback.js";
import { resolveProductionExclusions } from "./productionExclusions.js";

import { authorizedProductionSources, selectProductionSources, scopedProductionRequirements, productionRequestedSources, activeProductionSources, saveExpandedProductionScope } from "./productionScope.js";

import { productionSourceSummary, productionSourceSummaryMarkdown } from "./productionSourceSummary.js";

function refreshRequired(stage: string, message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    ...detail,
    category: ErrorCategory.UserInputInvalid, reason_code: "production-planning-refresh-required",
    next_action: { command: `context action prepare-current --revision ${stage} --format json` },
  });
}

const text = z.string().trim().min(1);
export const productionPlanInputSchema = z.object({
  stage: text,
  capabilities: productionCapabilitiesSchema,
  articles: z.array(z.object({ path: text.describe("Relative to knowledge/, e.g. business/example.md; do not prefix knowledge/"), question: text, sources: z.array(text).min(1),
    batch: text, after: z.array(text).default([]), brief: text.optional() }).strict()),
  indexer_usage: z.array(productionIndexerUsageSchema).default([]),
  replaces: z.array(text).default([]),
  pending_scopes: z.array(text).describe("Exact authorized source refs from the current stage scopes; no prose or module descriptions. Omit on amendments to preserve remaining investigation.").optional(),
}).strict();

/** Read-only bootstrap identity. A missing temporary stage starts new work;
 * it never reconstructs an old candidate or task from formal storage. */
export async function productionPlanningRequest(root: string) {
  const requirements = await inspectProductionRequirements(root);
  if (!requirements) return undefined;
  const resolved = await resolveProductionExclusions(requirements.requirements, source => productionSourceBaseline(root, source));
  return { ...resolved, revision: indexerProtocolDigest(resolved.requirements) };
}

/** Cheap navigation freshness, not a source re-scan or skill verification.
 * Actual source snapshots are checked at plan submission. */
export async function productionPlanningIsPrepared(root: string, stage: ProductionStage): Promise<boolean> {
  try {
    const directory = productionStageDirectory(stage.id);
    const current = await productionPlanningRequest(root);
    const supplied = YAML.parse(await readFile(await safeProjectTarget(root, join(directory, "shared/requirements.md")), "utf8"));
    await access(await safeProjectTarget(root, join(directory, "planning.md")));
    await access(await safeProjectTarget(root, join(directory, "planning.schema.json")));
    return !!current && indexerProtocolDigest(scopedProductionRequirements(current.requirements, productionRequestedSources(stage))) === indexerProtocolDigest(scopedProductionRequirements(supplied as ProductionRequirements, productionRequestedSources(stage)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function productionRequirementsAreCurrent(root: string, stage: ProductionStage): Promise<boolean> {
  try {
    const current = await productionPlanningRequest(root);
    const supplied = YAML.parse(await readFile(await safeProjectTarget(root,
      join(productionStageDirectory(stage.id), "shared/requirements.md")), "utf8"));
    return !!current && indexerProtocolDigest(scopedProductionRequirements(current.requirements, productionRequestedSources(stage))) === indexerProtocolDigest(scopedProductionRequirements(supplied as ProductionRequirements, productionRequestedSources(stage)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return false;
}

export async function assertProductionPlanRequirementsCurrent(root: string, stage: ProductionStage): Promise<void> {
  if (!await productionRequirementsAreCurrent(root, stage)) throw refreshRequired(stage.id,
    "Confirmed requirements changed or their planning snapshot is missing; refresh the plan before submitting");
}

export async function prepareInitialProductionPlanning(input: { projectRoot: string; revision: string; sources?: string[] }) {
  return withProjectWriteLock(input.projectRoot, "production-planning", async () => {
    const previous = await readProductionStage(input.projectRoot);
    if (previous && (previous.id !== input.revision || previous.report_approved && await productionRequirementsAreCurrent(input.projectRoot, previous))) {
      throw new TypeError("Use the current stage. Unchanged approved requirements continue through task-specific revisions");
    }
    const request = await productionPlanningRequest(input.projectRoot);
    if (!request || (!previous && request.revision !== input.revision)) throw new TypeError("Production requirements changed; read the current route");
    const authorized = new Set(authorizedProductionSources(request.requirements, true));
    const requested = selectProductionSources(request.requirements, input.sources ?? (previous
      ? productionRequestedSources(previous).filter(source => authorized.has(source)) : undefined), true);
    const scopeNames = requested.filter(source => !productionSourceIsExcluded(request.requirements, source));
    const scoped = scopedProductionRequirements(request.requirements, requested);
    const prepared = await prepareProductionPlanningMaterials({ projectRoot: input.projectRoot, requirements: scoped, scopes: new Set(scopeNames) });
    const sourceMaterials = new Map(prepared.materials.sources);
    const scopes: ProductionStage["scopes"] = [];
    for (const scope of scopeNames) {
      try { scopes.push({ scope, baseline: await productionSourceBaseline(input.projectRoot, scope) }); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        scopes.push({ scope, baseline: null });
        prepared.gaps = [...prepared.gaps.filter(gap => gap.scope !== scope), { scope, reason }];
        sourceMaterials.set(scope, `# ${scope}\n\nSource baseline is unavailable: ${reason}\n\nRestore the authorized source and retry preparation.\n`);
      }
    }
    const guidance = await productionExistingArticleNavigation(input.projectRoot);
    const stage = validateProductionStage({ id: randomUUID(), purpose: scoped.requirements.map(item =>
      item.purpose ?? item.reader_goals?.join("; ") ?? item.questions!.join("; ")).join("\n"),
    requested_sources: requested, scopes, pending_scopes: scopeNames,
    tasks: previous?.tasks.filter(task => previous.report_approved || ["accepted", "excluded", "replaced"].includes(task.status))
      .map(task => ["accepted", "excluded", "replaced"].includes(task.status) ? task : { ...task, status: "replaced",
        reason: "Long-term requirements changed; the replacement plan requires a new report approval." }) ?? [],
    planning_complete: false, gaps: prepared.gaps });
    const directory = productionStageDirectory(stage.id);
    await writeProductionProjection(input.projectRoot, join(directory, "planning.schema.json"), `${JSON.stringify(zodToJsonSchema(productionPlanInputSchema), null, 2)}\n`);
    await writeProductionProjection(input.projectRoot, join(directory, "planning.md"), ["# Investigate and plan", "",
      `Requirements: ${join(directory, "shared/requirements.md")}`, `Submission schema: ${join(directory, "planning.schema.json")}`,
      `Existing reader topics: ${join(directory, "guidance/existing-articles.md")}`,
      `Stage: ${stage.id}`, "", ...productionSourceSummaryMarkdown(stage), ...scopes.map(scope => `- ${scope.scope}: ${join(directory, productionSourceFile(scope.scope))}`), "",
      "Use code skeletons and document outlines to identify the authorized capability families and document tasks, then selectively read full material to decide reader topics. Navigation is not a complete feature inventory. Keep unchecked scope pending; do not parse all code or maintain per-symbol disposition just to plan.",
      "These materials cover this request's selected sources. Long-term supporting sources remain authorized for later article plans without becoming pending work. Reuse approved content and declare only actual remaining investigation.",
      "Report source baseline/read failures separately from content gaps. Restore the selected dependencies that an article actually needs; do not remove real unfinished investigation or manufacture successful source reads.",
      "Scale planning to the current request. For one or two documents or a clearly bounded module, decide which articles to add or revise and where they belong; do not redesign the whole knowledge base. Start with related existing topics, expand reading only when needed, and reuse applicable decisions. A large module may need several topics, but not investigation of unrelated modules.",
      "Separate the whole requested outcome from the current writing batch. Use one batch unless actual dependencies or useful parallel work justify more; do not invent page counts or dependencies. A first useful delivery does not settle remaining authorized work.",
      "Use question and brief to describe the reader task and useful depth: a checked file/symbol or document section with a concrete next step for navigation, or the behavior, conditions and steps needed for explanation. Reuse or revise existing articles without replacing valid detail with generic summaries; split distinct tasks, not sources or symbols.",
      ...(request.reassess.some(source => requested.includes(source)) ? [`Reassess earlier content exclusions: ${request.reassess.filter(source => requested.includes(source)).join(", ")}. Their source material changed or is unavailable. The stored decisions were preserved but no longer suppress investigation.`] : []),
      "Keep user-confirmed long-term exclusions in the existing requirements file. For a content-based exclusion, retain source_baselines from the supplied stage scopes for the material actually read; changed material is investigated again. Do not turn a temporary failure or an unapproved suggestion into a permanent exclusion.",
      "Declare available relevant skills and whether you can coordinate multiple Agents. Article sources may cross registered source and skill boundaries. Batch dependencies in after name article paths.",
      "Article path is relative to knowledge/ (for example business/example.md, not knowledge/business/example.md). indexer_usage.scopes names authorized source refs from the stage, not knowledge collections. Declare skills here; no separate Indexer registry is required.",
      "List remaining investigation in pending_scopes when submitting a partial plan. This is source/module-level progress, not a per-file ledger. Omit it on a writing amendment to preserve the remaining scope; submit an explicit list to update it. Unresolved material gaps cannot be cleared by declaring their investigation complete.",
      `Write the plan to ${productionAgentDirectory(stage.id)}/submissions/plan.yaml and use the current action command. This does not approve the work-start report.`, ""].join("\n"));
    await materializeProductionStage({ projectRoot: input.projectRoot, stage,
      capabilities: productionCapabilitiesSchema.parse({}), materials: { ...prepared.materials, sources: sourceMaterials, guidance } });
    return { stage_state: "active" as const, source_summary: productionSourceSummary(stage), next: { directory, mode: "single-agent" as const } };
  });
}

export async function submitProductionPlan(input: { projectRoot: string; stage: string; path: string; manifest?: FixedProductionFile }) {
  return withProductionFeedback({ operation: "plan", file: input.path, schema: productionPlanInputSchema },
    () => withProjectWriteLock(input.projectRoot, "production-plan-submit", async () => {
    let stage = await readProductionStage(input.projectRoot);
    if (!stage || stage.id !== input.stage) throw new TypeError("Plan replacement requires the current stage; read the current route");
    if (stage.delivery) throw new TypeError("Finish the requested delivery or run context run --resume-writing --format json before amending the plan.");
    if ((await readMaintenance(input.projectRoot)).active) throw new TypeError("Finish or cancel the active maintenance task before amending the production plan.");
    await assertProductionPlanRequirementsCurrent(input.projectRoot, stage);
    const file = input.manifest ?? await readProductionFile(input);
    const plan = productionPlanInputSchema.parse(YAML.parse(file.text));
    if (plan.stage !== stage.id) throw new TypeError("The submitted plan belongs to a different stage");
    if (new Set(plan.replaces).size !== plan.replaces.length) throw new TypeError("Replacement task identities must be unique");
    if (!stage.report_approved && plan.replaces.length) throw new TypeError("Before report approval, submit the complete plan instead of replacement task identities");
    if (stage.report_approved && !plan.articles.length && plan.pending_scopes === undefined) throw new TypeError("A writing-stage plan amendment needs new tasks or an explicit investigation update");
    const request = (await productionPlanningRequest(input.projectRoot))!;
    const selected = [...new Set([...plan.articles.flatMap(article => article.sources), ...plan.pending_scopes ?? []])];
    if (selected.length) selectProductionSources(request.requirements, selected);
    const existingScopes = new Set(stage.scopes.map(source => source.scope));
    const active = activeProductionSources(stage);
    const additions = selected.filter(source => !existingScopes.has(source) || !active.has(source));
    const additional = await prepareProductionPlanningMaterials({ projectRoot: input.projectRoot,
      requirements: scopedProductionRequirements(request.requirements, additions), scopes: new Set(additions) });
    const scopes = stage.scopes.filter(source => !additions.includes(source.scope));
    for (const scope of additions) {
      try { scopes.push({ scope, baseline: await productionSourceBaseline(input.projectRoot, scope) }); }
      catch (error) {
        scopes.push({ scope, baseline: null });
        additional.gaps = [...additional.gaps.filter(gap => gap.scope !== scope), { scope, reason: error instanceof Error ? error.message : String(error) }];
      }
    }
    stage = { ...stage, requested_sources: [...new Set([...productionRequestedSources(stage), ...selected])], scopes, gaps: [...stage.gaps, ...additional.gaps] };
    const pendingScopes = plan.pending_scopes ?? (stage.report_approved ? stage.pending_scopes : []);
    if (new Set(pendingScopes).size !== pendingScopes.length || pendingScopes.some(scope => !stage.scopes.some(source => source.scope === scope))) {
      throw new TypeError("Pending investigation must name unique authorized stage scopes");
    }
    if (stage.gaps.some(gap => !pendingScopes.includes(gap.scope))) throw refreshRequired(stage.id,
      "Keep unresolved material gaps in pending_scopes. These are current material/baseline read failures, not evidence that knowledge was never captured. Restore required dependencies before preparing their snapshots; do not label every pending source as unavailable.", {
        source_summary: productionSourceSummary(stage),
        missing_pending_scopes: [...new Set(stage.gaps.filter(gap => !pendingScopes.includes(gap.scope)).map(gap => gap.scope))],
      });
    if (plan.articles.some(article => article.sources.some(scope => stage.gaps.some(gap => gap.scope === scope)))) {
      throw refreshRequired(stage.id, "An article requires unavailable material in the captured stage. Restore the required source, including code dependencies of document-led work, then prepare the current stage; independent source plans may proceed.", { source_summary: productionSourceSummary(stage) });
    }
    const relevant = new Set([...activeProductionSources(stage), ...selected]);
    for (const source of stage.scopes) if (relevant.has(source.scope) && !stage.gaps.some(gap => gap.scope === source.scope) &&
      await productionSourceBaseline(input.projectRoot, source.scope) !== source.baseline) {
      throw refreshRequired(stage.id, `Planning source changed: ${source.scope}; refresh the investigation materials`);
    }
    const retained = stage.tasks.filter(task => ["accepted", "excluded", "replaced"].includes(task.status));
    const identities = new Map(plan.articles.map(article => [article.path, indexerProtocolDigest(stage.report_approved || retained.length > 0
      ? { stage: stage.id, submission: file.digest, path: article.path } : article.path).slice(7)]));
    if (identities.size !== plan.articles.length) throw new TypeError("Plan article paths must be unique");
    if (stage.report_approved && identities.size > 0 && [...identities.values()].every(id => stage.tasks.some(task => task.id === id))) {
      const prepared = await materializeProductionStage({ projectRoot: input.projectRoot, stage, capabilities: plan.capabilities });
      return { stage_state: prepared.state, next: { directory: prepared.directory, agent_directory: prepared.agent_directory, mode: prepared.mode,
        ...(prepared.submission ? { submission: prepared.submission } : {}) } };
    }
    const candidates = await readCandidateRecords(input.projectRoot);
    const approved = productionApprovedTargetsIndex(await readApprovedKnowledgeMetadataIndex(input.projectRoot));
    const tasks = [];
    for (const article of plan.articles) {
      if (stage.report_approved && stage.tasks.some(task => task.path === article.path &&
          !["accepted", "excluded", "replaced"].includes(task.status) && !plan.replaces.includes(task.id))) {
        throw new TypeError(`An unfinished task already owns ${article.path}; explicitly replace it instead of scheduling conflicting writers`);
      }
      const prior = candidates.find(candidate => candidate.path === article.path);
      const formal = approved.byPath.get(article.path);
      const markdown = prior?.body ?? (formal ? await readFile(await safeProjectTarget(input.projectRoot, join("knowledge", formal.path)), "utf8") : undefined);
      const sections = prior?.indexer_candidate?.sections.map(section => ({ id: section.section_key, references: section.references })) ?? formal?.sections;
      const task = { id: identities.get(article.path)!, article_id: prior?.article_id ?? formal?.article_id ?? stage.tasks.find(task => task.path === article.path)?.article_id ?? randomUUID(),
        path: article.path, question: article.question, batch: article.batch,
        after: article.after.map(path => { const id = (stage.report_approved || retained.length > 0) && stage.tasks.some(task => task.id === path) ? path : identities.get(path);
          if (!id) throw new TypeError(`Unknown dependency article path or existing task identity: ${path}`); return id; }),
        sources: article.sources.map(scope => { const source = stage.scopes.find(source => source.scope === scope);
          if (!source) throw new TypeError(`Article source is outside authorized scope: ${scope}`);
          if (source.baseline === null) throw refreshRequired(stage.id, `Source ${scope} has no captured version; restore and prepare it before planning an article`);
          return { scope: source.scope, baseline: source.baseline }; }),
        base: markdown === undefined ? null : productionArticleTargetDigest({ markdown, sections, visibility: prior?.visibility ?? formal!.visibility }),
        status: "pending" as const, ...(article.brief ? { brief: article.brief } : {}) };
      const complete = { ...task, input: productionTaskInput(task) };
      await readProductionArticleTarget({ projectRoot: input.projectRoot, task: complete, candidates, readApproved: async () => approved });
      tasks.push(complete);
    }
    const amended = stage.report_approved ? reviseProductionPlan({ stage, tasks, replaces: plan.replaces, pending_scopes: pendingScopes })
      : { ...stage, tasks: [...retained, ...tasks], pending_scopes: pendingScopes, planning_complete: true };
    const usage = stage.report_approved ? [...stage.indexer_usage, ...plan.indexer_usage] : plan.indexer_usage;
    const updated = validateProductionStage({ ...amended, indexer_usage: [...new Map(usage.map(item => [JSON.stringify(item), item])).values()] });
    await saveExpandedProductionScope(input.projectRoot, updated, request.requirements, additional.materials.sources);
    try {
      const prepared = await materializeProductionStage({ projectRoot: input.projectRoot, stage: updated, capabilities: plan.capabilities });
      return { stage_state: prepared.state, ...(prepared.submission ? { next: { directory: prepared.directory, agent_directory: prepared.agent_directory,
        submission: prepared.submission, mode: prepared.mode } } : { next_action: { command: "context status --format json" } }) };
    } catch (error) {
      return { stage_state: "active" as const, next_preparation: { outcome: "failed" as const,
        message: `Plan saved. Directory preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        command: `context action prepare-current --revision ${stage.id} --format json` } };
    }
  }));
}
