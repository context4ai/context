import { DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION } from "@c4a/context";
import type { AlignDiagnostic } from "./proseAlignTypes.js";
import { parseOptionalString, parseStringArray, reportUnknownFields } from "./proseAlignSchemaUtils.js";
import { compileDiagnostic, isRecord } from "./proseCompileDiagnostics.js";
import { compileSummaryDiagnostics } from "./proseCompileWarnings.js";

const ACTION_OPS = new Set(["add", "update", "skip"]);
const REWRITE_INTENTS = new Set(["rewrite", "translation", "reorganization"]);

export type CompileActionOp = "add" | "update" | "skip";

export interface CompileAction {
  op: CompileActionOp;
  section_id?: string;
  kind: string;
  summary?: string;
  source_refs: string[];
  content?: string;
  content_intent?: "rewrite" | "translation" | "reorganization";
  reason?: string;
}

export interface CompileActionPayload {
  schema_version: typeof DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION;
  view_ref: string;
  actions: CompileAction[];
}

interface ParsedCompileActionFields {
  op: string;
  kind: string;
  summary?: string;
  sectionId: string;
  refs: string[];
  reason?: string;
  content?: string;
  contentIntent?: string;
}

function parseCompileActionFields(
  raw: Record<string, unknown>,
  index: number,
  diagnostics: AlignDiagnostic[],
): ParsedCompileActionFields {
  reportUnknownFields(raw, ["op", "section_id", "kind", "summary", "source_refs", "content", "content_intent", "reason"], `actions[${index}]`, diagnostics);
  const reason = parseOptionalString(raw.reason, `actions[${index}].reason`, diagnostics);
  const summary = parseOptionalString(raw.summary, `actions[${index}].summary`, diagnostics);
  const content = parseOptionalString(raw.content, `actions[${index}].content`, diagnostics);
  const contentIntent = parseOptionalString(raw.content_intent, `actions[${index}].content_intent`, diagnostics);
  return {
    op: typeof raw.op === "string" ? raw.op.trim() : "",
    kind: typeof raw.kind === "string" ? raw.kind.trim() : "",
    ...(summary !== undefined ? { summary } : {}),
    sectionId: typeof raw.section_id === "string" ? raw.section_id.trim() : "",
    refs: parseStringArray(raw.source_refs, `actions[${index}].source_refs`, diagnostics),
    ...(reason !== undefined ? { reason } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(contentIntent !== undefined ? { contentIntent } : {}),
  };
}

function validateActionRequiredFields(
  fields: ParsedCompileActionFields,
  index: number,
  diagnostics: AlignDiagnostic[],
): void {
  if (!ACTION_OPS.has(fields.op)) {
    diagnostics.push(compileDiagnostic("error", "action.op_invalid", "schema", "Action op must be add, update, or skip.", `actions[${index}].op`));
  }
  if ((fields.op === "add" || fields.op === "update") && fields.sectionId.length === 0) {
    diagnostics.push(compileDiagnostic("error", "action.section_id_missing", "schema", "add/update actions require section_id from the confirmed structure.", `actions[${index}].section_id`));
  }
  if (fields.op !== "skip" && fields.kind.length === 0) diagnostics.push(compileDiagnostic("error", "action.kind_missing", "schema", "Reader-facing actions require kind.", `actions[${index}].kind`));
  if (fields.op !== "skip" && fields.summary !== undefined) {
    diagnostics.push(...compileSummaryDiagnostics({ summary: fields.summary, actionIndex: index }));
  }
  if (fields.op === "skip" && (fields.reason === undefined || fields.reason.trim().length === 0)) {
    diagnostics.push(compileDiagnostic("error", "action.skip_reason_missing", "schema", "skip actions require a source-bound reason.", `actions[${index}].reason`));
  }
}

function validateActionSourceRefs(
  fields: ParsedCompileActionFields,
  index: number,
  diagnostics: AlignDiagnostic[],
): void {
  if ((fields.op === "add" || fields.op === "update") && fields.refs.length === 0) {
    diagnostics.push(compileDiagnostic("error", "action.source_refs_missing", "source_ref", "add/update actions require source_refs[].", `actions[${index}].source_refs`));
  }
}

function validateActionRewriteIntent(
  fields: ParsedCompileActionFields,
  index: number,
  diagnostics: AlignDiagnostic[],
): void {
  if (fields.content !== undefined) {
    diagnostics.push(compileDiagnostic("error", "action.content_unsupported", "content", "Compile actions do not accept reader-visible content. Omit content so the CLI mirrors source spans, or return to align to split/reshape the section.", `actions[${index}].content`));
  }
  if (fields.contentIntent !== undefined && !REWRITE_INTENTS.has(fields.contentIntent)) {
    diagnostics.push(compileDiagnostic("error", "action.content_intent_invalid", "schema", "content_intent must be rewrite, translation, or reorganization.", `actions[${index}].content_intent`));
  }
  if (fields.contentIntent !== undefined) {
    diagnostics.push(compileDiagnostic("error", "action.content_intent_unsupported", "content", "Compile actions no longer accept rewrite intent. Approved knowledge is source-mirrored; split evidence in align instead of rewriting it here.", `actions[${index}].content_intent`));
  }
}

function compileActionFromFields(fields: ParsedCompileActionFields): CompileAction {
  const action: CompileAction = {
    op: ACTION_OPS.has(fields.op) ? fields.op as CompileActionOp : "skip",
    ...(fields.sectionId.length > 0 ? { section_id: fields.sectionId } : {}),
    kind: fields.kind || "body",
    ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
    source_refs: fields.refs,
  };
  if (fields.content !== undefined) action.content = fields.content;
  if (fields.contentIntent !== undefined && REWRITE_INTENTS.has(fields.contentIntent)) {
    action.content_intent = fields.contentIntent as NonNullable<CompileAction["content_intent"]>;
  }
  if (fields.reason !== undefined) action.reason = fields.reason;
  return action;
}

function parseCompileAction(
  raw: unknown,
  index: number,
  diagnostics: AlignDiagnostic[],
): CompileAction | undefined {
  if (!isRecord(raw)) {
    diagnostics.push(compileDiagnostic("error", "schema.action_object", "schema", "Each action must be an object.", `actions[${index}]`));
    return undefined;
  }
  const fields = parseCompileActionFields(raw, index, diagnostics);
  validateActionRequiredFields(fields, index, diagnostics);
  validateActionSourceRefs(fields, index, diagnostics);
  validateActionRewriteIntent(fields, index, diagnostics);
  return compileActionFromFields(fields);
}

export function parseCompilePayload(value: unknown): {
  payload?: CompileActionPayload;
  diagnostics: AlignDiagnostic[];
} {
  const diagnostics: AlignDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      diagnostics: [compileDiagnostic("error", "schema.payload_object", "schema", "Compile action payload must be an object.", "schema")],
    };
  }
  reportUnknownFields(value, ["schema_version", "view_ref", "actions"], "payload", diagnostics);
  if (value.schema_version !== DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION) {
    diagnostics.push(compileDiagnostic("error", "schema.version", "schema", `Payload schema_version must be ${DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION}.`, "schema_version"));
  }
  const viewRef = typeof value.view_ref === "string" ? value.view_ref.trim() : "";
  if (viewRef.length === 0) diagnostics.push(compileDiagnostic("error", "schema.view_ref_missing", "schema", "Payload must include view_ref.", "view_ref"));
  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  if (!Array.isArray(value.actions) || rawActions.length === 0) {
    diagnostics.push(compileDiagnostic("error", "schema.actions_missing", "schema", "Payload must include non-empty actions[].", "actions"));
  }
  const actions = rawActions.flatMap((raw, index) => {
    const action = parseCompileAction(raw, index, diagnostics);
    return action === undefined ? [] : [action];
  });
  return {
    payload: {
      schema_version: DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
      view_ref: viewRef,
      actions,
    },
    diagnostics,
  };
}
