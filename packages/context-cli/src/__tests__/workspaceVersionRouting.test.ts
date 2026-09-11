import { expect, test } from "bun:test";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

test("partial deliveries defer recording without claiming the workspace version is current", () => {
  const observation = { ...emptyObservation(), versionCurrent: false,
    indexerCandidateCompile: { state: "current" as const, partial_delivery: true } };
  expect(createContextWorkflowFacts(observation, []).version).toEqual({ current: false, recording_satisfied: true });
  expect(createContextWorkflowFacts({ ...observation, indexerCandidateCompile: { state: "current" } }, []).version)
    .toEqual({ current: false, recording_satisfied: false });
  expect(createContextWorkflowFacts({ ...observation, indexerCandidateCompile: { state: "current", partial_delivery: true, revision_pending: true } }, []).version)
    .toEqual({ current: false, recording_satisfied: false });
});
