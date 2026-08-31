import { describe, expect, test } from "bun:test";
import { verifyErrorsAreCloseRepairable } from "../project/workflow/verifyFacts.js";

describe("Context workflow close repair classification", () => {
  test("treats deterministic approved structure drift as close-repairable", () => {
    expect(verifyErrorsAreCloseRepairable([
      {
        severity: "error",
        code: "approved-structure-view-section-projection-mismatch",
        path: "knowledge/structure.yaml",
        message: "approved structure section projection is stale",
      },
      {
        severity: "error",
        code: "approved-parent-index-edge-missing",
        path: "knowledge/structure.yaml",
        message: "approved structure parent edge is stale",
      },
      {
        severity: "error",
        code: "approved-source-ref-stale",
        path: "knowledge/structure.yaml",
        message: "approved structure source reference is stale",
      },
    ])).toBe(true);
  });

  test("does not hide stale evidence on an approved knowledge page", () => {
    expect(verifyErrorsAreCloseRepairable([{
      severity: "error",
      code: "approved-source-ref-stale",
      path: "sop/action/example.md",
      message: "approved page source reference is stale",
    }])).toBe(false);
  });
});
