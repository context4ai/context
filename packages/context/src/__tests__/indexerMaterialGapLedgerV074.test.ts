import { describe, expect, test } from "bun:test";
import {
  buildIndexerMaterialGapLedger,
  checkpointIndexerEmittedMaterialGaps,
  indexerMaterialGapQuestionKey,
  indexerQuestionRevisionDigest,
  validateIndexerMaterialGapLedger,
  type IndexerUnresolvedMaterialGap,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function unresolved(ownerCellRef = "owner:knowledge/service"): IndexerUnresolvedMaterialGap {
  const questionContractDigest = digest("1");
  const questionTargetItemDigest = digest("2");
  const ownerCellDigest = digest("3");
  const identity = {
    owner_cell_ref: ownerCellRef,
    question_contract_digest: questionContractDigest,
    question_subject_target_ref: "subject:service/worker",
  };
  return {
    ...identity,
    question_ref: "question:service-overview",
    question_target_item_digest: questionTargetItemDigest,
    question_revision_digest: indexerQuestionRevisionDigest({
      question_contract_digest: questionContractDigest,
      question_key: indexerMaterialGapQuestionKey(identity),
      owner_cell_digest: ownerCellDigest,
      question_target_item_digest: questionTargetItemDigest,
    }),
    state: "unresolved",
    dependencies: {
      requirement_digest: digest("4"),
      owner_cell_digest: ownerCellDigest,
      emitted_question_digest: digest("5"),
      source_input_set_digest: digest("6"),
    },
  };
}

describe("Indexer material-gap runtime ledger", () => {
  test("stores only the current unresolved set and replaces it by complete inventory", () => {
    const entry = unresolved();
    const initial = buildIndexerMaterialGapLedger({
      question_target_inventory_digest: digest("7"),
      entries: [entry],
    });
    expect(validateIndexerMaterialGapLedger(initial)).toEqual(initial);
    expect(initial.entries).toEqual([expect.objectContaining({ state: "unresolved" })]);
    expect(initial).not.toHaveProperty("answers");
    expect(initial).not.toHaveProperty("review_receipts");

    const cleared = checkpointIndexerEmittedMaterialGaps({
      ledger: initial,
      expected_revision: initial.revision,
      authoritative_owner_cell_refs: [entry.owner_cell_ref],
      current_entries: [],
      complete_inventory_digest: digest("8"),
    });
    expect(cleared.entries).toEqual([]);
    expect(cleared.question_target_inventory_digest).toBe(digest("8"));
    expect(cleared.revision).not.toBe(initial.revision);
  });

  test("rejects stale checkpoints and gaps outside current owner authority", () => {
    const entry = unresolved();
    const ledger = buildIndexerMaterialGapLedger({
      question_target_inventory_digest: digest("7"),
      entries: [],
    });
    expect(() => checkpointIndexerEmittedMaterialGaps({
      ledger,
      expected_revision: digest("9"),
      authoritative_owner_cell_refs: [entry.owner_cell_ref],
      current_entries: [entry],
    })).toThrow(/CAS predecessor/);
    expect(() => checkpointIndexerEmittedMaterialGaps({
      ledger,
      expected_revision: ledger.revision,
      authoritative_owner_cell_refs: ["owner:knowledge/other"],
      current_entries: [entry],
    })).toThrow(/authoritative owner-cell set/);
  });
});
