import { describe, expect, test } from "bun:test";
import {
  validateIndexerPartitionSemanticInput,
  indexerAuthorSemanticInputSchema,
  indexerLayoutConfirmationInputSchema,
  type IndexerPartitionSemanticInput,
} from "../indexerSemanticInput.js";

const completePartition: IndexerPartitionSemanticInput = {
  stage: "partition",
  outcome: "complete",
  groups: [],
  excluded: [],
  unsupported: [],
};

describe("Indexer semantic input", () => {
  test("grouped dispositions expand exactly, leaving duplicates for ownership validation", () => {
    const base = { stage: "author", outcome: "catalog-only", group_key: "public" };
    const grouped = indexerAuthorSemanticInputSchema.parse({ ...base, member_dispositions: [
      { items: ["member:a", "member:b"], state: "catalog-only", reason_code: "supporting-only" },
      { item: "member:c", state: "unsupported", reason_code: "missing-source" },
    ] });
    const flat = indexerAuthorSemanticInputSchema.parse({ ...base, member_dispositions: [
      { item: "member:a", state: "catalog-only", reason_code: "supporting-only" },
      { item: "member:b", state: "catalog-only", reason_code: "supporting-only" },
      { item: "member:c", state: "unsupported", reason_code: "missing-source" },
    ] });
    expect(grouped).toEqual(flat);
    const duplicate = indexerAuthorSemanticInputSchema.parse({ ...base,
      member_dispositions: [{ items: ["member:a", "member:a"], state: "catalog-only" }] });
    expect(duplicate.member_dispositions.map(item => item.item)).toEqual(["member:a", "member:a"]);
  });
  test("extends the existing layout decision with explicit readable path choices", () => {
    const input = {
      stage: "layout-confirmation" as const, decision: "approved" as const,
      paths: [{ artifact_ref: "artifact:example", output_path: "knowledge/codeindex/library/guide.md" }],
    };
    expect(indexerLayoutConfirmationInputSchema.parse(input)).toEqual(input);
    expect(() => indexerLayoutConfirmationInputSchema.parse({
      ...input, decision: "rejected", feedback: "Revise the content instead",
    })).toThrow();
  });
  test("keeps strategy metadata out of the Agent partition result", () => {
    expect(validateIndexerPartitionSemanticInput(completePartition)).toEqual(
      completePartition,
    );
    expect(() => validateIndexerPartitionSemanticInput({
      ...completePartition,
      unit_type: "entry",
      partition_axis: "public-target-family",
    })).toThrow();
  });

  test("does not accept the internal accepted state as an Agent outcome", () => {
    expect(() => validateIndexerPartitionSemanticInput({
      ...completePartition,
      outcome: "accepted",
    })).toThrow();
  });
});
