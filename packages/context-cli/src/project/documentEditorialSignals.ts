import { sensitiveSourceLiteralCandidates } from "./sensitiveSourceLiteral.js";

export type DocumentEditorialAction = "keep" | "repair" | "reshape" | "omit";
export type DocumentEditorialSignalConfidence = "high" | "review";

export const DOCUMENT_EDITORIAL_OMISSION_REASONS = [
  "unanswered-question",
  "empty-or-placeholder",
  "draft-without-decision",
  "duplicate-content",
  "obsolete-without-replacement",
  "volatile-reference",
  "sensitive-value-candidate",
  "conversion-artifact",
] as const;

export type DocumentEditorialOmissionReason = typeof DOCUMENT_EDITORIAL_OMISSION_REASONS[number];

export type DocumentEditorialSignalCode =
  | "unanswered-question-set"
  | "answered-question-set"
  | "empty-table-row"
  | "placeholder-content"
  | "wide-table"
  | "long-table-cell"
  | "raw-or-unlabeled-link"
  | "adjacent-links"
  | "volatile-query-url"
  | "strikethrough-only-block"
  | "brainstorm-without-decision"
  | "duplicate-fragment"
  | "unstable-owner-reference"
  | "sensitive-value-candidate"
  | "heading-hierarchy-invalid"
  | "heading-content-overloaded"
  | "markdown-syntax-damaged"
  | "conversion-artifact"
  | "mixed-facts-and-draft";

export interface DocumentEditorialSignal {
  code: DocumentEditorialSignalCode;
  line_start: number;
  line_end: number;
  recommended_action: DocumentEditorialAction | "request-input";
  confidence: DocumentEditorialSignalConfidence;
  omission_reason?: DocumentEditorialOmissionReason;
  detail: string;
}

interface LocalSignal extends Omit<DocumentEditorialSignal, "line_start" | "line_end" | "confidence"> {
  lineStart: number;
  lineEnd: number;
  confidence?: DocumentEditorialSignalConfidence;
}

const PLACEHOLDER_RE = /^(?:todo|tbd|wip|n\/?a|none|pending|placeholder|to be (?:decided|defined|completed)|待补充|待确认|未定|暂无)$/iu;
const DRAFT_RE = /(?:\b(?:should we|could we|maybe|idea|proposal|consider|todo|tbd)\b|是否需要|是否应该|是否可以考虑|要不要|可以考虑|后续考虑|待讨论|待确认)/iu;
const DECISION_RE = /(?:\b(?:decision|decided|chosen|current|adopted|approved|use|uses|must|will)\b|结论|决定|当前|采用|已确认|必须|应当)/iu;
const VOLATILE_QUERY_RE = /[?&](?:access_?token|signature|sig|expires?|session(?:_id)?|timestamp|start_time|end_time)=/iu;
const OWNER_RE = /(?:\b(?:owner|contact)\s*[:：]\s*@?[\p{Letter}\p{Number}._-]+|负责人\s*[:：]\s*@?[\p{Letter}\p{Number}._-]+)/iu;
const RAW_URL_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s<>)\]`]+/giu;

function addSignal(signals: LocalSignal[], signal: LocalSignal): void {
  if (signals.some((item) =>
    item.code === signal.code && item.lineStart === signal.lineStart && item.lineEnd === signal.lineEnd
  )) return;
  signals.push(signal);
}

function visibleLine(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s*)/u, "")
    .trim();
}

function isQuestion(value: string): boolean {
  const line = visibleLine(value);
  return line.length > 0 && /[?？]\s*$/u.test(line);
}

function isHeading(value: string): boolean {
  return /^#{1,6}\s+\S/u.test(value.trim());
}

function markdownLinkRanges(value: string): Array<{ start: number; end: number }> {
  return [...value.matchAll(/!?\[[^\]\n]*\]\((?:[^()\s]+|\([^)]*\))+\)/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function hasUrlAsLinkLabel(value: string): boolean {
  return [...value.matchAll(/!?\[([^\]\n]+)\]\((?:[^()\s]+|\([^)]*\))+\)/gu)]
    .some((match) => /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)/iu.test(match[1]!.trim()));
}

function hasAdjacentMarkdownLinks(value: string): boolean {
  return /\)\s*\[/u.test(value) && /\)\[/u.test(value.replace(/\s+/gu, ""));
}

export function documentEditorialSignalConfidence(
  code: DocumentEditorialSignalCode,
): DocumentEditorialSignalConfidence {
  switch (code) {
    case "empty-table-row":
    case "placeholder-content":
    case "wide-table":
    case "long-table-cell":
    case "raw-or-unlabeled-link":
    case "adjacent-links":
    case "duplicate-fragment":
    case "heading-hierarchy-invalid":
    case "heading-content-overloaded":
    case "markdown-syntax-damaged":
    case "conversion-artifact":
      return "high";
    default:
      return "review";
  }
}

function withoutFencedCode(lines: readonly string[]): string[] {
  let fence: "```" | "~~~" | undefined;
  return lines.map((line) => {
    const marker = /^\s*(```|~~~)/u.exec(line)?.[1] as "```" | "~~~" | undefined;
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      return "";
    }
    return fence === undefined ? line : "";
  });
}

function withoutInlineCode(value: string): string {
  return value.replace(/`[^`\n]*`/gu, (match) => " ".repeat(match.length));
}

function hasUnclosedFence(lines: readonly string[]): boolean {
  let fence: "```" | "~~~" | undefined;
  for (const line of lines) {
    const marker = /^\s*(```|~~~)/u.exec(line)?.[1] as "```" | "~~~" | undefined;
    if (marker === undefined) continue;
    if (fence === undefined) fence = marker;
    else if (fence === marker) fence = undefined;
  }
  return fence !== undefined;
}

function rawUrls(value: string): string[] {
  const ranges = markdownLinkRanges(value);
  return [...value.matchAll(RAW_URL_RE)]
    .filter((match) => !ranges.some((range) => match.index >= range.start && match.index < range.end))
    .map((match) => match[0]);
}

function tableCells(line: string): string[] {
  const normalized = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return normalized.split(/(?<!\\)\|/u).map((cell) => cell.trim());
}

function tableRanges(lines: readonly string[]): Array<{ start: number; end: number; rows: string[][] }> {
  const ranges: Array<{ start: number; end: number; rows: string[][] }> = [];
  let index = 0;
  while (index < lines.length) {
    if (!/^\s*\|?.+\|.+\|?\s*$/u.test(lines[index] ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    const rows: string[][] = [];
    while (index < lines.length && /^\s*\|?.+\|.+\|?\s*$/u.test(lines[index] ?? "")) {
      rows.push(tableCells(lines[index]!));
      index += 1;
    }
    const hasSeparator = rows.some((row) => row.every((cell) => /^:?-{3,}:?$/u.test(cell)));
    if (hasSeparator) ranges.push({ start, end: index - 1, rows });
  }
  return ranges;
}

function questionSignals(lines: readonly string[], signals: LocalSignal[]): void {
  const questionLines = lines.flatMap((line, index) => isQuestion(line) ? [index] : []);
  if (questionLines.length < 2) return;
  const answeredQuestions = questionLines.filter((questionLine) => {
    for (let index = questionLine + 1; index < lines.length; index += 1) {
      const candidate = lines[index] ?? "";
      const visible = visibleLine(candidate);
      if (visible.length === 0) continue;
      if (isHeading(candidate) || isQuestion(candidate)) return false;
      return !PLACEHOLDER_RE.test(visible);
    }
    return false;
  });
  if (answeredQuestions.length === 0) {
    addSignal(signals, {
      code: "unanswered-question-set",
      lineStart: questionLines[0]! + 1,
      lineEnd: questionLines.at(-1)! + 1,
      recommended_action: "omit",
      omission_reason: "unanswered-question",
      detail: "Multiple questions have no answer, decision, or next action in this section.",
    });
  } else if (answeredQuestions.length === questionLines.length) {
    addSignal(signals, {
      code: "answered-question-set",
      lineStart: questionLines[0]! + 1,
      lineEnd: questionLines.at(-1)! + 1,
      recommended_action: "reshape",
      detail: "Multiple answered questions can be organized as a concise FAQ without removing their answers.",
    });
  }
}

function tableSignals(lines: readonly string[], signals: LocalSignal[]): void {
  for (const table of tableRanges(lines)) {
    const dataRows = table.rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/u.test(cell)));
    const columns = Math.max(0, ...dataRows.map((row) => row.length));
    const complex = dataRows.some((row) => row.some((cell) =>
      /!\[[^\]]*\]\(|https?:\/\/|<br\s*\/?>|`[^`]+`|\n/u.test(cell) || cell.length > 120
    ));
    if (columns > 4 && complex) {
      addSignal(signals, {
        code: "wide-table",
        lineStart: table.start + 1,
        lineEnd: table.end + 1,
        recommended_action: "reshape",
        detail: `The table has ${columns} columns and complex cells; prefer an index plus detail entries.`,
      });
    }
    if (dataRows.some((row) => row.some((cell) => cell.length > 300))) {
      addSignal(signals, {
        code: "long-table-cell",
        lineStart: table.start + 1,
        lineEnd: table.end + 1,
        recommended_action: "reshape",
        detail: "At least one table cell exceeds 300 characters.",
      });
    }
    dataRows.forEach((row, rowIndex) => {
      if (row.length > 0 && row.every((cell) => cell.length === 0)) {
        addSignal(signals, {
          code: "empty-table-row",
          lineStart: table.start + rowIndex + 1,
          lineEnd: table.start + rowIndex + 1,
          recommended_action: "repair",
          detail: "The table contains an empty reader-visible row.",
        });
      }
    });
  }
}

function headingSignals(lines: readonly string[], signals: LocalSignal[]): void {
  let previousLevel = 0;
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+\S/u.exec(line.trim());
    if (match === null) return;
    const level = match[1]!.length;
    if (markdownLinkRanges(line).length >= 2 || /(?:^|\s)(?:[-*+] |\d+[.)] )/u.test(line.slice(match[0].length))) {
      addSignal(signals, {
        code: "heading-content-overloaded",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "repair",
        detail: "The heading contains multiple links or embedded list content that belongs in the Section body.",
      });
    }
    if (previousLevel > 0 && level > previousLevel + 1) {
      addSignal(signals, {
        code: "heading-hierarchy-invalid",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "repair",
        detail: `Heading level jumps from ${previousLevel} to ${level}.`,
      });
    }
    previousLevel = level;
  });
}

export function analyzeDocumentEditorialSignals(content: string): DocumentEditorialSignal[] {
  const rawLines = content.split(/\r?\n/u);
  const lines = withoutFencedCode(rawLines);
  const signals: LocalSignal[] = [];
  if (hasUnclosedFence(rawLines)) {
    addSignal(signals, {
      code: "markdown-syntax-damaged",
      lineStart: 1,
      lineEnd: Math.max(rawLines.length, 1),
      recommended_action: "repair",
      detail: "A fenced code block is not closed before the end of the Section.",
    });
  }
  questionSignals(lines, signals);
  tableSignals(lines, signals);
  headingSignals(lines, signals);

  const visible = lines.map(visibleLine).filter((line) => line.length > 0);
  const nonHeading = lines.filter((line) => !isHeading(line)).map(visibleLine).filter((line) => line.length > 0);
  if (nonHeading.length > 0 && nonHeading.every((line) => PLACEHOLDER_RE.test(line))) {
    addSignal(signals, {
      code: "placeholder-content",
      lineStart: 1,
      lineEnd: Math.max(lines.length, 1),
      recommended_action: "omit",
      omission_reason: "empty-or-placeholder",
      detail: "The section contains only placeholder content.",
    });
  }

  lines.forEach((line, index) => {
    const readerLine = withoutInlineCode(line);
    if (/\[[^\]\n]+\]\([^\)\n]*$/u.test(readerLine)) {
      addSignal(signals, {
        code: "markdown-syntax-damaged",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "repair",
        detail: "A Markdown link is missing its closing delimiter.",
      });
    }
    if (/<!--\s*(?:lark|docx|conversion|source)[^>]*-->/iu.test(readerLine)) {
      addSignal(signals, {
        code: "conversion-artifact",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "omit",
        omission_reason: "conversion-artifact",
        detail: "A source-conversion annotation remains in reader-visible content.",
      });
    }
    const urls = rawUrls(readerLine);
    if (urls.length > 0 || hasUrlAsLinkLabel(readerLine)) {
      addSignal(signals, {
        code: "raw-or-unlabeled-link",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "repair",
        detail: "A reader-visible URL has no descriptive link label.",
      });
    }
    if (hasAdjacentMarkdownLinks(readerLine)) {
      addSignal(signals, {
        code: "adjacent-links",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "repair",
        detail: "Adjacent Markdown links have no reader-visible separator or relationship label.",
      });
    }
    if (VOLATILE_QUERY_RE.test(readerLine)) {
      addSignal(signals, {
        code: "volatile-query-url",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "request-input",
        omission_reason: "volatile-reference",
        detail: "A URL appears to contain a session, signature, token, or time-bound query value.",
      });
    }
    if (sensitiveSourceLiteralCandidates(readerLine).length > 0) {
      addSignal(signals, {
        code: "sensitive-value-candidate",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "request-input",
        omission_reason: "sensitive-value-candidate",
        detail: "The line resembles a credential or sensitive value and requires explicit review.",
      });
    }
    if (OWNER_RE.test(readerLine)) {
      addSignal(signals, {
        code: "unstable-owner-reference",
        lineStart: index + 1,
        lineEnd: index + 1,
        recommended_action: "request-input",
        detail: "The content depends on a named individual instead of a stable responsibility.",
      });
    }
  });

  if (nonHeading.length > 0 && nonHeading.every((line) => /^~~[^~]+~~$/u.test(line))) {
    addSignal(signals, {
      code: "strikethrough-only-block",
      lineStart: 1,
      lineEnd: Math.max(lines.length, 1),
      recommended_action: "omit",
      omission_reason: "obsolete-without-replacement",
      detail: "The section contains only struck-through content and no current replacement.",
    });
  }

  const hasDraft = visible.some((line) => DRAFT_RE.test(line));
  const hasDecision = visible.some((line) => DECISION_RE.test(line));
  if (hasDraft && !hasDecision) {
    addSignal(signals, {
      code: "brainstorm-without-decision",
      lineStart: 1,
      lineEnd: Math.max(lines.length, 1),
      recommended_action: "omit",
      omission_reason: "draft-without-decision",
      detail: "The section contains proposals or open considerations without a recorded decision.",
    });
  } else if (hasDraft && hasDecision) {
    addSignal(signals, {
      code: "mixed-facts-and-draft",
      lineStart: 1,
      lineEnd: Math.max(lines.length, 1),
      recommended_action: "reshape",
      detail: "Stable statements and unresolved draft material are mixed in the same section.",
    });
  }

  return signals
    .map((signal) => ({
      code: signal.code,
      line_start: signal.lineStart,
      line_end: signal.lineEnd,
      recommended_action: signal.recommended_action,
      confidence: signal.confidence ?? documentEditorialSignalConfidence(signal.code),
      ...(signal.omission_reason === undefined ? {} : { omission_reason: signal.omission_reason }),
      detail: signal.detail,
    }))
    .sort((left, right) => left.line_start - right.line_start || left.code.localeCompare(right.code));
}

export function omissionReasonsForSignals(
  signals: readonly DocumentEditorialSignal[],
): Set<DocumentEditorialOmissionReason> {
  return new Set(signals.flatMap((signal) =>
    signal.recommended_action === "omit" && signal.omission_reason !== undefined
      ? [signal.omission_reason]
      : []
  ));
}
