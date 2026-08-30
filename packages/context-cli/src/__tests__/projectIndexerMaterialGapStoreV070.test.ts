import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexerMaterialGapLedger,
  checkpointIndexerEmittedMaterialGaps,
  confirmIndexerMaterialQuestionExclusion,
  indexerMaterialGapQuestionKey,
  indexerMaterialQuestionKey,
  indexerProtocolDigest,
  indexerQuestionRevisionDigest,
  indexerResolvedMaterialQuestionDigest,
  proposeIndexerMaterialQuestionExclusion,
  type IndexerMaterialGapLedger,
  type IndexerResolvedMaterialQuestion,
} from "@c4a/context";
import YAML from "yaml";
import {
  checkpointIndexerMaterialGapStore,
  closeApprovedKnowledgeWithMaterialGaps,
  INDEXER_APPROVED_STRUCTURE_PATH,
  readIndexerMaterialGapStructure,
  recoverIndexerMaterialGapStore,
} from "../project/indexerMaterialGapStore.js";
import type { DurableTransactionFailurePoint } from
  "../project/durableSingleFileTransaction.js";
import { applyAndCheckpointIndexerMaterialQuestionExclusion } from
  "../project/indexerMaterialQuestionExclusionApply.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "context-indexer-gap-store-"));
}

function ledger(inventoryCharacter: string): IndexerMaterialGapLedger {
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: digest(inventoryCharacter),
    entries: [],
  });
}

function exclusionQuestion(): IndexerResolvedMaterialQuestion {
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
      accepted_kinds: ["runbook"],
      minimum_items: 1,
      minimum_distinct_sources: 1,
    },
    allowed_exclusion_reason_codes: ["not-applicable"],
  };
  return { ...payload, contract_digest: indexerResolvedMaterialQuestionDigest(payload) };
}

function ledgerWithGap(): IndexerMaterialGapLedger {
  const question = exclusionQuestion();
  const ownerCellRef = "owner-cell:public-knowledge#operations";
  const targetRef = "question-target:component/button";
  const questionKey = indexerMaterialQuestionKey({
    owner_cell_ref: ownerCellRef,
    question_contract_digest: question.contract_digest,
    question_subject_target_ref: targetRef,
  });
  const questionTargetItemDigest = digest("e");
  const ownerCellDigest = digest("f");
  return buildIndexerMaterialGapLedger({
    question_target_inventory_digest: digest("1"),
    entries: [{
      owner_cell_ref: ownerCellRef,
      question_ref: question.ref,
      question_contract_digest: question.contract_digest,
      question_subject_target_ref: targetRef,
      question_target_item_digest: questionTargetItemDigest,
      question_revision_digest: indexerQuestionRevisionDigest({
        question_contract_digest: question.contract_digest,
        question_key: questionKey,
        owner_cell_digest: ownerCellDigest,
        question_target_item_digest: questionTargetItemDigest,
      }),
      state: "unresolved",
      dependencies: {
        requirement_digest: digest("b"),
        owner_cell_digest: ownerCellDigest,
        emitted_question_digest: digest("3"),
        source_input_set_digest: indexerProtocolDigest({ inputs: [digest("2")] }),
      },
    }],
  });
}

function readStructure(root: string): Record<string, unknown> {
  return YAML.parse(
    readFileSync(join(root, INDEXER_APPROVED_STRUCTURE_PATH), "utf8"),
  ) as Record<string, unknown>;
}

function approvedStructure() {
  return {
    schema_version: "context.approved-structure.v1",
    input_hash: digest("a"),
    nodes: [{ node_ref: "node:sample" }],
    views: [{ view_ref: "view:sample", path: "architecture/sample.md" }],
    edges: [],
    source_inputs: { repo: { architecture: digest("b") } },
  };
}

describe("Indexer material gap durable structure store", () => {
  test("atomically checkpoints an exact non-delegable exclusion decision", async () => {
    const root = makeRoot();
    try {
      const initial = ledgerWithGap();
      await checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: initial,
      });
      const entry = initial.entries[0]!;
      const questionKey = indexerMaterialGapQuestionKey(entry);
      const report = proposeIndexerMaterialQuestionExclusion({
        ledger: initial,
        expected_revision: initial.revision,
        project_ref: "project:sample",
        question_key: questionKey,
        resolved_question: exclusionQuestion(),
        reason_code: "not-applicable",
        domain_state: "required",
        reader_impact: "The exact recovery target will remain intentionally unanswered.",
      });
      const confirmation = confirmIndexerMaterialQuestionExclusion({
        report,
        authority: "human",
        confirmed_by: "user:reviewer",
        confirmed_at: "2026-08-27T12:00:00.000Z",
      });
      await expect(applyAndCheckpointIndexerMaterialQuestionExclusion({
        projectRoot: root,
        expected_ledger_revision: initial.revision,
        report,
        confirmation,
        resolved_question: exclusionQuestion(),
        domain_state: "required",
        inject_failure: (point) => {
          if (point === "after-target-rename") throw new Error("injected exclusion crash");
        },
      })).rejects.toThrow("injected exclusion crash");

      await recoverIndexerMaterialGapStore(root);
      const recovered = await readIndexerMaterialGapStructure(root);
      expect(recovered?.ledger.entries[0]).toMatchObject({
        state: "excluded-with-confirmed-reason",
        exclusion: {
          reason_code: "not-applicable",
          decision_digest: confirmation.decision_digest,
        },
      });
      if (recovered === undefined) throw new Error("expected recovered exclusion ledger");
      const originalEntry = initial.entries[0];
      if (originalEntry?.state !== "unresolved") throw new Error("expected unresolved entry");
      const reopened = checkpointIndexerEmittedMaterialGaps({
        ledger: recovered.ledger,
        expected_revision: recovered.ledger.revision,
        authoritative_owner_cell_refs: [originalEntry.owner_cell_ref],
        current_entries: [{
          ...originalEntry,
          dependencies: {
            ...originalEntry.dependencies,
            requirement_digest: digest("9"),
          },
        }],
      });
      await expect(checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: recovered.ledger.revision,
        ledger: reopened,
        inject_failure: (point) => {
          if (point === "after-target-rename") throw new Error("injected reopen crash");
        },
      })).rejects.toThrow("injected reopen crash");
      await recoverIndexerMaterialGapStore(root);
      expect((await readIndexerMaterialGapStructure(root))?.ledger.entries[0]?.state)
        .toBe("unresolved");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates a minimal retained container without pretending close completed", async () => {
    const root = makeRoot();
    try {
      const current = ledger("1");
      const receipt = await checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: current,
        source_inputs: { repo: { architecture: digest("2") } },
      });
      expect(receipt).toMatchObject({
        operation: "checkpoint-material-gaps",
        predecessor_ledger_revision: null,
        successor_ledger_revision: current.revision,
      });
      const structure = readStructure(root);
      expect(structure).toMatchObject({
        schema_version: "context.approved-structure.v1",
        structure_state: "retained-state-present",
        nodes: [],
        views: [],
        edges: [],
        material_gap_ledger: current,
      });
      expect(structure).not.toHaveProperty("input_hash");
      expect((await readIndexerMaterialGapStructure(root))?.state)
        .toBe("retained-state-present");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("close atomically writes approved projection and reconciled ledger", async () => {
    const root = makeRoot();
    try {
      const initial = ledger("1");
      await checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: initial,
      });
      const closedLedger = ledger("2");
      const receipt = await closeApprovedKnowledgeWithMaterialGaps({
        projectRoot: root,
        expected_ledger_revision: initial.revision,
        ledger: closedLedger,
        approved_structure: approvedStructure(),
      });
      expect(receipt.operation).toBe("close-approved-knowledge");
      const structure = readStructure(root);
      expect(structure).toMatchObject({
        ...approvedStructure(),
        structure_state: "approved-projection-closed",
        material_gap_ledger: closedLedger,
      });
      expect((await readIndexerMaterialGapStructure(root))?.state)
        .toBe("approved-projection-closed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkpoint replaces only retained state on a closed structure", async () => {
    const root = makeRoot();
    try {
      const first = ledger("1");
      await closeApprovedKnowledgeWithMaterialGaps({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: first,
        approved_structure: approvedStructure(),
      });
      const before = readStructure(root);
      const second = ledger("2");
      await checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: first.revision,
        ledger: second,
      });
      const after = readStructure(root);
      expect(after.structure_state).toBe("approved-projection-closed");
      expect(after.material_gap_ledger).toEqual(second);
      for (const key of ["schema_version", "input_hash", "nodes", "views", "edges", "source_inputs"]) {
        expect(after[key]).toEqual(before[key]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects ledger CAS mismatch without changing the structure", async () => {
    const root = makeRoot();
    try {
      const first = ledger("1");
      await checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: first,
      });
      const before = readFileSync(join(root, INDEXER_APPROVED_STRUCTURE_PATH), "utf8");
      await expect(checkpointIndexerMaterialGapStore({
        projectRoot: root,
        expected_ledger_revision: digest("9"),
        ledger: ledger("2"),
      })).rejects.toThrow(/CAS mismatch/);
      expect(readFileSync(join(root, INDEXER_APPROVED_STRUCTURE_PATH), "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const failurePoint of [
    "after-journal-temp-write",
    "after-journal-temp-fsync",
    "after-journal-rename",
    "after-journal-dir-fsync",
    "after-target-write",
    "after-target-fsync",
    "after-target-rename",
    "after-target-dir-fsync",
    "after-journal-remove",
    "after-journal-remove-dir-fsync",
  ] as const satisfies readonly DurableTransactionFailurePoint[]) {
    test(`recovers checkpoint interruption at ${failurePoint}`, async () => {
      const root = makeRoot();
      try {
        const first = ledger("1");
        await checkpointIndexerMaterialGapStore({
          projectRoot: root,
          expected_ledger_revision: null,
          ledger: first,
        });
        const second = ledger("2");
        await expect(checkpointIndexerMaterialGapStore({
          projectRoot: root,
          expected_ledger_revision: first.revision,
          ledger: second,
          inject_failure: (point) => {
            if (point === failurePoint) throw new Error(`injected ${point}`);
          },
        })).rejects.toThrow(`injected ${failurePoint}`);
        await recoverIndexerMaterialGapStore(root);
        const journalWasNotPublished = failurePoint === "after-journal-temp-write" ||
          failurePoint === "after-journal-temp-fsync";
        expect((await readIndexerMaterialGapStructure(root))?.ledger)
          .toEqual(journalWasNotPublished ? first : second);
        if (journalWasNotPublished) {
          await checkpointIndexerMaterialGapStore({
            projectRoot: root,
            expected_ledger_revision: first.revision,
            ledger: second,
          });
          expect((await readIndexerMaterialGapStructure(root))?.ledger).toEqual(second);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const failurePoint of [
    "after-journal-temp-write",
    "after-journal-temp-fsync",
    "after-journal-rename",
    "after-journal-dir-fsync",
    "after-target-write",
    "after-target-fsync",
    "after-target-rename",
    "after-target-dir-fsync",
    "after-journal-remove",
    "after-journal-remove-dir-fsync",
  ] as const satisfies readonly DurableTransactionFailurePoint[]) {
    test(`recovers close interruption at ${failurePoint}`, async () => {
      const root = makeRoot();
      try {
        const retained = ledger("1");
        await checkpointIndexerMaterialGapStore({
          projectRoot: root,
          expected_ledger_revision: null,
          ledger: retained,
        });
        const closedLedger = ledger("2");
        await expect(closeApprovedKnowledgeWithMaterialGaps({
          projectRoot: root,
          expected_ledger_revision: retained.revision,
          ledger: closedLedger,
          approved_structure: approvedStructure(),
          inject_failure: (point) => {
            if (point === failurePoint) throw new Error(`injected close ${point}`);
          },
        })).rejects.toThrow(`injected close ${failurePoint}`);
        await recoverIndexerMaterialGapStore(root);

        const journalWasNotPublished = failurePoint === "after-journal-temp-write" ||
          failurePoint === "after-journal-temp-fsync";
        const recovered = await readIndexerMaterialGapStructure(root);
        if (journalWasNotPublished) {
          expect(recovered).toMatchObject({
            state: "retained-state-present",
            ledger: retained,
          });
          await closeApprovedKnowledgeWithMaterialGaps({
            projectRoot: root,
            expected_ledger_revision: retained.revision,
            ledger: closedLedger,
            approved_structure: approvedStructure(),
          });
        } else {
          expect(recovered).toMatchObject({
            state: "approved-projection-closed",
            ledger: closedLedger,
          });
          expect(readStructure(root)).toMatchObject(approvedStructure());
        }
        expect((await readIndexerMaterialGapStructure(root))?.state)
          .toBe("approved-projection-closed");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test("rejects caller attempts to smuggle retained state through close projection", async () => {
    const root = makeRoot();
    try {
      const projection = {
        ...approvedStructure(),
        material_gap_ledger: ledger("9"),
      };
      await expect(closeApprovedKnowledgeWithMaterialGaps({
        projectRoot: root,
        expected_ledger_revision: null,
        ledger: ledger("1"),
        approved_structure: projection,
      })).rejects.toThrow(/complete approved structure/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
