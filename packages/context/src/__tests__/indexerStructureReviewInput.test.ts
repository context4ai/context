import { expect, test } from "bun:test";
import { indexerStructureReviewInputSchema } from "../indexerSemanticInput.js";

test("source-update structure approvals can omit a map; the current route enforces coverage", () => {
  expect(indexerStructureReviewInputSchema.parse({ stage: "structure-review", decision: "approved" }))
    .toEqual({ stage: "structure-review", decision: "approved" });
  expect(() => indexerStructureReviewInputSchema.parse({ stage: "structure-review", decision: "request-adjustment" })).toThrow();
  expect(() => indexerStructureReviewInputSchema.parse({ stage: "structure-review", decision: "approved", knowledge_map: {} })).toThrow();
});
