import { expect, test } from "bun:test";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";

test("unfinished production overrides historical close while explicit partial delivery remains available", () => {
  const observation = { ...emptyObservation(), approvedPages: 4, unfinishedIndexerTasks: true,
    close: { state: "ready" as const, diagnostics: [] } };
  expect(createContextWorkflowFacts(observation, []).indexer.lifecycle_current).toBe(false);
  expect(createContextWorkflowFacts({ ...observation, unfinishedIndexerTasks: false }, []).indexer.lifecycle_current).toBe(true);
  expect(createContextWorkflowFacts({ ...observation,
    indexerCandidateCompile: { state: "current", partial_delivery: true } }, []).indexer.lifecycle_current).toBe(true);
  expect(createContextWorkflowFacts({ ...observation,
    indexerCandidateCompile: { state: "current", delivery_pending: true } }, []).indexer.lifecycle_current).toBe(false);
  const checkpoint = createContextWorkflowFacts({ ...observation, draftCandidates: 2, versionCurrent: false,
    indexerCandidateCompile: { state: "current", delivery_pending: true, delivery_ready: true } }, []);
  expect(checkpoint.indexer.lifecycle_current).toBe(true);
  expect(checkpoint.review.gate_clear).toBe(false);
  expect(checkpoint.version).toEqual({ current: false, recording_satisfied: true });
  expect(createContextWorkflowFacts({ ...observation, versionCurrent: false, unfinishedIndexerTasks: false,
    indexerCandidateCompile: { state: "current", delivery_ready: true } }, []).version).toEqual({ current: false, recording_satisfied: false });
  expect(createContextWorkflowFacts({ ...observation,
    indexerCandidateCompile: { state: "stale", delivery_ready: true } }, []).indexer.lifecycle_current).toBe(false);
  const rebuilding = createContextWorkflowFacts({ ...observation, versionCurrent: false,
    indexerCandidateCompile: { state: "current", maintenance_output_only: true } }, []);
  expect(rebuilding.indexer.lifecycle_current).toBe(true);
  expect(rebuilding.packages.declared).toBe(false);
  expect(rebuilding.version).toEqual({ current: false, recording_satisfied: true });
});
