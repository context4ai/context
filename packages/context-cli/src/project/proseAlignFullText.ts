import {
  createDocumentSourceSpan,
  formatCanonicalProseSourceRef,
} from "@c4a/extract";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
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

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function snapshotLines(markdown: string): string[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split("\n");
  if (markdown.endsWith("\n")) lines.pop();
  return lines;
}

function lineRange(input: {
  requested?: string;
  lineCount: number;
}): { start: number; end: number } {
  if (input.requested === undefined) {
    return { start: 1, end: input.lineCount };
  }
  const parsed = parseRange(input.requested);
  if (parsed.end > input.lineCount) {
    throw userError(`requested line range exceeds document length: L${parsed.start}-${parsed.end}`, {
      line_count: input.lineCount,
      range: input.requested,
    });
  }
  return parsed;
}

function documentChoices(evidence: EvidenceContext): Array<Record<string, unknown>> {
  return evidence.documents.map(({ document, locator, token_estimate }) => ({
    document_path: document.path,
    locator,
    title: document.title,
    line_count: document.line_count,
    token_estimate,
  }));
}

export function fullTextDocumentCommand(
  phaseId: string,
  documentPath: string,
): string {
  return alignCommand(phaseId, [
    "--view",
    "full-text",
    "--source",
    documentPath,
    "--page-size",
    "120",
    "--format",
    "json",
  ]);
}

export function fullTextDocumentPlan(
  phaseId: string,
  evidence: EvidenceContext,
  source?: string,
): Array<{ document_path: string; command: string }> {
  return evidence.documents.filter(({ document, locator }) =>
    source === undefined || document.path === source || locator === source
  ).map(({ document }) => ({
    document_path: document.path,
    command: fullTextDocumentCommand(phaseId, document.path),
  }));
}

export function sourceBodyFilePlan(
  evidence: EvidenceContext,
  source?: string,
): Array<{
  document_path: string;
  path: string;
  digest: string;
  line_count: number;
}> {
  return evidence.documents.filter(({ document, locator }) =>
    source === undefined || document.path === source || locator === source
  ).map(({ document }) => ({
    document_path: document.path,
    path: `${evidence.source.materializedAt}/${document.path}`,
    digest: document.content_hash,
    line_count: document.line_count,
  }));
}

export function fullText(input: {
  phase: ProseEvidencePhase;
  evidence: EvidenceContext;
  options: ProseAlignRunOptions;
}): AlignViewResult {
  if (input.options.source === undefined) {
    const documents = documentChoices(input.evidence);
    const commandPlan = fullTextDocumentPlan(input.phase.id, input.evidence);
    const firstCommand = commandPlan[0]?.command;
    return {
      ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
      view: "full-text",
      full_text: {
        documents,
        command_plan: commandPlan,
        message: firstCommand === undefined
          ? "No source document body is available."
          : "Read each document body in order; follow each page's exact continuation command.",
      },
      next_action: firstCommand === undefined
        ? {
            kind: "validate_payload",
            command: alignCommand(input.phase.id, ["--validate", "--input", suggestedAlignPayloadPath(input.phase.id), "--format", "json"]),
            reason_code: "prose-align-ready-for-payload",
          }
        : {
            kind: "read_source_body",
            command: firstCommand,
            command_plan: commandPlan,
            reason_code: "prose-align-source-body-required",
          },
    };
  }

  const document = input.evidence.documents.find((candidate) =>
    candidate.document.path === input.options.source ||
    candidate.locator === input.options.source
  );
  if (document === undefined) {
    throw userError(`unknown source document: ${input.options.source}`, {
      source: input.options.source,
      documents: documentChoices(input.evidence),
      next: alignCommand(input.phase.id, ["--view", "source-mapping", "--format", "json"]),
    });
  }

  const lines = snapshotLines(document.markdown);
  const requested = lineRange({
    lineCount: lines.length,
    ...(input.options.range !== undefined ? { requested: input.options.range } : {}),
  });
  const budgets = evidenceBudgets(input.options);
  const pageSize = parsePositiveOption(input.options.pageSize, "--page-size", 120);
  const offset = parseNonNegativeOption(input.options.readCursor ?? input.options.pageToken, "--read-cursor", 0);
  const total = Math.max(0, requested.end - requested.start + 1);
  if (total === 0) {
    return {
      ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
      view: "full-text",
      full_text: {
        document_path: document.document.path,
        locator: document.locator,
        requested_line_range: "L0-0",
        line_range: "L0-0",
        text: "",
        page_size: pageSize,
        byte_budget: budgets.byteBudget,
        byte_used: 0,
        byte_truncated: false,
        read_cursor: "0",
        has_more: false,
      },
      next_action: {
        kind: "validate_payload",
        command: alignCommand(input.phase.id, ["--validate", "--input", suggestedAlignPayloadPath(input.phase.id), "--format", "json"]),
        reason_code: "prose-align-ready-for-payload",
      },
    };
  }
  if (offset >= total) {
    const restartCommand = alignEvidenceViewCommand({
      phaseId: input.phase.id,
      view: "full-text",
      options: input.options,
      overrides: { pageToken: null, readCursor: null },
    });
    throw userError("--read-cursor is beyond the requested document text", {
      read_cursor: input.options.readCursor ?? input.options.pageToken,
      total,
      diagnostics: [{
        severity: "error",
        code: "cursor.expired",
        family: "cursor",
        message: "The read cursor no longer fits the requested full-text view.",
      }],
      repair_hints: [{
        action: "restart_full_text_without_cursor",
        reason: "The source document or requested range changed; request the current full-text page again.",
        command: restartCommand,
      }],
      next: restartCommand,
    });
  }

  const pageStart = requested.start + offset;
  const maxPageEnd = Math.min(requested.end, pageStart + pageSize - 1);
  const byteWindow = takeLinesByByteBudget({
    lines,
    lineStart: pageStart,
    lineEnd: maxPageEnd,
    byteBudget: budgets.byteBudget,
  });
  const pageEnd = byteWindow.lineEnd;
  const nextOffset = offset + (pageEnd - pageStart + 1);
  const hasMore = pageEnd < requested.end;
  const span = createDocumentSourceSpan(document.markdown, {
    lineStart: pageStart,
    lineEnd: pageEnd,
  });
  const sourceRef = formatCanonicalProseSourceRef({
    sourceType: input.evidence.source.sourceType,
    sourceName: input.evidence.source.sourceName,
    documentPath: document.document.path,
    span,
  });
  const nextCommandArgs = [
    "--view",
    "full-text",
    "--source",
    document.document.path,
    ...(input.options.range !== undefined ? ["--range", input.options.range] : []),
    "--page-size",
    String(pageSize),
    "--byte-budget",
    String(budgets.byteBudget),
    "--read-cursor",
    String(nextOffset),
    "--format",
    "json",
  ];
  const nextCommand = alignCommand(input.phase.id, nextCommandArgs);
  const documentIndex = input.evidence.documents.indexOf(document);
  const nextDocument = input.options.range === undefined
    ? input.evidence.documents[documentIndex + 1]
    : undefined;
  const nextDocumentCommand = nextDocument === undefined
    ? undefined
    : fullTextDocumentCommand(input.phase.id, nextDocument.document.path);
  const remainingBodyCommand = input.options.range === undefined
    ? nextDocumentCommand
    : fullTextDocumentCommand(input.phase.id, document.document.path);

  return {
    ...commonEnvelope({ phase: input.phase, source: input.evidence.source }),
    view: "full-text",
    full_text: {
      document_path: document.document.path,
      locator: document.locator,
      source_ref: sourceRef,
      requested_line_range: `L${requested.start}-${requested.end}`,
      line_range: `L${pageStart}-${pageEnd}`,
      text: lines.slice(pageStart - 1, pageEnd).join("\n"),
      page_size: pageSize,
      byte_budget: budgets.byteBudget,
      byte_used: byteWindow.byte_used,
      byte_truncated: byteWindow.byte_truncated,
      read_cursor: String(offset),
      has_more: hasMore,
      delivery: {
        content_digest: document.document.content_hash,
        delivered_line_range: `L${pageStart}-${pageEnd}`,
        document_complete: !hasMore && input.options.range === undefined,
        remaining_documents: Math.max(0, input.evidence.documents.length - documentIndex - 1),
      },
      ...(hasMore ? {
        next_cursor: String(nextOffset),
        next_range: `L${requested.start + nextOffset}-${requested.end}`,
        next_command: nextCommand,
      } : {}),
    },
    next_action: hasMore
      ? {
          kind: "read_next_page",
          command: nextCommand,
          reason_code: "prose-align-full-text-next-page",
        }
      : remainingBodyCommand !== undefined
      ? {
          kind: input.options.range === undefined
            ? "read_next_document"
            : "read_full_document",
          command: remainingBodyCommand,
          reason_code: input.options.range === undefined
            ? "prose-align-source-body-next-document"
            : "prose-align-source-body-full-document-required",
        }
      : {
          kind: "validate_payload",
          command: alignCommand(input.phase.id, ["--validate", "--input", suggestedAlignPayloadPath(input.phase.id), "--format", "json"]),
          reason_code: "prose-align-ready-for-payload",
        },
  };
}
