import {
  createDocumentSourceSpan,
  formatCanonicalProseSourceRef,
  parseDocumentSourceLocator,
  parseSpanSourceRef,
} from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { resolveProseSourceRef } from "./documentEvidenceIndex.js";
import {
  alignEvidenceViewCommand,
  evidenceBudgets,
  parseNonNegativeOption,
  parsePositiveOption,
  parseRange,
  takeLinesByByteBudget,
} from "./proseAlignBudget.js";
import {
  alignCommand,
  commonEnvelope,
  suggestedAlignPayloadPath,
  type AlignViewResult,
  type EvidenceContext,
  type ProseEvidencePhase,
  type ProseAlignRunOptions,
} from "./proseAlignTypes.js";

interface SpanTextRequest {
  documentPath: string;
  lineStart: number;
  lineEnd: number;
  sourceRef?: string;
}

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function workspaceError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, message, {
    category: ErrorCategory.WorkspaceStateInvalid,
    ...detail,
  });
}

function snapshotLines(markdown: string): string[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split("\n");
  if (markdown.endsWith("\n")) lines.pop();
  return lines;
}

async function spanRequest(input: {
  phaseId: string;
  view: "span-text" | "span-detail";
  projectRoot: string;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): Promise<SpanTextRequest> {
  if (input.options.chunk !== undefined) {
    const chunk = input.evidence.chunks.find((candidate) => candidate.chunk_id === input.options.chunk);
    if (chunk === undefined) throw userError(`unknown reading chunk: ${input.options.chunk}`, {
      chunk: input.options.chunk,
      next: alignCommand(input.phaseId, ["--view", "chunks", "--format", "json"]),
    });
    return {
      documentPath: chunk.document_path,
      lineStart: chunk.line_start,
      lineEnd: chunk.line_end,
      sourceRef: chunk.source_ref,
    };
  }
  if (input.options.span !== undefined) {
    const parsed = parseSpanSourceRef(input.options.span);
    if (parsed?.locator === undefined) throw userError(`invalid span source_ref: ${input.options.span}`, {
      source_ref: input.options.span,
      diagnostics: [{
        severity: "error",
        code: "source_ref.invalid",
        family: "source_ref",
        message: "Use a canonical source_ref returned by chunks or source-mapping.",
      }],
      repair_hints: [{
        action: "copy_current_source_ref_from_source_mapping_view",
        command: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
      }],
      next: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
    });
    const locator = parseDocumentSourceLocator(parsed.locator);
    if (locator === null || locator.sourceType !== input.evidence.source.sourceType || locator.sourceName !== input.evidence.source.sourceName) {
      throw userError(`span source_ref does not belong to this align source: ${input.options.span}`, {
        source_ref: input.options.span,
        diagnostics: [{
          severity: "error",
          code: "source_ref.source_mismatch",
          family: "source_ref",
          message: "Use a source_ref from this align phase source.",
        }],
        repair_hints: [{
          action: "copy_current_source_ref_from_source_mapping_view",
          command: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
        }],
        next: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
      });
    }
    const resolved = await resolveProseSourceRef({
      projectRoot: input.projectRoot,
      index: input.evidence.index,
      sourceRef: input.options.span,
      snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
    });
    if (resolved === null) {
      throw userError(`span source_ref cannot be resolved against current snapshot: ${input.options.span}`, {
        source_ref: input.options.span,
        diagnostics: [{
          severity: "error",
          code: "source_ref.unresolved",
          family: "source_ref",
          message: "Use a current source_ref returned by chunks or source-mapping.",
        }],
        repair_hints: [{
          action: "copy_current_source_ref_from_source_mapping_view",
          command: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
        }],
        next: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
      });
    }
    if (resolved.status !== "exact") {
      const currentCommand = alignCommand(input.phaseId, [
        "--view",
        input.view,
        "--span",
        resolved.span.canonical_source_ref,
        "--format",
        "json",
      ]);
      throw userError(`span source_ref is stale against current snapshot: ${input.options.span}`, {
        source_ref: input.options.span,
        current_source_ref: resolved.span.canonical_source_ref,
        diagnostics: [{
          severity: "error",
          code: `source_ref.${resolved.status}`,
          family: "source_ref",
          message: "Use the current canonical source_ref before reading or staging prose evidence.",
          current_source_ref: resolved.span.canonical_source_ref,
        }],
        repair_hints: [{
          action: "replace_with_current_canonical_source_ref",
          current_source_ref: resolved.span.canonical_source_ref,
          command: currentCommand,
        }],
        next: currentCommand,
      });
    }
    return {
      documentPath: resolved.span.document_path,
      lineStart: resolved.span.line_start,
      lineEnd: resolved.span.line_end,
      sourceRef: resolved.span.canonical_source_ref,
    };
  }
  if (input.options.source !== undefined && input.options.range !== undefined) {
    const range = parseRange(input.options.range);
    const document = input.evidence.documents.find((candidate) =>
      candidate.document.path === input.options.source || candidate.locator === input.options.source
    );
    if (document === undefined) throw userError(`unknown source document: ${input.options.source}`, {
      source: input.options.source,
      next: alignCommand(input.phaseId, ["--view", "source-mapping", "--format", "json"]),
    });
    return {
      documentPath: document.document.path,
      lineStart: range.start,
      lineEnd: range.end,
    };
  }
  throw userError(`${input.view} view requires --chunk, --span, or --source plus --range`, {
    next: alignCommand(input.phaseId, ["--view", "chunks", "--format", "json"]),
  });
}

export async function spanText(input: {
  projectRoot: string;
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
  view?: "span-text" | "span-detail";
}): Promise<AlignViewResult> {
  const view = input.view ?? "span-text";
  const request = await spanRequest({
    phaseId: input.phase.id,
    view,
    projectRoot: input.projectRoot,
    evidence: input.evidence,
    options: input.options,
  });
  const document = input.evidence.documents.find((candidate) => candidate.document.path === request.documentPath);
  if (document === undefined) {
    throw workspaceError(`source document is missing from evidence: ${request.documentPath}`, {
      document_path: request.documentPath,
    });
  }
  const lines = snapshotLines(document.markdown);
  if (request.lineEnd > lines.length) {
    throw userError(`requested line range exceeds document length: L${request.lineStart}-${request.lineEnd}`, {
      document_path: request.documentPath,
      line_count: lines.length,
    });
  }
  const budgets = evidenceBudgets(input.options);
  const pageSize = parsePositiveOption(input.options.pageSize, "--page-size", 80);
  const offset = parseNonNegativeOption(input.options.readCursor ?? input.options.pageToken, "--read-cursor", 0);
  const total = request.lineEnd - request.lineStart + 1;
  if (offset >= total) {
    const restartCommand = alignEvidenceViewCommand({
      phaseId: input.phase.id,
      view,
      options: input.options,
      overrides: { pageToken: null, readCursor: null },
    });
    throw userError("--read-cursor is beyond the requested line range", {
      read_cursor: input.options.readCursor ?? input.options.pageToken,
      total,
      diagnostics: [{
        severity: "error",
        code: "cursor.expired",
        family: "cursor",
        message: "The read cursor no longer fits the requested span.",
      }],
      repair_hints: [{
        action: "restart_span_text_without_cursor",
        reason: `The source span or requested range changed; request the current ${view} page again.`,
        command: restartCommand,
      }],
      next: restartCommand,
    });
  }
  const pageStart = request.lineStart + offset;
  const maxPageEnd = Math.min(request.lineEnd, pageStart + pageSize - 1);
  const byteWindow = takeLinesByByteBudget({
    lines,
    lineStart: pageStart,
    lineEnd: maxPageEnd,
    byteBudget: budgets.byteBudget,
  });
  const pageEnd = byteWindow.lineEnd;
  const hasMore = pageEnd < request.lineEnd;
  const nextOffset = offset + (pageEnd - pageStart + 1);
  const span = createDocumentSourceSpan(document.markdown, {
    lineStart: request.lineStart,
    lineEnd: request.lineEnd,
  });
  const sourceRef = request.sourceRef ?? formatCanonicalProseSourceRef({
    sourceType: input.evidence.source.sourceType,
    sourceName: input.evidence.source.sourceName,
    documentPath: request.documentPath,
    span,
  });
  const nextCommand = alignCommand(input.phase.id, [
    "--view",
    view,
    "--span",
    sourceRef,
    "--page-size",
    String(pageSize),
    "--byte-budget",
    String(budgets.byteBudget),
    "--read-cursor",
    String(nextOffset),
    "--format",
    "json",
  ]);
  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view,
    span_text: {
      document_path: request.documentPath,
      locator: document.locator,
      source_ref: sourceRef,
      requested_line_range: `L${request.lineStart}-${request.lineEnd}`,
      requested_range_role: request.sourceRef === undefined ? "manual-read-range" : "evidence-span",
      line_range: `L${pageStart}-${pageEnd}`,
      range_role: "transport-page",
      section_candidate: false,
      text: lines.slice(pageStart - 1, pageEnd).join("\n"),
      page_size: pageSize,
      byte_budget: budgets.byteBudget,
      byte_used: byteWindow.byte_used,
      byte_truncated: byteWindow.byte_truncated,
      read_cursor: String(offset),
      has_more: hasMore,
      ...(hasMore ? {
        next_cursor: String(nextOffset),
        next_range: `L${request.lineStart + nextOffset}-${request.lineEnd}`,
        next_command: nextCommand,
      } : {}),
    },
    next_action: hasMore
      ? {
          kind: "read_next_page",
          command: nextCommand,
          reason_code: "prose-align-span-text-next-page",
        }
      : {
          kind: "validate_payload",
          command: alignCommand(input.phase.id, ["--validate", "--input", suggestedAlignPayloadPath(input.phase.id), "--format", "json"]),
          reason_code: "prose-align-ready-for-payload",
        },
  };
}
