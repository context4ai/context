import {
  type AlignDiagnostic,
} from "./proseAlignTypes.js";
import type { DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION } from "@c4a/context";
import type { SemanticRuleSet } from "./semanticRules.js";
import type { SemanticRulesViewResult } from "./semanticRulesView.js";
import type { DiagnosticsViewResult } from "./diagnosticsView.js";
import { COMPILE_GATE_SCHEMA_VERSION } from "./proseCompileConstants.js";
import {
  type CompileViewResult,
} from "./proseCompileViews.js";

export interface CompileRunOptions {
  view?: string;
  schema?: boolean;
  validate?: boolean;
  stage?: boolean;
  input?: string;
  source?: string;
  span?: string;
  readCursor?: string;
  pageSize?: string;
  pageToken?: string;
  rule?: string;
}

export interface CompileValidateResult {
  kind: "prose.compile.validate.result";
  schema_version: typeof COMPILE_GATE_SCHEMA_VERSION;
  state: "invalid" | "ready";
  valid: boolean;
  payload_schema?: typeof DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION;
  view_ref?: string;
  actions?: number;
  views: number;
  sections: number;
  diagnostics: AlignDiagnostic[];
  diagnostics_view?: Record<string, unknown>;
  next_action: Record<string, unknown>;
  semantic_rules?: SemanticRuleSet;
  semantic_reference_files?: SemanticRuleSet["required"];
}

export interface CompileStageResult {
  kind: "prose.compile.stage.result";
  schema_version: typeof COMPILE_GATE_SCHEMA_VERSION;
  views: number;
  sections: number;
  candidateFile: ".tmp/context-runtime/lifecycle/candidates.jsonl";
  candidates: {
    added: number;
    updated: number;
    unchanged: number;
    skippedRejected: number;
    replacedIdentityConflicts: number;
  };
  next_action: Record<string, unknown>;
}

export type CompileRunResult = CompileViewResult | CompileValidateResult | CompileStageResult | SemanticRulesViewResult | DiagnosticsViewResult;

export function isProseCompileRunResult(value: unknown): value is CompileRunResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    typeof value.kind === "string" &&
    value.kind.startsWith("prose.compile.");
}
