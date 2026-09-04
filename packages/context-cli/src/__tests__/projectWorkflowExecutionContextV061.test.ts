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
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.repositoryRestore],
    };
    expect(workflowStatusCommand(context)).toBe(
      "context status --managed --authority 'context.repository-restore' --format json",
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
          "context status --managed --authority 'context.repository-restore' --format json",
      },
    });
  });

  test("current resource commands preserve workflow execution context", () => {
    const result = {
      next_action: {
        command: "context resource materialize 'current-author-workset' --format json",
      },
    };
    expect(bindWorkflowExecutionContext(result, {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.repositoryRestore],
      revision: `sha256:${"a".repeat(64)}`,
    })).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.repository-restore' resource materialize 'current-author-workset' --format json`,
      },
    });
  });

  test("revision-binds current lifecycle writes and preserves managed authority", () => {
    expect(bindWorkflowExecutionContext({
      next_action: {
        kind: "complete_current",
        effect: "write",
        command: "context action complete-current --input .tmp/agent-payloads/current.json --format json",
      },
    }, {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.repositoryRestore],
      revision: `sha256:${"a".repeat(64)}`,
    })).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.repository-restore' action complete-current --input .tmp/agent-payloads/current.json --format json`,
      },
    });
  });

  test("carries the receipt file through status and current continuations", () => {
    const context = {
      managed: true,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.repositoryRestore],
      revision: `sha256:${"a".repeat(64)}`,
      resourceReceiptsReference:
        "@.tmp/context-runtime/workflow/read-receipts/current.json",
    };
    expect(workflowStatusCommand(context)).toBe(
      "context status --managed --authority 'context.repository-restore' --resource-receipts '@.tmp/context-runtime/workflow/read-receipts/current.json' --format json",
    );
    expect(bindWorkflowExecutionContext({
      next_action: {
        command: "context action complete-current --input .tmp/agent-payloads/current.json --format json",
      },
    }, context)).toMatchObject({
      next_action: {
        command:
          `context --workflow-revision 'sha256:${"a".repeat(64)}' --workflow-managed --workflow-authority 'context.repository-restore' --workflow-resource-receipts '@.tmp/context-runtime/workflow/read-receipts/current.json' action complete-current --input .tmp/agent-payloads/current.json --format json`,
      },
    });
  });
});
