import { assertProjectWorkflowRevisionValue } from "./statusCommand.js";
import { resolveCurrentIndexerWorkflowRoute } from "./indexerCurrentWorkflowRoute.js";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

export async function assertCurrentIndexerBatchRevision(input: {
  projectRoot: string;
  expectedRevision: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
}) {
  assertProjectWorkflowRevisionValue(input.expectedRevision);
  const route = await resolveCurrentIndexerWorkflowRoute(input);
  if (route?.revision === input.expectedRevision) return route;
  const authorityOptions = input.authorities.map((authority) =>
    ` --workflow-authority '${authority}'`
  ).join("");
  const command = `context${authorityOptions} status${input.managed ? " --managed" : ""} --view summary --format json`;
  throw new ContextError(
    ExitCode.WorkspaceStateError,
    `The supplied revision does not match the current Indexer route. Re-run \`${command}\` and use the new route.`,
    {
      category: ErrorCategory.WorkflowRevisionStale,
      project_root: input.projectRoot,
      expected_revision: input.expectedRevision,
      current_revision: route?.revision ?? null,
      revision_advanced: false,
      next_action: {
        kind: "refresh_workflow_route",
        cwd: input.projectRoot,
        command,
        message: "Verify this is the intended workspace. If another submission is running, wait for its receipt before refreshing. A changed revision can reflect updated instructions or resources, not only accepted tasks. Read the current Route and submit only its outstanding tasks; task prepare is not revision recovery.",
      },
    },
  );
}
