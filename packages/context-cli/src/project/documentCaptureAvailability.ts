import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PhaseDefinition } from "@c4a/context";
import { applyAtomicFileBatch } from "../lib/atomicFileBatch.js";
import { ContextError } from "../lib/errors.js";
import { resolveDocumentPhaseSource, type DocumentPhaseDefinition } from "./documentRun.js";
import { DOCUMENT_ACQUISITION_UNAVAILABLE } from "./documentCaptureContract.js";
import type { DocumentSourceStatus } from "./statusTypes.js";
import { withProjectWriteLock } from "./writeLock.js";
import { workspaceRouteReevaluation } from "./workflow/workflowReceipt.js";

// Only pre-write acquisition failures may be deferred. Validation and persistence
// failures must remain errors; they cannot certify an older snapshot as valid.


function receiptPath(root: string, phaseId: string): string {
  const key = createHash("sha256").update(phaseId).digest("hex");
  return join(root, ".tmp/context-runtime/document-acquisition", `${key}.json`);
}

async function identity(root: string, phase: DocumentPhaseDefinition) {
  const resolved = await resolveDocumentPhaseSource({ projectRoot: root, phase });
  return { resolved, configuration: JSON.parse(JSON.stringify({ entry: resolved.entry, phase })) as unknown };
}

function usableOrAbsent(source: DocumentSourceStatus): boolean {
  return source.snapshotReady || source.diagnostics.length === 1 && (
    source.diagnostics[0] === `snapshot is missing: ${source.manifest}` ||
    source.diagnostics[0] === `snapshot batch has no captured entry for ${source.name}`
  );
}

export async function runDocumentCaptureWithAvailability<T>(
  root: string, phase: DocumentPhaseDefinition, capture: () => Promise<T>,
): Promise<T | Record<string, unknown>> {
  return withProjectWriteLock(root, "document-acquisition", async () => {
    const { resolved, configuration } = await identity(root, phase);
    const path = receiptPath(root, phase.id);
    // An explicit retry supersedes any previous warning, even when it now fails
    // validation. Never leave an old deferral hiding a new hard error.
    await rm(path, { force: true });
    try {
      return await capture();
    } catch (error) {
      if (!(error instanceof ContextError) || error.detail?.reason_code !== DOCUMENT_ACQUISITION_UNAVAILABLE) throw error;
      const { readSourceStatus } = await import("./statusReaders.js");
      const source = (await readSourceStatus(root)).documentSources.find(item =>
        item.type === resolved.sourceType && item.name === resolved.sourceName);
      if (!source || !usableOrAbsent(source)) throw error;
      const warning = {
        code: DOCUMENT_ACQUISITION_UNAVAILABLE,
        cause: typeof error.detail.acquisition_cause === "string" ? error.detail.acquisition_cause : "document.local-unreadable",
        source_ref: `${resolved.sourceType}:${resolved.sourceName}`,
        state: source.snapshotReady ? "retained-snapshot" : "deferred-no-evidence",
        ...(source.snapshotHash ? { snapshot_hash: source.snapshotHash } : {}),
        retry_command: `context run ${phase.id}`,
        message: source.snapshotReady
          ? "Document refresh unavailable. Retain the validated registered snapshot; it is not confirmed current upstream."
          : "Document acquisition unavailable. Keep this source registered as a pending evidence gap; do not cite it or invent content. Unrelated work may continue.",
      };
      await applyAtomicFileBatch({ transactionRoot: join(root, ".tmp/context-runtime/transactions"), writes: [{ path, bytes: `${JSON.stringify({ configuration, warning }, null, 2)}\n` }] });
      return {
        kind: "document.capture.warning", captured: false, warning,
        next_action: workspaceRouteReevaluation(`deferred:${phase.id}`),
      };
    }
  });
}

export async function attachDocumentAcquisitionWarnings(
  root: string, phases: readonly PhaseDefinition[], sources: DocumentSourceStatus[],
): Promise<void> {
  for (const phase of phases) {
    if (phase.kind !== "phase.capture.file" && phase.kind !== "phase.capture.lark") continue;
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath(root, phase.id), "utf8")); }
    catch { continue; } // Missing or malformed receipts never grant a deferral.
    const { resolved, configuration } = await identity(root, phase);
    if (!isDeepStrictEqual(configuration, receipt.configuration)) continue;
    const source = sources.find(item => item.type === resolved.sourceType && item.name === resolved.sourceName);
    if (!source || !usableOrAbsent(source) || receipt.warning?.code !== DOCUMENT_ACQUISITION_UNAVAILABLE) continue;
    if (receipt.warning.snapshot_hash !== source.snapshotHash) continue;
    source.acquisitionWarning = receipt.warning;
  }
}
