import {
  digestText,
  type ResourceReadReceiptSet,
} from "@c4a/agent-graph";
import type { ProjectStatus } from "../statusTypes.js";
import {
  isContextWorkflowResourceId,
  renderContextWorkflowResource,
} from "./workflowResourceRender.js";
import {
  CONTEXT_WORKFLOW_PROVIDER_ID,
  type ContextWorkflowResource,
} from "./workflowTypes.js";

function hasContentReceipt(
  receipts: ResourceReadReceiptSet | undefined,
  id: string,
  digest: string,
): boolean {
  if (receipts?.provider !== CONTEXT_WORKFLOW_PROVIDER_ID) return false;
  return receipts.receipts.some((receipt) =>
    receipt.id === id && receipt.digest === digest
  );
}

function contentAddressedResource(
  resource: ContextWorkflowResource,
  status: ProjectStatus,
  receipts: ResourceReadReceiptSet | undefined,
): ContextWorkflowResource {
  if (!isContextWorkflowResourceId(resource.id)) return resource;
  const digest = digestText(renderContextWorkflowResource(resource.id, status));
  const current = hasContentReceipt(receipts, resource.id, digest);
  if (current) {
    const projected = { ...resource, digest, read_state: "current" as const };
    delete projected.command;
    return projected;
  }
  return {
    ...resource,
    digest,
    read_state: "read-required",
  };
}

/**
 * Context knows the exact bytes of its generated views before materialization.
 * Project their content digest after the status envelope is assembled so read
 * receipts survive unrelated workflow revisions without weakening command
 * revision checks.
 */
export function withContentAddressedWorkflowResources(
  status: ProjectStatus,
  receipts?: ResourceReadReceiptSet,
): ProjectStatus {
  const current = status.workflow.current;
  if (current === undefined) return status;
  return {
    ...status,
    workflow: {
      ...status.workflow,
      current: {
        ...current,
        resources: {
          ...current.resources,
          required: current.resources.required.map((resource) =>
            contentAddressedResource(resource, status, receipts)
          ),
          recommended: current.resources.recommended.map((resource) =>
            contentAddressedResource(resource, status, receipts)
          ),
        },
      },
    },
  };
}
