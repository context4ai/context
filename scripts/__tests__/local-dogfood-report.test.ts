import { describe, expect, test } from "bun:test";
import {
  evaluateLocalDogfoodSummary,
  type LocalDogfoodEvaluationInput,
} from "../local-dogfood-report.js";

function current(): LocalDogfoodEvaluationInput {
  return {
    force_approved: false,
    approved_knowledge: { count: 2 },
    close: { state: "ready" },
    verify: { evidence_status: "pass" },
    packages: [{ state: "ready" }],
    completed_runtime_paths_present: [],
  };
}

describe("local dogfood report evaluation", () => {
  test("accepts only mechanically complete current output", () => {
    expect(evaluateLocalDogfoodSummary(current())).toEqual({
      outcome: "conformant",
      reason_codes: [],
    });
  });

  test("marks force-approved output as nonconformant", () => {
    const input = current();
    input.force_approved = true;
    expect(evaluateLocalDogfoodSummary(input)).toEqual({
      outcome: "nonconformant",
      reason_codes: ["force-approved-workload"],
    });
  });

  test("rejects empty approved output and stale build manifest", () => {
    const input = current();
    input.approved_knowledge.count = 0;
    input.packages = [{ state: "stale" }];
    expect(evaluateLocalDogfoodSummary(input).reason_codes).toEqual([
      "approved-knowledge-empty",
      "build-manifest-stale",
    ]);
  });

  test("requires close to remove temporary Review and lifecycle state", () => {
    const input = current();
    input.completed_runtime_paths_present = [
      ".tmp/context-runtime/review",
      ".tmp/context-runtime/lifecycle",
    ];
    expect(evaluateLocalDogfoodSummary(input).reason_codes).toEqual([
      "close-temporary-state-not-cleaned",
    ]);
  });
});
