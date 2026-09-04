import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerRepairIntent,
  composeIndexerLayerInput,
  loadIndexerRegistry,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readCandidateRecords, type CandidateRecord } from "./candidateLedger.js";
import {
  INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
  INDEXER_CURRENT_READINESS_PATH,
  readProjectIndexerCandidateCompileStatus,
} from "./indexerCandidateCompileActions.js";
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
import {
  buildProjectIndexerMainPartitionWorksets,
  buildProjectIndexerQuestionTargetInventory,
} from "./indexerMainLifecycleActions.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { INDEXER_POST_AUTHOR_RUN_STORE_ROOT } from
  "./indexerPostAuthorStorePersistence.js";

function normalizedSelector(value: string): string {
  return value.normalize("NFC").replace(/^knowledge\//u, "").replace(/^\.\//u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
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

async function clearDerivedCurrentState(projectRoot: string): Promise<void> {
  await Promise.all([
    INDEXER_CURRENT_FINALIZATION_PATH,
    INDEXER_CURRENT_READINESS_PATH,
    INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
    INDEXER_POST_AUTHOR_RUN_STORE_ROOT,
  ].map((path) => rm(join(projectRoot, path), { recursive: true, force: true })));
}

export async function reopenCurrentAuthorWorksets(input: {
  projectRoot: string;
  instruction: string;
  target_ref: string;
  workset_digests?: readonly string[];
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
  await clearDerivedCurrentState(input.projectRoot);
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

function approvedViewAliases(view: Record<string, unknown>): string[] {
  const path = typeof view.path === "string" ? view.path : undefined;
  return [
    ...(typeof view.view_ref === "string" ? [view.view_ref] : []),
    ...(typeof view.node_ref === "string" ? [view.node_ref] : []),
    ...(path === undefined ? [] : [path, `knowledge/${path}`]),
    ...(typeof view.title === "string" ? [view.title] : []),
  ];
}

function resolveApprovedView(
  structure: Record<string, unknown>,
  selector: string,
): Record<string, unknown> {
  const views = Array.isArray(structure.views)
    ? structure.views.filter(isRecord)
    : [];
  const normalized = normalizedSelector(selector).toLocaleLowerCase();
  const exact = views.filter((view) => approvedViewAliases(view).some((alias) =>
    normalizedSelector(alias).toLocaleLowerCase() === normalized
  ));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ContextError(
      ExitCode.UserError,
      `approved knowledge target is ambiguous: ${selector}`,
      {
        category: ErrorCategory.UserInputInvalid,
        candidates: exact.map((view) => ({
          path: view.path,
          title: view.title,
          view_ref: view.view_ref,
        })),
      },
    );
  }
  throw new ContextError(
    ExitCode.UserError,
    `approved knowledge target not found: ${selector}`,
    {
      category: ErrorCategory.UserInputInvalid,
      next: "Use a canonical path or exact title from knowledge/structure.yaml.",
    },
  );
}

function approvedViewSources(view: Record<string, unknown>): string[] {
  const sectionSources = Array.isArray(view.sections)
    ? view.sections.flatMap((section) => isRecord(section) ? stringList(section.source_refs) : [])
    : [];
  return [...new Set([...stringList(view.sources), ...sectionSources])].sort();
}

async function reopenApprovedPartition(input: {
  projectRoot: string;
  selector: string;
  instruction: string;
}) {
  const structure = await readKnowledgeStructure(input.projectRoot);
  if (structure.parsed === null) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "context revise requires approved knowledge structure after close",
      { category: ErrorCategory.WorkspaceStateInvalid },
    );
  }
  const view = resolveApprovedView(structure.parsed, input.selector);
  const sourceRefs = approvedViewSources(view);
  if (sourceRefs.length === 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "approved knowledge target has no recoverable source reference",
      { category: ErrorCategory.WorkspaceStateInvalid },
    );
  }
  const loaded = await loadIndexerRegistry(input.projectRoot);
  const questionTargets = await buildProjectIndexerQuestionTargetInventory({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: loaded.requirementSetDigest,
    },
  });
  const partition = await buildProjectIndexerMainPartitionWorksets({
    projectRoot: input.projectRoot,
    value: {
      protocol: "context.indexer.main-partition-workset-build-input/v1",
      question_target_inventory: questionTargets,
    },
  });
  const selected = partition.worksets.filter((workset) =>
    sourceRefs.includes(workset.source_ref)
  );
  if (selected.length === 0) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "approved knowledge sources no longer resolve to a current Indexer Partition",
      {
        category: ErrorCategory.WorkspaceStateInvalid,
        sources: sourceRefs,
        next: "Update src/indexers.yaml or recapture the source before retrying.",
      },
    );
  }
  const repairIntent = buildIndexerRepairIntent({
    target_ref: typeof view.path === "string" ? `knowledge/${view.path}` : input.selector,
    instruction: input.instruction,
  });
  const specByWorkset = new Map(partition.run_specs.map((spec) => [
    spec.request.workset.workset_digest,
    spec,
  ]));
  const repairedSpecs = selected.map((oldWorkset) => {
    const oldSpec = specByWorkset.get(oldWorkset.workset_digest);
    if (oldSpec === undefined) {
      throw new TypeError("targeted Partition is missing its current run specification");
    }
    const {
      workset_digest: _oldDigest,
      repair_intent: _oldRepair,
      ...worksetPayload
    } = oldWorkset;
    void _oldDigest;
    void _oldRepair;
    const repairedWorkset = buildIndexerMainWorkset({
      ...worksetPayload,
      repair_intent: repairIntent,
    });
    if (repairedWorkset.stage !== "partition") {
      throw new TypeError("approved knowledge repair produced a non-Partition workset");
    }
    const request = buildIndexerMainRunRequest({
      workset: repairedWorkset,
      composition_input: composeIndexerLayerInput({
        workset_digest: repairedWorkset.workset_digest,
        final_authority_layer_ref:
          oldSpec.request.composition_input.final_authority_layer_ref,
        fragments: oldSpec.request.composition_input.accepted_fragments,
      }),
      final_authority: oldSpec.request.final_authority,
      run_environment: oldSpec.request.run_environment,
      partition_strategy_attempt: oldSpec.request.partition_strategy_attempt,
    });
    return normalizeRunSpec({
      protocol: "context.indexer.main-run-spec/v1",
      request,
      validation: oldSpec.validation,
    });
  });
  await clearDerivedCurrentState(input.projectRoot);
  await prepareIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_set: buildIndexerMainWorksetSet(
      repairedSpecs.map((spec) => spec.request.workset),
    ),
    run_specs: repairedSpecs,
  });
  await startIndexerMainRunStore({
    projectRoot: input.projectRoot,
    workset_digest: repairedSpecs[0]!.request.workset.workset_digest,
  });
  return {
    status: "partition-reopened" as const,
    path: view.path,
    source_refs: sourceRefs,
    workset_count: repairedSpecs.length,
    repair_intent_digest: repairIntent.intent_digest,
    next_action: { command: "context status --format json" },
  };
}

/**
 * Reopen the exact Author workset that produced a current Candidate. The
 * instruction is part of the new workset identity, so an old accepted Result
 * can never satisfy the repair run.
 */
export async function beginDocumentRevision(input: {
  projectRoot: string;
  selector: string;
  instruction: string;
}) {
  const instruction = input.instruction.trim();
  if (instruction.length === 0) {
    throw new ContextError(ExitCode.UserError, "--instruction must not be empty", {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  const status = await readProjectIndexerCandidateCompileStatus(input.projectRoot);
  if (status.state !== "current" || status.compile === undefined) {
    if (await currentLedger(input.projectRoot) !== undefined) {
      throw new ContextError(
        ExitCode.WorkspaceStateError,
        "context revise cannot replace an unfinished Indexer lifecycle",
        {
          category: ErrorCategory.WorkspaceStateInvalid,
          next: "Finish or repair the current workflow route first.",
        },
      );
    }
    return reopenApprovedPartition({
      projectRoot: input.projectRoot,
      selector: input.selector,
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
  const candidate = resolveCandidate(candidates, input.selector);
  const file = status.compile.files.find((item) =>
    item.file_digest === candidate.indexer_candidate.file_digest
  );
  if (file === undefined) {
    throw new TypeError("current Candidate does not resolve to its compiled Artifact");
  }
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
    target_ref: candidate.candidate_id,
    workset_digests: [binding.workset_digest],
  });
  return {
    status: "author-reopened" as const,
    candidate_id: candidate.candidate_id,
    path: candidate.path,
    workset_digest: repaired.first_workset_digest,
    repair_intent_digest: repaired.repair_intent_digest,
    next_action: { command: "context status --format json" },
  };
}
