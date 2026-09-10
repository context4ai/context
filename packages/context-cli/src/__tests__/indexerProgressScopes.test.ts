import { expect, test } from "bun:test";
import { indexerProgressScopes, submittedProgressSlice } from "../project/indexerProgressScopes.js";

test("overall planning, wave tasks and Route slice retain independent denominators and units", () => {
  const scopes = indexerProgressScopes({
    delivered: 12, planning: { completed: 20, total: 70, stale: 12 }, author: { completed: 9, total: 9 },
    wavePages: { authored: 6, delivered: 2 },
    composer: { completed: 4, prepared: 6, allPrepared: false },
    review: { pending: 2, requiresRepair: 1 },
    slice: { stage: "post-author", completed: 0, total: 2 },
  });
  expect(scopes.overall.planning).toMatchObject({ unit: "task", completed: 20, total: 70, needs_recheck: 12, definition: "currently-valid-accepted", recheck_reason: "request-bindings-changed" });
  expect(scopes.overall.delivery).toEqual({ unit: "page", completed: 12, total: null });
  expect(scopes.wave?.writing).toEqual({ unit: "task", completed: 9, total: 9 });
  expect(scopes.wave?.delivery).toEqual({ unit: "page", completed: 2, total: null });
  expect(scopes.wave?.composition.total).toBeNull();
  expect(scopes.wave?.review.requires_repair).toBe(1);
  expect(scopes.slice).toMatchObject({ scope: "current-route-slice", unit: "task", total: 2, completed: 0 });
  expect(submittedProgressSlice("post-author", [{ outcome: "accepted", committed: true }, { outcome: "failed", committed: true }]))
    .toMatchObject({ scope: "submitted-slice", completed: 1, total: 2 });
});

test("planning and absent active slices do not imply a completed wave or known page count", () => {
  const scopes = indexerProgressScopes({ delivered: 0, planning: { completed: 3, total: 8 },
    author: null, wavePages: { authored: 0, delivered: 0 }, composer: { completed: 0, prepared: 0, allPrepared: false },
    review: { pending: 0, requiresRepair: 0 }, slice: null });
  expect(scopes.wave).toBeNull();
  expect(scopes.slice).toBeNull();
  expect(scopes.overall.delivery.total).toBeNull();
});
