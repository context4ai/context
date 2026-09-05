import { describe, expect, test } from "bun:test";
import {
  validateIndexerPartitionSemanticInput,
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
  test("extends the existing layout decision with explicit readable path choices", () => {
    const input = {
      stage: "layout-confirmation" as const, decision: "approved" as const,
      paths: [{ artifact_ref: "artifact:example", output_path: "knowledge/codeindex/library/guide.md" }],
    };
    expect(indexerLayoutConfirmationInputSchema.parse(input)).toEqual(input);
    expect(() => indexerLayoutConfirmationInputSchema.parse({
      ...input, decision: "rejected", feedback: "Revise the content instead",
    })).toThrow("only an approved layout");
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
