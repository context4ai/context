import { describe, expect, test } from "bun:test";
import {
  bindWorkflowExecutionContext,
  workflowStatusCommand,
} from "../project/workflow/workflowExecutionContext.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";

describe("workflow execution context", () => {
  test("managed phase receipts preserve non-managed session authorities", () => {
    const context = {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
    };
    expect(workflowStatusCommand(context)).toBe(
      "context status --managed --authority 'context.source-read' --format json",
    );
    expect(bindWorkflowExecutionContext({
      next_action: {
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
      },
    }, context)).toEqual({
      next_action: {
        kind: "reevaluate_workspace_route",
        command:
          "context status --managed --authority 'context.source-read' --format json",
      },
    });
  });

  test("phase-local read commands preserve workflow execution context", () => {
    const result = {
      next_action: {
        command:
          "context run align:file:manual:faq --view read-plan --format json",
      },
    };
    expect(bindWorkflowExecutionContext(result, {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
      revision: `sha256:${"a".repeat(64)}`,
    })).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.source-read' run align:file:manual:faq --view read-plan --format json`,
      },
    });
  });

  test("revision-binds phase-local lifecycle writes and preserves managed authority", () => {
    expect(bindWorkflowExecutionContext({
      next_action: {
        kind: "stage_structure",
        effect: "write",
        command:
          "context run align:file:manual:faq --stage --input .tmp/agent-payloads/manual.yaml --format json",
      },
    }, {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
      revision: `sha256:${"a".repeat(64)}`,
    })).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.source-read' run align:file:manual:faq --stage --input .tmp/agent-payloads/manual.yaml --format json`,
      },
    });
  });

  test("carries the receipt file through status and phase-local continuations", () => {
    const context = {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.sourceRead],
      revision: `sha256:${"a".repeat(64)}`,
      resourceReceiptsReference:
        "@.tmp/context-runtime/workflow/read-receipts/current.json",
    };
    expect(workflowStatusCommand(context)).toBe(
      "context status --managed --authority 'context.source-read' --resource-receipts '@.tmp/context-runtime/workflow/read-receipts/current.json' --format json",
    );
    expect(bindWorkflowExecutionContext({
      next_action: {
        command: "context run align:file:manual:faq --view read-plan --format json",
      },
    }, context)).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.source-read' --workflow-resource-receipts '@.tmp/context-runtime/workflow/read-receipts/current.json' run align:file:manual:faq --view read-plan --format json`,
      },
    });
  });
});
