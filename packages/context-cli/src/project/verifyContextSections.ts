import type { ProjectVerifyIssue } from "./verifyTypes.js";
import { parseLocalCodeSymbolSourceRef } from "./codeSymbolSourceRef.js";

const LOCAL_SPAN_SOURCE_REF = /^src-(\d+)(#span:.+)$/iu;

interface ContextSectionRef {
  value?: string;
  line: number;
}

export interface ApprovedContextSectionEvidence {
  refs: string[];
  line: number;
  id?: string;
  kind?: string;
  summary?: string;
  contentMode?: string;
  readerVisibleBody: string;
}

interface ContextSectionBlock {
  attrs: Record<string, string>;
  body: string;
  line: number;
}

const SUMMARY_JSON_BLOCK_RE = /<!--\s*context:summary\s*([\s\S]*?)\/context:summary\s*-->/giu;
const LEGACY_SUMMARY_BLOCK_RE = /<!--\s*context:summary\s*-->\s*[\s\S]*?<!--\s*\/context:summary\s*-->/giu;
const SOURCE_REFS_BLOCK_WITH_SEPARATOR_RE = /<!--\s*context:source_refs\s*[\s\S]*?\/context:source_refs\s*-->(?:\r?\n){2}/giu;
const AUDIT_BLOCK_WITH_SEPARATOR_RE = /<!--\s*context:audit\s*[\s\S]*?\/context:audit\s*-->(?:\r?\n){2}/giu;
const SUMMARY_JSON_BLOCK_WITH_SEPARATOR_RE = /<!--\s*context:summary\s*[\s\S]*?\/context:summary\s*-->(?:\r?\n){2}/giu;
const LEGACY_SUMMARY_BLOCK_WITH_SEPARATOR_RE = /<!--\s*context:summary\s*-->\s*[\s\S]*?<!--\s*\/context:summary\s*-->(?:\r?\n){2}/giu;

function htmlAttributeDecode(value: string): string {
  return value
    .replace(/&quot;/gu, "\"")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function parseAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-z_][a-z0-9_-]*)="([^"]*)"/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const key = match[1];
    const raw = match[2];
    if (key !== undefined && raw !== undefined) attrs[key] = htmlAttributeDecode(raw);
  }
  return attrs;
}

function contextSectionBlocks(content: string): ContextSectionBlock[] {
  const sections: ContextSectionBlock[] = [];
  const regex = /<!--\s*context:section\b([\s\S]*?)-->([\s\S]*?)(?:<!--\s*\/context:section\s*-->|$)/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    sections.push({
      attrs: parseAttrs(match[1] ?? ""),
      body: match[2] ?? "",
      line: content.slice(0, match.index).split(/\r?\n/u).length,
    });
  }
  return sections;
}

type SourceRefsBlockIssueCode =
  | "approved-section-source-refs-invalid"
  | "approved-section-source-refs-unsupported";

function sourceRefsBlockPayloads(body: string): Array<{
  refs: string[];
  error?: string;
  issueCode?: SourceRefsBlockIssueCode;
}> {
  const payloads: Array<{
    refs: string[];
    error?: string;
    issueCode?: SourceRefsBlockIssueCode;
  }> = [];
  const regex = /<!--\s*context:source_refs([\s\S]*?)\/context:source_refs\s*-->/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const raw = match[1] ?? "";
    if (!raw.startsWith("\n") && !raw.startsWith("\r\n")) {
      payloads.push({
        refs: [],
        error: "legacy inline context:source_refs blocks are unsupported",
        issueCode: "approved-section-source-refs-unsupported",
      });
      continue;
    }
    try {
      const parsed = JSON.parse(raw.trim()) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
        payloads.push({ refs: [], error: "context:source_refs must contain a JSON string array" });
        continue;
      }
      payloads.push({ refs: parsed as string[] });
    } catch {
      payloads.push({ refs: [], error: "context:source_refs must contain valid JSON" });
    }
  }
  return payloads;
}

function sourceRefsForSection(section: ContextSectionBlock): string[] {
  return [...new Set([
    ...(section.attrs.source_ref !== undefined ? [section.attrs.source_ref] : []),
    ...sourceRefsBlockPayloads(section.body).flatMap((payload) => payload.refs),
  ])];
}

function auditBlockPayloads(body: string): Array<{ value: unknown; error?: string }> {
  const payloads: Array<{ value: unknown; error?: string }> = [];
  const regex = /<!--\s*context:audit\s*([\s\S]*?)\/context:audit\s*-->/giu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    try {
      payloads.push({ value: JSON.parse((match[1] ?? "").trim()) as unknown });
    } catch {
      payloads.push({ value: undefined, error: "context:audit must contain valid JSON" });
    }
  }
  return payloads;
}

function stripLeadingSectionSeparator(value: string): string {
  if (value.startsWith("\r\n\r\n")) return value.slice(4);
  if (value.startsWith("\n\n")) return value.slice(2);
  return value;
}

function stripTrailingSectionSeparator(value: string): string {
  if (value.endsWith("\r\n\r\n")) return value.slice(0, -4);
  if (value.endsWith("\n\n")) return value.slice(0, -2);
  return value;
}

function readerVisibleSectionBody(body: string): string {
  const withoutMetadata = body
    .replace(SOURCE_REFS_BLOCK_WITH_SEPARATOR_RE, "")
    .replace(AUDIT_BLOCK_WITH_SEPARATOR_RE, "")
    .replace(SUMMARY_JSON_BLOCK_WITH_SEPARATOR_RE, "")
    .replace(LEGACY_SUMMARY_BLOCK_WITH_SEPARATOR_RE, "")
    .replace(/<!--\s*context:source_refs\s*[\s\S]*?\/context:source_refs\s*-->/giu, "")
    .replace(/<!--\s*context:audit\s*[\s\S]*?\/context:audit\s*-->/giu, "")
    .replace(SUMMARY_JSON_BLOCK_RE, "")
    .replace(LEGACY_SUMMARY_BLOCK_RE, "");
  return stripTrailingSectionSeparator(stripLeadingSectionSeparator(withoutMetadata));
}

function summaryBlockText(body: string): string | undefined {
  const jsonMatch = /<!--\s*context:summary\s*([\s\S]*?)\/context:summary\s*-->/iu.exec(body);
  const jsonRaw = jsonMatch?.[1]?.trim();
  if (jsonRaw !== undefined && jsonRaw.length > 0) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (typeof parsed === "string") return parsed.trim() || undefined;
      if (
        parsed !== null
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && typeof (parsed as { text?: unknown }).text === "string"
      ) {
        const text = (parsed as { text: string }).text.trim();
        return text.length > 0 ? text : undefined;
      }
    } catch {
      return undefined;
    }
  }
  const match = /<!--\s*context:summary\s*-->\s*([\s\S]*?)<!--\s*\/context:summary\s*-->/iu.exec(body);
  const raw = match?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.split(/\r?\n/u)
    .map((line) => line.replace(/^>\s?/u, ""))
    .join("\n")
    .trim();
}

function readerFacingSectionBody(body: string): string {
  return readerVisibleSectionBody(body).trim();
}

export function contextSectionsInMarkdown(content: string): ContextSectionRef[] {
  return approvedContextSectionsInMarkdown(content).flatMap((section) => {
    const refs = section.refs;
    return refs.length === 0
      ? [{ line: section.line }]
      : refs.map((value) => ({ value, line: section.line }));
  });
}

export function approvedContextSectionsInMarkdown(content: string): ApprovedContextSectionEvidence[] {
  return contextSectionBlocks(content).map((section) => {
    const summary = summaryBlockText(section.body);
    return {
      refs: sourceRefsForSection(section),
      line: section.line,
      ...(section.attrs.id !== undefined ? { id: section.attrs.id } : {}),
      ...(section.attrs.kind !== undefined ? { kind: section.attrs.kind } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(section.attrs.content_mode !== undefined ? { contentMode: section.attrs.content_mode } : {}),
      readerVisibleBody: readerVisibleSectionBody(section.body),
    };
  });
}

function sourceRefsInMarkdown(content: string): Array<{ value: string; line: number }> {
  return contextSectionsInMarkdown(content)
    .filter((section): section is { value: string; line: number } => section.value !== undefined);
}

export function sourceRefKinds(content: string): { hasSymbol: boolean; hasSpan: boolean } {
  let hasSymbol = false;
  let hasSpan = false;
  for (const ref of sourceRefsInMarkdown(content)) {
    if (parseLocalCodeSymbolSourceRef(ref.value) !== undefined) hasSymbol = true;
    if (LOCAL_SPAN_SOURCE_REF.test(ref.value)) hasSpan = true;
  }
  return { hasSymbol, hasSpan };
}

export function validateApprovedSectionMetadata(input: {
  relPath: string;
  content: string;
  issues: ProjectVerifyIssue[];
}): void {
  for (const section of contextSectionBlocks(input.content)) {
    const rawMode = section.attrs.content_mode;
    const refs = sourceRefsForSection(section);
    const sourceRefPayloads = sourceRefsBlockPayloads(section.body);
    for (const payload of sourceRefPayloads) {
      if (payload.error === undefined) continue;
      input.issues.push({
        severity: "error",
        code: payload.issueCode ?? "approved-section-source-refs-invalid",
        path: input.relPath,
        line: section.line,
        message: payload.error,
      });
    }
    if (sourceRefPayloads.length > 1) {
      input.issues.push({
        severity: "error",
        code: "approved-section-source-refs-duplicate",
        path: input.relPath,
        line: section.line,
        message: "approved context section must contain at most one context:source_refs block",
      });
    }
    if (rawMode === undefined && refs.some((ref) => LOCAL_SPAN_SOURCE_REF.test(ref))) {
      input.issues.push({
        severity: "error",
        code: "approved-section-content-mode-missing",
        path: input.relPath,
        line: section.line,
        message: "document context section must include content_mode",
      });
      continue;
    }
    const mode = rawMode ?? "verbatim";
    if (mode !== "verbatim" && mode !== "empty") {
      input.issues.push({
        severity: "error",
        code: "approved-section-content-mode-invalid",
        path: input.relPath,
        line: section.line,
        message: `context section content_mode must be verbatim or empty: ${mode}`,
      });
      continue;
    }
    if (section.attrs.content_source_digest !== undefined) {
      input.issues.push({
        severity: "error",
        code: "approved-section-content-source-digest-not-supported",
        path: input.relPath,
        line: section.line,
        message: "approved document sections must not persist content_source_digest",
      });
    }
    if (auditBlockPayloads(section.body).length > 0) {
      input.issues.push({
        severity: "error",
        code: "approved-section-audit-not-supported",
        path: input.relPath,
        line: section.line,
        message: "approved knowledge must not contain context:audit blocks; review audit is not reader-facing knowledge",
      });
    }
    if (mode === "empty" && readerFacingSectionBody(section.body).length > 0) {
      input.issues.push({
        severity: "error",
        code: "approved-empty-section-has-body",
        path: input.relPath,
        line: section.line,
        message: "empty context section must not contain reader-facing content",
      });
      continue;
    }
  }
}
