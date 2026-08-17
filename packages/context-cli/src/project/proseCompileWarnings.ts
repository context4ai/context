import type { AlignDiagnostic } from "./proseAlignTypes.js";

const SUMMARY_MAX_CHARS = 100;
const PLACEHOLDER_SUMMARY_RE = /^(?:description|spec|warning|principle|decision|incident|example|changelog|comparison|faq)?\s*section\s+covering\s+\d+\s+evidence\s+(?:blocks?|spans?)\s*(?:\(s\))?\.?$/iu;

function warning(
  code: string,
  family: string,
  message: string,
  field: string,
  repair?: Record<string, unknown>,
): AlignDiagnostic {
  return {
    severity: "warning",
    code,
    family,
    message,
    field,
    ...(repair !== undefined ? { repair } : {}),
  };
}

export function compileSummaryDiagnostics(input: {
  summary: string;
  actionIndex: number;
}): AlignDiagnostic[] {
  const diagnostics: AlignDiagnostic[] = [];
  const field = `actions[${input.actionIndex}].summary`;
  const summary = input.summary.trim();
  if (summary.length === 0) return diagnostics;
  if (PLACEHOLDER_SUMMARY_RE.test(summary)) {
    diagnostics.push(warning(
      "action.summary_placeholder",
      "summary",
      "summary looks like a generated placeholder, not a reader/query summary.",
      field,
      {
        action: "replace_or_remove_summary",
        submitted_summary: summary,
        summary_policy: "summary is reader/query aid and must be meaningful; do not keep template placeholders",
      },
    ));
  }
  if (/\r|\n/u.test(summary) || /```|~~~|^#{1,6}\s|^\s*[-*+]\s/mu.test(summary)) {
    diagnostics.push(warning(
      "action.summary_format",
      "summary",
      "summary should be one plain paragraph without Markdown block formatting.",
      field,
      {
        action: "rewrite_summary_as_plain_paragraph",
        summary_policy: "keep lists, headings, and fenced code in section content",
      },
    ));
  }
  if (summary.length > SUMMARY_MAX_CHARS) {
    diagnostics.push(warning(
      "action.summary_too_long",
      "summary",
      `summary is ${summary.length} characters; keep summaries compact for query output.`,
      field,
      {
        action: "shorten_summary",
        summary_length: summary.length,
        recommended_max_summary_length: SUMMARY_MAX_CHARS,
      },
    ));
  }
  return diagnostics;
}
