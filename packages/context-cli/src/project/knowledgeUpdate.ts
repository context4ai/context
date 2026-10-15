import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { readProductionRequirements, productionRequirementsSchema } from "./productionRequirements.js";
import { revisionStoragePath } from "./maintenanceStorage.js";
import { newKnowledgePageTarget, type NewKnowledgePage } from "./newKnowledgePage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { validateArticleStructureEntries, indexerCurrentActionInputDefinitions, indexerProtocolDigest, processedScopesSchema, readProcessedScopes,
  processedVersionForScope, } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { prepareApprovedRevision, readApprovedRevision, targetBytes } from "./approvedRevision.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { captureProcessedScopes, currentScopeSourceVersion, commitProcessedScopes } from "./processedScopeStorage.js";
import { readProductionStage } from "./productionStageStore.js";
import { readCandidateRecords } from "./candidateLedger.js";
import { withProjectWriteLock } from "./writeLock.js";
import { SubmissionInputError } from "./productionFeedback.js";
import { repoContentScopeMatches } from "@c4a/context";
import { ensureRepoContentLinks } from "./repoContentLinks.js";
import { inspectRepoContentChanges, repoContentImpactReader } from "./repoContentEvidence.js";
import { inspectSettledReferences } from "./settledReferenceRelocation.js";

export const knowledgeUpdateInputSchema = z.object({
  scopes: z.array(z.object({ requirement_ref: z.string().min(1), source_ref: z.string().min(1),
    module_refs: z.array(z.string().min(1)).min(1).optional(), processed_version: z.string().min(1).optional() }).strict()).min(1),
  changes: z.string().optional(),
}).strict();
const updateSchema = z.object({
  protocol: z.literal("context.source-update/v1"), revision: z.string(),
  scopes: processedScopesSchema,
  requirements: productionRequirementsSchema.shape.requirements,
  candidates: z.array(z.object({ path: z.string(), title: z.string(), source_refs: z.array(z.string()),
    view_ref: z.string() }).strict()),
  refresh_sources: z.array(z.string().min(1)).min(1).optional(),
  structure_proposal: indexerCurrentActionInputDefinitions.sourceUpdate.omit({ stage: true }).optional(),
  previous_versions: z.array(z.string().nullable()), changes: z.string().optional(),
  repo_content: z.unknown().optional(),
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
    await ensureRepoContentLinks(projectRoot);
    const { readTaskRollback } = await import("./taskRollback.js");
    if (await readTaskRollback(projectRoot) || await readApprovedRevision(projectRoot) || await readKnowledgeUpdate(projectRoot) || await readProductionStage(projectRoot) || (await readCandidateRecords(projectRoot)).length > 0) {
      throw new TypeError("Finish or explicitly roll back the active task before starting an independent source update.");
    }
    const versions = new Map<string, Promise<string>>();
    const scopes = await captureProcessedScopes(projectRoot, await Promise.all(input.scopes.map(async (scope) => {
      if (scope.processed_version !== undefined) return { ...scope, processed_version: scope.processed_version };
      if (!versions.has(scope.source_ref)) versions.set(scope.source_ref, currentScopeSourceVersion(projectRoot, scope.source_ref));
      return { ...scope, processed_version: await versions.get(scope.source_ref)! };
    })));
    const structure = await readKnowledgeStructure(projectRoot);
    if (!structure.parsed) throw new TypeError("Close the existing knowledge before checking source updates");
    const candidates = await Promise.all(validateArticleStructureEntries(structure.parsed.articles ?? [])
      .filter(article => article.sections.some(section => section.references.some(reference =>
        scopes.some(scope => repoContentScopeMatches(scope.source_ref, reference.source_ref)))))
      .map(async article => {
        const title = parseFrontmatterLoose(await targetBytes(projectRoot, article.path)).title;
        return { path: article.path, title: typeof title === "string" ? title : article.path,
          view_ref: article.article_id,
          source_refs: [...new Set(article.sections.flatMap(section => section.references.map(reference => reference.source_ref)))] };
      }));
    const registry = await readProductionRequirements(projectRoot);
    const repoReferences = validateArticleStructureEntries(structure.parsed.articles ?? []).flatMap(article =>
      article.sections.flatMap(section => section.references.filter(ref => ref.source_ref.startsWith("repo-content:") &&
        scopes.some(scope => repoContentScopeMatches(scope.source_ref, ref.source_ref)))
        .map(reference => ({ article: article.path, section: section.id, reference }))));
    const impact = repoReferences.length ? await repoContentImpactReader(projectRoot) : undefined;
    const repoContent = scopes.some(scope => scope.source_ref.startsWith("repo-content:")) ? {
      entries: await inspectRepoContentChanges(projectRoot),
      impacts: await Promise.all(repoReferences.map(async item => ({ ...item, impact: await impact!(item.reference) }))),
    } : undefined;
    const requirementIds = new Set(scopes.map((scope) => scope.requirement_ref));
    const requirements = registry.requirements.filter((requirement) => requirementIds.has(requirement.id));
    const payload = { protocol: "context.source-update/v1" as const, scopes, requirements, candidates,
      ...(repoContent === undefined ? {} : { repo_content: repoContent }),
      previous_versions: scopes.map((scope) => processedVersionForScope(readProcessedScopes(structure.parsed), scope) ?? null),
      ...(input.changes === undefined ? {} : { changes: input.changes }) };
    const request = updateSchema.parse({ ...payload, revision: indexerProtocolDigest(payload) });
    await atomicWriteFile(join(projectRoot, await revisionStoragePath(projectRoot)), `${JSON.stringify(request)}\n`);
    return { outcome: "update-prepared", revision: request.revision,
      next_action: { command: "context status --format json" } };
  });
}

/** A receipt for decisions already accepted, not a gate: kept pages whose cited
 * text changed or cannot be confirmed retain their previous citations, except
 * repository content, which settlement still re-signs to the current text. */
async function keptReferenceWarnings(projectRoot: string,
  decisions: ReadonlyArray<{ path: string; instruction?: string | undefined }>, scopes: readonly string[]) {
  const kept = new Set(decisions.filter((decision) => !decision.instruction?.trim()).map((decision) => decision.path));
  if (kept.size === 0) return {};
  const structure = await readKnowledgeStructure(projectRoot);
  const articles = validateArticleStructureEntries(structure.parsed?.articles ?? []).filter((article) => kept.has(article.path));
  const { unresolved } = await inspectSettledReferences(projectRoot, articles, scopes, readProcessedScopes(structure.parsed));
  const repoScopes = scopes.filter((scope) => scope.startsWith("repo-content:"));
  const repoReferences = articles.flatMap((article) => article.sections.flatMap((section) => section.references
    .filter((reference) => reference.source_ref.startsWith("repo-content:") && repoScopes.some((scope) => repoContentScopeMatches(scope, reference.source_ref)))
    .map((reference) => ({ path: article.path, section_id: section.id, reference }))));
  const impact = repoReferences.length ? await repoContentImpactReader(projectRoot) : undefined;
  const resigned = (await Promise.all(repoReferences.map(async (item) => {
    const { state } = await impact!(item.reference);
    return state === "changed" ? { ...item, state: "changed" as const }
      : state === "unavailable" || state === "worktree" ? { ...item, state: "unavailable" as const } : undefined;
  }))).filter((item) => item !== undefined);
  if (unresolved.length === 0 && resigned.length === 0) return {};
  return {
    reference_warnings: [...unresolved, ...resigned].map((item) => ({ path: item.path, section_id: item.section_id, state: item.state,
      source_ref: item.reference.source_ref, locator: item.reference.locator })),
    reference_warning_instruction: [
      "These pages were kept unchanged as decided.",
      ...(unresolved.length ? ["Their listed citations changed or could not be confirmed against the updated source and keep their previous locations."] : []),
      ...(resigned.length ? ["Listed repo-content citations changed or could not be confirmed; settlement still re-signs them to the current repository text, so verify will not report them later."] : []),
      "The decision cannot be resubmitted; after the current update queue finishes, run context revise <path> --instruction <correction> for each page that needs a correction.",
    ].join(" "),
  };
}

export async function completeKnowledgeUpdate(input: { projectRoot: string; revision: string;
  decisions: Array<{ path: string; instruction?: string | undefined; supporting_sources?: string[] | undefined }>; scope_summary: string; new_topics: NewKnowledgePage[]; structure_approved?: boolean }) {
  return withProjectWriteLock(input.projectRoot, "resolve-knowledge-update", async () => {
    const request = await readKnowledgeUpdate(input.projectRoot);
    if (!request || request.revision !== input.revision) throw new TypeError("Source update revision is stale; refresh context status --format json");
    if (request.refresh_sources) throw new TypeError("Import adjusted source inputs, then run context task adjust with refresh: true before deciding pages.");
    const registry = await readProductionRequirements(input.projectRoot);
    const ids = new Set(request.scopes.map((scope) => scope.requirement_ref));
    if (indexerProtocolDigest(registry.requirements.filter((requirement) => ids.has(requirement.id))) !== indexerProtocolDigest(request.requirements)) {
      throw new TypeError("The confirmed purpose or scope changed. Refresh the source update before deciding its pages; no baseline was advanced.");
    }
    for (const page of input.new_topics) {
      newKnowledgePageTarget(page);
      if (page.source_refs.some((ref) => !request.scopes.some((scope) => repoContentScopeMatches(scope.source_ref, ref) || ref.startsWith(`${scope.source_ref}/`)))) {
        throw new SubmissionInputError(`New topic ${page.path} references material outside the confirmed update scope; allowed sources: ${request.scopes.map((scope) => scope.source_ref).join(", ")}`,
          ["new_topics", input.new_topics.indexOf(page), "source_refs"]);
      }
    }
    for (const [index, decision] of input.decisions.entries()) {
      if (decision.supporting_sources && (!decision.instruction || decision.supporting_sources.some((ref) =>
        !request.scopes.some((scope) => repoContentScopeMatches(scope.source_ref, ref))))) {
        throw new SubmissionInputError(`Supporting sources for ${decision.path} must belong to the confirmed update and accompany a concrete revision instruction`,
          ["decisions", index, "supporting_sources"]);
      }
    }
    const paths = [...input.decisions.map((decision) => decision.path), ...input.new_topics.map((page) => page.path)];
    const repeated = [...new Set(paths.filter((path, index) => paths.indexOf(path) !== index))];
    if (repeated.length) throw new SubmissionInputError(`Update page paths must be unique; repeated: ${repeated.join(", ")}`, ["decisions"]);
    const candidates = new Set(request.candidates.map((candidate) => candidate.path));
    const missing = [...candidates].filter((path) => !input.decisions.some((decision) => decision.path === path));
    const unknown = input.decisions.map((decision) => decision.path).filter((path) => !candidates.has(path));
    if (missing.length || unknown.length) {
      throw new SubmissionInputError([
        "Decide each source-bound candidate once; an omitted page is not a no-change decision. List a candidate with only its path to keep it unchanged.",
        ...(missing.length ? [`Missing: ${missing.join(", ")}.`] : []),
        ...(unknown.length ? [`Not candidates (use new_topics for new pages): ${unknown.join(", ")}.`] : []),
      ].join(" "), ["decisions"]);
    }
    await captureProcessedScopes(input.projectRoot, request.scopes);
    const receipt = await keptReferenceWarnings(input.projectRoot, input.decisions, request.scopes.map((scope) => scope.source_ref));
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
      return { outcome: "unchanged" as const, ...receipt };
    }
    await prepareApprovedRevision({ projectRoot: input.projectRoot, replace_current: true, selector: first.path,
      instruction: first.instruction, pending_targets: remaining, processed_scopes: request.scopes, requirements: request.requirements,
      ...(first.supporting_sources === undefined ? {} : { supporting_sources: first.supporting_sources }),
      ...(first.create === undefined ? {} : { create: first.create }) });
    return { outcome: "revisions-prepared" as const, page_count: revisions.length, ...receipt };
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
