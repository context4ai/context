import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ResourceReadReceiptSet } from "@c4a/agent-graph";
import { buildCommittedEvidenceIndex } from "../documentEvidenceIndex.js";
import type { DocumentSourceStatus } from "../statusTypes.js";
import {
  CONTEXT_WORKFLOW_PROVIDER_ID,
  type ContextWorkflowObservation,
  type ContextWorkflowResource,
} from "./workflowTypes.js";

function sourceKeysForRoute(
  node: string,
  observation: ContextWorkflowObservation,
): string[] {
  if (node === "classify-document") {
    return observation.unclassifiedDocumentTargets.map((target) =>
      target.sourceKey
    );
  }
  if (node === "align-next") {
    return observation.pendingStructureTargets.map((target) => target.sourceKey);
  }
  return [];
}

function sourceForKey(
  sources: readonly DocumentSourceStatus[],
  sourceKey: string,
): DocumentSourceStatus | undefined {
  const separator = sourceKey.indexOf(":");
  if (separator < 1) return undefined;
  const type = sourceKey.slice(0, separator);
  const name = sourceKey.slice(separator + 1);
  if (type !== "file" && type !== "lark") return undefined;
  return sources.find((source) =>
    source.type === type && source.name === name && source.snapshotReady
  );
}

function resourceId(sourceKey: string, documentPath: string): string {
  const identity = createHash("sha256")
    .update(`${sourceKey}\u0000${documentPath}`)
    .digest("hex")
    .slice(0, 24);
  return `context.source-body/${identity}`;
}

function isCurrent(
  id: string,
  digest: string,
  receipts: ResourceReadReceiptSet | undefined,
): boolean {
  if (receipts?.provider !== CONTEXT_WORKFLOW_PROVIDER_ID) return false;
  return receipts.receipts.some((receipt) =>
    receipt.id === id && receipt.digest === digest
  );
}

export async function currentSourceBodyResources(input: {
  node: string;
  observation: ContextWorkflowObservation;
  receipts?: ResourceReadReceiptSet;
}): Promise<ContextWorkflowResource[]> {
  const resources: ContextWorkflowResource[] = [];
  const sourceKeys = [...new Set(sourceKeysForRoute(
    input.node,
    input.observation,
  ))];
  for (const sourceKey of sourceKeys) {
    const source = sourceForKey(input.observation.documentSources, sourceKey);
    if (source === undefined) continue;
    try {
      const evidence = await buildCommittedEvidenceIndex({
        projectRoot: input.observation.projectRoot,
        sourceType: source.type,
        sourceName: source.name,
        materializedAt: source.materializedAt,
        manifestPath: source.manifest,
        writeRuntimeIndex: false,
      });
      for (const document of evidence.index.documents) {
        const id = resourceId(sourceKey, document.path);
        resources.push({
          id,
          kind: "context-view",
          media_type: "text/markdown",
          digest: document.content_hash,
          path: join(
            input.observation.projectRoot,
            source.materializedAt,
            document.path,
          ),
          read_state: isCurrent(id, document.content_hash, input.receipts)
            ? "current"
            : "read-required",
        });
      }
    } catch {
      // Workspace/source diagnostics already own invalid snapshot reporting.
      // Route projection must not replace that typed root cause with a second
      // resource expansion failure.
    }
  }
  return resources.sort((left, right) => left.id.localeCompare(right.id));
}
