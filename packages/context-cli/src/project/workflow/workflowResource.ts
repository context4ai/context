import { join } from "node:path";
import {
  digestText,
  materializeResource,
  writeJsonAtomic,
  type ResourceReadReceiptSet,
} from "@c4a/agent-graph";
import { ErrorCategory, formatFeedback } from "../../lib/cliFeedback.js";
import { ContextError } from "../../lib/errors.js";
import { ExitCode } from "../../types/exitCode.js";
import {
  collectProjectStatusSnapshot,
  reevaluateProjectStatusWorkflow,
} from "../status.js";
import type { ProjectStatus } from "../statusTypes.js";
import {
  assertObservedProjectWorkflowRevision,
  assertProjectWorkflowRevisionValue,
} from "../statusCommand.js";
import { findContextProjectRoot } from "../workspace.js";
import { contextWorkflowAuthorities } from "./workflowFacts.js";
import {
  authorityCommandOptions,
  loadContextWorkflowProvider,
} from "./workflowProvider.js";
import {
  CONTEXT_WORKFLOW_RESOURCE_IDS,
  isContextWorkflowResourceId,
  renderContextWorkflowResource,
  type ContextWorkflowResourceId,
} from "./workflowResourceRender.js";
import {
  CONTEXT_WORKFLOW_PROVIDER_ID,
  type ContextWorkflowAuthority,
} from "./workflowTypes.js";

export {
  CONTEXT_WORKFLOW_RESOURCE_IDS,
  renderContextWorkflowResource,
  type ContextWorkflowResourceId,
} from "./workflowResourceRender.js";

export interface ContextWorkflowResourceResult {
  protocol: "context.workflow.resource.v1";
  id: ContextWorkflowResourceId;
  revision: string;
  digest: string;
  media_type: string;
  path: string;
  next_action: {
    kind: "read_resource_file";
    path: string;
    message: string;
    command: string;
  };
}

function mergedReceipts(
  current: ResourceReadReceiptSet | undefined,
  receipt: {
    id: string;
    digest: string;
  },
): ResourceReadReceiptSet {
  const receipts = new Map(
    (current?.provider === CONTEXT_WORKFLOW_PROVIDER_ID
      ? current.receipts
      : []).map((item) => [item.id, item]),
  );
  receipts.set(receipt.id, receipt);
  return {
    schema: "agent-graph.resource-read-receipts.v1",
    provider: CONTEXT_WORKFLOW_PROVIDER_ID,
    receipts: [...receipts.values()].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

export type ContextWorkflowResourceAcknowledgeResult = ProjectStatus & {
  resourceAcknowledgement: {
    protocol: "context.workflow.resource-receipts.v1";
    acknowledged: number;
    receiptReference: string;
  };
};

export interface ContextWorkflowResourceAcknowledgeSummary {
  protocol: "context.workflow.resource-acknowledgement.v1";
  resourceAcknowledgement: ContextWorkflowResourceAcknowledgeResult["resourceAcknowledgement"];
  workflow: ProjectStatus["workflow"];
}

export function projectWorkflowResourceAcknowledgeSummary(
  result: ContextWorkflowResourceAcknowledgeResult,
): ContextWorkflowResourceAcknowledgeSummary {
  return {
    protocol: "context.workflow.resource-acknowledgement.v1",
    resourceAcknowledgement: result.resourceAcknowledgement,
    workflow: result.workflow,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function receiptSetPath(receipts: ResourceReadReceiptSet): string {
  const token = digestText(JSON.stringify(receipts)).slice("sha256:".length);
  return join(
    ".tmp",
    "context-runtime",
    "workflow",
    "read-receipts",
    `${token}.json`,
  );
}

async function writeReceiptContinuation(input: {
  projectRoot: string;
  managed: boolean;
  authorities: readonly ContextWorkflowAuthority[];
  receipts: ResourceReadReceiptSet;
}): Promise<{ path: string; command: string }> {
  const path = receiptSetPath(input.receipts);
  const absolutePath = join(input.projectRoot, path);
  await writeJsonAtomic(absolutePath, input.receipts);
  const contextCommand = input.managed
    ? [
        "context",
        "--workflow-resource-receipts",
        shellQuote(`@${absolutePath}`),
        "run",
        authorityCommandOptions(input.authorities, "resource").trim(),
        "--until blocked-or-complete",
        "--format json",
      ].filter((item) => item.length > 0).join(" ")
    : [
        "context status",
        authorityCommandOptions(input.authorities, "resource").trim(),
        "--resource-receipts",
        shellQuote(`@${absolutePath}`),
        "--format json",
      ].filter((item) => item.length > 0).join(" ");
  return {
    path,
    command: `cd ${shellQuote(input.projectRoot)} && ${contextCommand}`,
  };
}

function workflowResourceId(value: string): ContextWorkflowResourceId {
  if (isContextWorkflowResourceId(value)) return value;
  throw new ContextError(
    ExitCode.UserError,
    `unsupported Context workflow resource: ${value}`,
    {
      category: ErrorCategory.UserInputInvalid,
      valid_resources: [...CONTEXT_WORKFLOW_RESOURCE_IDS],
    },
  );
}

export async function materializeContextWorkflowResource(input: {
  cwd: string;
  resourceId: string;
  revision: string;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
}): Promise<ContextWorkflowResourceResult> {
  const found = findContextProjectRoot(input.cwd);
  if (!found) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "resource materialization requires a context project workspace",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const authorities = contextWorkflowAuthorities({
    managed: input.managed === true,
    ...(input.authorities === undefined
      ? {}
      : { authorities: input.authorities }),
  });
  assertProjectWorkflowRevisionValue(input.revision);
  const snapshot = await collectProjectStatusSnapshot(found.projectRoot, {
    managed: input.managed === true,
    authorities,
    ...(input.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: input.resourceReceipts }),
  });
  assertObservedProjectWorkflowRevision({
    status: snapshot.status,
    expectedRevision: input.revision,
    managed: input.managed === true,
    authorities,
  });
  const status = snapshot.status;
  const resourceId = workflowResourceId(input.resourceId);
  const currentResources = [
    ...(status.workflow.current?.resources.required ?? []),
    ...(status.workflow.current?.resources.recommended ?? []),
  ];
  const currentResource = currentResources.find((resource) =>
    resource.id === resourceId
  );
  if (currentResource === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `resource ${resourceId} is not selected by the current Context route`,
      {
        category: ErrorCategory.WorkflowRevisionStale,
        current_state: status.workflow.current?.reason_code ??
          status.workflow.status,
        current_resources: currentResources.map((resource) => resource.id),
      },
    );
  }
  const content = renderContextWorkflowResource(resourceId, status);
  const location = await materializeResource(
    await loadContextWorkflowProvider(),
    resourceId,
    {
      cache: join(
        found.projectRoot,
        ".tmp",
        "context-runtime",
        "workflow",
        "resources",
      ),
      workspace: found.projectRoot,
      revision: input.revision,
      input: {
        schema: "context.workflow.resource-input.v1",
        revision: input.revision,
        content,
      },
    },
  );
  if (location.filePath === undefined || location.digest === undefined) {
    throw new Error(`Context workflow resource ${resourceId} was not materialized`);
  }
  if (
    currentResource.digest !== undefined &&
    currentResource.digest !== location.digest
  ) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `materialized Context resource digest changed during the current workflow revision: ${resourceId}`,
      {
        category: ErrorCategory.WorkflowRevisionStale,
        expected_digest: currentResource.digest,
        actual_digest: location.digest,
        next: "context status --format json",
      },
    );
  }
  const receiptCandidate = {
    id: resourceId,
    digest: location.digest,
  };
  const afterReadReceipts = mergedReceipts(
    input.resourceReceipts,
    receiptCandidate,
  );
  const continuation = await writeReceiptContinuation({
    projectRoot: found.projectRoot,
    managed: input.managed === true,
    authorities,
    receipts: afterReadReceipts,
  });
  return {
    protocol: "context.workflow.resource.v1",
    id: resourceId,
    revision: input.revision,
    digest: location.digest,
    media_type: location.mediaType,
    path: location.filePath,
    next_action: {
      kind: "read_resource_file",
      path: location.filePath,
      message:
        "Read the complete file, then run the returned command. Materialization alone is not a read receipt.",
      command: continuation.command,
    },
  };
}

export async function acknowledgeCurrentWorkflowResources(input: {
  cwd: string;
  revision: string;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
}): Promise<ContextWorkflowResourceAcknowledgeResult> {
  const found = findContextProjectRoot(input.cwd);
  if (!found) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      "resource acknowledgement requires a context project workspace",
      { category: ErrorCategory.WorkspaceNotFound },
    );
  }
  const authorities = contextWorkflowAuthorities({
    managed: input.managed === true,
    ...(input.authorities === undefined
      ? {}
      : { authorities: input.authorities }),
  });
  assertProjectWorkflowRevisionValue(input.revision);
  const snapshot = await collectProjectStatusSnapshot(found.projectRoot, {
    managed: input.managed === true,
    authorities,
    ...(input.resourceReceipts === undefined
      ? {}
      : { resourceReceipts: input.resourceReceipts }),
    ...(input.resourceReceiptsReference === undefined
      ? {}
      : { resourceReceiptsReference: input.resourceReceiptsReference }),
  });
  assertObservedProjectWorkflowRevision({
    status: snapshot.status,
    expectedRevision: input.revision,
    managed: input.managed === true,
    authorities,
  });
  const status = snapshot.status;
  const directResources = (status.workflow.current?.resources.required ?? [])
    .filter((resource) =>
      resource.read_state === "read-required" &&
      resource.path !== undefined &&
      resource.digest !== undefined
    );
  let receipts = input.resourceReceipts;
  for (const resource of directResources) {
    receipts = mergedReceipts(receipts, {
      id: resource.id,
      digest: resource.digest!,
    });
  }
  const normalizedReceipts = receipts ?? {
    schema: "agent-graph.resource-read-receipts.v1" as const,
    provider: CONTEXT_WORKFLOW_PROVIDER_ID,
    receipts: [],
  };
  const continuation = await writeReceiptContinuation({
    projectRoot: found.projectRoot,
    managed: input.managed === true,
    authorities,
    receipts: normalizedReceipts,
  });
  // A read receipt changes only route resource freshness, not workspace facts.
  // Reuse the revision-checked observation instead of scanning sources and
  // approved knowledge again. Any later workspace mutation is still rejected
  // by the revision-bound lifecycle command, and stale resource digests cannot
  // satisfy a different route.
  const reevaluated = await reevaluateProjectStatusWorkflow({
    snapshot,
    resourceReceipts: normalizedReceipts,
    resourceReceiptsReference: `@${join(found.projectRoot, continuation.path)}`,
  });
  return {
    ...reevaluated,
    resourceAcknowledgement: {
      protocol: "context.workflow.resource-receipts.v1",
      acknowledged: directResources.length,
      receiptReference: `@${join(found.projectRoot, continuation.path)}`,
    },
  };
}

export async function runContextWorkflowResourceAcknowledgeCommand(input: {
  cwd: string;
  revision: string;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  resourceReceiptsReference?: string;
  format: "text" | "json";
  view?: "summary" | "full";
}): Promise<void> {
  const result = await acknowledgeCurrentWorkflowResources(input);
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(
      input.view === "full"
        ? result
        : projectWorkflowResourceAcknowledgeSummary(result),
      null,
      2,
    )}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "acknowledged",
    subject: "current required resources",
    headline: `${result.resourceAcknowledgement.acknowledged} content receipt(s) recorded and workflow re-evaluated`,
    next: "Use --format json to consume the re-evaluated workflow.current without another status call.",
  }));
}

export async function runContextWorkflowResourceCommand(input: {
  cwd: string;
  resourceId: string;
  revision: string;
  managed?: boolean;
  authorities?: readonly ContextWorkflowAuthority[];
  resourceReceipts?: ResourceReadReceiptSet;
  format: "text" | "json";
}): Promise<void> {
  const result = await materializeContextWorkflowResource(input);
  if (input.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatFeedback({
    symbol: "✓",
    action: "materialized",
    subject: result.id,
    headline: "current Context workflow resource",
    body: [
      `revision: ${result.revision}`,
      `digest: ${result.digest}`,
      `path: ${result.path}`,
      `after read: ${result.next_action.command}`,
    ],
  }));
}
