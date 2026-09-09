import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { revisionStoragePath } from "./maintenanceStorage.js";
import { newKnowledgePageTarget, type NewKnowledgePage } from "./newKnowledgePage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { indexerCurrentActionInputDefinitions, indexerProtocolDigest, processedScopesSchema, readProcessedScopes,
  processedVersionForScope, indexRequirementSchema, } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { prepareApprovedRevision, readApprovedRevision } from "./approvedRevision.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { captureProcessedScopes, currentScopeSourceVersion, commitProcessedScopes } from "./processedScopeStorage.js";
import { currentLedger } from "./indexerMainRunStoreRecords.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { withProjectWriteLock } from "./writeLock.js";

export const knowledgeUpdateInputSchema = z.object({
  scopes: z.array(z.object({ requirement_ref: z.string().min(1), source_ref: z.string().min(1),
    module_refs: z.array(z.string().min(1)).min(1).optional(), processed_version: z.string().min(1).optional() }).strict()).min(1),
  changes: z.string().optional(),
}).strict();
const updateSchema = z.object({
  protocol: z.literal("context.source-update/v1"), revision: z.string(),
  scopes: processedScopesSchema,
  requirements: z.array(indexRequirementSchema),
  candidates: z.array(z.object({ path: z.string(), title: z.string(), source_refs: z.array(z.string()),
    view_ref: z.string() }).strict()),
  refresh_sources: z.array(z.string().min(1)).min(1).optional(),
  structure_proposal: indexerCurrentActionInputDefinitions.sourceUpdate.omit({ stage: true }).optional(),
  previous_versions: z.array(z.string().nullable()), changes: z.string().optional(),
}).strict();
export type KnowledgeUpdate = z.infer<typeof updateSchema>;

export async function readKnowledgeUpdate(projectRoot: string): Promise<KnowledgeUpdate | undefined> {
  let value: unknown;
  try { value = JSON.parse(await readFile(join(projectRoot, await revisionStoragePath(projectRoot)), "utf8")); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
  if (!value || typeof value !== "object" || !("protocol" in value) || value.protocol !== "context.source-update/v1") return undefined;
  const update = updateSchema.parse(value);
  const { revision, ...payload } = update;
  if (indexerProtocolDigest(payload) !== revision) throw new TypeError("Source update request digest is invalid");
  return update;
}

export async function beginKnowledgeUpdate(projectRoot: string, value: unknown) {
  return withProjectWriteLock(projectRoot, "begin-knowledge-update", async () => {
    const input = knowledgeUpdateInputSchema.parse(value);
    const { readTaskRollback } = await import("./taskRollback.js");
    if (await readTaskRollback(projectRoot) || await readApprovedRevision(projectRoot) || await readKnowledgeUpdate(projectRoot) || await currentLedger(projectRoot) || (await readCandidateRecords(projectRoot)).length > 0) {
      throw new TypeError("Finish or explicitly roll back the active task before starting an independent source update.");
    }
    const versions = new Map<string, Promise<string>>();
    const scopes = await captureProcessedScopes(projectRoot, await Promise.all(input.scopes.map(async (scope) => {
      if (!versions.has(scope.source_ref)) versions.set(scope.source_ref, currentScopeSourceVersion(projectRoot, scope.source_ref));
      return { ...scope, processed_version: scope.processed_version ?? await versions.get(scope.source_ref)! };
    })));
    const structure = await readKnowledgeStructure(projectRoot);
    if (!structure.parsed) throw new TypeError("Close the existing knowledge before checking source updates");
    const views: unknown[] = Array.isArray(structure.parsed.views) ? structure.parsed.views : [];
    const candidates = views.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const view = value as Record<string, unknown>;
      const refs = Array.isArray(view.sources) ? view.sources.filter((ref): ref is string => typeof ref === "string") : [];
      if (!refs.some((ref) => scopes.some((scope) => ref === scope.source_ref || ref.startsWith(`${scope.source_ref}/`) || ref.startsWith(`${scope.source_ref}#`)))) return [];
      return [{ path: String(view.path), title: String(view.title), view_ref: String(view.view_ref), source_refs: refs }];
    });
    const { registry } = await loadIndexerRegistry(projectRoot);
    const requirementIds = new Set(scopes.map((scope) => scope.requirement_ref));
    const requirements = registry.requirements.filter((requirement) => requirementIds.has(requirement.id));
    const payload = { protocol: "context.source-update/v1" as const, scopes, requirements, candidates,
      previous_versions: scopes.map((scope) => processedVersionForScope(readProcessedScopes(structure.parsed), scope) ?? null),
      ...(input.changes === undefined ? {} : { changes: input.changes }) };
    const request = updateSchema.parse({ ...payload, revision: indexerProtocolDigest(payload) });
    await atomicWriteFile(join(projectRoot, await revisionStoragePath(projectRoot)), `${JSON.stringify(request)}\n`);
    return { outcome: "update-prepared", revision: request.revision,
      next_action: { command: "context status --format json" } };
  });
}

export async function completeKnowledgeUpdate(input: { projectRoot: string; revision: string;
  decisions: Array<{ path: string; instruction?: string | undefined; supporting_sources?: string[] | undefined }>; scope_summary: string; new_topics: NewKnowledgePage[]; structure_approved?: boolean }) {
  return withProjectWriteLock(input.projectRoot, "resolve-knowledge-update", async () => {
    const request = await readKnowledgeUpdate(input.projectRoot);
    if (!request || request.revision !== input.revision) throw new TypeError("Source update revision is stale; refresh context status --format json");
    if (request.refresh_sources) throw new TypeError("Import adjusted source inputs, then run context task adjust with refresh: true before deciding pages.");
    const { registry } = await loadIndexerRegistry(input.projectRoot);
    const ids = new Set(request.scopes.map((scope) => scope.requirement_ref));
    if (indexerProtocolDigest(registry.requirements.filter((requirement) => ids.has(requirement.id))) !== indexerProtocolDigest(request.requirements)) {
      throw new TypeError("The confirmed purpose or scope changed. Refresh the source update before deciding its pages; no baseline was advanced.");
    }
    for (const page of input.new_topics) {
      newKnowledgePageTarget(page);
      if (page.source_refs.some((ref) => !request.scopes.some((scope) => ref === scope.source_ref || ref.startsWith(`${scope.source_ref}/`)))) {
        throw new TypeError("New topic references material outside the confirmed update scope");
      }
    }
    for (const decision of input.decisions) {
      if (decision.supporting_sources && (!decision.instruction || decision.supporting_sources.some((ref) =>
        !request.scopes.some((scope) => ref === scope.source_ref)))) {
        throw new TypeError("Supporting sources must belong to the confirmed update and accompany a concrete revision instruction");
      }
    }
    const paths = [...input.decisions.map((decision) => decision.path), ...input.new_topics.map((page) => page.path)];
    if (new Set(paths).size !== paths.length) throw new TypeError("Update page paths must be unique");
    const selected = new Set(input.decisions.map((decision) => decision.path));
    if (selected.size !== input.decisions.length || selected.size !== request.candidates.length ||
        request.candidates.some((candidate) => !selected.has(candidate.path))) {
      throw new TypeError("Decide each source-bound candidate once; an omitted page is not a no-change decision");
    }
    await captureProcessedScopes(input.projectRoot, request.scopes);
    const revisions: Array<{ path: string; instruction: string; create?: NewKnowledgePage; supporting_sources?: string[] | undefined }> = input.decisions.filter((decision): decision is { path: string; instruction: string } =>
      typeof decision.instruction === "string" && decision.instruction.trim().length > 0);
    revisions.push(...input.new_topics.map((page) => ({ path: page.path, instruction: page.instruction, create: page })));
    if (input.new_topics.length && !input.structure_approved) {
      const { revision: _revision, ...rest } = request;
      void _revision;
      const payload = { ...rest, structure_proposal: { decisions: input.decisions, scope_summary: input.scope_summary, new_topics: input.new_topics } };
      await atomicWriteFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), `${JSON.stringify({ ...payload, revision: indexerProtocolDigest(payload) })}\n`);
      return { outcome: "structure-review-required" as const };
    }
    const [first, ...remaining] = revisions;
    if (!first) {
      await commitProcessedScopes(input.projectRoot, request.scopes);
      const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
      await clearCompletedLifecycle(input.projectRoot);
      return { outcome: "unchanged" as const };
    }
    await prepareApprovedRevision({ projectRoot: input.projectRoot, replace_current: true, selector: first.path,
      instruction: first.instruction, pending_targets: remaining, processed_scopes: request.scopes, requirements: request.requirements,
      ...(first.supporting_sources === undefined ? {} : { supporting_sources: first.supporting_sources }),
      ...(first.create === undefined ? {} : { create: first.create }) });
    return { outcome: "revisions-prepared" as const, page_count: revisions.length };
  });
}


export async function completeUpdateStructureReview(input: { projectRoot: string; revision: string;
  decision: "approved" | "exclude-obsolete" | "request-adjustment"; feedback?: string }) {
  return withProjectWriteLock(input.projectRoot, "review-update-structure", async () => {
    const request = await readKnowledgeUpdate(input.projectRoot);
    if (!request?.structure_proposal || request.revision !== input.revision) throw new TypeError("Update structure review is stale");
    if (input.decision === "approved") return completeKnowledgeUpdate({ ...input, ...request.structure_proposal, structure_approved: true });
    if (input.decision !== "request-adjustment" || !input.feedback) throw new TypeError("Review the proposed new paths: approve or request adjustment with feedback.");
    const { revision: _revision, structure_proposal: _proposal, ...rest } = request;
    void _revision; void _proposal;
    const payload = { ...rest, changes: `${rest.changes ?? ""}\nStructure feedback: ${input.feedback}` };
    await atomicWriteFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), `${JSON.stringify({ ...payload, revision: indexerProtocolDigest(payload) })}\n`);
    return { outcome: "structure-adjustment-required" as const };
  });
}
