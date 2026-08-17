import type { CompileProsePhaseDefinition } from "@c4a/context";
import type {
  AlignDiagnostic,
  AlignPayload,
} from "./proseAlignTypes.js";

export function compileRepairNextAction(input: {
  phase: CompileProsePhaseDefinition;
  structure: AlignPayload;
  viewRef: string | undefined;
  diagnostics: readonly AlignDiagnostic[];
}): Record<string, unknown> {
  const shouldReadPlan = input.viewRef === undefined ||
    input.viewRef.length === 0 ||
    input.diagnostics.some((item) =>
      item.code === "schema.view_ref_missing" ||
      item.code === "schema.view_ref_unknown"
    );
  if (shouldReadPlan) {
    return {
      kind: "inspect_read_plan",
      command: `context run ${input.phase.id} --view read-plan --format json`,
      available_view_refs: input.structure.views.map((view) => view.view_ref),
    };
  }
  return {
    kind: "repair_compile_actions",
    command: `context run ${input.phase.id} --view node-context --source ${input.viewRef} --format json`,
  };
}
