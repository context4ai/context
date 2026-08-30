import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  actualizeIndexerMaterialAnswer,
  buildIndexerMaterialAnswerLayoutProposalFromLayoutSet,
  deriveIndexerMaterialAnswerFlowStatus,
  indexerMaterialAnswerBindingDigestFromLedgerEntry,
  indexerMaterialGapQuestionKey,
  indexerMaterialQuestionKey,
  indexerProtocolDigest,
  indexerQuestionRevisionDigest,
  indexerRegistryDigests,
  indexerResolvedMaterialQuestionSchema,
  ownerCells,
  parseIndexerRegistry,
  reopenIndexerMaterialAnswerBinding,
  validateIndexerResolvedMaterialQuestion,
  type IndexerRegistry,
  type IndexerMaterialGapLedgerEntry,
} from "@c4a/context";
import { indexerOwnerDomainAuthorities } from "./indexerMaterialGapAuthority.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapStructure,
} from "./indexerMaterialGapStore.js";
import { materialAnswerEvidenceReadResolver } from
  "./indexerMaterialAnswerEvidenceReads.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

interface RegisteredSource {
  source_ref: string;
  source_input_digest: string;
}

function registeredSources(value: unknown): RegisteredSource[] {
  const sources = list(value, "actualization registered_sources").map((item) => {
    const source = record(item, "actualization registered source");
    return {
      source_ref: text(source.source_ref, "actualization source_ref"),
      source_input_digest: text(
        source.source_input_digest,
        "actualization source_input_digest",
      ),
    };
  });
  if (new Set(sources.map((source) => source.source_ref)).size !== sources.length) {
    throw new TypeError("actualization registered sources must be unique");
  }
  return sources;
}

function resolvedQuestions(input: {
  value: unknown;
  registry: IndexerRegistry;
  allowed_selector_fact_paths: ReadonlySet<string>;
}) {
  const questions = list(input.value, "actualization resolved_questions").map((item) => {
    const entry = record(item, "actualization resolved question");
    const requirementRef = text(
      entry.requirement_ref,
      "actualization requirement_ref",
    );
    if (!requirementRef.startsWith("requirement:")) {
      throw new TypeError("actualization requirement_ref is invalid");
    }
    const requirement = input.registry.requirements.find((candidate) =>
      candidate.id === requirementRef.slice("requirement:".length)
    );
    const unresolved = indexerResolvedMaterialQuestionSchema.parse(entry.question);
    const binding = requirement?.questions?.find((candidate) =>
      candidate.ref === unresolved.ref
    );
    const domainState = requirement?.coverage_domains[unresolved.coverage_domain];
    if (requirement === undefined || binding === undefined || domainState === undefined) {
      throw new TypeError("actualization question is outside current requirement authority");
    }
    return {
      requirement_ref: requirementRef,
      question: validateIndexerResolvedMaterialQuestion({
        binding,
        resolved_question: unresolved,
        allowed_selector_fact_paths: input.allowed_selector_fact_paths,
        coverage_domain_state: domainState,
      }),
    };
  });
  const keys = questions.map((entry) =>
    `${entry.requirement_ref}\u0000${entry.question.ref}`
  );
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("actualization resolved questions must be unique per requirement");
  }
  return questions;
}

function landingMappings(value: unknown) {
  return list(value, "actualization answer_landings").map((item) => {
    const landing = record(item, "actualization answer landing");
    return {
      answer_landing_ref: text(
        landing.answer_landing_ref,
        "actualization answer_landing_ref",
      ),
      indexer_id: text(landing.indexer_id, "actualization landing indexer_id"),
      artifact_id: text(landing.artifact_id, "actualization landing artifact_id"),
      ...(landing.section_key === undefined
        ? {}
        : { section_key: text(landing.section_key, "actualization section_key") }),
    };
  });
}

function currentQuestionRevision(input: {
  entry: IndexerMaterialGapLedgerEntry;
  owner_indexer_ids: readonly string[];
  question: ReturnType<typeof validateIndexerResolvedMaterialQuestion>;
}): string {
  return indexerQuestionRevisionDigest({
    question_contract_digest: input.question.contract_digest,
    question_key: indexerMaterialQuestionKey({
      owner_cell_ref: input.entry.owner_cell_ref,
      question_contract_digest: input.question.contract_digest,
      question_subject_target_ref: input.entry.question_subject_target_ref,
    }),
    owner_cell_digest: indexerProtocolDigest({
      owner_cell_ref: input.entry.owner_cell_ref,
      owner_indexer_ids: input.owner_indexer_ids,
    }),
    question_target_item_digest: input.entry.question_target_item_digest,
    ...(input.entry.dependencies.answer_landing_dependency_digest === undefined
      ? {}
      : {
          answer_landing_dependency_digest:
            input.entry.dependencies.answer_landing_dependency_digest,
        }),
  });
}

export async function actualizeProjectIndexerMaterialAnswerBindings(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "actualize-material-answer-bindings input");
  if (value.protocol !== "context.indexer.actualize-material-answer-bindings-input/v1") {
    throw new TypeError("actualize-material-answer-bindings input protocol is invalid");
  }
  const current = await readIndexerMaterialGapStructure(input.projectRoot);
  if (current === undefined) throw new TypeError("material-answer actualization requires a checkpoint");
  const expectedRevision = text(
    value.expected_ledger_revision,
    "actualization expected_ledger_revision",
  );
  if (current.ledger.revision !== expectedRevision) {
    throw new TypeError("material-answer actualization retained ledger CAS is stale");
  }
  const registry = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const registryDigests = indexerRegistryDigests(registry);
  const authorities = indexerOwnerDomainAuthorities(registry);
  const ownerByRef = new Map(ownerCells(registry).map((owner) => [
    owner.owner_cell_ref,
    owner,
  ]));
  const selectorPaths = list(
    value.allowed_selector_fact_paths,
    "actualization allowed_selector_fact_paths",
  ).map((path) => text(path, "actualization selector fact path"));
  if (new Set(selectorPaths).size !== selectorPaths.length) {
    throw new TypeError("actualization selector fact paths must be unique");
  }
  const questions = resolvedQuestions({
    value: value.resolved_questions,
    registry,
    allowed_selector_fact_paths: new Set(selectorPaths),
  });
  const sources = registeredSources(value.registered_sources);
  const sourceByRef = new Map(sources.map((source) => [source.source_ref, source]));
  const evidenceReads = materialAnswerEvidenceReadResolver({
    receipts: list(value.evidence_read_receipts, "actualization evidence_read_receipts"),
    expected_reader_authority_digest: text(
      value.reader_authority_digest,
      "actualization reader_authority_digest",
    ),
  });
  const answerLandings = landingMappings(value.answer_landings);
  const retainedLandingRefs = new Set(current.ledger.entries.flatMap((entry) =>
    (entry.state === "answer-approved" || entry.state === "resolved") &&
      entry.answer_landing_ref !== undefined
      ? [entry.answer_landing_ref]
      : []
  ));
  if (answerLandings.some((landing) =>
    !retainedLandingRefs.has(landing.answer_landing_ref)
  )) {
    throw new TypeError(
      "material-answer actualization contains an unapproved answer landing",
    );
  }
  const layoutProposal = buildIndexerMaterialAnswerLayoutProposalFromLayoutSet({
    layout_proposal_set: value.layout_proposal_set,
    landings: answerLandings,
  });
  let ledger = current.ledger;
  const evaluations = [];
  for (const retainedEntry of current.ledger.entries) {
    if (retainedEntry.state !== "answer-approved" && retainedEntry.state !== "resolved") {
      continue;
    }
    const questionKey = indexerMaterialGapQuestionKey(retainedEntry);
    const bindingDigest = indexerMaterialAnswerBindingDigestFromLedgerEntry(
      retainedEntry,
    );
    const owner = ownerByRef.get(retainedEntry.owner_cell_ref);
    const question = owner === undefined
      ? undefined
      : questions.find((entry) =>
          entry.requirement_ref === owner.requirement_ref &&
          entry.question.ref === retainedEntry.question_ref
        )?.question;
    if (owner === undefined || question === undefined) {
      ledger = reopenIndexerMaterialAnswerBinding({
        ledger,
        expected_revision: ledger.revision,
        question_key: questionKey,
        binding_digest: bindingDigest,
      });
      evaluations.push({
        question_key: questionKey,
        state: "unresolved" as const,
        reason_codes: [
          owner === undefined
            ? "owner-authority-unavailable"
            : "question-authority-unavailable",
        ],
      });
      continue;
    }
    const acceptedWorkset = retainedEntry.answer.accepted_workset;
    const worksetItem = acceptedWorkset.items.find((item) =>
      item.question_key === questionKey
    );
    if (worksetItem === undefined) {
      throw new TypeError("retained material answer does not contain its accepted workset item");
    }
    const currentSourceInputDigests = worksetItem.authorized_source_refs.flatMap((ref) => {
      const source = sourceByRef.get(ref);
      return source === undefined ? [] : [source.source_input_digest];
    });
    const providerFingerprints = new Set<string>();
    if (
      acceptedWorkset.registry_digest === registryDigests.registryDigest &&
      acceptedWorkset.requirement_set_digest === registryDigests.requirementSetDigest &&
      worksetItem.eligible_answer_indexer_ids.includes(
        retainedEntry.answer.answer_indexer_id,
      )
    ) {
      providerFingerprints.add(
        retainedEntry.answer.answer_provider_composition_fingerprint,
      );
    }
    const result = actualizeIndexerMaterialAnswer({
      ledger,
      expected_revision: ledger.revision,
      question_key: questionKey,
      binding_digest: bindingDigest,
      layout_proposal: layoutProposal,
      current_question_revision_digest: currentQuestionRevision({
        entry: retainedEntry,
        owner_indexer_ids: owner.owner_indexer_ids,
        question,
      }),
      current_question: question,
      current_provider_composition_fingerprints: providerFingerprints,
      current_source_input_digests: currentSourceInputDigests,
      current_sources: evidenceReads.current_sources,
      resolve_evidence_digest: evidenceReads.resolve_evidence_digest,
    });
    ledger = result.ledger;
    evaluations.push({ question_key: questionKey, ...result });
  }
  if (evaluations.every((evaluation) => evaluation.state === "resolved")) {
    evidenceReads.assert_all_consumed();
  }
  const checkpoint = await checkpointIndexerMaterialGapStore({
    projectRoot: input.projectRoot,
    expected_ledger_revision: expectedRevision,
    ledger,
  });
  const status = deriveIndexerMaterialAnswerFlowStatus({
    ledger,
    current_layout_digest: layoutProposal.layout_digest,
    owner_domain_authorities: authorities.map((authority) => ({
      owner_cell_ref: authority.owner_cell_ref,
      domain_state: authority.domain_state,
    })),
  });
  return {
    protocol: "context.indexer.material-answer-actualization-result/v1" as const,
    layout_proposal: layoutProposal,
    evaluations,
    ledger,
    checkpoint,
    status,
    graph_outcome: status.main_candidate_review_allowed
      ? "completed" as const
      : "blocked" as const,
  };
}
