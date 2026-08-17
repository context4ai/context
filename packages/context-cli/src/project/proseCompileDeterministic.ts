import {
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  type CompileProsePhaseDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { isSafeEntityId } from "./entityId.js";
import {
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
} from "./proseAlignTypes.js";
import { COMPILE_GATE_SCHEMA_VERSION } from "./proseCompileConstants.js";
import type { CompileActionPayload } from "./proseCompileActionPayload.js";
import { compileDiagnostic } from "./proseCompileDiagnostics.js";
import {
  candidateRecord,
  compileBatchNextAction,
  parentIndexCandidateRecord,
  writeCompileCandidates,
} from "./proseCompileCandidates.js";
import { prepareActionSections } from "./proseCompileMaterialize.js";
import {
  type CompileRunOptions,
  type CompileStageResult,
  type CompileValidateResult,
} from "./proseCompileTypes.js";
import { existingApprovedNodeSections } from "./proseCompileViews.js";
import { isParentIndexView } from "./parentIndexView.js";

function deterministicCompilePayload(input: {
  node: AlignPayload["views"][number];
  existingSectionIds: ReadonlySet<string>;
}): CompileActionPayload {
  return {
    schema_version: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
    view_ref: input.node.view_ref,
    actions: input.node.sections.map((section) => ({
      op: input.existingSectionIds.has(section.id) ? "update" as const : "add" as const,
      section_id: section.id,
      kind: section.kind,
      ...(section.summary === undefined ? {} : { summary: section.summary }),
      source_refs: [...section.source_refs],
    })),
  };
}

async function prepareDeterministicCompileBatch(input: {
  evidence: EvidenceContext;
  projectRoot: string;
  structure: AlignPayload;
}): Promise<{
  diagnostics: AlignDiagnostic[];
  records: ReturnType<typeof candidateRecord>[];
  sections: number;
}> {
  const diagnostics: AlignDiagnostic[] = [];
  const records: ReturnType<typeof candidateRecord>[] = [];
  let sections = 0;

  for (const node of input.structure.views) {
    if (!isSafeEntityId(node.node_ref)) {
      diagnostics.push(compileDiagnostic(
        "error",
        "schema.node_ref_unsafe",
        "schema",
        "Confirmed structure node_ref is not a safe knowledge id.",
        `views[${node.view_ref}].node_ref`,
      ));
      continue;
    }

    if (isParentIndexView({ structure: input.structure, view: node })) {
      const record = parentIndexCandidateRecord({
        evidence: input.evidence,
        structure: input.structure,
        node,
      });
      if (record === undefined) {
        diagnostics.push(compileDiagnostic(
          "error",
          "parent_index.source_refs_missing",
          "source_ref",
          "Parent-index views require source-backed contains edges.",
          `views[${node.view_ref}]`,
        ));
      } else {
        records.push(record);
      }
      continue;
    }

    const existing = await existingApprovedNodeSections({
      projectRoot: input.projectRoot,
      node,
    });
    const prepared = await prepareActionSections({
      projectRoot: input.projectRoot,
      evidence: input.evidence,
      node,
      payload: deterministicCompilePayload({
        node,
        existingSectionIds: new Set(existing.sections.map((section) => section.id)),
      }),
    });
    diagnostics.push(...prepared.diagnostics);
    if (prepared.sections.length !== node.sections.length) continue;

    const candidateSections = prepared.sections.map((section) => section.section);
    records.push(candidateRecord({
      evidence: input.evidence,
      structure: input.structure,
      node,
      sections: candidateSections,
    }));
    sections += candidateSections.length;
  }

  return { diagnostics, records, sections };
}

export async function runDeterministicCompileBatch(input: {
  evidence: EvidenceContext;
  options: CompileRunOptions;
  phase: CompileProsePhaseDefinition;
  projectRoot: string;
  structure: AlignPayload;
}): Promise<CompileValidateResult | CompileStageResult> {
  const prepared = await prepareDeterministicCompileBatch(input);
  const errors = prepared.diagnostics.filter((item) => item.severity === "error");
  const result: CompileValidateResult = {
    kind: "prose.compile.validate.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    state: errors.length === 0 ? "ready" : "invalid",
    valid: errors.length === 0,
    views: prepared.records.length,
    sections: prepared.sections,
    diagnostics: prepared.diagnostics,
    diagnostics_view: {
      total: prepared.diagnostics.length,
      page_size: 25,
      command: `context run ${input.phase.id} --view diagnostics --format json`,
    },
    next_action: errors.length === 0
      ? {
          kind: "stage_compile_batch",
          effect: "write",
          command: `context run ${input.phase.id} --stage --format json`,
        }
      : {
          kind: "inspect_compile_diagnostics",
          command: `context run ${input.phase.id} --view diagnostics --format json`,
        },
  };
  if (input.options.stage !== true) return result;
  if (!result.valid) {
    throw new ContextError(ExitCode.UserError, "confirmed structure cannot be compiled deterministically", {
      category: ErrorCategory.UserInputInvalid,
      diagnostics: prepared.diagnostics,
      next: result.next_action,
    });
  }

  const candidates = await writeCompileCandidates({
    projectRoot: input.projectRoot,
    records: prepared.records,
  });
  return {
    kind: "prose.compile.stage.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    views: prepared.records.length,
    sections: prepared.sections,
    candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
    candidates,
    next_action: await compileBatchNextAction(input),
  };
}
