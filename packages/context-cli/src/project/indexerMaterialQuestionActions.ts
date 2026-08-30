import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerMaterialAnswerExecutionPlan,
  buildIndexerMaterialQuestionWorkset,
  indexerProtocolDigest,
  indexerProviderManifestSchema,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerMaterialGapLedger,
  type IndexerEvidenceKind,
  type IndexerMaterialAnswerExecutionAuthority,
  type IndexerProviderManifest,
  type IndexerRegistry,
  type IndexerRegistryEntry,
} from "@c4a/context";
import { readIndexerMaterialGapStructure } from "./indexerMaterialGapStore.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

interface ProviderCapability {
  indexer_id: string;
  provider_integrity: string;
  stage_receipt_digest: string;
  manifest: IndexerProviderManifest;
}

interface RegisteredSource {
  source_ref: string;
  source_input_digest: string;
}

interface LandingHint {
  question_ref: string;
  target_ref: string;
  answer_landing_ref?: string;
  answer_landing_dependency_digest?: string;
}

function providerCapabilities(value: unknown): ProviderCapability[] {
  const capabilities = array(value, "material-answer provider_capabilities")
    .map((item) => {
      const capability = record(item, "material-answer provider capability");
      return {
        indexer_id: string(capability.indexer_id, "provider capability indexer_id"),
        provider_integrity: string(
          capability.provider_integrity,
          "provider capability provider_integrity",
        ),
        stage_receipt_digest: string(
          capability.stage_receipt_digest,
          "provider capability stage_receipt_digest",
        ),
        manifest: indexerProviderManifestSchema.parse(capability.manifest),
      };
    });
  if (new Set(capabilities.map((item) => item.indexer_id)).size !== capabilities.length) {
    throw new TypeError("material-answer provider capabilities must be unique by Indexer");
  }
  return capabilities;
}

function registeredSources(value: unknown): RegisteredSource[] {
  const sources = array(value, "material-answer registered_sources").map((item) => {
    const source = record(item, "material-answer registered source");
    return {
      source_ref: string(source.source_ref, "registered source_ref"),
      source_input_digest: string(
        source.source_input_digest,
        "registered source_input_digest",
      ),
    };
  });
  if (new Set(sources.map((item) => item.source_ref)).size !== sources.length) {
    throw new TypeError("material-answer registered sources must be unique");
  }
  return sources;
}

function landingHints(value: unknown): LandingHint[] {
  const hints = array(value ?? [], "material-answer answer_landings").map((item) => {
    const hint = record(item, "material-answer landing hint");
    return {
      question_ref: string(hint.question_ref, "landing question_ref"),
      target_ref: string(hint.target_ref, "landing target_ref"),
      ...(hint.answer_landing_ref === undefined ? {} : {
        answer_landing_ref: string(hint.answer_landing_ref, "answer_landing_ref"),
      }),
      ...(hint.answer_landing_dependency_digest === undefined ? {} : {
        answer_landing_dependency_digest: string(
          hint.answer_landing_dependency_digest,
          "answer_landing_dependency_digest",
        ),
      }),
    };
  });
  const keys = hints.map((hint) => `${hint.question_ref}\u0000${hint.target_ref}`);
  if (new Set(keys).size !== hints.length) {
    throw new TypeError("material-answer landing hints must be unique");
  }
  return hints;
}

function requirementId(requirementRef: string): string {
  if (!requirementRef.startsWith("requirement:")) {
    throw new TypeError("material question requirement_ref is invalid");
  }
  return requirementRef.slice("requirement:".length);
}

function readableEvidenceSources(input: {
  registry: IndexerRegistry;
  indexer: IndexerRegistryEntry;
  requirement_id: string;
  registered_sources: readonly RegisteredSource[];
}): string[] {
  const requirement = input.registry.requirements.find((item) =>
    item.id === input.requirement_id
  );
  if (requirement === undefined) return [];
  const evidenceSources = new Set(requirement.evidence_source_scope.targets.map((target) =>
    target.source_ref
  ));
  const includesEvidenceScope = input.indexer.read_scope.refs.includes(
    `requirement:${input.requirement_id}#evidence_source_scope`,
  );
  const extra = new Set((input.indexer.read_scope.extra_targets ?? []).map((target) =>
    target.source_ref
  ));
  return input.registered_sources.filter((source) =>
    evidenceSources.has(source.source_ref) &&
    (includesEvidenceScope || extra.has(source.source_ref))
  ).map((source) => source.source_ref).sort();
}

function materialAnswerOperation(manifest: IndexerProviderManifest) {
  return manifest.provides.operations.find((operation) =>
    operation.id === "material-answer"
  );
}

function candidatesForQuestion(input: {
  registry: IndexerRegistry;
  capabilities: ReadonlyMap<string, ProviderCapability>;
  registered_sources: readonly RegisteredSource[];
  requirement_ref: string;
  coverage_domain: string;
  accepted_kinds: readonly IndexerEvidenceKind[];
}) {
  const requirement = requirementId(input.requirement_ref);
  const candidates = input.registry.indexers.flatMap((indexer) => {
    const binding = indexer.requirement_bindings.find((item) =>
      item.requirement_ref === requirement &&
      item.role === "enricher" &&
      item.coverage_domains.includes(input.coverage_domain)
    );
    const capability = input.capabilities.get(indexer.id);
    const primary = indexer.providers.find((provider) => provider.role === "primary");
    const operation = capability === undefined
      ? undefined
      : materialAnswerOperation(capability.manifest);
    const sources = readableEvidenceSources({
      registry: input.registry,
      indexer,
      requirement_id: requirement,
      registered_sources: input.registered_sources,
    });
    if (
      binding === undefined ||
      !indexer.operations.includes("material-answer") ||
      capability === undefined ||
      primary === undefined ||
      primary.id !== capability.manifest.id ||
      primary.version !== capability.manifest.version ||
      primary.integrity !== capability.provider_integrity ||
      operation === undefined ||
      sources.length === 0 ||
      !operation.supported_evidence_kinds.some((kind) =>
        input.accepted_kinds.includes(kind)
      )
    ) {
      return [];
    }
    return [{
      indexer,
      capability,
      sources,
      supported_evidence_kinds: operation.supported_evidence_kinds,
    }];
  });
  const sourceUnion = [...new Set(candidates.flatMap((candidate) => candidate.sources))]
    .sort();
  const safelyRouted = candidates.filter((candidate) =>
    sourceUnion.every((sourceRef) => candidate.sources.includes(sourceRef))
  );
  return {
    authorized_source_refs: safelyRouted.length === 0 ? [] : sourceUnion,
    candidates: safelyRouted.map((candidate) => ({
      indexer_id: candidate.indexer.id,
      operations: candidate.indexer.operations,
      requirement_binding_role: "enricher" as const,
      provider_operation_supported: true,
      supported_evidence_kinds: candidate.supported_evidence_kinds,
    })),
    authority_receipts: safelyRouted.map((candidate) => ({
      indexer_id: candidate.indexer.id,
      provider_integrity: candidate.capability.provider_integrity,
      stage_receipt_digest: candidate.capability.stage_receipt_digest,
      manifest_digest: indexerProtocolDigest(candidate.capability.manifest),
    })),
  };
}

export async function buildProjectIndexerMaterialQuestionWorkset(input: {
  projectRoot: string;
  value: unknown;
}) {
  const value = record(input.value, "build-material-question-workset input");
  if (value.protocol !== "context.indexer.build-material-question-workset-input/v1") {
    throw new TypeError("build-material-question-workset input protocol is invalid");
  }
  const registry = parseIndexerRegistry(await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  ));
  const digests = indexerRegistryDigests(registry);
  if (value.requirement_set_digest !== digests.requirementSetDigest) {
    throw new TypeError("material-question workset targets a stale requirement set");
  }
  const retained = await readIndexerMaterialGapStructure(input.projectRoot);
  const ledger = retained?.ledger ?? validateIndexerMaterialGapLedger(
    value.material_gap_ledger,
  );
  const sources = registeredSources(value.registered_sources);
  const capabilities = providerCapabilities(value.provider_capabilities);
  const capabilityByIndexer = new Map(capabilities.map((item) => [item.indexer_id, item]));
  const questions = array(value.resolved_questions, "resolved material questions") as
    Parameters<typeof buildIndexerMaterialQuestionWorkset>[0]["resolved_questions"];
  const inventory = record(value.question_target_inventory, "question target inventory") as
    Parameters<typeof buildIndexerMaterialQuestionWorkset>[0]["question_target_inventory"];
  const hints = landingHints(value.answer_landings);
  const receipts = new Map<string, {
    indexer_id: string;
    provider_integrity: string;
    stage_receipt_digest: string;
    manifest_digest: string;
  }>();
  const routes = questions.flatMap((entry) => inventory.items.map((target) => {
    const eligibility = candidatesForQuestion({
      registry,
      capabilities: capabilityByIndexer,
      registered_sources: sources,
      requirement_ref: entry.requirement_ref,
      coverage_domain: entry.question.coverage_domain,
      accepted_kinds: entry.question.evidence_contract.accepted_kinds,
    });
    eligibility.authority_receipts.forEach((receipt) => receipts.set(
      receipt.indexer_id,
      receipt,
    ));
    const hint = hints.find((item) =>
      item.question_ref === entry.question.ref && item.target_ref === target.target_ref
    );
    return {
      requirement_ref: entry.requirement_ref,
      question_ref: entry.question.ref,
      target_ref: target.target_ref,
      authorized_source_refs: eligibility.authorized_source_refs,
      candidates: eligibility.candidates,
      ...(hint?.answer_landing_ref === undefined ? {} : {
        answer_landing_ref: hint.answer_landing_ref,
      }),
      ...(hint?.answer_landing_dependency_digest === undefined ? {} : {
        answer_landing_dependency_digest: hint.answer_landing_dependency_digest,
      }),
    };
  }));
  const selectorPaths = array(
    value.allowed_selector_fact_paths,
    "material question selector fact paths",
  ).map((item) => string(item, "selector fact path"));
  const workset = buildIndexerMaterialQuestionWorkset({
    question_target_inventory: inventory,
    resolved_questions: questions,
    owner_cells: array(value.owner_cells, "material question owner cells") as
      Parameters<typeof buildIndexerMaterialQuestionWorkset>[0]["owner_cells"],
    target_facts: record(value.target_facts, "material question target facts") as
      Parameters<typeof buildIndexerMaterialQuestionWorkset>[0]["target_facts"],
    allowed_selector_fact_paths: new Set(selectorPaths),
    routes,
    predecessor_ledger_revision: ledger.revision,
    registry_digest: digests.registryDigest,
    requirement_set_digest: digests.requirementSetDigest,
    source_input_digests: sources.map((source) => source.source_input_digest),
  });
  return {
    protocol: "context.indexer.build-material-question-workset-result/v1" as const,
    workset,
    provider_authority_receipts: [...receipts.values()].sort((left, right) =>
      left.indexer_id.localeCompare(right.indexer_id)
    ),
    unresolved_question_keys: workset.items.filter((item) =>
      item.eligible_answer_indexer_ids.length === 0 ||
      item.authorized_source_refs.length === 0
    ).map((item) => item.question_key),
  };
}

export function buildProjectIndexerMaterialAnswerExecutionPlan(value: unknown) {
  const input = record(value, "prepare-material-answer-runs input");
  if (input.protocol !== "context.indexer.prepare-material-answer-runs-input/v1") {
    throw new TypeError("prepare-material-answer-runs input protocol is invalid");
  }
  return buildIndexerMaterialAnswerExecutionPlan({
    workset: input.workset,
    authorities: array(input.authorities, "material-answer execution authorities") as
      IndexerMaterialAnswerExecutionAuthority[],
  });
}
