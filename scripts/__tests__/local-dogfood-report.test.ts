import { describe, expect, test } from "bun:test";
import {
  evaluateLocalDogfoodSummary,
  type LocalDogfoodEvaluationInput,
} from "../local-dogfood-report.js";

function current(): LocalDogfoodEvaluationInput {
  return {
    force_approved: false,
    main_run: { present: true, states: ["accepted"] },
    post_author: { present: true, states: ["accepted"], envelope_current: true },
    candidate_compile: {
      state: "current",
      file_count: 2,
      approved_binding_count: 2,
      draft_count: 0,
    },
    close: { state: "ready" },
    material_gaps: { blocking_count: 0 },
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

  test("classifies an interrupted Result without caller-authored approval", () => {
    const input = current();
    input.main_run.states = ["running"];
    expect(evaluateLocalDogfoodSummary(input)).toEqual({
      outcome: "nonconformant",
      reason_codes: ["main-run-incomplete"],
    });
  });

  test("classifies a stale Result without caller-authored approval", () => {
    const input = current();
    input.main_run.states = ["stale"];
    expect(evaluateLocalDogfoodSummary(input)).toEqual({
      outcome: "nonconformant",
      reason_codes: ["main-result-stale"],
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

  test("rejects Candidate/approved binding and build manifest mismatches", () => {
    const input = current();
    input.candidate_compile.approved_binding_count = 1;
    input.packages = [{ state: "stale" }];
    expect(evaluateLocalDogfoodSummary(input).reason_codes).toEqual([
      "build-manifest-stale",
      "candidate-approved-binding-mismatch",
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

  test("rejects unresolved required material gaps", () => {
    const input = current();
    input.material_gaps.blocking_count = 1;
    expect(evaluateLocalDogfoodSummary(input).reason_codes).toEqual([
      "required-material-gap",
    ]);
  });
});
