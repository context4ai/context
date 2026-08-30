import { describe, expect, test } from "bun:test";
import {
  buildIndexerMaterialQuestionWorkset,
  buildIndexerMaterialAnswerRunRequest,
  buildIndexerQuestionTargetInventory,
  composeIndexerLayerInput,
  indexerMaterialAnswerResultDigest,
  indexerProgramRunRequestSchema,
  indexerProgramRunResultSchema,
  indexerResolvedMaterialQuestionDigest,
  validateIndexerMaterialAnswerCandidateSet,
  validateIndexerMaterialAnswerResult,
  validateIndexerMaterialAnswerRunResult,
  type IndexerCurrentEvidenceSource,
  type IndexerMaterialAnswerResult,
  type IndexerResolvedMaterialQuestion,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const REQUIREMENT_REF = "requirement:public-knowledge";
const OWNER_REF = "owner-cell:public-knowledge#operations";
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const PROVIDER = {
  layer_ref: "provider:answer#layer:primary",
  integrity: digest("a"),
  bundle_digest: digest("b"),
  config_fingerprint: digest("c"),
  customization_fingerprint: null,
};

function question(input: {
  minimum_items?: number;
  minimum_distinct_sources?: number;
  provenance?: IndexerResolvedMaterialQuestion["evidence_contract"]["provenance_constraints"];
} = {}): IndexerResolvedMaterialQuestion {
  const payload: Omit<IndexerResolvedMaterialQuestion, "contract_digest"> = {
    ref: "question:failure-recovery",
    authority: {
      kind: "cli-base-contract",
      ref: "contract:community-profile",
      digest: digest("a"),
    },
    contract_version: 1,
    semantic: "How does this capability recover from failure?",
    coverage_domain: "operations",
    target_domain_ref: "component",
    target_selector: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.visibility", value: "public" },
    },
    evidence_contract: {
      accepted_kinds: ["documentation", "runbook"],
      minimum_items: input.minimum_items ?? 2,
      minimum_distinct_sources: input.minimum_distinct_sources ?? 1,
      ...(input.provenance === undefined
        ? {}
        : { provenance_constraints: input.provenance }),
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  return { ...payload, contract_digest: indexerResolvedMaterialQuestionDigest(payload) };
}

function workset(currentQuestion = question()) {
  const inventory = buildIndexerQuestionTargetInventory({
    requirement_set_digest: digest("b"),
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: REQUIREMENT_REF,
      owner_cell_ref: OWNER_REF,
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: SUBJECT,
      canonical_fact_slice_digest: digest("e"),
    }],
  });
  const targetRef = inventory.items[0]!.target_ref;
  return buildIndexerMaterialQuestionWorkset({
    question_target_inventory: inventory,
    resolved_questions: [{ requirement_ref: REQUIREMENT_REF, question: currentQuestion }],
    owner_cells: [{
      owner_cell_ref: OWNER_REF,
      owner_cell_digest: digest("f"),
      requirement_ref: REQUIREMENT_REF,
      coverage_domain: "operations",
      domain_state: "required",
    }],
    target_facts: { [targetRef]: { target: { visibility: "public" } } },
    allowed_selector_fact_paths: new Set(["target.visibility"]),
    routes: [{
      requirement_ref: REQUIREMENT_REF,
      question_ref: currentQuestion.ref,
      target_ref: targetRef,
      authorized_source_refs: [
        "source:doc",
        "source:doc-alias",
        "source:doc-mirror",
        "source:doc-next-snapshot",
        "source:runbook",
      ],
      candidates: [{
        indexer_id: "answer-indexer",
        operations: ["material-answer"],
        requirement_binding_role: "enricher",
        provider_operation_supported: true,
        supported_evidence_kinds: ["documentation", "runbook"],
      }],
    }],
    predecessor_ledger_revision: digest("0"),
    registry_digest: digest("1"),
    requirement_set_digest: digest("b"),
    source_input_digests: [digest("2"), digest("3"), digest("4")],
  });
}

function source(input: Partial<IndexerCurrentEvidenceSource> & {
  source_ref: string;
  source_origin_ref: string;
  source_input_digest: string;
}): IndexerCurrentEvidenceSource {
  return {
    source_role: "evidence",
    evidence_kinds: ["documentation", "runbook"],
    span_unit: "line",
    span_extent: 100,
    snapshot_current: true,
    locator_valid: true,
    tool_trust: "verified",
    ...input,
  };
}

const SOURCES: IndexerCurrentEvidenceSource[] = [
  source({
    source_ref: "source:doc",
    source_origin_ref: "origin:handbook",
    source_input_digest: digest("2"),
  }),
  source({
    source_ref: "source:doc-alias",
    source_origin_ref: "origin:handbook",
    source_input_digest: digest("2"),
  }),
  source({
    source_ref: "source:doc-mirror",
    source_origin_ref: "origin:handbook",
    source_input_digest: digest("2"),
  }),
  source({
    source_ref: "source:doc-next-snapshot",
    source_origin_ref: "origin:handbook",
    source_input_digest: digest("3"),
  }),
  source({
    source_ref: "source:runbook",
    source_origin_ref: "origin:runbook",
    source_input_digest: digest("4"),
    source_role: "runbook",
  }),
];

function claim(sourceRef: string, input: {
  kind?: "documentation" | "runbook" | "code";
  spans?: Array<{ unit: "line"; start: number; end_exclusive: number }>;
  evidence_digest?: string;
} = {}) {
  return {
    kind: input.kind ?? "documentation",
    source_ref: sourceRef,
    source_spans: input.spans ?? [{ unit: "line" as const, start: 10, end_exclusive: 20 }],
    evidence_digest: input.evidence_digest ?? digest("9"),
  };
}

function result(
  currentWorkset: ReturnType<typeof workset>,
  claims: ReturnType<typeof claim>[],
  authority: {
    execution_request_digest?: string;
    provider_composition_fingerprint?: string;
  } = {},
) {
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: currentWorkset.workset_digest,
    execution_request_digest: authority.execution_request_digest ?? digest("6"),
    answer_indexer_id: "answer-indexer",
    answer_provider_composition_fingerprint:
      authority.provider_composition_fingerprint ?? digest("7"),
    bindings: [{
      workset_digest: currentWorkset.workset_digest,
      question_key: currentWorkset.items[0]!.question_key,
      question_revision_digest: currentWorkset.items[0]!.question_revision_digest,
      evidence_claims: claims,
    }],
  };
  return { ...payload, result_digest: indexerMaterialAnswerResultDigest(payload) };
}

function validate(
  currentWorkset: ReturnType<typeof workset>,
  currentResult: unknown,
  currentSources = SOURCES,
) {
  return validateIndexerMaterialAnswerResult({
    result: currentResult,
    workset: currentWorkset,
    expected_execution_request_digest: digest("6"),
    expected_provider_composition_fingerprint: digest("7"),
    current_sources: currentSources,
    resolve_evidence_digest: () => digest("9"),
  });
}

describe("Material Answer evidence authority", () => {
  test("normalizes spans and deduplicates aliases, mirrors, and snapshots by origin", () => {
    const currentWorkset = workset();
    const currentResult = result(currentWorkset, [
      claim("source:doc", {
        spans: [
          { unit: "line", start: 11, end_exclusive: 15 },
          { unit: "line", start: 10, end_exclusive: 20 },
          { unit: "line", start: 10, end_exclusive: 20 },
        ],
      }),
      claim("source:doc-alias"),
      claim("source:doc-mirror"),
      claim("source:doc-next-snapshot"),
    ]);
    const validated = validate(currentWorkset, currentResult);
    const evaluation = validated.candidate_set.evaluations[0]!;
    expect(evaluation.state).toBe("candidate");
    if (evaluation.state !== "candidate") throw new Error("expected candidate");
    expect(evaluation.evidence_item_count).toBe(2);
    expect(evaluation.distinct_source_count).toBe(1);
    expect(evaluation.evidence[0]!.source_spans).toEqual([
      { unit: "line", start: 10, end_exclusive: 20 },
    ]);
    expect(validateIndexerMaterialAnswerCandidateSet(validated.candidate_set))
      .toEqual(validated.candidate_set);
  });

  test("returns insufficient instead of a Review candidate when distinct origins are missing", () => {
    const currentWorkset = workset(question({ minimum_distinct_sources: 2 }));
    const evaluation = validate(currentWorkset, result(currentWorkset, [
      claim("source:doc"),
      claim("source:doc-next-snapshot"),
    ])).candidate_set.evaluations[0]!;
    expect(evaluation).toMatchObject({
      state: "material-answer-evidence-insufficient",
      reason_codes: ["minimum-distinct-sources-not-met"],
      accepted_evidence_item_count: 2,
      distinct_source_count: 1,
    });
    expect(evaluation).not.toHaveProperty("binding_digest");
  });

  test("accepts multiple current origins and preserves both provenance identities", () => {
    const currentWorkset = workset(question({
      minimum_items: 2,
      minimum_distinct_sources: 2,
    }));
    const evaluation = validate(currentWorkset, result(currentWorkset, [
      claim("source:doc"),
      claim("source:runbook", { kind: "runbook" }),
    ])).candidate_set.evaluations[0]!;

    expect(evaluation.state).toBe("candidate");
    if (evaluation.state !== "candidate") throw new Error("expected candidate");
    expect(evaluation.evidence_item_count).toBe(2);
    expect(evaluation.distinct_source_count).toBe(2);
    expect(new Set(evaluation.evidence.map((item) => item.source_origin_ref))).toEqual(
      new Set(["origin:handbook", "origin:runbook"]),
    );
    expect(evaluation.evidence.every((item) => item.evidence_item_ref.length > 0)).toBe(true);
  });

  test("filters evidence through the fixed provenance fact allowlist", () => {
    const currentQuestion = question({
      provenance: {
        protocol: "context.indexer.selector/v1",
        expression: { op: "equals", fact: "tool.trust", value: "verified" },
      },
    });
    const currentWorkset = workset(currentQuestion);
    const sources = SOURCES.map((item) =>
      item.source_ref === "source:runbook" ? { ...item, tool_trust: "untrusted" } : item
    );
    const evaluation = validate(currentWorkset, result(currentWorkset, [
      claim("source:doc"),
      claim("source:runbook", { kind: "runbook" }),
    ]), sources).candidate_set.evaluations[0]!;
    expect(evaluation).toMatchObject({
      state: "material-answer-evidence-insufficient",
      reason_codes: ["minimum-items-not-met", "provenance-constraint-not-met"],
      accepted_evidence_item_count: 1,
    });
  });

  test("rejects Provider-owned origin, input digest, EvidenceItemRef, and authority fields", () => {
    const currentWorkset = workset();
    const currentResult = result(currentWorkset, [claim("source:doc")]) as unknown as {
      bindings: Array<{ evidence_claims: Array<Record<string, unknown>> }>;
      owner_cell_ref?: string;
    };
    currentResult.bindings[0]!.evidence_claims[0]!.source_origin_ref = "origin:forged";
    currentResult.bindings[0]!.evidence_claims[0]!.source_input_digest = digest("8");
    currentResult.bindings[0]!.evidence_claims[0]!.evidence_item_ref = "evidence-item:forged";
    currentResult.owner_cell_ref = OWNER_REF;
    expect(() => validate(currentWorkset, currentResult)).toThrow();
  });

  test("rejects unauthorized kinds, stale source inputs, and content-digest drift", () => {
    const currentWorkset = workset();
    expect(() => validate(currentWorkset, result(currentWorkset, [
      claim("source:doc", { kind: "code" }),
    ]))).toThrow(/kind/);
    expect(() => validate(
      currentWorkset,
      result(currentWorkset, [claim("source:doc")]),
      [source({
        source_ref: "source:doc",
        source_origin_ref: "origin:handbook",
        source_input_digest: digest("8"),
      })],
    )).toThrow(/authorized current source/);
    const drifted = result(currentWorkset, [
      claim("source:doc", { evidence_digest: digest("8") }),
    ]);
    expect(() => validate(currentWorkset, drifted)).toThrow(/content digest/);
  });

  test("rejects partial overlap, out-of-bounds spans, and wrong coordinate units", () => {
    const currentWorkset = workset();
    expect(() => validate(currentWorkset, result(currentWorkset, [
      claim("source:doc", { spans: [
        { unit: "line", start: 10, end_exclusive: 20 },
        { unit: "line", start: 15, end_exclusive: 25 },
      ] }),
    ]))).toThrow(/partially overlapping/);
    expect(() => validate(currentWorkset, result(currentWorkset, [
      claim("source:doc", { spans: [
        { unit: "line", start: 90, end_exclusive: 101 },
      ] }),
    ]))).toThrow(/outside current source/);
    const byteClaim = claim("source:doc") as unknown as {
      source_spans: Array<{ unit: string; start: number; end_exclusive: number }>;
    };
    byteClaim.source_spans[0]!.unit = "byte";
    expect(() => validate(currentWorkset, result(
      currentWorkset,
      [byteClaim as ReturnType<typeof claim>],
    ))).toThrow(/outside current source/);
  });

  test("binds the exact workset, question revision, eligible Indexer, Provider, and Result digest", () => {
    const currentWorkset = workset();
    const revisionDrift = result(currentWorkset, [claim("source:doc")]);
    revisionDrift.bindings[0]!.question_revision_digest = digest("8");
    revisionDrift.result_digest = indexerMaterialAnswerResultDigest({
      ...revisionDrift,
      result_digest: undefined,
    } as unknown as Omit<IndexerMaterialAnswerResult, "result_digest">);
    expect(() => validate(currentWorkset, revisionDrift)).toThrow(/not authorized/);

    const indexerDrift = result(currentWorkset, [claim("source:doc")]);
    indexerDrift.answer_indexer_id = "other-indexer";
    indexerDrift.result_digest = indexerMaterialAnswerResultDigest({
      protocol: indexerDrift.protocol,
      workset_digest: indexerDrift.workset_digest,
      execution_request_digest: indexerDrift.execution_request_digest,
      answer_indexer_id: indexerDrift.answer_indexer_id,
      answer_provider_composition_fingerprint:
        indexerDrift.answer_provider_composition_fingerprint,
      bindings: indexerDrift.bindings,
    });
    expect(() => validate(currentWorkset, indexerDrift)).toThrow(/not authorized/);

    const digestDrift = result(currentWorkset, [claim("source:doc")]);
    digestDrift.result_digest = digest("8");
    expect(() => validate(currentWorkset, digestDrift)).toThrow(/digest/);
  });

  test("uses the material-answer branch of the unified program request/result ABI", () => {
    const currentWorkset = workset();
    const request = buildIndexerMaterialAnswerRunRequest({
      workset: currentWorkset,
      answer_indexer_id: "answer-indexer",
      composition_input: composeIndexerLayerInput({
        workset_digest: currentWorkset.workset_digest,
        final_authority_layer_ref: PROVIDER.layer_ref,
        fragments: [],
      }),
      final_authority: PROVIDER,
      answer_provider_composition_fingerprint: digest("7"),
    });
    const operationResult = result(currentWorkset, [
      claim("source:doc"),
      claim("source:runbook", { kind: "runbook" }),
    ], { execution_request_digest: request.execution_request_digest });
    const runResult = {
      protocol: "context.indexer.run-result/v1" as const,
      operation: "material-answer" as const,
      consumed_input_view_digest: request.composition_input.view_digest,
      result: operationResult,
    };
    expect(indexerProgramRunRequestSchema.parse(request)).toEqual(request);
    expect(indexerProgramRunResultSchema.parse(runResult)).toEqual(runResult);
    expect(validateIndexerMaterialAnswerRunResult({
      request,
      result: runResult,
      current_sources: SOURCES,
      resolve_evidence_digest: () => digest("9"),
    }).candidate_set.evaluations[0]).toMatchObject({ state: "candidate" });

    runResult.consumed_input_view_digest = digest("8");
    expect(() => validateIndexerMaterialAnswerRunResult({
      request,
      result: runResult,
      current_sources: SOURCES,
      resolve_evidence_digest: () => digest("9"),
    })).toThrow(/request\/workset\/input view/);
  });

  test("rejects mixed main-index and material-answer union branches", () => {
    const currentWorkset = workset();
    const request = buildIndexerMaterialAnswerRunRequest({
      workset: currentWorkset,
      answer_indexer_id: "answer-indexer",
      composition_input: composeIndexerLayerInput({
        workset_digest: currentWorkset.workset_digest,
        final_authority_layer_ref: PROVIDER.layer_ref,
        fragments: [],
      }),
      final_authority: PROVIDER,
      answer_provider_composition_fingerprint: digest("7"),
    }) as unknown as Record<string, unknown>;
    request.operation = "main-index";
    expect(() => indexerProgramRunRequestSchema.parse(request)).toThrow();
  });
});
