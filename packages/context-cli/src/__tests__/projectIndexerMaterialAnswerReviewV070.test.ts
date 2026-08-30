import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexerMaterialAnswerReviewInspectionInput,
  buildIndexerMaterialAnswerReviewResolutionInput,
  buildIndexerMaterialGapLedger,
  buildIndexerMaterialQuestionWorkset,
  buildIndexerQuestionTargetInventory,
  indexerMaterialAnswerResultDigest,
  indexerMaterialAnswerSourceInputSetDigest,
  indexerProtocolDigest,
  indexerResolvedMaterialQuestionDigest,
  validateIndexerMaterialAnswerResult,
  type IndexerCurrentEvidenceSource,
  type IndexerMaterialAnswerResult,
  type IndexerMaterialGapLedger,
  type IndexerResolvedMaterialQuestion,
} from "@c4a/context";
import {
  inspectProjectIndexerMaterialAnswerReview,
  resolveProjectIndexerMaterialAnswerReview,
} from "../project/indexerMaterialAnswerReviewActions.js";
import { buildIndexerMaterialAnswerReviewRoute } from
  "../project/indexerMaterialAnswerReviewRoute.js";
import { checkpointProjectIndexerMaterialAnswerReview } from
  "../project/indexerMaterialGapActions.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapStructure,
} from "../project/indexerMaterialGapStore.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const requirementRef = "requirement:public-knowledge";
const ownerRef = "owner-cell:public-knowledge#operations";
const questionRef = "question:failure-recovery";

async function withTempDir<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), "context-material-answer-review-"));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function question(): IndexerResolvedMaterialQuestion {
  const payload: Omit<IndexerResolvedMaterialQuestion, "contract_digest"> = {
    ref: questionRef,
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
      accepted_kinds: ["runbook"],
      minimum_items: 1,
      minimum_distinct_sources: 1,
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  return { ...payload, contract_digest: indexerResolvedMaterialQuestionDigest(payload) };
}

function inventory() {
  return buildIndexerQuestionTargetInventory({
    requirement_set_digest: digest("b"),
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "component",
      requirement_ref: requirementRef,
      owner_cell_ref: ownerRef,
      source_ref: "repo:sample@revision",
      module_ref: "module:packages/sample",
      subject_key: {
        protocol: "context.subject-key/v1",
        namespace: "sample-package",
        kind: "component",
        local_key: "button",
      },
      canonical_fact_slice_digest: digest("e"),
    }],
  });
}

function workset(predecessor: string) {
  const targetInventory = inventory();
  const targetRef = targetInventory.items[0]!.target_ref;
  return buildIndexerMaterialQuestionWorkset({
    question_target_inventory: targetInventory,
    resolved_questions: [{ requirement_ref: requirementRef, question: question() }],
    owner_cells: [{
      owner_cell_ref: ownerRef,
      owner_cell_digest: digest("f"),
      requirement_ref: requirementRef,
      coverage_domain: "operations",
      domain_state: "required",
    }],
    target_facts: { [targetRef]: { target: { visibility: "public" } } },
    allowed_selector_fact_paths: new Set(["target.visibility"]),
    routes: [{
      requirement_ref: requirementRef,
      question_ref: questionRef,
      target_ref: targetRef,
      authorized_source_refs: ["source:runbook"],
      candidates: [{
        indexer_id: "answer-indexer",
        operations: ["material-answer"],
        requirement_binding_role: "enricher",
        provider_operation_supported: true,
        supported_evidence_kinds: ["runbook"],
      }],
    }],
    predecessor_ledger_revision: predecessor,
    registry_digest: digest("1"),
    requirement_set_digest: digest("b"),
    source_input_digests: [digest("2")],
  });
}

function ledger(): IndexerMaterialGapLedger {
  const provisional = workset(digest("0"));
  const item = provisional.items[0]!;
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: inventory().inventory_digest,
    entries: [{
      owner_cell_ref: item.question.owner_cell_ref,
      question_ref: item.question.question_ref,
      question_contract_digest: item.question_contract_digest,
      question_subject_target_ref: item.question.question_subject_target_ref,
      question_target_item_digest: item.question.question_target_item_digest,
      answer_landing_ref: item.question.answer_landing_ref,
      question_revision_digest: item.question_revision_digest,
      state: "unresolved",
      dependencies: {
        requirement_digest: digest("b"),
        owner_cell_digest: digest("f"),
        emitted_question_digest: digest("3"),
        answer_landing_dependency_digest: indexerProtocolDigest({
          answer_landing_ref: item.question.answer_landing_ref,
        }),
        source_input_set_digest: indexerMaterialAnswerSourceInputSetDigest([
          digest("2"),
        ]),
      },
    }],
  });
}

const source: IndexerCurrentEvidenceSource = {
  source_ref: "source:runbook",
  source_origin_ref: "origin:runbook",
  source_input_digest: digest("2"),
  source_role: "runbook",
  evidence_kinds: ["runbook"],
  span_unit: "line",
  span_extent: 100,
  snapshot_current: true,
  locator_valid: true,
  tool_trust: "verified",
};

function reviewFixture() {
  const currentLedger = ledger();
  const currentWorkset = workset(currentLedger.revision);
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: currentWorkset.workset_digest,
    execution_request_digest: digest("4"),
    answer_indexer_id: "answer-indexer",
    answer_provider_composition_fingerprint: digest("5"),
    bindings: [{
      workset_digest: currentWorkset.workset_digest,
      question_key: currentWorkset.items[0]!.question_key,
      question_revision_digest: currentWorkset.items[0]!.question_revision_digest,
      evidence_claims: [{
        kind: "runbook",
        source_ref: source.source_ref,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      }],
    }],
  };
  const candidateSet = validateIndexerMaterialAnswerResult({
    result: { ...payload, result_digest: indexerMaterialAnswerResultDigest(payload) },
    workset: currentWorkset,
    expected_execution_request_digest: digest("4"),
    expected_provider_composition_fingerprint: digest("5"),
    current_sources: [source],
    resolve_evidence_digest: () => digest("6"),
  }).candidate_set;
  const inspectionInput = buildIndexerMaterialAnswerReviewInspectionInput({
    workset: currentWorkset,
    candidate_set: candidateSet,
    question_key: currentWorkset.items[0]!.question_key,
  });
  const inspection = inspectProjectIndexerMaterialAnswerReview(inspectionInput);
  const resolutionInput = buildIndexerMaterialAnswerReviewResolutionInput({
    ledger: currentLedger,
    workset: currentWorkset,
    candidate_set: candidateSet,
    baseline_report: inspection.baseline_report,
    decision: "approved",
  });
  return { inspectionInput, inspection, resolutionInput };
}

describe("project limited material-answer Review Route", () => {
  test("returns an exact answer-approved fact without final candidate authority", () => {
    const fixture = reviewFixture();
    const result = resolveProjectIndexerMaterialAnswerReview(fixture.resolutionInput);
    expect(result.state).toBe("approved");
    expect(result.review_scope).toBe("question-target-source-span-evidence-binding");
    expect(result).not.toHaveProperty("reader_content_approved");
    expect(result).not.toHaveProperty("candidate_approval");
    if (result.state !== "approved") throw new Error("expected approval");
    expect(result.answer_approval.successor_ledger.entries[0]!.state)
      .toBe("answer-approved");
    expect(result.answer_approval.successor_ledger.entries[0])
      .toHaveProperty("answer.accepted_workset.items.0.question.question_ref", questionRef);
  });

  test("checkpoints only the exact approved successor against retained CAS", async () => {
    await withTempDir(async (projectRoot) => {
      const fixture = reviewFixture();
      await checkpointIndexerMaterialGapStore({
        projectRoot,
        expected_ledger_revision: null,
        ledger: fixture.resolutionInput.ledger,
      });
      const resolution = resolveProjectIndexerMaterialAnswerReview(
        fixture.resolutionInput,
      );
      const result = await checkpointProjectIndexerMaterialAnswerReview({
        projectRoot,
        value: {
          protocol: "context.indexer.checkpoint-material-answer-review-input/v1",
          resolution_result: resolution,
        },
      });
      expect(result).toMatchObject({
        stage: "answer-approved",
        graph_outcome: "completed",
      });
      expect((await readIndexerMaterialGapStructure(projectRoot))?.ledger.entries[0])
        .toHaveProperty("state", "answer-approved");
      await expect(checkpointProjectIndexerMaterialAnswerReview({
        projectRoot,
        value: {
          protocol: "context.indexer.checkpoint-material-answer-review-input/v1",
          resolution_result: resolution,
        },
      })).rejects.toThrow(/predecessor is stale/);
    });
  });

  test("routes ordinary and explicitly delegated Review through the same bounded Gate", async () => {
    await withTempDir(async (projectRoot) => {
      const fixture = reviewFixture();
      const common = {
        projectRoot,
        inspection_input: fixture.inspectionInput,
        resolution_input: fixture.resolutionInput,
        inspectionInputRef: ".tmp/agent-payloads/material-answer-inspection.json",
        resolutionInputRef: ".tmp/agent-payloads/material-answer-resolution.json",
      };
      const ordinary = await buildIndexerMaterialAnswerReviewRoute(common);
      expect(ordinary.route).toMatchObject({
        node: "review-material-answer-candidates",
        reason_code: "route.indexer.material-answer-review",
        availability: "requires-user",
        gate: {
          id: "review-material-answer-candidates",
          delegatable: true,
          resolution: "user",
        },
      });
      expect(ordinary.route.commands[0]?.command).not.toContain(projectRoot);
      expect((ordinary.route.gate?.inspection_action as { input?: unknown })?.input)
        .toEqual(fixture.inspectionInput);
      expect((ordinary.route.gate?.resolution_action as { input?: unknown })?.input)
        .toEqual(fixture.resolutionInput);

      const delegated = await buildIndexerMaterialAnswerReviewRoute({
        ...common,
        authorities: ["context.indexer-material-answer-review"],
      });
      expect(delegated.route.gate?.resolution).toBe("session-authority");
      expect(delegated.route.commands[0]?.managed_execution).toBe("automatic");
    });
  });

  test("rejects a route whose resolution does not bind the inspected baseline", async () => {
    await withTempDir(async (projectRoot) => {
      const fixture = reviewFixture();
      const forged = structuredClone(fixture.resolutionInput);
      forged.baseline_report = {
        ...forged.baseline_report,
        report_digest: digest("9"),
      };
      await expect(buildIndexerMaterialAnswerReviewRoute({
        projectRoot,
        inspection_input: fixture.inspectionInput,
        resolution_input: forged,
        inspectionInputRef: "inspection.json",
        resolutionInputRef: "resolution.json",
      })).rejects.toThrow();
    });
  });
});
