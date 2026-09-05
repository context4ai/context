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
import { resolveCurrentIndexerAgentContext } from "../indexerCurrentWorkflowRoute.js";
import { materializeCurrentIndexerInstructions } from
  "../indexerCurrentInstructionMaterialization.js";
import { validateIndexerWorksetViewMaterializationRequest } from
  "../indexerWorksetViewMaterialization.js";
import { materializeCurrentIndexerStructurePreview } from "../indexerStructureReview.js";
import { readCurrentIndexerComposerBatch } from "../indexerCurrentComposer.js";
import { loadIndexerCustomization } from "../indexerCustomization.js";
import {
  canonicalIndexerJson,
  validateIndexerPostAuthorFragmentRequest,
} from "@c4a/context";
import { atomicWriteFile } from "../../lib/atomicWrite.js";
import { collectAllReviewCandidates } from "../reviewHtml.js";
import { materializeCurrentReviewBatchSet } from "../reviewCurrentResource.js";
import { measureContextDebugOperation } from "../debugTrace.js";

export {
  CONTEXT_WORKFLOW_RESOURCE_IDS,
  renderContextWorkflowResource,
  type ContextWorkflowResourceId,
} from "./workflowResourceRender.js";

export interface ContextWorkflowResourceResult {
  protocol: "context.workflow.resource.v1";
  id: string;
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

async function materializeCurrentIndexerResource(input: {
  projectRoot: string;
  resourceId: string;
  currentResource: NonNullable<ProjectStatus["workflow"]["current"]>["resources"]["required"][number];
  nextCommand: string;
}): Promise<ContextWorkflowResourceResult | undefined> {
  const materialize = input.currentResource.materialize;
  if (materialize === undefined) return undefined;
  if (materialize.handler === "context.materialize-indexer-structure-preview/v1") {
    const projected = await materializeCurrentIndexerStructurePreview({
      projectRoot: input.projectRoot,
      expectedRevision: input.currentResource.revision ?? "",
    });
    return {
      protocol: "context.workflow.resource.v1",
      id: input.resourceId,
      revision: input.currentResource.revision ?? "",
      digest: projected.digest,
      media_type: "application/json",
      path: projected.path,
      next_action: {
        kind: "read_resource_file",
        path: projected.path,
        message: "Read the complete semantic structure preview, then approve it or request an adjustment.",
        command: input.nextCommand,
      },
    };
  }
  if (materialize.handler === "context.materialize-indexer-instructions/v1") {
    const request = materialize.input.value as { composer_id?: unknown };
    const composer = request.composer_id === null || request.composer_id === undefined
      ? undefined
      : await readCurrentIndexerComposerBatch(input.projectRoot);
    const current = composer === undefined
      ? await resolveCurrentIndexerAgentContext(input.projectRoot)
      : undefined;
    if (composer === undefined && current === undefined) {
      throw new TypeError("current Indexer Agent workset is no longer available");
    }
    const authority = composer?.tasks[0]?.context.authority ?? current!.authority;
    const customization = composer === undefined
      ? current!.customization
      : await loadIndexerCustomization({
          workspaceRoot: input.projectRoot,
          projectRef: input.projectRoot,
          indexer: authority.indexer,
          manifest: authority.manifest,
          providerIntegrity: authority.provider.integrity,
        });
    const value = await measureContextDebugOperation({
      projectRoot: input.projectRoot,
      operation: "indexer.instructions-materialize",
      counters: { instruction_materialize_count: 1 },
    }, () => materializeCurrentIndexerInstructions({
        request: materialize.input.value,
        authority,
        customization,
        workspaceRoot: input.projectRoot,
      }));
    const path = join(
      input.projectRoot,
      ".tmp",
      "context-runtime",
      "indexer",
      "instructions",
      `${value.payload_digest.slice("sha256:".length)}.json`,
    );
    await writeJsonAtomic(path, value);
    return {
      protocol: "context.workflow.resource.v1",
      id: input.resourceId,
      revision: input.currentResource.revision ?? value.request_digest,
      digest: value.payload_digest,
      media_type: "application/json",
      path,
      next_action: {
        kind: "read_resource_file",
        path,
        message: "Read the complete instructions file, then complete the current Agent action.",
        command: input.nextCommand,
      },
    };
  }
  if (materialize.handler === "context.materialize-indexer-workset-view/v1") {
    if (
      typeof materialize.input.value === "object" &&
      materialize.input.value !== null &&
      "protocol" in materialize.input.value &&
      materialize.input.value.protocol === "context.indexer.layer-fragment-request/v1"
    ) {
      const request = validateIndexerPostAuthorFragmentRequest(materialize.input.value);
      const current = await readCurrentIndexerComposerBatch(input.projectRoot);
      const task = current?.tasks.find((candidate) =>
        candidate.context.request.request_digest === request.request_digest
      );
      if (
        task === undefined ||
        task.context.request.primary_result_view.view_digest !==
          request.primary_result_view.view_digest
      ) {
        throw new TypeError("current Composer PrimaryResultView is stale");
      }
      const path = join(
        input.projectRoot,
        ".tmp",
        "context-runtime",
        "indexer",
        "views",
        `${request.primary_result_view.view_digest.slice("sha256:".length)}.json`,
      );
      await atomicWriteFile(path, `${canonicalIndexerJson(request.primary_result_view)}\n`);
      return {
        protocol: "context.workflow.resource.v1",
        id: input.resourceId,
        revision: input.currentResource.revision ?? request.primary_result_view.view_digest,
        digest: request.primary_result_view.view_digest,
        media_type: "application/json",
        path,
        next_action: {
          kind: "read_resource_file",
          path,
          message: "Read the complete authorized PrimaryResult View, then complete the current Composer action.",
          command: input.nextCommand,
        },
      };
    }
    const current = await resolveCurrentIndexerAgentContext(input.projectRoot);
    if (current === undefined) {
      throw new TypeError("current Indexer Agent batch is no longer available");
    }
    const request = validateIndexerWorksetViewMaterializationRequest(
      materialize.input.value,
    );
    const task = current.descriptor.tasks.find((candidate) =>
      candidate.view_request.resource_id === input.resourceId
    );
    if (
      task === undefined ||
      task.view_request.request_digest !== request.request_digest
    ) {
      throw new TypeError("current Indexer Agent View is stale");
    }
    return {
      protocol: "context.workflow.resource.v1",
      id: input.resourceId,
      revision: input.currentResource.revision ?? request.request_digest,
      digest: request.payload_digest,
      media_type: "application/json",
      path: task.view_path,
      next_action: {
        kind: "read_resource_file",
        path: task.view_path,
        message: "Read the complete authorized task View, then complete the current Agent batch.",
        command: input.nextCommand,
      },
    };
  }
  throw new TypeError(`unsupported Context Host resource handler: ${materialize.handler}`);
}

async function materializeCurrentReview(input: {
  projectRoot: string;
  revision: string;
  nextCommand: string;
}): Promise<ContextWorkflowResourceResult> {
  const candidates = await collectAllReviewCandidates(input.projectRoot);
  const materialized = await materializeCurrentReviewBatchSet({
    projectRoot: input.projectRoot,
    candidates,
  });
  return {
    protocol: "context.workflow.resource.v1",
    id: "context.review-current",
    revision: input.revision,
    digest: materialized.digest,
    media_type: "text/markdown",
    path: materialized.path,
    next_action: {
      kind: "read_resource_file",
      path: materialized.path,
      message: `Read the Review index and all ${materialized.batch_count} reader-facing batch files before resolving the final Review gate.`,
      command: input.nextCommand,
    },
  };
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
  const currentResources = [
    ...(status.workflow.current?.resources.required ?? []),
    ...(status.workflow.current?.resources.recommended ?? []),
  ];
  const currentResource = currentResources.find((resource) =>
    resource.id === input.resourceId
  );
  if (currentResource === undefined) {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `resource ${input.resourceId} is not selected by the current Context route`,
      {
        category: ErrorCategory.WorkflowRevisionStale,
        current_state: status.workflow.current?.reason_code ??
          status.workflow.status,
        current_resources: currentResources.map((resource) => resource.id),
      },
    );
  }
  if (input.resourceId === "context.review-current") {
    return materializeCurrentReview({
      projectRoot: found.projectRoot,
      revision: input.revision,
      nextCommand: status.workflow.current?.commands.find((command) =>
        command.effect === "write"
      )?.command ?? "context status --format json",
    });
  }
  const dynamic = await materializeCurrentIndexerResource({
    projectRoot: found.projectRoot,
    resourceId: input.resourceId,
    currentResource,
    nextCommand: status.workflow.current?.commands[0]?.command ??
      "context status --format json",
  });
  if (dynamic !== undefined) return dynamic;
  const resourceId = workflowResourceId(input.resourceId);
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
