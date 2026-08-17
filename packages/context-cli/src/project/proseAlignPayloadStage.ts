import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";
import { alignPayloadUserError } from "./proseAlignPayloadErrors.js";
import { normalizeAlignPayloadForWrite } from "./proseAlignPayloadParse.js";
import { currentEvidenceSnapshotHash } from "./proseAlignPayloadValidation.js";
import { openLocalFile } from "./localHtmlReport.js";
import {
  ALIGN_GATE_SCHEMA_VERSION,
  alignCommand,
  type AlignPayload,
  type AlignSelfHealSummary,
  type AlignWarningLifecycle,
  type EvidenceContext,
  type StageResult,
} from "./proseAlignTypes.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  archiveActiveStructure,
  activeStructureSlots,
  currentStructureSlotDigest,
  readStructureSnapshotPayload,
  writeStructureSnapshot,
} from "./proseStructureStore.js";
import { workspaceRouteReevaluation } from "./workflow/workflowReceipt.js";

async function resolveStagedPayloadConfirmation(input: {
  projectRoot: string;
  phaseCollection: string;
  evidence: EvidenceContext;
  payload: AlignPayload;
}): Promise<{
  payload: AlignPayload;
  previousStructureDigest?: string;
  confirmationRestored: boolean;
}> {
  await archiveActiveStructure(input.projectRoot);
  const sourceKey = `${input.evidence.source.sourceType}:${input.evidence.source.sourceName}`;
  const previousStructureDigest = await currentStructureSlotDigest(input.projectRoot, sourceKey, input.phaseCollection);
  const currentSlots = await activeStructureSlots(input.projectRoot);
  const payloadCollections = [...new Set(input.payload.views.map((view) => view.collection))];
  const everyPayloadSlotMatches = input.payload.sources.every((source) =>
    payloadCollections.every((collection) => currentSlots.some((slot) =>
      slot.source === source &&
      slot.collection === collection &&
      slot.structureDigest === input.payload.structure_digest
    ))
  );
  const confirmedSnapshot = everyPayloadSlotMatches
    ? await readStructureSnapshotPayload(input.projectRoot, input.payload.structure_digest)
    : undefined;
  const confirmationRestored = input.payload.lifecycle.state === "draft" && confirmedSnapshot !== undefined;
  const payload: AlignPayload = confirmationRestored
    ? {
        ...input.payload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "existing-structure-slot",
          confirmed_at: confirmedSnapshot.lifecycle.confirmed_at ?? "structure-snapshot",
          structure_digest: input.payload.structure_digest,
        },
      }
    : input.payload;
  return {
    payload,
    ...(previousStructureDigest !== undefined ? { previousStructureDigest } : {}),
    confirmationRestored,
  };
}

function stagedWarningLifecycle(
  warningLifecycle: AlignWarningLifecycle | undefined,
  confirmed: boolean,
): AlignWarningLifecycle | undefined {
  if (warningLifecycle === undefined) return undefined;
  return {
    ...warningLifecycle,
    disposition: confirmed ? "accepted-by-structure-confirmation" : warningLifecycle.disposition,
  };
}

function stageReasonCode(restored: boolean, state: AlignPayload["lifecycle"]["state"]): string {
  if (restored) return "prose-align-structure-confirmation-restored";
  return state === "confirmed" ? "prose-align-structure-confirmed" : "prose-align-structure-staged";
}

export async function stageAlignPayload(input: {
  projectRoot: string;
  phaseId: string;
  phaseCollection: string;
  evidence: EvidenceContext;
  payload: AlignPayload;
  replace?: string;
  reviewNotice?: Record<string, unknown>;
  structureSummary?: Record<string, unknown>;
  structureSummaryCompact?: Record<string, unknown>;
  structureReport?: Record<string, unknown>;
  warningLifecycle?: AlignWarningLifecycle;
  selfHealed?: AlignSelfHealSummary;
}): Promise<StageResult> {
  const result = await withProjectWriteLock(input.projectRoot, "align-structure", async () => {
    const currentSnapshotHash = await currentEvidenceSnapshotHash({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
    });
    if (input.payload.evidence_snapshot_hash !== currentSnapshotHash) {
      const readPlanCommand = alignCommand(input.phaseId, ["--view", "read-plan", "--format", "json"]);
      throw alignPayloadUserError("context.structure.v1 payload evidence snapshot is stale", {
        expected_snapshot_hash: currentSnapshotHash,
        actual_snapshot_hash: input.payload.evidence_snapshot_hash,
        diagnostics: [{
          severity: "error",
          code: "payload.digest_stale",
          family: "stale",
          message: "Payload was generated from a different evidence snapshot; rerun read-plan and regenerate the structure.",
          field: "evidence_snapshot_hash",
          repair: {
            action: "regenerate_structure_from_current_evidence",
            expected_snapshot_hash: currentSnapshotHash,
            actual_snapshot_hash: input.payload.evidence_snapshot_hash,
          },
        }],
        repair_hints: [{
          family: "stale",
          action: "regenerate_structure_from_current_evidence",
          command: readPlanCommand,
          reason: "The source snapshot changed after the structure payload was prepared.",
        }],
        next: readPlanCommand,
      });
    }
    const structurePath = join(input.projectRoot, STRUCTURE_FILE);
    const resolved = await resolveStagedPayloadConfirmation(input);
    const effectivePayload: AlignPayload = {
      ...resolved.payload,
      lifecycle: {
        ...resolved.payload.lifecycle,
        phase_collection: input.phaseCollection,
      },
    };
    if (effectivePayload.lifecycle.state === "confirmed" || effectivePayload.lifecycle.state === "frozen") {
      await writeStructureSnapshot(input.projectRoot, effectivePayload);
    }
    await mkdir(dirname(structurePath), { recursive: true });
    await writeFile(structurePath, YAML.stringify(normalizeAlignPayloadForWrite(effectivePayload)), "utf8");
    return {
      structureFile: STRUCTURE_FILE,
      previousStructureDigest: resolved.previousStructureDigest,
      confirmationRestored: resolved.confirmationRestored,
      lifecycleState: effectivePayload.lifecycle.state,
      nodes: input.payload.nodes.length,
      views: input.payload.views.length,
      edges: input.payload.edges.length,
      unresolved: input.payload.unresolved.length,
    };
  });
  const confirmed = result.lifecycleState === "confirmed";
  const warningLifecycle = stagedWarningLifecycle(input.warningLifecycle, confirmed);
  const structureDigestChanged = result.previousStructureDigest !== undefined &&
    result.previousStructureDigest !== input.payload.structure_digest;
  const reportPath = input.structureReport !== undefined &&
    typeof input.structureReport.absolute_path === "string"
    ? input.structureReport.absolute_path
    : undefined;
  const openResult = !confirmed && reportPath !== undefined
    ? await openLocalFile(reportPath)
    : undefined;
  const reviewNotice = input.reviewNotice === undefined
    ? undefined
    : {
        ...input.reviewNotice,
        ...(input.structureReport !== undefined ? { review_report: input.structureReport } : {}),
        ...(openResult !== undefined ? { report_opened: openResult.opened } : {}),
      };
  return {
    kind: "prose.align.structure-write.result",
    operation: result.confirmationRestored
      ? "confirmation-restored"
      : confirmed
        ? "confirmed"
        : "staged",
    schema_version: ALIGN_GATE_SCHEMA_VERSION,
    source: {
      type: input.evidence.source.sourceType,
      name: input.evidence.source.sourceName,
    },
    phase_collection: input.phaseCollection,
    collections: [...new Set(input.payload.views.map((view) => view.collection))].sort(),
    payload_digest: input.payload.payload_digest,
    ...(result.previousStructureDigest !== undefined ? { previous_structure_digest: result.previousStructureDigest } : {}),
    ...(structureDigestChanged ? { structure_digest_changed: true } : {}),
    ...(result.confirmationRestored ? { confirmation_restored: true } : {}),
    nodes: result.nodes,
    views: result.views,
    edges: result.edges,
    unresolved: result.unresolved,
    structure_digest: input.payload.structure_digest,
    lifecycle_state: result.lifecycleState,
    structureFile: result.structureFile,
    ...(reviewNotice !== undefined ? { review_notice: reviewNotice } : {}),
    ...(input.structureReport !== undefined ? { structure_report: input.structureReport } : {}),
    ...(input.structureSummaryCompact !== undefined ? { structure_summary_compact: input.structureSummaryCompact } : {}),
    ...(warningLifecycle !== undefined ? { warning_lifecycle: warningLifecycle } : {}),
    ...(input.selfHealed !== undefined ? { self_healed: input.selfHealed } : {}),
    next_action: {
      ...workspaceRouteReevaluation(input.phaseId),
      reason_code: stageReasonCode(result.confirmationRestored, result.lifecycleState),
    },
    ...(input.structureSummary !== undefined ? { structure_summary: input.structureSummary } : {}),
  };
}
