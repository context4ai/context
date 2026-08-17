import type { CompileProsePhaseDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type {
  AlignPayload,
  EvidenceContext,
  StructureViewPlan,
} from "./proseAlignTypes.js";
import { viewResult } from "./proseCompileViews.js";
import { compileSemanticRules } from "./proseCompileSemanticRules.js";
import { semanticRulesView } from "./semanticRulesView.js";
import type { CompileRunResult } from "./proseCompileTypes.js";

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

export function selectedView(structure: AlignPayload, viewRef: string | undefined): StructureViewPlan {
  const node = viewRef === undefined
    ? structure.views[0]
    : structure.views.find((candidate) => candidate.view_ref === viewRef);
  if (node === undefined) {
    throw userError("compile view not found in confirmed structure", {
      view_ref: viewRef,
      available_view_refs: structure.views.map((candidate) => candidate.view_ref),
      next: "Use --view read-plan or --view node-context --source <view-ref> with an existing view_ref.",
    });
  }
  return node;
}

export async function runCompileViewRequest(input: {
  evidence: EvidenceContext;
  projectRoot: string;
  phase: CompileProsePhaseDefinition;
  structure: AlignPayload;
  view: string | undefined;
  source: string | undefined;
  rule: string | undefined;
  readCursor: string | undefined;
  pageSize: string | undefined;
}): Promise<CompileRunResult> {
  if (input.view !== "schema" && input.view !== "node-context" && input.view !== "read-plan" && input.view !== "blockers" && input.view !== "semantic-rules") {
    throw userError("unsupported compile view", {
      view: input.view,
      available_views: ["read-plan", "blockers", "node-context", "schema", "semantic-rules"],
      next: `context run ${input.phase.id} --view read-plan --format json`,
    });
  }
  if (input.view === "semantic-rules") {
    const node = input.source === undefined ? undefined : selectedView(input.structure, input.source);
    return semanticRulesView({
      rules: compileSemanticRules({
        view: node === undefined ? "read-plan" : "node-context",
        structure: input.structure,
        ...(node !== undefined ? { node } : {}),
      }),
      baseCommand: `context run ${input.phase.id}${input.source !== undefined ? ` --source ${input.source}` : ""}`,
      ...(input.rule !== undefined ? { ruleId: input.rule } : {}),
      ...(input.readCursor !== undefined ? { readCursor: input.readCursor } : {}),
      ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    });
  }
  if (input.view === "schema") {
    return await viewResult({ projectRoot: input.projectRoot, phase: input.phase, evidence: input.evidence, structure: input.structure, view: "schema" });
  }
  if (input.view === "node-context") {
    return await viewResult({
      projectRoot: input.projectRoot,
      phase: input.phase,
      evidence: input.evidence,
      structure: input.structure,
      view: "node-context",
      node: selectedView(input.structure, input.source),
    });
  }
  if (input.view === "blockers") {
    return await viewResult({ projectRoot: input.projectRoot, phase: input.phase, evidence: input.evidence, structure: input.structure, view: "blockers" });
  }
  return await viewResult({ projectRoot: input.projectRoot, phase: input.phase, evidence: input.evidence, structure: input.structure, view: "read-plan" });
}
