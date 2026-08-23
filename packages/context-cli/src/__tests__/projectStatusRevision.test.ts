import { describe, expect, test } from "bun:test";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { assertObservedProjectWorkflowRevision } from "../project/statusCommand.js";
import type { ProjectStatus } from "../project/statusTypes.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";

const expectedRevision = `sha256:${"a".repeat(64)}`;
const currentRevision = `sha256:${"b".repeat(64)}`;

function staleStatus(): ProjectStatus {
  return {
    workflow: {
      revision: currentRevision,
      status: "actionable",
      current: { reason_code: "route.package.template-review-required" },
    },
  } as ProjectStatus;
}

function captureRevisionError(input: {
  managed: boolean;
  authorities: ReturnType<typeof contextWorkflowAuthorities>;
}): ContextError {
  try {
    assertObservedProjectWorkflowRevision({
      status: staleStatus(),
      expectedRevision,
      ...input,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ContextError);
    return error as ContextError;
  }
  throw new Error("expected stale workflow revision");
}

describe("workflow revision recovery", () => {
  test("keeps the ordinary execution mode", () => {
    const error = captureRevisionError({ managed: false, authorities: [] });
    expect(error.detail).toMatchObject({
      category: ErrorCategory.WorkflowRevisionStale,
      next_action: {
        kind: "refresh_workflow_route",
        command: "context status --format json",
      },
    });
    expect(error.message).toContain("`context status --format json`");
  });

  test("keeps managed mode and additional session authority", () => {
    const authorities = contextWorkflowAuthorities({
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
    });
    const command = "context status --managed --authority 'context.source-read' --format json";
    const error = captureRevisionError({ managed: true, authorities });
    expect(error.detail).toMatchObject({
      category: ErrorCategory.WorkflowRevisionStale,
      next_action: { kind: "refresh_workflow_route", command },
    });
    expect(error.message).toContain(`\`${command}\``);
  });
});
