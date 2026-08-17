import { digest } from "./proseAlignPayloadParse.js";
import { repairHints } from "./proseAlignPayloadValidation.js";
import {
  ALIGN_GATE_SCHEMA_VERSION,
  STRUCTURE_SCHEMA_VERSION,
  PROSE_SEMANTIC_ISSUE_FAMILIES,
  alignSemanticRules,
  alignCommand,
  suggestedAlignPayloadPath,
  type AlignDiagnostic,
  type AlignPayload,
  type ValidateResult,
} from "./proseAlignTypes.js";

function confirmationBlockerDiagnostics(diagnostics: readonly AlignDiagnostic[]): AlignDiagnostic[] {
  return diagnostics.filter((item) =>
    item.severity === "warning" &&
    (
      item.code === "view.split_required" ||
      item.code === "view.orphan_risk" ||
      item.code === "existing_approved.path_identity_conflict" ||
      item.code === "existing_approved.view_path_conflict" ||
      item.code === "section.artificial_line_grid" ||
      item.code.startsWith("section.source_mirror_")
    )
  );
}

export function buildValidateResult(input: {
  payload: AlignPayload | undefined;
  diagnostics: AlignDiagnostic[];
  phaseId: string;
  phaseCollection: string;
  commandInputPath?: string;
}): ValidateResult {
  const payloadPath = input.commandInputPath ?? suggestedAlignPayloadPath(input.phaseId);
  const errors = input.diagnostics.filter((item) => item.severity === "error");
  const confirmationBlockers = confirmationBlockerDiagnostics(input.diagnostics);
  const warnings = input.diagnostics.filter((item) => item.severity === "warning");
  const confirmationReady = errors.length === 0 && confirmationBlockers.length === 0;
  const semanticRules = alignSemanticRules(input.diagnostics);
  return {
    kind: "prose.align.validate.result",
    schema_version: ALIGN_GATE_SCHEMA_VERSION,
    payload_schema: STRUCTURE_SCHEMA_VERSION,
    state: errors.length > 0
      ? "invalid"
      : confirmationReady
        ? "ready"
        : "repair-required",
    valid: confirmationReady,
    error_free: errors.length === 0,
    phase_collection: input.phaseCollection,
    collections: [...new Set(input.payload?.views.map((view) => view.collection) ?? [])].sort(),
    nodes: input.payload?.nodes.length ?? 0,
    views: input.payload?.views.length ?? 0,
    edges: input.payload?.edges.length ?? 0,
    unresolved: input.payload?.unresolved.length ?? 0,
    lifecycle_state: input.payload?.lifecycle.state ?? "unknown",
    structure_digest: input.payload?.structure_digest ?? digest({}),
    diagnostics: input.diagnostics,
    diagnostics_view: {
      total: input.diagnostics.length,
      page_size: 25,
      command: alignCommand(input.phaseId, ["--view", "diagnostics", "--input", payloadPath, "--format", "json"]),
    },
    repair_hints: repairHints(input.diagnostics, input.phaseId),
    allowed_actions: errors.length > 0
      ? ["repair_payload", "view_evidence"]
      : confirmationReady
        ? ["stage_structure"]
        : ["repair_confirmation_blockers", "view_evidence"],
    confirmation_ready: confirmationReady,
    confirmation_blockers: confirmationBlockers,
    warning_lifecycle: {
      scope: "align-quality",
      count: warnings.length,
      blocking_count: confirmationBlockers.length,
      disposition: confirmationBlockers.length > 0
        ? "blocks-structure-confirmation"
        : "pending-structure-confirmation",
      verify_scope: "not-carried-to-verify",
    },
    next_action: errors.length === 0 && confirmationBlockers.length > 0
      ? {
          kind: "repair_confirmation_blockers",
          command: alignCommand(input.phaseId, [
            "--validate",
            "--input",
            payloadPath,
            "--format",
            "json",
          ]),
          reason_code: "prose-align-confirmation-blocked",
          confirmation_blockers: confirmationBlockers,
          message:
            "Revise only the remaining non-mechanical blockers from the diagnostics and validate again.",
        }
      : errors.length === 0
      ? {
          kind: "stage_structure",
          effect: "write",
          command: alignCommand(input.phaseId, [
            "--stage",
            "--input",
            payloadPath,
            "--format",
            "json",
          ]),
          reason_code: "prose-align-structure-valid",
          message: "The structure is ready to stage.",
        }
      : {
          kind: "repair_payload",
          command: alignCommand(input.phaseId, ["--view", "read-plan", "--format", "json"]),
          reason_code: "prose-align-structure-invalid",
        },
    semantic_issue_families: [...PROSE_SEMANTIC_ISSUE_FAMILIES],
    semantic_rules: semanticRules,
    semantic_reference_files: semanticRules.required,
  };
}

export function withStructureReviewArtifacts(input: {
  result: ValidateResult;
  summary?: Record<string, unknown>;
  compact: Record<string, unknown>;
  report: Record<string, unknown>;
  notice: Record<string, unknown>;
}): ValidateResult {
  const { result } = input;
  return {
    kind: result.kind,
    schema_version: result.schema_version,
    payload_schema: result.payload_schema,
    state: result.state,
    valid: result.valid,
    error_free: result.error_free,
    phase_collection: result.phase_collection,
    collections: result.collections,
    nodes: result.nodes,
    views: result.views,
    edges: result.edges,
    unresolved: result.unresolved,
    lifecycle_state: result.lifecycle_state,
    structure_digest: result.structure_digest,
    review_notice: input.notice,
    structure_report: input.report,
    structure_summary_compact: input.compact,
    diagnostics: result.diagnostics,
    diagnostics_view: result.diagnostics_view,
    repair_hints: result.repair_hints,
    allowed_actions: result.allowed_actions,
    next_action: result.next_action,
    confirmation_ready: result.confirmation_ready,
    confirmation_blockers: result.confirmation_blockers,
    warning_lifecycle: result.warning_lifecycle,
    semantic_issue_families: result.semantic_issue_families,
    semantic_rules: result.semantic_rules,
    semantic_reference_files: result.semantic_reference_files,
    ...(result.self_healed !== undefined ? { self_healed: result.self_healed } : {}),
    ...(input.summary !== undefined ? { structure_summary: input.summary } : {}),
  };
}
