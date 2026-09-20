import { existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import { readProductionStage, productionStageDirectory, readProductionCapabilities, productionPlanMarkdown, writeProductionProjection } from "./productionStageStore.js";
import { productionAgentDirectory } from "./productionSubmissionFiles.js";
import { dispatchProductionStage } from "./productionStage.js";
import { productionReportRevision } from "./productionReport.js";
import { loadContextWorkflowProvider, projectWorkflowResourceLocation, projectWorkflowRouteAction } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority, ContextWorkflowResource } from "./workflow/workflowTypes.js";
import { productionPlanningRoute } from "./productionPlanningRoute.js";
import { productionPlanningIsPrepared, productionRequirementsAreCurrent } from "./productionPlanning.js";
import { readCandidateRecords } from "./candidateLedger.js";

/** Graph owns report/prepare/write/block ordering; this adapter supplies current
 * stage facts and concrete paths. It does not initialize sources or a plan. */
export async function productionWorkflowRoute(input: {
  projectRoot: string; authorities: readonly ContextWorkflowAuthority[];
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  const stage = await readProductionStage(input.projectRoot);
  if (!stage || !stage.planning_complete) return productionPlanningRoute(input, stage);
  if (!await productionRequirementsAreCurrent(input.projectRoot, stage)) return productionPlanningRoute(input, stage);
  if (stage.delivery) return undefined;
  if (!stage.report_approved && !await productionPlanningIsPrepared(input.projectRoot, stage)) return productionPlanningRoute(input, stage);
  const previousCapabilities = await readProductionCapabilities(input.projectRoot, stage.id);
  const dispatch = dispatchProductionStage(stage, previousCapabilities);
  const rejected = dispatch.state === "ended"
    ? (await readCandidateRecords(input.projectRoot)).filter(candidate => candidate.status === "rejected") : [];
  const directory = productionStageDirectory(stage.id);
  const selected = new Set(dispatch.batches.flatMap(batch => batch.tasks));
  const context = { workspace: input.projectRoot, authorities: [...input.authorities], facts: { production: {
    report_approved: stage.report_approved,
    prepared: !dispatch.batches.length || (existsSync(join(input.projectRoot, directory, "stage.md")) &&
      stage.tasks.filter(task => selected.has(task.id)).every(task => task.status === "issued")),
    writing_complete: dispatch.batches.length === 0,
    complete: dispatch.state === "ended",
    review_clear: rejected.length === 0,
    investigation_clear: !stage.pending_scopes.some(scope => !stage.gaps.some(gap => gap.scope === scope)),
  } } };
  const provider = await loadContextWorkflowProvider();
  const evaluated = evaluateGraph(provider, "indexer", "production", context);
  const primary = evaluated.evaluation.primaryRoute;
  if (!primary) {
    if (evaluated.evaluation.statusCode === "complete") return undefined;
    throw new TypeError("The production graph has no current route");
  }
  const resolved = await resolveRoute(provider, "indexer", "production", primary.routeId, context, evaluated.evaluation.revision);
  const report = resolved.node === "confirm-production-report";
  if (report) await writeProductionProjection(input.projectRoot, join(directory, "plan.md"), productionPlanMarkdown(stage));
  const prepare = resolved.node === "prepare-production-stage";
  const writing = resolved.node === "work-production-stage";
  const repair = resolved.node === "repair-production-articles";
  const investigate = resolved.node === "continue-production-investigation";
  const gap = resolved.node === "resolve-production-gap";
  const revision = report ? productionReportRevision(stage) : stage.id;
  const agent = productionAgentDirectory(stage.id);
  const path = `${agent}/submissions/${report ? "report" : repair || investigate ? "plan-amendment" : "ready"}.yaml`;
  const command = prepare || gap ? `context action prepare-current --revision ${revision} --format json`
    : `context action complete-current --revision ${revision} --input ${path} --format json`;
  const required = resolved.resources.required.map(location => projectWorkflowResourceLocation(location, revision, input.authorities));
  const resource = (path: string): ContextWorkflowResource => ({ id: `production/${stage.id}/${report ? "plan" : "stage"}`,
    kind: "context-view", media_type: "text/markdown", path: join(input.projectRoot, directory, path), read_state: "read-required" });
  if (report || writing) required.push(resource(report ? "plan.md" : "stage.md"));
  if (investigate) {
    required.push(resource("stage.md"));
    required.push({ id: `production/${stage.id}/planning`, kind: "context-view", media_type: "text/markdown",
      path: join(input.projectRoot, directory, "planning.md"), read_state: "read-required" });
  }
  if (repair) {
    await writeProductionProjection(input.projectRoot, join(directory, "repair.md"), ["# Revise rejected articles", "",
      ...rejected.map(candidate => `- ${candidate.path}: ${candidate.review.title}`), "",
      "Use the user's Review feedback to add revision tasks for these article paths. Rejection does not cancel their planned responsibilities. Ask for missing feedback instead of guessing the reason.",
      `Submit the plan amendment to ${path} using ${join(directory, "planning.schema.json")}. Keep accepted task identities unchanged; the CLI assigns the revision tasks and preserves article identities.`,
      "Once issued, repair the affected sections through the existing edits submission. Unchanged sections and references do not need resubmission.", ""].join("\n"));
    required.push({ id: `production/${stage.id}/repair`, kind: "context-view", media_type: "text/markdown",
      path: join(input.projectRoot, directory, "repair.md"), read_state: "read-required" });
  }
  const resolution = resolved.gate?.resolutionAction?.action;
  const action = resolution ? projectWorkflowRouteAction({ action: { ...resolution, input: { stage: stage.id, decision: "approved" } }, revision,
    authorities: input.authorities }) : undefined;
  return { protocol: "context.workflow.route.v1", id: resolved.routeId, node: resolved.node,
    revision, reason_code: resolved.reasonCode, availability: resolved.availability,
    summary: report ? `Present the report and apply context.gate.work_start_scope. After the applicable scope decision, write {stage: ${stage.id}, decision: approved} to ${path}.`
      : writing ? "Read the issued task directories. Coordinate them sequentially unless this caller supports independent Agents; only the coordinator submits shared state."
      : repair ? "Add revision tasks for rejected articles using the Review feedback; accepted production responsibilities remain unchanged."
      : investigate ? `Review pending configured scopes: ${stage.pending_scopes.filter(scope => !stage.gaps.some(gap => gap.scope === scope)).join(", ")}. Check their relevance to the current request and existing approved content before assigning investigation. Submit supported article tasks and remaining pending_scopes; do not infer missing articles from this list or repeat accepted work. If the requested articles are already accepted, context run --deliver --format json enters their Review while retaining unrelated pending scopes.`
      : resolved.node === "resolve-production-gap" ? `Source availability gaps: ${stage.gaps.map(gap => `${gap.scope}: ${gap.reason}`).join("; ")}. These failures do not establish missing knowledge or a new investigation assignment. Identify which sources the current task actually depends on; report unrelated configured-source failures separately. Preserve the configuration. To review completed articles independently, use context run --deliver --format json; this retains pending scopes and does not approve or publish content. If these sources are required, use context source recovery-plan --format json and context source restore with explicit local or clone decisions before preparation.` : "Prepare the current stage's eligible task directories.",
    commands: report || prepare || writing || repair || investigate || gap ? [{ command, effect: "write", availability: report || gap ? "after-human-confirmation" : "immediate",
      managed_execution: prepare ? "automatic" : "agent-required" }] : [],
    ...(resolved.gate ? { gate: { id: resolved.gate.id, delegatable: false, resolution: "user" as const,
      ...(action && action.effect !== "read" ? { resolution_action: { ...action, effect: action.effect } } : {}) } } : {}),
    resources: { required, recommended: resolved.resources.recommended.map(location => projectWorkflowResourceLocation(location, revision, input.authorities)) },
    after_action: { evaluate: true } };
}
