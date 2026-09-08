import { resetIndexerDeliveryProjection } from "./indexerDelivery.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  indexerProtocolDigest,
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerRepairIntent,
  composeIndexerLayerInput,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { indexerCandidateId, readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import {
  INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
  INDEXER_CURRENT_READINESS_PATH,
  readProjectIndexerCandidateCompileStatus,
  indexerCandidateTitle,
} from "./indexerCandidateCompileActions.js";
import { hydrateApprovedKnowledgeMarkdown, readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { INDEXER_CURRENT_FINALIZATION_PATH } from "./indexerCurrentFinalization.js";
import {
  prepareIndexerMainRunStore,
  startIndexerMainRunStore,
} from "./indexerMainRunStore.js";
import {
  currentLedger,
  currentSpec,
  normalizeRunSpec,
} from "./indexerMainRunStoreRecords.js";
import { prepareApprovedRevision, reopenApprovedRevision, readApprovedRevision } from "./approvedRevision.js";
import {
  postAuthorCurrentEnvelopePath,
  postAuthorCurrentStatePath,
} from "./indexerPostAuthorStorePersistence.js";

function normalizedSelector(value: string): string {
  return value.normalize("NFC").replace(/^\.\//u, "").replace(/^knowledge\//u, "");
}

function candidateAliases(candidate: CandidateRecord): string[] {
  return [
    candidate.candidate_id,
    candidate.path,
    `knowledge/${candidate.path}`,
    candidate.review.title,
  ];
}

function resolveCandidate(
  candidates: readonly CandidateRecord[],
  selector: string,
): CandidateRecord {
  const normalized = normalizedSelector(selector);
  const exact = candidates.filter((candidate) =>
    candidateAliases(candidate).some((alias) =>
      normalizedSelector(alias).toLocaleLowerCase() === normalized.toLocaleLowerCase()
    )
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ContextError(
      ExitCode.UserError,
      `revision target is ambiguous: ${selector}`,
      {
        category: ErrorCategory.UserInputInvalid,
        candidates: exact.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          path: candidate.path,
          title: candidate.review.title,
        })),
      },
    );
  }
  throw new ContextError(ExitCode.UserError, `current Candidate not found: ${selector}`, {
    category: ErrorCategory.UserInputInvalid,
    next: "Use a candidate id or canonical Candidate path from context review list --all --format json.",
  });
}

async function clearDerivedCurrentState(
  projectRoot: string,
  revisedWorksets: readonly string[] = [],
): Promise<void> {
  await resetIndexerDeliveryProjection(projectRoot, true);
  // Whole-batch projections must be regenerated. Per-page Composer results
  // remain reusable: their requests already bind the Author input. Invalidate
  // only the revised pages' current pointers; close cleans temporary history.
  await Promise.all([
    INDEXER_CURRENT_FINALIZATION_PATH,
    INDEXER_CURRENT_READINESS_PATH,
    INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
    ...revisedWorksets.flatMap((digest) => [
      postAuthorCurrentStatePath(digest),
      postAuthorCurrentEnvelopePath(digest),
    ]),
  ].map((path) => rm(join(projectRoot, path), { recursive: true, force: true })));
}

export async function reopenCurrentAuthorWorksets(input: {
  projectRoot: string;
  instruction: string;
  target_ref: string;
  workset_digests?: readonly string[];
  current_markdown?: string;
}) {
  const ledger = await currentLedger(input.projectRoot);
  if (
    ledger === undefined || ledger.entries.length === 0 ||
    ledger.entries.some((entry) => entry.stage !== "author")
  ) {
    throw new TypeError("Author repair requires the current Author run ledger");
  }
  const selected = input.workset_digests === undefined
    ? new Set(ledger.entries.map((entry) => entry.workset_digest))
    : new Set(input.workset_digests);
  if (selected.size === 0) {
    throw new TypeError("Author repair requires at least one workset");
  }
  const repairIntent = buildIndexerRepairIntent({
    target_ref: input.target_ref,
    instruction: input.instruction,
    ...(input.current_markdown === undefined ? {} : { current_markdown: input.current_markdown }),
  });
  let repairedCount = 0;
  const specs = await Promise.all(ledger.entries.map(async (entry) => {
    const oldSpec = await currentSpec({
      projectRoot: input.projectRoot,
      request_digest: entry.execution_request_digest,
    });
    if (!selected.has(entry.workset_digest)) return oldSpec;
    repairedCount += 1;
    const oldWorkset = oldSpec.request.workset;
    const { workset_digest: _oldDigest, repair_intent: _oldRepair, ...worksetPayload } = oldWorkset;
    void _oldDigest;
    void _oldRepair;
    const repairedWorkset = buildIndexerMainWorkset({
      ...worksetPayload,
      repair_intent: repairIntent,
    });
    if (repairedWorkset.stage !== "author") {
      throw new TypeError("Author repair produced a non-Author workset");
    }
    const repairedRequest = buildIndexerMainRunRequest({
      workset: repairedWorkset,
      composition_input: composeIndexerLayerInput({
        workset_digest: repairedWorkset.workset_digest,
        final_authority_layer_ref:
          oldSpec.request.composition_input.final_authority_layer_ref,
        fragments: oldSpec.request.composition_input.accepted_fragments,
      }),
      final_authority: oldSpec.request.final_authority,
      run_environment: oldSpec.request.run_environment,
    });
    return normalizeRunSpec({
      protocol: "context.indexer.main-run-spec/v1",
      request: repairedRequest,
      validation: oldSpec.validation,
    });
  }));
  if (repairedCount !== selected.size) {
    throw new TypeError("Author repair references a workset outside the current ledger");
  }
  await clearDerivedCurrentState(input.projectRoot, [...selected]);
  await prepareIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_set: buildIndexerMainWorksetSet(specs.map((spec) => spec.request.workset)),
    run_specs: specs,
  });
  const firstIndex = ledger.entries.findIndex((entry) => selected.has(entry.workset_digest));
  const first = firstIndex < 0 ? undefined : specs[firstIndex];
  if (first === undefined) throw new TypeError("Author repair lost its selected workset");
  await startIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_digest: first.request.workset.workset_digest,
  });
  return {
    workset_count: repairedCount,
    first_workset_digest: first.request.workset.workset_digest,
    repair_intent_digest: repairIntent.intent_digest,
  };
}

interface DocumentRevisionInput {
  move_to?: string;
  timing?: "after-batch" | "priority";
  regenerate?: boolean;
  projectRoot: string;
  selector: string;
  instruction: string;
}

async function registerRequestedRevisionMaintenance(input: DocumentRevisionInput) {
  const instruction = input.instruction.trim();
  // Scheduling preferences must not turn a current draft into an approved-page
  // request. Repair the current delivery before considering maintenance queues.
  const currentCandidates = await readCandidateRecords(input.projectRoot);
  const selectedCandidates = currentCandidates.filter((candidate) => candidateAliases(candidate).some((alias) =>
    normalizedSelector(alias).toLocaleLowerCase() === normalizedSelector(input.selector).toLocaleLowerCase()));
  if (selectedCandidates.length > 1) resolveCandidate(selectedCandidates, input.selector);
  if (input.regenerate || input.timing === "priority") {
    if (input.move_to) throw new ContextError(ExitCode.UserError,
      "A page move uses the structure-aware revise route, not maintenance scheduling", {
        category: ErrorCategory.UserInputInvalid,
        next: "Use context revise with --move-to after the current Candidate review, without --regenerate or --timing priority.",
      });
    if (selectedCandidates.length === 0) {
      const { registerKnowledgeMaintenance } = await import("./knowledgeMaintenance.js");
      const request = { operation: input.regenerate ? "regenerate" : "revise", timing: input.timing ?? "after-batch",
        targets: [{ path: input.selector, instruction: input.instruction }] };
      return registerKnowledgeMaintenance(input.projectRoot, { ...request, id: indexerProtocolDigest(request).slice(7) }, { renewCompleted: true });
    }
    if (input.regenerate) {
      const command = `context revise '${input.selector.replace(/'/gu, "'\\''")}' --instruction '${instruction.replace(/'/gu, "'\\''")}' --format json`;
      throw new ContextError(ExitCode.UserError, "This page is a current Candidate; repair its owning Author before approved-page regeneration", {
        category: ErrorCategory.UserInputInvalid,
        reason_code: "current-candidate-requires-repair",
        next: command,
        next_action: { command },
      });
    }
  }
  return undefined;
}

/**
 * Reopen the exact Author workset that produced a current Candidate. The
 * instruction is part of the new workset identity, so an old accepted Result
 * can never satisfy the repair run.
 */
export async function beginDocumentRevision(input: DocumentRevisionInput) {
  const instruction = input.instruction.trim();
  if (instruction.length === 0) {
    throw new ContextError(ExitCode.UserError, "--instruction must not be empty", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const scheduled = await registerRequestedRevisionMaintenance(input);
  if (scheduled) return scheduled;
  if (input.move_to && (await readCandidateRecords(input.projectRoot)).length) throw new TypeError("Finish current Candidate review before moving an approved page.");
  if (input.move_to && await readApprovedRevision(input.projectRoot)) throw new TypeError("Finish the active page revision before requesting a move; no existing move is silently replaced.");
  const reopened = await reopenApprovedRevision({ ...input, instruction });
  if (reopened) return reopened;
  const status = await readProjectIndexerCandidateCompileStatus(input.projectRoot);
  if (status.state !== "current" || status.compile === undefined) {
    if (await currentLedger(input.projectRoot) !== undefined) {
      if (status.state === "stale" || status.state === "invalid") throw new TypeError("Repair the unfinished Indexer lifecycle before revising a page whose current compile is stale or invalid. Run context status --format json.");
      if (input.move_to) throw new TypeError("Finish the current delivery before moving an approved page; no current task was replaced.");
      const { registerKnowledgeMaintenance } = await import("./knowledgeMaintenance.js");
      return registerKnowledgeMaintenance(input.projectRoot, { id: indexerProtocolDigest({ selector: input.selector, instruction }).slice(7),
        operation: "revise", targets: [{ path: input.selector, instruction }] }, { renewCompleted: true });
    }
    return prepareApprovedRevision({
      projectRoot: input.projectRoot,
      selector: input.selector,
      ...(input.move_to === undefined ? {} : { move_to: input.move_to }),
      instruction,
    });
  }
  if (status.compile === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "context revise requires a current Candidate or approved knowledge structure",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        next: "Finish the current Indexer lifecycle or select an approved knowledge path after close.",
      },
    );
  }
  const candidates = (await readCandidateRecords(input.projectRoot)).filter((candidate) =>
    candidate.candidate_type === "indexer-artifact"
  );
  const selector = normalizedSelector(input.selector).toLocaleLowerCase();
  const pending = candidates.filter((candidate) => candidateAliases(candidate).some((alias) =>
    normalizedSelector(alias).toLocaleLowerCase() === selector));
  const applied = status.compile.files.filter((file) =>
    !candidates.some((candidate) => candidate.candidate_id === indexerCandidateId(file.file_digest)) &&
    [indexerCandidateId(file.file_digest), file.output_path, file.node_ref, file.internal_view_ref,
      indexerCandidateTitle(file.markdown, file.output_path, file.artifact_kind)].some((alias) =>
      normalizedSelector(alias).toLocaleLowerCase() === selector));
  if (pending.length + applied.length > 1) throw new ContextError(ExitCode.UserError, `revision target is ambiguous: ${input.selector}`, {
    category: ErrorCategory.UserInputInvalid, next: "Use the exact path of one page in the current review batch.",
  });
  const candidate = pending.length ? resolveCandidate(pending, input.selector) : undefined;
  const file = candidate ? status.compile.files.find((item) =>
    item.file_digest === candidate.indexer_candidate.file_digest) : applied[0];
  if (file === undefined) {
    if (input.move_to) throw new TypeError("Finish the current delivery before moving an approved page.");
    const { registerKnowledgeMaintenance } = await import("./knowledgeMaintenance.js");
    return registerKnowledgeMaintenance(input.projectRoot, { id: indexerProtocolDigest({ selector: input.selector, instruction }).slice(7),
      operation: "revise", targets: [{ path: input.selector, instruction }] }, { renewCompleted: true });
  }
  // A current compile already verifies that a file absent from the pending
  // ledger matches its approved identity and sections. Keep that actual page
  // as the Author's repair input instead of recreating its original draft.
  const path = normalizedSelector(file.output_path);
  const targetRef = candidate?.candidate_id ?? indexerCandidateId(file.file_digest);
  if (!candidate) await safeProjectTarget(input.projectRoot, file.output_path);
  const markdown = candidate?.body ?? hydrateApprovedKnowledgeMarkdown({
    content: await readFile(join(input.projectRoot, file.output_path), "utf8"), relPath: path,
    metadata: await readApprovedKnowledgeMetadataIndex(input.projectRoot),
  });
  const binding = status.compile.result_bindings.find((item) =>
    item.artifact_result_digest === file.artifact_result_digest
  );
  if (binding === undefined) {
    throw new TypeError("current Candidate does not resolve to its owning Author workset");
  }
  const ledger = await currentLedger(input.projectRoot);
  if (ledger === undefined || ledger.entries.some((entry) => entry.stage !== "author")) {
    throw new TypeError("current Candidate repair requires the Author run ledger");
  }
  const owner = ledger.entries.find((entry) =>
    entry.workset_digest === binding.workset_digest
  );
  if (owner === undefined) {
    throw new TypeError("owning Author workset is absent from the current ledger");
  }
  const repaired = await reopenCurrentAuthorWorksets({
    projectRoot: input.projectRoot,
    instruction,
    target_ref: targetRef,
    current_markdown: markdown,
    workset_digests: [binding.workset_digest],
  });
  return {
    status: "author-reopened" as const,
    candidate_id: targetRef,
    path,
    workset_digest: repaired.first_workset_digest,
    repair_intent_digest: repaired.repair_intent_digest,
    next_action: { command: "context status --format json" },
  };
}
