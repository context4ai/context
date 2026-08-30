import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexerLayoutProposalSet,
  buildIndexerMaterialAnswerReviewInspectionInput,
  buildIndexerMaterialAnswerReviewResolutionInput,
  buildIndexerPlannedMaterialAnswer,
  buildIndexerSharedArtifactFingerprint,
  canonicalIndexerNodeRef,
  indexerMaterialAnswerBindingDigestFromLedgerEntry,
  indexerMaterialGapQuestionKey,
  indexerMaterialAnswerResultDigest,
  indexerLayoutSectionIdentityRef,
  indexerProtocolDigest,
  indexerRegistryDigests,
  inspectIndexerMaterialAnswerReview,
  resolveIndexerMaterialAnswerReview,
  validateIndexerMaterialAnswerResult,
  type IndexerMaterialAnswerResult,
} from "@c4a/context";
import YAML from "yaml";
import { actualizeProjectIndexerMaterialAnswerBindings } from
  "../project/indexerMaterialAnswerActualizationActions.js";
import { buildIndexerMaterialAnswerEvidenceReadReceipt } from
  "../project/indexerMaterialAnswerEvidenceReads.js";
import { checkpointProjectIndexerMaterialAnswerReview } from
  "../project/indexerMaterialGapActions.js";
import { closeProjectIndexerApprovedKnowledge } from
  "../project/indexerMaterialGapCloseActions.js";
import {
  checkpointIndexerMaterialGapStore,
  readIndexerMaterialGapStructure,
} from "../project/indexerMaterialGapStore.js";
import {
  REQUIREMENT_REF,
  SOURCE,
  digest,
  materialLedger,
  materialRegistry,
  materialWorkset,
  resolvedQuestion,
} from "./projectIndexerMaterialAnswerExecutionV070.fixture.js";

async function workspace() {
  const projectRoot = await mkdtemp(join(tmpdir(), "context-answer-actualization-"));
  const registry = materialRegistry();
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
    name: "material-answer-actualization-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(projectRoot, "src", "index.ts"), "export {};\n", "utf8");
  await writeFile(
    join(projectRoot, "src", "indexers.yaml"),
    YAML.stringify(registry),
    "utf8",
  );
  return { projectRoot, registry };
}

function approvedFixture() {
  const registry = materialRegistry();
  const registryDigests = indexerRegistryDigests(registry);
  const initial = materialLedger(registryDigests.requirementSetDigest);
  const workset = materialWorkset({
    predecessor: initial.revision,
    requirementSetDigest: registryDigests.requirementSetDigest,
    registryDigest: registryDigests.registryDigest,
  });
  const providerFingerprint = digest("5");
  const payload: Omit<IndexerMaterialAnswerResult, "result_digest"> = {
    protocol: "context.indexer.material-answer-result/v1",
    workset_digest: workset.workset_digest,
    execution_request_digest: digest("4"),
    answer_indexer_id: "answer-indexer",
    answer_provider_composition_fingerprint: providerFingerprint,
    bindings: [{
      workset_digest: workset.workset_digest,
      question_key: workset.items[0]!.question_key,
      question_revision_digest: workset.items[0]!.question_revision_digest,
      evidence_claims: [{
        kind: "runbook",
        source_ref: SOURCE.source_ref,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      }],
    }],
  };
  const candidateSet = validateIndexerMaterialAnswerResult({
    result: { ...payload, result_digest: indexerMaterialAnswerResultDigest(payload) },
    workset,
    expected_execution_request_digest: digest("4"),
    expected_provider_composition_fingerprint: providerFingerprint,
    current_sources: [{
      ...SOURCE,
      evidence_kinds: [...SOURCE.evidence_kinds],
    }],
    resolve_evidence_digest: () => digest("6"),
  }).candidate_set;
  const inspection = inspectIndexerMaterialAnswerReview(
    buildIndexerMaterialAnswerReviewInspectionInput({
      workset,
      candidate_set: candidateSet,
      question_key: workset.items[0]!.question_key,
    }),
  );
  const resolution = resolveIndexerMaterialAnswerReview(
    buildIndexerMaterialAnswerReviewResolutionInput({
      ledger: initial,
      workset,
      candidate_set: candidateSet,
      baseline_report: inspection.baseline_report,
      decision: "approved",
    }),
  );
  if (resolution.state !== "approved") throw new Error("expected approved fixture");
  return { initial, workset, resolution };
}

function layoutSet() {
  const sharedArtifactFingerprint = buildIndexerSharedArtifactFingerprint({
    indexer_id: "answer-indexer",
    program_digest: null,
    instructions_digest: digest("e"),
    template_set_digest: digest("f"),
  });
  const node = canonicalIndexerNodeRef({
    protocol: "context.subject-key/v1",
    namespace: "sample-package",
    kind: "component",
    local_key: "button",
  });
  const sectionIdentityRef = indexerLayoutSectionIdentityRef({
    node_ref: node,
    owner_indexer_id: "answer-indexer",
    artifact_kind: "runbook",
    section_key: "recovery",
  });
  const payload = {
    protocol: "context.indexer.layout-proposal/v1" as const,
    indexer_id: "answer-indexer",
    source_ref: "repo:sample",
    profile: "domain-reference",
    profile_contract_digest: digest("7"),
    subject_key_schema_set_digest: digest("8"),
    subject_key_schema_digest: digest("d"),
    artifact_result_digest: digest("9"),
    shared_artifact_fingerprint: sharedArtifactFingerprint,
    node: {
      node_ref: node,
      subject_key: {
        protocol: "context.subject-key/v1" as const,
        namespace: "sample-package",
        kind: "component",
        local_key: "button",
      },
    },
    artifacts: [{
      artifact_ref: "artifact:subject:button-operations",
      node_ref: node,
      artifact_id: "operations",
      artifact_kind: "runbook",
      internal_view_ref: "view:artifact:button-operations",
      collection: "sop" as const,
      output_path: "knowledge/sop/button/operations.md",
      shared_artifact_fingerprint_digest:
        sharedArtifactFingerprint.fingerprint_digest,
      purpose: "required" as const,
      split_of_artifact_ref: null,
      split_boundary: null,
      sections: [{
        section_ref: "section:subject:button-recovery",
        section_identity_ref: sectionIdentityRef,
        section_key: "recovery",
        owner_indexer_id: "answer-indexer",
        document_kind: "runbook",
        reader_goal: "understand-operations",
        artifact_kind: "runbook",
        state: "structured" as const,
        content_digest: digest("a"),
        evidence_refs: [],
        material_question_proposal_ref: null,
        collection_resolution_digest: digest("b"),
      }],
    }],
  };
  return buildIndexerLayoutProposalSet([{
    ...payload,
    proposal_digest: indexerProtocolDigest(payload),
  }]);
}

async function checkpointApproved(projectRoot: string) {
  const fixture = approvedFixture();
  await checkpointIndexerMaterialGapStore({
    projectRoot,
    expected_ledger_revision: null,
    ledger: fixture.initial,
  });
  await checkpointProjectIndexerMaterialAnswerReview({
    projectRoot,
    value: {
      protocol: "context.indexer.checkpoint-material-answer-review-input/v1",
      resolution_result: fixture.resolution,
    },
  });
  const approved = await readIndexerMaterialGapStructure(projectRoot);
  if (approved === undefined) throw new Error("expected answer-approved checkpoint");
  const readerAuthority = digest("c");
  const readReceipt = buildIndexerMaterialAnswerEvidenceReadReceipt({
    reader_authority_digest: readerAuthority,
    source: SOURCE,
    source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
    evidence_digest: digest("6"),
  });
  return { fixture, approved, readerAuthority, readReceipt };
}

function actualizationInput(input: Awaited<ReturnType<typeof checkpointApproved>>) {
  return {
    protocol: "context.indexer.actualize-material-answer-bindings-input/v1",
    expected_ledger_revision: input.approved.ledger.revision,
    layout_proposal_set: layoutSet(),
    answer_landings: [{
      answer_landing_ref: input.fixture.workset.items[0]!.question.answer_landing_ref,
      indexer_id: "answer-indexer",
      artifact_id: "operations",
      section_key: "recovery",
    }],
    resolved_questions: [{
      requirement_ref: REQUIREMENT_REF,
      question: resolvedQuestion(),
    }],
    allowed_selector_fact_paths: ["target.visibility"],
    registered_sources: [{
      source_ref: SOURCE.source_ref,
      source_input_digest: SOURCE.source_input_digest,
    }],
    reader_authority_digest: input.readerAuthority,
    evidence_read_receipts: [input.readReceipt],
  };
}

async function copyRetainedWorkspace(projectRoot: string): Promise<string> {
  const copiedRoot = await mkdtemp(join(tmpdir(), "context-answer-recovery-copy-"));
  await mkdir(join(copiedRoot, "src"), { recursive: true });
  await mkdir(join(copiedRoot, "knowledge"), { recursive: true });
  for (const relativePath of [
    "package.json",
    "src/index.ts",
    "src/indexers.yaml",
    "knowledge/structure.yaml",
  ]) {
    await copyFile(join(projectRoot, relativePath), join(copiedRoot, relativePath));
  }
  return copiedRoot;
}

describe("project material-answer actualization", () => {
  test("recovers from the retained accepted workset and checkpoints an exact layout-set mapping", async () => {
    const current = await workspace();
    try {
      const { fixture, approved, readerAuthority, readReceipt } =
        await checkpointApproved(current.projectRoot);
      const actualization = actualizationInput({
        fixture,
        approved,
        readerAuthority,
        readReceipt,
      });
      await expect(actualizeProjectIndexerMaterialAnswerBindings({
        projectRoot: current.projectRoot,
        value: {
          ...actualization,
          answer_landings: [...actualization.answer_landings, {
            answer_landing_ref: "planned-section:unapproved",
            indexer_id: "answer-indexer",
            artifact_id: "operations",
            section_key: "recovery",
          }],
        },
      })).rejects.toThrow(/unapproved answer landing/);
      const result = await actualizeProjectIndexerMaterialAnswerBindings({
        projectRoot: current.projectRoot,
        value: actualization,
      });
      expect(result).toMatchObject({
        graph_outcome: "completed",
        status: { main_candidate_review_allowed: true },
      });
      expect(result.ledger.entries[0]).toMatchObject({
        state: "resolved",
        actualization: {
          actualized_target_ref: "section:subject:button-recovery",
          layout_digest: result.layout_proposal.layout_digest,
        },
      });
      const resolved = result.ledger.entries[0]!;
      if (resolved.state !== "resolved") throw new Error("expected resolved answer");
      const evidenceItemRefs = resolved.answer.evidence.map((item) =>
        item.evidence_item_ref
      );
      const materialAnswer = {
        question_key: indexerMaterialGapQuestionKey(resolved),
        binding_digest: indexerMaterialAnswerBindingDigestFromLedgerEntry(resolved),
        planned_answer_digest:
          buildIndexerPlannedMaterialAnswer(resolved).planned_answer_digest,
        actualization_digest: resolved.actualization.actualization_digest,
        actualized_target_ref: resolved.actualization.actualized_target_ref,
        section_ref: resolved.actualization.section_ref,
        evidence_item_refs: evidenceItemRefs,
        evidence_set_digest: indexerProtocolDigest({
          evidence_item_refs: evidenceItemRefs,
        }),
      };
      const approvedStructure = {
        schema_version: "context.approved-structure.v1",
        input_hash: digest("d"),
        layout_digest: result.layout_proposal.layout_digest,
        nodes: [],
        views: [],
        edges: [],
      };
      await expect(closeProjectIndexerApprovedKnowledge({
        projectRoot: current.projectRoot,
        value: {
          protocol: "context.indexer.close-approved-knowledge-input/v1",
          expected_ledger_revision: result.ledger.revision,
          approved_structure: {
            ...approvedStructure,
            material_answers: [],
          },
        },
      })).rejects.toThrow(/absent from approved structure/);
      expect((await readIndexerMaterialGapStructure(current.projectRoot))?.ledger.entries[0])
        .toHaveProperty("state", "resolved");
      const closed = await closeProjectIndexerApprovedKnowledge({
        projectRoot: current.projectRoot,
        value: {
          protocol: "context.indexer.close-approved-knowledge-input/v1",
          expected_ledger_revision: result.ledger.revision,
          approved_structure: {
            ...approvedStructure,
            material_answers: [materialAnswer],
          },
        },
      });
      expect(closed.ledger.entries).toEqual([]);
      expect((await readIndexerMaterialGapStructure(current.projectRoot))?.state)
        .toBe("approved-projection-closed");
    } finally {
      await rm(current.projectRoot, { recursive: true, force: true });
    }
  });

  test("reopens retained approval when its registered source disappears", async () => {
    const current = await workspace();
    try {
      const { fixture, approved, readerAuthority, readReceipt } =
        await checkpointApproved(current.projectRoot);
      const actualization = actualizationInput({
        fixture,
        approved,
        readerAuthority,
        readReceipt,
      });
      const result = await actualizeProjectIndexerMaterialAnswerBindings({
        projectRoot: current.projectRoot,
        value: {
          ...actualization,
          registered_sources: [],
        },
      });
      expect(result.graph_outcome).toBe("blocked");
      expect(result.ledger.entries[0]).toHaveProperty("state", "unresolved");
      expect(result.evaluations[0]?.reason_codes).toContain("source-input-set-stale");
    } finally {
      await rm(current.projectRoot, { recursive: true, force: true });
    }
  });

  test("recovers an approved binding in a clean checkout using only retained and static authority", async () => {
    const original = await workspace();
    let copiedRoot: string | undefined;
    try {
      const checkpoint = await checkpointApproved(original.projectRoot);
      copiedRoot = await copyRetainedWorkspace(original.projectRoot);
      expect(existsSync(join(copiedRoot, ".tmp", "context-runtime"))).toBe(false);
      await rm(original.projectRoot, { recursive: true, force: true });
      const result = await actualizeProjectIndexerMaterialAnswerBindings({
        projectRoot: copiedRoot,
        value: actualizationInput(checkpoint),
      });
      expect(result.graph_outcome).toBe("completed");
      expect(result.ledger.entries[0]).toHaveProperty("state", "resolved");
    } finally {
      await rm(original.projectRoot, { recursive: true, force: true });
      if (copiedRoot !== undefined) {
        await rm(copiedRoot, { recursive: true, force: true });
      }
    }
  });

  test("atomically reopens the same retained entry when span, Provider, or question authority is stale", async () => {
    const scenarios = ["span", "provider", "question-revision", "question-missing"] as const;
    for (const scenario of scenarios) {
      const current = await workspace();
      try {
        const checkpoint = await checkpointApproved(current.projectRoot);
        const value = actualizationInput(checkpoint);
        if (scenario === "span") {
          value.evidence_read_receipts = [
            buildIndexerMaterialAnswerEvidenceReadReceipt({
              reader_authority_digest: checkpoint.readerAuthority,
              source: SOURCE,
              source_spans: [{ unit: "line", start: 11, end_exclusive: 20 }],
              evidence_digest: digest("6"),
            }),
          ];
        } else {
          const registry = structuredClone(materialRegistry());
          if (scenario === "provider") {
            registry.indexers[0]!.providers[0]!.version = "1.0.1";
          } else if (scenario === "question-revision") {
            registry.indexers[0]!.requirement_bindings[0]!.role = "primary";
          } else {
            registry.requirements[0]!.questions = [];
            value.resolved_questions = [];
          }
          await writeFile(
            join(current.projectRoot, "src", "indexers.yaml"),
            YAML.stringify(registry),
            "utf8",
          );
        }
        const questionKey = checkpoint.fixture.workset.items[0]!.question_key;
        const result = await actualizeProjectIndexerMaterialAnswerBindings({
          projectRoot: current.projectRoot,
          value,
        });
        expect(result.graph_outcome).toBe("blocked");
        expect(result.ledger.entries).toHaveLength(1);
        expect(indexerMaterialGapQuestionKey(result.ledger.entries[0]!)).toBe(
          questionKey,
        );
        expect(result.ledger.entries[0]).toHaveProperty("state", "unresolved");
        expect((await readIndexerMaterialGapStructure(current.projectRoot))?.ledger)
          .toEqual(result.ledger);
        if (scenario === "span") {
          expect(result.evaluations[0]?.reason_codes).toContain("evidence-span-stale");
        } else if (scenario === "provider") {
          expect(result.evaluations[0]?.reason_codes).toContain(
            "provider-composition-stale",
          );
        } else if (scenario === "question-revision") {
          expect(result.evaluations[0]?.reason_codes).toContain(
            "question-or-binding-stale",
          );
        } else {
          expect(result.evaluations[0]?.reason_codes).toContain(
            "question-authority-unavailable",
          );
        }
      } finally {
        await rm(current.projectRoot, { recursive: true, force: true });
      }
    }
  });
});
