export interface WorkspaceRouteReevaluation {
  kind: "reevaluate_workspace_route";
  command: "context status --format json";
  completed_operation: string;
  message: string;
}

export function workspaceRouteReevaluation(
  completedOperation: string,
): WorkspaceRouteReevaluation {
  return {
    kind: "reevaluate_workspace_route",
    command: "context status --format json",
    completed_operation: completedOperation,
    message:
      "The current operation completed. Re-evaluate workflow.current before another workspace lifecycle action.",
  };
}
