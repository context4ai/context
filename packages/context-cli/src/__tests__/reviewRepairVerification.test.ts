import { expect, test } from "bun:test";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

test("approved-content errors allow Review but block again after draft resolution", () => {
  const observation = { ...emptyObservation(), draftCandidates: 1, verifyErrors: 1,
    verifyIssues: [{ severity: "error" as const, code: "approved-type-collection-mismatch", path: "knowledge/business/guide.md", message: "Wrong type" }] };
  expect(createContextWorkflowFacts(observation, []).verification.blocking_clear).toBe(true);
  expect(createContextWorkflowFacts({ ...observation, draftCandidates: 0 }, []).verification.blocking_clear).toBe(false);
  expect(createContextWorkflowFacts({ ...observation, verifyIssues: [{ ...observation.verifyIssues[0]!, path: "src/index.ts" }] }, []).verification.blocking_clear).toBe(false);
});
