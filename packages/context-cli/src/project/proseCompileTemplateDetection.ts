const PLACEHOLDER_RE = /<\s*placeholder\s*>|<\s*\.\.\.\s*>|^\s*<[^>\n]+>\s*$|^\s*\.\.\.\s*$|\/\/\s*\.\.\.\s*$/iu;
const PURE_PLACEHOLDER_TOKEN_RE = /^(?:TODO|TBD|待补充|待完善|暂无|无详细)(?:\s*[：:，,。.\-]\s*)?$/iu;
const PLACEHOLDER_TOKEN_RE = /\b(?:TODO|TBD)\b/giu;
const EXPLICIT_PLACEHOLDER_RE = /<\s*placeholder\s*>/giu;
const ANGLE_ELLIPSIS_RE = /<\s*\.\.\.\s*>/gu;
const PURE_FUTURE_CONTENT_RE = /^(?:details?|content) (?:to be added|will be added|coming soon)\.?$|^(?:内容|详情)(?:待补充|稍后补充|即将补充|后续补充)[。.]?$/iu;
const FUTURE_CONTENT_MARKER_RE = /\b(?:details?|content) (?:to be added|will be added|coming soon)\b|(?:内容|详情)(?:待补充|稍后补充|即将补充|后续补充)/giu;
const SOURCE_OMISSION_RE = /(?:详见原文|见原文|参见原文|参见原始\s*(?:wiki|文档)?|see\s+(?:the\s+)?original(?:\s+(?:text|source|wiki))?|see\s+source)/iu;
const BARE_OMISSION_RE = /(?:^|[（(：:\s])(?:略|省略)(?:[）)]|$|[，,。.;；:：\s])/iu;
const SOURCE_PLACEHOLDER_CONTEXT_RE = /(?:源文档|原文|原始\s*(?:wiki|文档)|source)[^。\n.;；]{0,48}(?:占位|TBD|待补充|未补充|尚未补充)/iu;

export type CompileTemplateLikeReason =
  | "empty-content"
  | "placeholder-marker"
  | "generic-boilerplate"
  | "future-content-placeholder";

export interface CompileTemplateLikeMatch {
  reason: CompileTemplateLikeReason;
  rule_id: string;
  matched_text: string;
  phrase_span: [number, number];
  span_basis: "normalized_content";
  repair_hint: string;
}

interface CompileTemplatePattern {
  reason: CompileTemplateLikeReason;
  ruleId: string;
  pattern: RegExp;
  repairHint: string;
}

const BOILERPLATE_PATTERNS: CompileTemplatePattern[] = [
  {
    reason: "generic-boilerplate",
    ruleId: "directory-lead-in.en.this-section",
    pattern: /\bthis section (?:describes|covers|explains|summarizes)\b/iu,
    repairHint: "Remove the directory-style lead-in and write the source-backed fact directly.",
  },
  {
    reason: "generic-boilerplate",
    ruleId: "directory-lead-in.zh.this-section",
    pattern: /本(?:章节|小?节|文档|部分)(?:介绍|描述|讲解|说明|涵盖|讨论)/iu,
    repairHint: "删除“本节/本文介绍”这类目录性导语，直接写源文事实。",
  },
  {
    reason: "generic-boilerplate",
    ruleId: "directory-lead-in.zh.following-content",
    pattern: /以下内容(?:介绍|描述|讲解|说明|涵盖|讨论)/iu,
    repairHint: "删除“以下内容介绍”这类目录性导语，直接写源文事实。",
  },
  {
    reason: "generic-boilerplate",
    ruleId: "directory-lead-in.zh.this-part",
    pattern: /这一部分(?:介绍|描述|讲解|说明|涵盖|讨论)/iu,
    repairHint: "删除“这一部分介绍”这类目录性导语，直接写源文事实。",
  },
];

function normalizedContent(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function compileTemplateLikeReason(value: string): CompileTemplateLikeReason | undefined {
  const normalized = normalizedContent(value);
  if (normalized.length === 0) return "empty-content";
  if (PURE_PLACEHOLDER_TOKEN_RE.test(normalized)) return "placeholder-marker";
  if (PLACEHOLDER_RE.test(normalized)) return "placeholder-marker";
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.pattern.test(normalized))) return "generic-boilerplate";
  if (PURE_FUTURE_CONTENT_RE.test(normalized)) return "future-content-placeholder";
  return undefined;
}

function templateMatchForPattern(normalized: string, pattern: CompileTemplatePattern): CompileTemplateLikeMatch | undefined {
  const match = pattern.pattern.exec(normalized);
  if (match === null || match.index === undefined) return undefined;
  const matchedText = match[0] ?? "";
  return {
    reason: pattern.reason,
    rule_id: pattern.ruleId,
    matched_text: matchedText,
    phrase_span: [match.index, match.index + matchedText.length],
    span_basis: "normalized_content",
    repair_hint: pattern.repairHint,
  };
}

export function compileTemplateLikeMatches(value: string): CompileTemplateLikeMatch[] {
  const normalized = normalizedContent(value);
  const reason = compileTemplateLikeReason(normalized);
  if (reason === undefined) return [];
  if (reason === "generic-boilerplate") {
    return BOILERPLATE_PATTERNS
      .map((pattern) => templateMatchForPattern(normalized, pattern))
      .filter((match): match is CompileTemplateLikeMatch => match !== undefined);
  }
  if (reason === "empty-content") {
    return [{
      reason,
      rule_id: "empty-content",
      matched_text: "",
      phrase_span: [0, 0],
      span_basis: "normalized_content",
      repair_hint: "Write source-backed Section content before submitting the draft.",
    }];
  }
  return [{
    reason,
    rule_id: reason,
    matched_text: normalized.slice(0, 80),
    phrase_span: [0, Math.min(normalized.length, 80)],
    span_basis: "normalized_content",
    repair_hint: "Replace the placeholder marker with source-backed Section content.",
  }];
}

export function compileTemplatePlaceholderMarkers(value: string): string[] {
  const normalized = normalizedContent(value);
  const markers = new Set<string>();
  for (const match of normalized.matchAll(PLACEHOLDER_TOKEN_RE)) {
    markers.add(match[0]!.toUpperCase());
  }
  for (const match of normalized.matchAll(EXPLICIT_PLACEHOLDER_RE)) {
    markers.add(match[0]!.toLowerCase());
  }
  for (const match of normalized.matchAll(ANGLE_ELLIPSIS_RE)) {
    markers.add(match[0]!);
  }
  if (/^<[^>\n]+>$/u.test(normalized)) markers.add(normalized.toLowerCase());
  if (/^\.\.\.$/u.test(normalized)) markers.add("...");
  if (/\/\/\s*\.\.\.\s*$/u.test(normalized)) markers.add("//...");
  if (SOURCE_OMISSION_RE.test(normalized) || BARE_OMISSION_RE.test(normalized)) {
    markers.add("source-omission");
    markers.add("source-placeholder");
  }
  if (SOURCE_PLACEHOLDER_CONTEXT_RE.test(normalized)) {
    markers.add("source-placeholder");
  }
  return [...markers];
}

export function compileTemplateFutureContentMarkers(value: string): string[] {
  const normalized = normalizedContent(value);
  return [...new Set([...normalized.matchAll(FUTURE_CONTENT_MARKER_RE)].map((match) => match[0]!.toLowerCase()))];
}
