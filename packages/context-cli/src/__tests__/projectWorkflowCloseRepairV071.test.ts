import { describe, expect, test } from "bun:test";
import { createContextWorkflowFacts } from "../project/workflow/workflowFacts.js";
import { evaluateContextWorkflow } from "../project/workflow/workflowProvider.js";
import { verifyErrorsAreCloseRepairable } from "../project/workflow/verifyFacts.js";
import { emptyObservation } from "./projectWorkflowProviderV0610.fixtures.js";

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

  test("routes a stale structure projection to deterministic close without an evidence gate", async () => {
    const issues = [{
      severity: "error" as const,
      code: "approved-structure-view-section-projection-mismatch",
      path: "knowledge/structure.yaml",
      message: "approved structure section projection is stale",
    }, {
      severity: "error" as const,
      code: "approved-source-ref-stale",
      path: "knowledge/structure.yaml",
      message: "approved structure source reference is stale",
    }];
    const observation = {
      ...emptyObservation(),
      approvedPages: 1,
      close: { state: "stale" as const, diagnostics: ["projection is stale"] },
      evidenceWarnings: "stale" as const,
      verifyErrors: 0,
      projectionRefreshIssues: issues.length,
      verifyIssues: issues,
    };

    expect(createContextWorkflowFacts(observation, []).evidence.maintenance_clear).toBe(true);
    expect((await evaluateContextWorkflow({ observation, authorities: [] })).route).toMatchObject({
      node: "close-approved-knowledge",
      reason_code: "route.close.projection-stale",
    });
  });
});
