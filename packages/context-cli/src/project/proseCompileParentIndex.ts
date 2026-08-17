import {
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  type CompileProsePhaseDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import {
  compileBatchNextAction,
  parentIndexCandidateRecord,
  writeCompileCandidates,
} from "./proseCompileCandidates.js";
import { COMPILE_GATE_SCHEMA_VERSION } from "./proseCompileConstants.js";
import { compileSemanticRules } from "./proseCompileSemanticRules.js";
import { compileDiagnostic } from "./proseCompileDiagnostics.js";
import type {
  CompileRunOptions,
  CompileRunResult,
  CompileValidateResult,
} from "./proseCompileTypes.js";
import { isParentIndexView } from "./parentIndexView.js";
import { selectedView } from "./proseCompileViewRequest.js";

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function parentIndexValidateResult(input: {
  diagnostics: AlignDiagnostic[];
  node: StructureViewPlan;
  phase: CompileProsePhaseDefinition;
  structure: AlignPayload;
}): CompileValidateResult {
  const semanticRules = compileSemanticRules({
    view: "node-context",
    structure: input.structure,
    node: input.node,
    parentIndex: true,
  });
  return {
    kind: "prose.compile.validate.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    payload_schema: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
    state: input.diagnostics.length === 0 ? "ready" : "invalid",
    valid: input.diagnostics.length === 0,
    view_ref: input.node.view_ref,
    actions: 0,
    views: 1,
    sections: 0,
    diagnostics: input.diagnostics,
    semantic_rules: semanticRules,
    semantic_reference_files: semanticRules.required,
    next_action: input.diagnostics.length === 0
      ? {
          kind: "stage_compile_batch",
          effect: "write",
          command: `context run ${input.phase.id} --stage --format json`,
        }
      : {
          kind: "inspect_node_context",
          command: `context run ${input.phase.id} --view node-context --source ${input.node.view_ref} --format json`,
        },
  };
}

export async function runParentIndexCompileRequest(input: {
  evidence: EvidenceContext;
  options: CompileRunOptions;
  phase: CompileProsePhaseDefinition;
  projectRoot: string;
  structure: AlignPayload;
}): Promise<CompileRunResult | undefined> {
  if (input.options.input !== undefined || input.options.source === undefined) return undefined;
  const node = selectedView(input.structure, input.options.source);
  if (!isParentIndexView({ structure: input.structure, view: node })) return undefined;
  const record = parentIndexCandidateRecord({ evidence: input.evidence, structure: input.structure, node });
  const diagnostics: AlignDiagnostic[] = record === undefined
    ? [compileDiagnostic("error", "parent_index.source_refs_missing", "source_ref", "Parent-index views require contains edges with source_refs before compile.", "view_ref", {
        repair: { action: "return_to_align_add_contains_edge_source_refs", view_ref: node.view_ref },
      })]
    : [];
  const result = parentIndexValidateResult({ phase: input.phase, node, diagnostics, structure: input.structure });
  if (input.options.stage !== true) return result;
  if (record === undefined) {
    throw userError("parent-index view is not valid for compile", {
      diagnostics,
      next: result.next_action,
    });
  }
  const candidates = await writeCompileCandidates({
    projectRoot: input.projectRoot,
    records: [record],
  });
  const nextAction = await compileBatchNextAction(input);
  return {
    kind: "prose.compile.stage.result",
    schema_version: COMPILE_GATE_SCHEMA_VERSION,
    views: 1,
    sections: 0,
    candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl",
    candidates,
    next_action: nextAction,
  };
}
