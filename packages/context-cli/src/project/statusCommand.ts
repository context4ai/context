import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { ResourceReadReceiptSet } from "@c4a/agent-graph";
import { collectProjectStatus } from "./status.js";
import { formatProjectStatus } from "./statusRender.js";
import type { ProjectStatus } from "./statusTypes.js";
import {
  assertContextStatusWorkspaceAllowed,
  findContextProjectRoot,
} from "./workspace.js";
import { workflowStatusCommand } from "./workflow/workflowExecutionContext.js";
import type { ContextWorkflowAuthority } from "./workflow/workflowTypes.js";

function projectStatusSummary(status: ProjectStatus): Record<string, unknown> {
  const complete = status.workflow.status === "complete";
  const requestedSourceKeys = status.unclassifiedDocumentTargets.length > 0
    ? status.unclassifiedDocumentTargets.map((target) => target.sourceKey)
    : status.pendingStructureTargets.length > 0
    ? [...new Set(status.pendingStructureTargets.map((target) => target.sourceKey))]
    : status.compilePhaseResolution?.requestedSourceKeys ??
      status.alignPhaseResolution?.requestedSourceKeys ?? [];
  const requestedCollections = status.unclassifiedDocumentTargets.length > 0
    ? []
    : status.pendingStructureTargets.length > 0
    ? [...new Set(status.pendingStructureTargets.map((target) => target.collection))]
    : status.compilePhaseResolution?.requestedCollections ??
      status.alignPhaseResolution?.requestedCollections ??
      status.pendingReview?.collections ?? [];
  const completedSourceKeys = [
    ...status.sources.map((source) => `repo:${source.name}`),
    ...status.documentSources.map((source) =>
      `${source.type}:${source.name}`
    ),
  ].sort();
  const completedCollections = [...status.approvedCollections].sort();
  return {
    workflow: status.workflow,
    ...(status.executionMode !== undefined
      ? { executionMode: status.executionMode }
      : {}),
    ...(complete
      ? {
          completedScope: {
            sourceKeys: completedSourceKeys,
            collections: completedCollections,
            approvedPages: status.approvedPages,
            packages: status.packages.map((item) => item.name).sort(),
          },
        }
      : {
          currentTarget: {
            sourceKeys: requestedSourceKeys,
            collections: requestedCollections,
            ...(status.unclassifiedDocumentTargets.length > 0
              ? { unclassifiedDocumentTargets: status.unclassifiedDocumentTargets }
              : {}),
            ...(status.pendingStructureTargets.length > 0
              ? { pendingStructureTargets: status.pendingStructureTargets }
              : {}),
            ...(status.pendingReview !== undefined
              ? { pendingReview: status.pendingReview }
              : {}),
          },
        }),
    progress: {
      structureBatch: {
        state: status.structureBatch.state,
        slotCount: status.structureBatch.slotCount,
        sourceCount: status.structureBatch.sourceCount,
        pendingTargets: status.pendingStructureTargets.length,
      },
      pendingCapturePhases: status.pendingCapturePhases.length,
      pendingExtractPhases: status.pendingExtractPhases.length,
      documentOptimization: {
        enabled: status.documentOptimization.enabled,
        current: status.documentOptimization.current,
        revisionPages: status.documentOptimization.revision_pages,
        pendingFragments: status.documentOptimization.pending_fragments,
        conflicts: status.documentOptimization.conflict_fragments,
      },
      configurationGaps: status.configurationGaps,
    },
    counts: {
      sources: status.sourceSummary,
      draftCandidates: status.draftCandidates,
      approvedPages: status.approvedPages,
      distFiles: status.distFiles,
      packageCount: status.packageCount,
      verifyErrors: status.verifyErrors,
      verifyWarnings: status.verifyWarnings,
      projectionRefreshIssues: status.projectionRefreshIssues,
    },
    diagnostics: status.workflow.diagnostics,
  };
}

export async function runProjectStatusCommand(input: {
  cwd: string;
  format?: "table" | "json";
  view?: "full" | "summary";
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
  onSuccess?: (status: ProjectStatus) => void;
}): Promise<boolean> {
  assertContextStatusWorkspaceAllowed(input.cwd);
  const found = findContextProjectRoot(input.cwd);
  if (!found) return false;
  const status = await collectProjectStatus(found.projectRoot, {
    managed: input.managed === true,
    ...(input.authorities === undefined
      ? {}
      : { authorities: input.authorities }),
    ...(input.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: input.resourceReceipts }),
    ...(input.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: input.resourceReceiptsReference }),
  });
  if (input.format === "json") {
    const { next, state, routing, ...detail } = status;
    process.stdout.write(`${JSON.stringify(
      input.view === "summary"
        ? projectStatusSummary(status)
        : { next, state, routing, ...detail },
      null,
      2,
    )}\n`);
  } else {
    process.stdout.write(formatProjectStatus(status));
  }
  input.onSuccess?.(status);
  return true;
}

export async function assertProjectWorkflowRevision(input: {
  cwd: string;
  expectedRevision: string;
  managed: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
}): Promise<void> {
  assertProjectWorkflowRevisionValue(input.expectedRevision);
  const found = findContextProjectRoot(input.cwd);
  if (!found) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "workflow revision validation requires a context project workspace",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const status = await collectProjectStatus(found.projectRoot, {
    managed: input.managed,
    ...(input.authorities === undefined
      ? {}
      : { authorities: input.authorities }),
  });
  assertObservedProjectWorkflowRevision({
    status,
    expectedRevision: input.expectedRevision,
    managed: input.managed,
    authorities: input.authorities ?? [],
  });
}

export function assertObservedProjectWorkflowRevision(input: {
  status: ProjectStatus;
  expectedRevision: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
}): void {
  assertProjectWorkflowRevisionValue(input.expectedRevision);
  if (input.status.workflow.revision === input.expectedRevision) return;
  const recoveryCommand = workflowStatusCommand({
    managed: input.managed,
    authorities: input.authorities,
  });
  throw new ContextError(
    ExitCode.WorkspaceStateError,
    `The Context workspace changed after this command was selected. Re-run \`${recoveryCommand}\` and use the new route.`,
    {
      category: ErrorCategory.WorkflowRevisionStale,
      expected_revision: input.expectedRevision,
      current_revision: input.status.workflow.revision,
      current_state: input.status.workflow.current?.reason_code ??
        input.status.workflow.status,
      next_action: {
        kind: "refresh_workflow_route",
        command: recoveryCommand,
        message: "Refresh the current route in the same execution mode and use only the newly returned command.",
      },
    },
  );
}

export function assertProjectWorkflowRevisionValue(expectedRevision: string): void {
  if (/^sha256:[a-f0-9]{64}$/.test(expectedRevision)) return;
  throw new ContextError(
    ExitCode.UserError,
    `workflow revision is invalid: ${expectedRevision}`,
    { category: ErrorCategory.UserInputInvalid },
  );
}
