import { projectCurrentIndexerGate, projectCurrentIndexerGateResolution } from "./indexerCurrentWorkflowRoute.js";
import { approvedRevisionContext } from "./approvedRevisionContext.js";
import { approvedRevisionRecovery } from "./approvedRevisionRecovery.js";
import { readKnowledgeUpdate } from "./knowledgeUpdate.js";
import { evaluateGraph, resolveRoute, type JsonValue } from "@c4a/agent-graph";
import { readApprovedRevision, assertApprovedRevisionBase, resolveApprovedRevisionAuthor } from "./approvedRevision.js";
import { authorityCommandOptions, loadContextWorkflowProvider, projectWorkflowResourceLocation,
  projectWorkflowRouteAction } from "./workflow/workflowProvider.js";
import type { ContextResolvedWorkflowRoute, ContextWorkflowAuthority } from "./workflow/workflowTypes.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import type { KnowledgeUpdate } from "./knowledgeUpdate.js";

/** Historical and current excerpts dominate a source update; the Route names
 * the file and the Agent reads it only for references it is deciding. */
async function sourceUpdateRouteInput(projectRoot: string, update: KnowledgeUpdate): Promise<Record<string, unknown>> {
  const { reference_evidence: evidence, ...rest } = update;
  if (!evidence?.length) return rest;
  const file = `.tmp/context-runtime/source-update/evidence-${update.revision.replace(/^sha256:/u, "")}.json`;
  if (!existsSync(join(projectRoot, file))) await atomicWriteFile(join(projectRoot, file), `${JSON.stringify(evidence, null, 2)}\n`);
  return { ...rest, reference_evidence_file: file, reference_evidence_count: evidence.length };
}

export async function buildApprovedRevisionRoute(input: {
  projectRoot: string; authorities: readonly ContextWorkflowAuthority[]; managed: boolean;
}): Promise<ContextResolvedWorkflowRoute | undefined> {
  const current = await readApprovedRevision(input.projectRoot);
  const recovery = await approvedRevisionRecovery(input.projectRoot, current);
  const request = recovery?.request ?? await resolveApprovedRevisionAuthor(input.projectRoot, current);
  const update = current === undefined ? await readKnowledgeUpdate(input.projectRoot) : undefined;
  if ((!request || request.candidate !== undefined || request.review_ready) && !update) return undefined;
  if (request) await assertApprovedRevisionBase(input.projectRoot, request);
  const entry = recovery ? "approved-revision-recovery" : update?.structure_proposal ? "update-structure-review" : update ? "source-update" : "approved-revision";
  const provider = await loadContextWorkflowProvider();
  const context = { authorities: [...input.authorities], workspace: input.projectRoot };
  const evaluated = evaluateGraph(provider, "indexer", entry, context);
  const primary = evaluated.evaluation.primaryRoute;
  if (primary === undefined) throw new TypeError("Approved revision Graph route is unavailable");
  const resolved = await resolveRoute(provider, "indexer", entry, primary.routeId,
    context, evaluated.evaluation.revision);
  if (update?.structure_proposal) {
    const revision = update.revision;
    const resolution = projectCurrentIndexerGateResolution({ resolved, revision, authorities: input.authorities,
      value: { stage: "structure-review", scope_summary: update.structure_proposal.scope_summary,
        new_topics: update.structure_proposal.new_topics, affected_existing_pages: update.structure_proposal.decisions.filter((item) => item.instruction) } as unknown as JsonValue });
    return { protocol: "context.workflow.route.v1", id: resolved.routeId, node: resolved.node,
      reason_code: resolved.reasonCode, revision, availability: resolved.availability,
      commands: [{ command: `context${authorityCommandOptions(input.authorities, "workflow")} action complete-current --revision '${revision}'${input.managed ? " --managed" : ""} --input - --format json`,
        effect: "write", availability: resolved.availability === "requires-user" ? "after-human-confirmation" : "immediate", managed_execution: "agent-required" }],
      resources: { required: [], recommended: [] }, gate: projectCurrentIndexerGate(resolved, resolution), after_action: { evaluate: true } };
  }
  if (resolved.action === undefined) throw new TypeError("Approved revision Graph action is unavailable");
  const revision = (update ?? request)!.revision;
  const writingContext = request ? await approvedRevisionContext(input.projectRoot, request.target) : undefined;
  const action = projectWorkflowRouteAction({ action: { ...resolved.action,
    input: (update ? { stage: "source-update", ...await sourceUpdateRouteInput(input.projectRoot, update) } : { stage: "approved-revision", instruction: request!.instruction, writing_context: writingContext, program_blocks: request!.program_blocks ?? [],
      target: request!.target, ...(recovery ? { merge_context: recovery.request.merge_context, recovery: "Merge the latest approved content with the prior draft. Preserve concurrent edits; ask the user when their intent conflicts. Submit the merged Markdown through this exact revision. Review still applies." } : {}), ...(request!.refresh_sources ? { refresh_sources: request!.refresh_sources, next: "Import these explicitly selected sources, then context task adjust --input <input-with-refresh-true> --format json; do not submit page content yet." } : {}), ...(request!.requirements === undefined ? {} : { requirements: request!.requirements }) }) as unknown as JsonValue }, revision, authorities: input.authorities });
  return { protocol: "context.workflow.route.v1", id: resolved.routeId, node: resolved.node,
    reason_code: resolved.reasonCode, revision, availability: resolved.availability,
    commands: [{ command: `context${authorityCommandOptions(input.authorities, "workflow")} action complete-current --revision '${revision}'${input.managed ? " --managed" : ""} --input - --format json`,
      effect: "write", availability: "immediate", managed_execution: "agent-required" },
      ...(request?.pending_targets?.length && !request.refresh_sources && !recovery ? [{
        command: `context${authorityCommandOptions(input.authorities, "workflow")} action prepare-current --revision '${revision}'${input.managed ? " --managed" : ""} --format json`,
        effect: "write" as const, availability: "immediate" as const, managed_execution: "agent-required" as const,
      }] : [])],
    ...(action === undefined ? {} : { action }),
    resources: { required: resolved.resources.required.map((location) => projectWorkflowResourceLocation(location, revision, input.authorities)),
      recommended: resolved.resources.recommended.map((location) => projectWorkflowResourceLocation(location, revision, input.authorities)) }, after_action: { evaluate: true } };
}
