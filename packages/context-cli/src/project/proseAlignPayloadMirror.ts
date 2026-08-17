import { diagnostic } from "./proseAlignSchemaUtils.js";
import {
  nodeLocalSources,
  plannedSectionMirrorHint,
  type PlannedSectionMirrorHint,
} from "./proseCompileViews.js";
import type {
  AlignDiagnostic,
  AlignPayload,
  EvidenceContext,
} from "./proseAlignTypes.js";

type AlignMirrorValidationInput = {
  projectRoot: string;
  evidence: EvidenceContext;
};

function mirrorDiagnosticCode(status: PlannedSectionMirrorHint["status"]): string {
  if (status === "split_required") return "section.source_mirror_split_required";
  if (status === "source_ref_repair_required") return "section.source_mirror_repair_required";
  return "section.source_mirror_source_refs_missing";
}

function mirrorDiagnosticMessage(status: PlannedSectionMirrorHint["status"]): string {
  if (status === "split_required") {
    return "Section source_refs cannot be compiled as one source mirror; split this section before confirmation.";
  }
  if (status === "source_ref_repair_required") {
    return "Section source_refs do not resolve exactly against current evidence; repair them before confirmation.";
  }
  return "Source-bound section has no source_refs; add evidence refs, make a valid parent_index view, or move the unsupported item to unresolved.";
}

export async function addSectionMirrorDiagnostics(
  input: AlignMirrorValidationInput,
  payload: AlignPayload | undefined,
  diagnostics: AlignDiagnostic[],
): Promise<void> {
  if (payload === undefined) return;
  const blocking = payload.lifecycle.state === "confirmed" || payload.lifecycle.state === "frozen";
  for (const [viewIndex, view] of payload.views.entries()) {
    if (view.sections.length === 0 && view.generated === "parent_index") continue;
    const localSources = nodeLocalSources(view);
    for (const [sectionIndex, section] of view.sections.entries()) {
      const hint = await plannedSectionMirrorHint({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        section,
        localSources,
      });
      if (hint.status === "mirrorable") continue;
      diagnostics.push(diagnostic(
        blocking ? "error" : "warning",
        mirrorDiagnosticCode(hint.status),
        "source_ref",
        mirrorDiagnosticMessage(hint.status),
        `views[${viewIndex}].sections[${sectionIndex}].source_refs`,
        {
          candidate_id: section.section_ref,
          repair: {
            action: hint.action,
            view_ref: view.view_ref,
            node_ref: view.node_ref,
            section_id: section.id,
            reason: hint.reason,
            local_action_source_refs: hint.local_action_source_refs,
            ...(hint.unresolved_source_refs !== undefined ? { unresolved_source_refs: hint.unresolved_source_refs } : {}),
            ...(hint.suggested_splits !== undefined ? { suggested_splits: hint.suggested_splits } : {}),
          },
        },
      ));
    }
  }
}
