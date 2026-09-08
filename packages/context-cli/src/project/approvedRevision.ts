import { revisionStoragePath } from "./maintenanceStorage.js";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import YAML from "yaml";
import { indexerProtocolDigest, indexerKnowledgeCollectionSchema, processedScopesSchema,
  indexRequirementSchema, loadIndexerRegistry, readProcessedScopes, processedVersionForScope, type IndexRequirement, type ProcessedScope } from "@c4a/context";
import { newKnowledgePageTarget, type NewKnowledgePage } from "./newKnowledgePage.js";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { candidateRecordsContent, indexerCandidateId, isSafeKnowledgeTargetPath, readCandidateRecords,
  parseCandidateRecord, CANDIDATE_LEDGER_FILE, type CandidateRecord } from "./candidateLedger.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { hydrateApprovedKnowledgeMarkdown, readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { withProjectWriteLock } from "./writeLock.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import { runDurableMultiFileTransaction } from "./durableMultiFileTransaction.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { captureProcessedScopes, commitProcessedScopes } from "./processedScopeStorage.js";

// The current compile container holds either a normal accepted-Indexer compile
// or a direct revision of an approved page. Neither retains previous runs.
export const APPROVED_REVISION_PATH = join(".tmp", "context-runtime", "indexer", "candidate-compile", "current.json");
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const revisionTargetSchema = z.object({
  path: z.string().min(1), node_ref: z.string().min(1), view_ref: z.string().min(1),
  collection: indexerKnowledgeCollectionSchema, markdown: z.string().min(1),
  base_digest: digest.nullable(), previous_path: z.string().min(1).optional(), source_refs: z.array(z.string().min(1)).min(1),
}).strict();
const requestSchema = z.object({
  protocol: z.literal("context.approved-revision/v1"),
  revision: digest,
  target: revisionTargetSchema,
  instruction: z.string().trim().min(1),
  pending_targets: z.array(z.object({ path: z.string().min(1), instruction: z.string().trim().min(1),
    target: revisionTargetSchema.optional(),
    regenerate: z.boolean().optional(),
    supporting_sources: z.array(z.string().min(1)).min(1).optional(),
    create: z.object({ path: z.string().min(1), title: z.string().min(1), source_refs: z.array(z.string().min(1)).min(1), instruction: z.string().min(1) }).strict().optional() }).strict()).optional(),
  regenerate: z.boolean().optional(),
  requirements: z.array(indexRequirementSchema).optional(),
  processed_scopes: processedScopesSchema.optional(),
  candidate: z.unknown().optional(),
  batch_candidates: z.array(z.unknown()).optional(),
  review_ready: z.boolean().optional(),
  program_blocks: z.array(z.object({ token: z.string(), source_ref: z.string(), fact_ref: z.string(), markdown: z.string() }).strict()).optional(),
  refresh_sources: z.array(z.string().min(1)).min(1).optional(),
  merge_context: z.object({ approved_markdown: z.string().nullable(), draft_markdown: z.string() }).strict().optional(),
}).strict();
export type ApprovedRevision = Omit<z.infer<typeof requestSchema>, "candidate" | "batch_candidates"> & { candidate?: CandidateRecord; batch_candidates?: CandidateRecord[] };

export function requestDigest(input: Pick<ApprovedRevision, "target" | "instruction" | "pending_targets" | "processed_scopes" | "requirements" | "program_blocks" | "regenerate" | "merge_context">): string {
  // A page's review authority binds its own inputs. Adjusting a queued sibling
  // does not revoke an unchanged page's decision or accepted body.
  const scopes = input.processed_scopes?.filter((scope) => input.target.source_refs.some((ref) =>
    ref === scope.source_ref || ref.startsWith(`${scope.source_ref}#`) || ref.startsWith(`${scope.source_ref}/`)));
  const ids = new Set(scopes?.map((scope) => scope.requirement_ref));
  return indexerProtocolDigest({ target: input.target, instruction: input.instruction,
    ...(input.merge_context ? { merge_context: input.merge_context } : {}),
    ...(input.regenerate ? { regenerate: true, program_blocks: input.program_blocks ?? [] } : {}),
    ...(input.requirements === undefined ? {} : { requirements: input.requirements.filter((item) => ids.has(item.id) || item.target_scope.targets.some((source) => input.target.source_refs.some((ref) => ref === source.source_ref || ref.startsWith(`${source.source_ref}#`) || ref.startsWith(`${source.source_ref}/`)))) }),
    ...(scopes === undefined ? {} : { processed_scopes: scopes }),
  });
}

export function parseApprovedRevision(value: unknown): ApprovedRevision | undefined {
  if (!value || typeof value !== "object" || !("protocol" in value) ||
      value.protocol !== "context.approved-revision/v1") return undefined;
  const parsed = requestSchema.parse(value);
  if (!isSafeKnowledgeTargetPath(parsed.target.collection, parsed.target.path) ||
      parsed.revision !== requestDigest(parsed) || (parsed.target.previous_path !== undefined && !isSafeKnowledgeTargetPath(parsed.target.collection, parsed.target.previous_path))) throw new TypeError("Approved revision target or digest is invalid");
  const { candidate: raw, batch_candidates: batch, ...rest } = parsed;
  const request = { ...rest, ...(batch === undefined ? {} : { batch_candidates: batch.map((item, index) => parseCandidateRecord(item, index + 1)) }) };
  if (raw === undefined) return request;
  const candidate = parseCandidateRecord(raw, 1);
  if (candidate.approved_revision?.request_digest !== request.revision ||
      candidate.approved_revision.base_digest !== request.target.base_digest ||
      candidate.approved_revision.previous_path !== request.target.previous_path ||
      candidate.path !== request.target.path || candidate.node_ref !== request.target.node_ref ||
      candidate.view_ref !== request.target.view_ref ||
      candidate.fingerprint !== indexerProtocolDigest({ revision: request.revision, markdown: candidate.body })) {
    throw new TypeError("Approved revision Candidate does not match its request");
  }
  return { ...request, candidate };
}

export async function readApprovedRevision(projectRoot: string): Promise<ApprovedRevision | undefined> {
  try {
    return parseApprovedRevision(JSON.parse(await readFile(join(projectRoot, await revisionStoragePath(projectRoot)), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function revisionBatch(request: ApprovedRevision): CandidateRecord[] {
  return [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])];
}

export function pendingAfterReopen(request: ApprovedRevision, selectedPath: string): ApprovedRevision["pending_targets"] {
  if (selectedPath === request.target.path || revisionBatch(request).some((item) => item.path === request.target.path)) {
    return request.pending_targets;
  }
  // This is an interrupted Author, not an accepted Candidate. Keep its exact
  // input in the existing queue, including an unfinished new page or page move.
  return [{ path: request.target.path, instruction: request.instruction, target: request.target,
    ...(request.regenerate ? { regenerate: true } : {}) },
    ...(request.pending_targets ?? []).filter((item) => item.path !== request.target.path)];
}

/** Read-only projection: rejection selects the existing Author action. The next
 * submission replaces the rejected Candidate atomically, without a reset call. */
export async function resolveApprovedRevisionAuthor(projectRoot: string, request: ApprovedRevision | undefined) {
  if (!request || (!request.candidate && !request.review_ready)) return request;
  const { observeApprovedRevisionBatch } = await import("./approvedRevisionBatch.js");
  const observed = await observeApprovedRevisionBatch(projectRoot, request);
  if (observed.state !== "current") return undefined;
  const rejected = observed.candidates.find((item) => item.status === "rejected");
  const selected = revisionBatch(request).find((item) => item.candidate_id === rejected?.candidate_id);
  if (!selected) return undefined;
  const { candidate: _candidate, review_ready: _ready, program_blocks: _blocks, ...previous } = request;
  void _candidate; void _ready; void _blocks;
  const target: ApprovedRevision["target"] = {
    path: selected.path, node_ref: selected.node_ref, view_ref: selected.view_ref, collection: selected.collection,
    markdown: selected.body, source_refs: selected.source_refs, base_digest: selected.approved_revision!.base_digest,
    ...(selected.approved_revision!.previous_path ? { previous_path: selected.approved_revision!.previous_path } : {}),
  };
  const payload = { ...previous, target, pending_targets: pendingAfterReopen(request, selected.path),
    batch_candidates: revisionBatch(request).filter((item) => item.candidate_id !== selected.candidate_id),
    instruction: `Review rejected this draft. Apply the user's review feedback before resubmitting; ask if the intended correction is unclear. Original task: ${selected.review.reason}`,
    ...(selected.path === request.target.path && request.program_blocks ? { program_blocks: request.program_blocks } : {}),
  };
  return { ...payload, revision: requestDigest(payload) };
}

export async function targetBytes(projectRoot: string, path: string): Promise<string> {
  const project = await realpath(projectRoot);
  const root = await realpath(join(projectRoot, "knowledge"));
  const rootRelative = relative(project, root);
  if (isAbsolute(rootRelative) || rootRelative === ".." || rootRelative.startsWith("../")) {
    throw new TypeError("Approved knowledge directory leaves the Context workspace");
  }
  const target = await realpath(join(root, path));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new TypeError("Approved revision target leaves knowledge/");
  return readFile(target, "utf8");
}

export async function assertApprovedRevisionBase(projectRoot: string, request: ApprovedRevision): Promise<void> {
  let current: string | undefined;
  try { current = await targetBytes(projectRoot, request.target.previous_path ?? request.target.path); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  if (request.target.previous_path !== undefined) {
    try { await targetBytes(projectRoot, request.target.path); throw new TypeError("The move destination already exists; choose an unused knowledge path."); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
  if ((current === undefined ? null : durableContentDigest(current)) !== request.target.base_digest) {
    throw new TypeError("Approved page changed after this revision began. Run context status --format json and follow the current merge recovery Route; no page was overwritten.");
  }
}

/** A partial Review can already have applied the page held by the current
 * request. Reopening that page starts from those accepted bytes, while peers
 * remain in the same batch. Never infer approval from an arbitrary file edit. */
export async function currentApprovedRevisionTarget(projectRoot: string, request: ApprovedRevision): Promise<ApprovedRevision["target"]> {
  const candidate = request.candidate;
  if (candidate && !(await readCandidateRecords(projectRoot)).some((item) => item.candidate_id === candidate.candidate_id)) {
    let bytes: string | undefined;
    try { bytes = await targetBytes(projectRoot, candidate.path); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const { approvedRevisionCandidateApplied } = await import("./approvedRevisionBatch.js");
    if (bytes !== undefined && await approvedRevisionCandidateApplied(projectRoot, candidate, bytes)) {
      const { previous_path: _previous, ...target } = request.target;
      void _previous;
      return { ...target, base_digest: durableContentDigest(bytes), markdown: hydrateApprovedKnowledgeMarkdown({
        content: bytes, relPath: candidate.path, metadata: await readApprovedKnowledgeMetadataIndex(projectRoot),
      }) };
    }
  }
  await assertApprovedRevisionBase(projectRoot, request);
  return request.target;
}

export async function prepareApprovedRevision(input: {
  projectRoot: string; selector: string; instruction: string;
  move_to?: string;
  regenerate?: boolean;
  pending_targets?: ApprovedRevision["pending_targets"];
  target?: ApprovedRevision["target"];
  supporting_sources?: string[];
  create?: NewKnowledgePage;
  replace_current?: boolean;
  persist?: boolean;
  batch_candidates?: CandidateRecord[];
  requirements?: IndexRequirement[];
  processed_scopes?: ProcessedScope[];
}) {
  return withProjectWriteLock(input.projectRoot, "prepare-approved-revision", async () => {
    if (!input.replace_current) {
      const active = await readApprovedRevision(input.projectRoot);
      const { readKnowledgeUpdate } = await import("./knowledgeUpdate.js");
      const { readTaskRollback } = await import("./taskRollback.js");
      if (active || await readTaskRollback(input.projectRoot) || await readKnowledgeUpdate(input.projectRoot)) throw new TypeError("An update is already active. Continue or explicitly adjust that task before starting another page revision.");
    }
    const structure = await readKnowledgeStructure(input.projectRoot);
    const selector = input.selector.replace(/^knowledge\//u, "").normalize("NFC").toLocaleLowerCase();
    const views = Array.isArray(structure.parsed?.views) ? structure.parsed.views : [];
    const matches = views.filter((view): view is Record<string, unknown> => !!view && typeof view === "object" &&
      [view.path, view.title, view.view_ref, view.node_ref].some((value) => typeof value === "string" && value.normalize("NFC").toLocaleLowerCase() === selector));
    if (!input.target && !input.create && matches.length !== 1) throw new TypeError("Use one unambiguous approved page path or title from knowledge/structure.yaml.");
    if (input.create && matches.length > 0) throw new TypeError("New topic already has an approved page; revise that page instead");
    const view = matches[0]!;
    const path = input.target?.path ?? input.create?.path ?? String(view.path);
    const pending = await readCandidateRecords(input.projectRoot);
    if (pending.some((candidate) => !input.batch_candidates?.some((item) => item.candidate_id === candidate.candidate_id) &&
      (candidate.approved_revision === undefined || candidate.path !== path))) {
      throw new TypeError("Finish or explicitly roll back the current Candidates before starting an independent page revision.");
    }
    let target: ApprovedRevision["target"];
    if (input.target) {
      target = input.target;
      if (target.path !== input.selector || !isSafeKnowledgeTargetPath(target.collection, target.path)) throw new TypeError("Queued revision target has an unsafe or inconsistent path");
      await assertApprovedRevisionBase(input.projectRoot, { target } as ApprovedRevision);
    } else if (input.create) {
      target = newKnowledgePageTarget(input.create);
      await assertApprovedRevisionBase(input.projectRoot, { target } as ApprovedRevision);
    } else {
    const collection = indexerKnowledgeCollectionSchema.parse(view.collection);
    if (!isSafeKnowledgeTargetPath(collection, path)) throw new TypeError("Approved page has an unsafe path");
    const bytes = await targetBytes(input.projectRoot, path);
    const metadata = await readApprovedKnowledgeMetadataIndex(input.projectRoot);
    const markdown = hydrateApprovedKnowledgeMarkdown({ content: bytes, relPath: path, metadata });
    target = { path, node_ref: String(view.node_ref), view_ref: String(view.view_ref), collection,
      markdown, base_digest: durableContentDigest(bytes),
      source_refs: z.array(z.string().min(1)).min(1).parse(view.sources) };
    }
    if (input.move_to !== undefined) {
      if (input.create || !isSafeKnowledgeTargetPath(target.collection, input.move_to) || input.move_to === target.path) {
        throw new TypeError("Move requires a different safe path in the same knowledge collection.");
      }
      const { moveKnowledgeLinkTargets } = await import("./approvedPageMove.js");
      const movedMarkdown = moveKnowledgeLinkTargets(target.markdown, input.move_to, target.path, new Map([[target.path, input.move_to]]))
        .replace(/^resource:.*$/mu, `resource: knowledge:${input.move_to.replace(/\.md$/u, "")}`);
      target = { ...target, previous_path: target.path, path: input.move_to, markdown: movedMarkdown };
      await assertApprovedRevisionBase(input.projectRoot, { target } as ApprovedRevision);
    }
    if (input.supporting_sources) {
      target = { ...target, source_refs: [...new Set([...target.source_refs, ...input.supporting_sources])] };
    }
    if (input.processed_scopes) await captureProcessedScopes(input.projectRoot, input.processed_scopes);
    const { prepareRevisionProgramBlocks } = await import("./approvedRevisionPrograms.js");
    const programScopes = input.processed_scopes?.filter((scope) => processedVersionForScope(readProcessedScopes(structure.parsed), scope) !== scope.processed_version);
    const { registry } = await loadIndexerRegistry(input.projectRoot);
    const requirements = input.requirements ?? registry.requirements.filter((requirement) => requirement.target_scope.targets.some((source) =>
      target.source_refs.some((ref) => ref === source.source_ref || ref.startsWith(`${source.source_ref}#`) || ref.startsWith(`${source.source_ref}/`))));
    const { currentScopeSourceVersion } = await import("./processedScopeStorage.js");
    const regenerationScopes = input.regenerate ? await Promise.all(requirements.flatMap(requirement =>
      requirement.target_scope.targets.filter(source => source.source_ref.startsWith("repo:") && target.source_refs.some(ref =>
        ref === source.source_ref || ref.startsWith(`${source.source_ref}#`) || ref.startsWith(`${source.source_ref}/`)))
        .map(async source => ({ requirement_ref: requirement.id, source_ref: source.source_ref,
          ...(source.module_refs.length ? { module_refs: source.module_refs } : {}),
          processed_version: await currentScopeSourceVersion(input.projectRoot, source.source_ref) })))) : undefined;
    const programBlocks = regenerationScopes || programScopes
      ? await prepareRevisionProgramBlocks(input.projectRoot, target.source_refs, regenerationScopes ?? programScopes!) : undefined;
    if (input.regenerate && !programBlocks?.length) throw new TypeError("No applicable program blocks in the selected page sources. Inspect its Provider/materials; do not submit the old table as regenerated. Cancel or adjust this maintenance request before continuing.");
    const payload = { target, instruction: input.instruction.trim(), requirements,
      ...(input.regenerate ? { regenerate: true } : {}),
      ...(programBlocks === undefined ? {} : { program_blocks: programBlocks }),
      ...(input.batch_candidates === undefined ? {} : { batch_candidates: input.batch_candidates }),
      ...(input.requirements === undefined ? {} : { requirements: input.requirements }),
      ...(input.pending_targets === undefined ? {} : { pending_targets: input.pending_targets }),
      ...(input.processed_scopes === undefined ? {} : { processed_scopes: input.processed_scopes }),
    };
    const request = parseApprovedRevision({ protocol: "context.approved-revision/v1", ...payload,
      revision: requestDigest(payload) })!;
    if (input.persist !== false) await atomicWriteFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), `${JSON.stringify(request)}\n`);
    return { status: "author-reopened" as const, path, request, revision: request.revision,
      next_action: { command: "context status --format json" } };
  });
}

function frontmatter(markdown: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  const parsed: unknown = match ? YAML.parse(match[1]!) : undefined;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Revision must retain the approved page frontmatter");
  return parsed as Record<string, unknown>;
}

export async function completeApprovedRevision(input: {
  projectRoot: string; revision: string; markdown: string;
}) {
  return withProjectWriteLock(input.projectRoot, "compile-approved-revision", async () => {
    const currentRequest = await readApprovedRevision(input.projectRoot);
    const { approvedRevisionRecovery } = await import("./approvedRevisionRecovery.js");
    const recovery = await approvedRevisionRecovery(input.projectRoot, currentRequest);
    const request = recovery?.request ?? await resolveApprovedRevisionAuthor(input.projectRoot, currentRequest);
    if (!request || request.revision !== input.revision || request.candidate) throw new TypeError("Approved revision is stale. Refresh context status --format json.");
    if (request.refresh_sources) throw new TypeError("Import the explicitly adjusted source inputs, then run context task adjust with refresh: true before submitting page content.");
    await assertApprovedRevisionBase(input.projectRoot, request);
    const { expandRevisionProgramBlocks } = await import("./approvedRevisionPrograms.js");
    input = { ...input, markdown: expandRevisionProgramBlocks(input.markdown, request.program_blocks ?? []) };
    if (request.processed_scopes) await captureProcessedScopes(input.projectRoot, request.processed_scopes);
    await assertRevisionRequirements(input.projectRoot, request);
    const approved = request.target.base_digest === null ? undefined : hydrateApprovedKnowledgeMarkdown({
      content: await targetBytes(input.projectRoot, request.target.previous_path ?? request.target.path), relPath: request.target.previous_path ?? request.target.path,
      metadata: await readApprovedKnowledgeMetadataIndex(input.projectRoot),
    });
    const metadata = frontmatter(input.markdown);
    if (metadata.node_ref !== request.target.node_ref || metadata.view_ref !== request.target.view_ref ||
        indexerProtocolDigest(metadata.sources) !== indexerProtocolDigest(request.target.source_refs)) {
      throw new TypeError("Direct revision must retain the approved identity and sources. Register additional factual material before changing its source scope.");
    }
    const replacingCandidate = (await readCandidateRecords(input.projectRoot)).some((item) => item.path === request.target.path);
    if (input.markdown === approved && request.target.previous_path === undefined && !replacingCandidate) {
      const { prepareRevisionBatchContinuation } = await import("./approvedRevisionBatch.js");
      const next = await prepareRevisionBatchContinuation(input.projectRoot, request, request.batch_candidates ?? []);
      if (next || request.batch_candidates?.length) {
        await atomicWriteFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), `${JSON.stringify(next ?? { ...request, review_ready: true })}\n`);
      } else {
        await advanceApprovedRevision(input.projectRoot, request);
      }
      return undefined;
    }
    const sections = approvedContextSectionsInMarkdown(input.markdown);
    if (sections.length === 0 || sections.some((section) => !section.id || section.refs.length === 0)) {
      throw new TypeError("Revision must retain source-bound context sections");
    }
    const previousRefs = new Set(approvedContextSectionsInMarkdown(request.target.markdown).flatMap((section) => section.refs));
    if (sections.some((section) => section.refs.some((ref) => !previousRefs.has(ref) &&
      !request.target.source_refs.some((source) => ref === source || ref.startsWith(`${source}#`))))) {
      throw new TypeError("Revision section references a source outside the approved page scope");
    }
    if (new Set(sections.map((section) => section.id)).size !== sections.length) {
      throw new TypeError("Revision section identities must be unique");
    }
    const title = z.string().trim().min(1).parse(metadata.title);
    const fingerprint = indexerProtocolDigest({ revision: request.revision, markdown: input.markdown });
    const projectedSections = sections.map((section) => ({
      section_ref: `${request.target.view_ref}#${section.id!}`, section_key: section.id!,
      evidence_refs: [], markdown: section.readerVisibleBody,
      markdown_digest: indexerProtocolDigest(section.readerVisibleBody),
    }));
    const candidate = parseCandidateRecord({
      candidate_id: indexerCandidateId(fingerprint), node_ref: request.target.node_ref, view_ref: request.target.view_ref,
      collection: request.target.collection, status: "draft", candidate_type: "indexer-artifact",
      kind: sections[0]?.kind ?? "content", visibility: "public", module: "approved-revision",
      path: request.target.path, structure_digest: request.revision, source_refs: request.target.source_refs,
      body: input.markdown, fingerprint,
      approved_revision: { request_digest: request.revision, base_digest: request.target.base_digest,
        ...(request.target.previous_path === undefined ? {} : { previous_path: request.target.previous_path }) },
      indexer_candidate: { compile_digest: request.revision, file_digest: fingerprint,
        artifact_ref: request.target.view_ref, section_refs: projectedSections.map((section) => section.section_ref),
        source_ref: request.target.source_refs[0], evidence_bindings: [], sections: projectedSections },
      review: { title, summary: z.string().trim().min(1).parse(metadata.description ?? title),
        signals: ["approved-page-revision"], reason: request.instruction }, updated: new Date().toISOString(),
    }, 1);
    const current = await readFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), "utf8");
    let previous: string | undefined;
    try { previous = await readFile(join(input.projectRoot, CANDIDATE_LEDGER_FILE), "utf8"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const { prepareRevisionBatchContinuation } = await import("./approvedRevisionBatch.js");
    const batch = [...(request.batch_candidates ?? []), candidate];
    const next = await prepareRevisionBatchContinuation(input.projectRoot, request, batch);
    const liveIds = new Set((await readCandidateRecords(input.projectRoot)).map((item) => item.candidate_id));
    const candidateContent = candidateRecordsContent(batch.filter((item) => item.candidate_id === candidate.candidate_id || liveIds.has(item.candidate_id)))!;
    const compileContent = `${JSON.stringify(next ?? { ...request, candidate, review_ready: true })}\n`;
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "compile-approved-revision",
      proposal_digest: fingerprint,
      targets: [{ path: await revisionStoragePath(input.projectRoot), operation: "write" as const, base_digest: durableContentDigest(current),
        target_digest: durableContentDigest(compileContent), content: compileContent },
      { path: CANDIDATE_LEDGER_FILE, operation: "write" as const, base_digest: previous === undefined ? null : durableContentDigest(previous),
        target_digest: durableContentDigest(candidateContent), content: candidateContent }].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    });
    return candidate;
  });
}

/** Called only after all configured package outputs have built successfully. */
export async function finishApprovedRevision(projectRoot: string): Promise<void> {
  await withProjectWriteLock(projectRoot, "finish-approved-revision", async () => {
    const request = await readApprovedRevision(projectRoot);
    if (!request || (!request.candidate && !request.batch_candidates?.length)) return;
    if (request.refresh_sources) throw new TypeError("Finish the pending source adjustment before advancing this update queue.");
    const { approvedRevisionCandidateApplied } = await import("./approvedRevisionBatch.js");
    for (const candidate of [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])]) {
      if (!await approvedRevisionCandidateApplied(projectRoot, candidate, await targetBytes(projectRoot, candidate.path), true)) {
        throw new TypeError("Every page in the revision batch must be applied and closed before final cleanup");
      }
    }
    await advanceApprovedRevision(projectRoot, request);
  });
}

async function advanceApprovedRevision(projectRoot: string, request: ApprovedRevision): Promise<void> {
  const [next, ...remaining] = request.pending_targets ?? [];
  if (next) {
    await prepareApprovedRevision({ projectRoot, replace_current: true, selector: next.path, instruction: next.instruction,
      ...(next.regenerate ? { regenerate: true } : {}),
      ...(next.target === undefined ? {} : { target: next.target }),
      pending_targets: remaining, ...(next.create === undefined ? {} : { create: next.create }),
      ...(next.supporting_sources === undefined ? {} : { supporting_sources: next.supporting_sources }),
      ...(request.requirements === undefined ? {} : { requirements: request.requirements }), ...(request.processed_scopes === undefined ? {} : { processed_scopes: request.processed_scopes }) });
    return;
  }
  await assertRevisionRequirements(projectRoot, request);
  await commitProcessedScopes(projectRoot, request.processed_scopes ?? []);
  const { finishMaintenanceRevision } = await import("./knowledgeMaintenance.js");
  if (await finishMaintenanceRevision(projectRoot)) return;
  const { clearCompletedLifecycle } = await import("./lifecycleCleanup.js");
  await clearCompletedLifecycle(projectRoot);
}

async function assertRevisionRequirements(projectRoot: string, request: ApprovedRevision): Promise<void> {
  if (!request.requirements) return;
  const { registry } = await loadIndexerRegistry(projectRoot);
  const ids = new Set(request.requirements.map((requirement) => requirement.id));
  if (indexerProtocolDigest(registry.requirements.filter((requirement) => ids.has(requirement.id))) !== indexerProtocolDigest(request.requirements)) {
    throw new TypeError("Revision purpose or scope changed; adjust the pending update before continuing. No baseline was advanced.");
  }
}

export async function reopenApprovedRevision(input: { projectRoot: string; selector: string; instruction: string }) {
  return withProjectWriteLock(input.projectRoot, "reopen-approved-revision", async () => {
    const request = await readApprovedRevision(input.projectRoot);
    if (!request) return undefined;
    const { approvedRevisionRecovery } = await import("./approvedRevisionRecovery.js");
    if (await approvedRevisionRecovery(input.projectRoot, request)) return {
      status: "merge-required" as const,
      next_action: { command: "context status --format json" },
      message: "Read the current merge recovery Route. Merge the latest approved content and the existing draft before submitting; other batch pages remain intact.",
    };
    const selector = input.selector.replace(/^\.\//u, "").replace(/^knowledge\//u, "").normalize("NFC").toLowerCase();
    const batch = [...(request.batch_candidates ?? []), ...(request.candidate ? [request.candidate] : [])];
    const selected = batch.find((item) => [item.path, item.node_ref, item.view_ref, item.candidate_id, item.review.title]
      .some((alias) => alias.normalize("NFC").toLowerCase() === selector));
    const aliases = [request.target.path, request.target.node_ref, request.target.view_ref, frontmatter(request.target.markdown).title];
    if (!selected && !aliases.some((alias) => typeof alias === "string" && alias.normalize("NFC").toLowerCase() === selector)) {
      throw new TypeError("Another page update is active. Finish or explicitly roll back that task before starting this revision.");
    }
    const kept = batch.filter((item) => item.candidate_id !== selected?.candidate_id);
    const { candidate: _candidate, review_ready: _ready, ...previous } = request;
    void _candidate; void _ready;
    let base = previous;
    if (selected && selected.path !== request.target.path) {
      const prepared = await prepareApprovedRevision({ projectRoot: input.projectRoot, replace_current: true, persist: false,
        selector: selected.path, instruction: input.instruction, batch_candidates: batch,
        ...(request.regenerate ? { regenerate: true } : {}),
        pending_targets: pendingAfterReopen(request, selected.path),
        ...(request.requirements ? { requirements: request.requirements } : {}),
        ...(request.processed_scopes ? { processed_scopes: request.processed_scopes } : {}),
        ...(selected.approved_revision?.base_digest === null ? { create: { path: selected.path,
          title: selected.review.title, source_refs: selected.source_refs, instruction: input.instruction } } : {}) });
      base = prepared.request;
    } else base = { ...base, target: await currentApprovedRevisionTarget(input.projectRoot, request) };
    const payload = { ...base, batch_candidates: kept, instruction: input.instruction.trim(), target: { ...base.target,
      markdown: selected?.body ?? base.target.markdown } };
    const current = await readFile(join(input.projectRoot, await revisionStoragePath(input.projectRoot)), "utf8");
    const content = `${JSON.stringify({ ...payload, revision: requestDigest(payload) })}\n`;
    let ledger: string | undefined;
    try { ledger = await readFile(join(input.projectRoot, CANDIDATE_LEDGER_FILE), "utf8"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const liveIds = new Set((await readCandidateRecords(input.projectRoot)).map((item) => item.candidate_id));
    const keptRows = kept.filter((item) => liveIds.has(item.candidate_id));
    await runDurableMultiFileTransaction({ projectRoot: input.projectRoot, kind: "reopen-approved-revision",
      proposal_digest: requestDigest(payload), targets: [
        { path: await revisionStoragePath(input.projectRoot), operation: "write" as const, base_digest: durableContentDigest(current), target_digest: durableContentDigest(content), content },
        ...(ledger === undefined ? [] : [keptRows.length ? { path: CANDIDATE_LEDGER_FILE, operation: "write" as const,
          base_digest: durableContentDigest(ledger), target_digest: durableContentDigest(candidateRecordsContent(keptRows)!), content: candidateRecordsContent(keptRows)! }
          : { path: CANDIDATE_LEDGER_FILE, operation: "delete" as const, base_digest: durableContentDigest(ledger), target_digest: null }]),
      ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
    return { status: "author-reopened" as const, path: payload.target.path, revision: requestDigest(payload),
      next_action: { command: "context status --format json" } };
  });
}
