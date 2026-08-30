import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { documentOptimizationPolicyDigest } from "./documentOptimizationConfig.js";
import {
  analyzeDocumentEditorialSignals,
  documentEditorialSignalConfidence,
  omissionReasonsForSignals,
  type DocumentEditorialAction,
  type DocumentEditorialOmissionReason,
  type DocumentEditorialSignal,
} from "./documentEditorialSignals.js";

const SPAN_REF_RE = /^src-\d+#span:/u;
const SECTION_RE = /<!--\s*context:section\b([\s\S]*?)-->([\s\S]*?)(?:<!--\s*\/context:section\s*-->|$)/giu;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export interface DocumentOptimizationFragment {
  fragment_id: string;
  view_ref: string;
  approved_path: string;
  section_id: string;
  source_ref: string;
  kind: string;
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  content: string;
  input_digest: string;
  context_digest: string;
  policy_digest: string;
  signals: DocumentEditorialSignal[];
  allowed_actions: DocumentEditorialAction[];
  keep_requires_assessment: boolean;
}

export interface DocumentOptimizationSectionState {
  input_digest: string;
  context_digest: string;
  policy_digest: string;
}

interface DocumentOptimizationStateMetadata {
  schema: "context.document-optimization-state.v1";
  sections: Record<string, DocumentOptimizationSectionState>;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fragmentIdentity(input: {
  approvedPath: string;
  sectionId: string;
}): string {
  return `opt-${sha256(`${input.approvedPath}\u0000${input.sectionId}`).slice(0, 24)}`;
}

function eligibleFile(file: ApprovedKnowledgeFile): boolean {
  if (
    file.relPath === "structure.yaml" ||
    file.relPath.startsWith("codegraph/") ||
    file.relPath.startsWith("codeindex/")
  ) return false;
  const frontmatter = parseKnowledgeFrontmatter(file.content);
  return frontmatter.generated !== true;
}

function fragmentsForFile(file: ApprovedKnowledgeFile): DocumentOptimizationFragment[] {
  if (!eligibleFile(file)) return [];
  const frontmatter = parseKnowledgeFrontmatter(file.content);
  const viewRef = typeof frontmatter.view_ref === "string" && frontmatter.view_ref.length > 0
    ? frontmatter.view_ref
    : file.relPath;
  return approvedContextSectionsInMarkdown(file.content).flatMap((section, sectionIndex) => {
    const sourceRef = section.refs.find((ref) => SPAN_REF_RE.test(ref));
    if (section.contentMode !== "verbatim" || sourceRef === undefined) return [];
    const sectionId = section.id ?? `section-${sectionIndex + 1}`;
    const content = section.readerVisibleBody;
    if (content.trim().length === 0) return [];
    const signals = analyzeDocumentEditorialSignals(content).map((signal) => ({
      ...signal,
      line_start: section.line + signal.line_start,
      line_end: section.line + signal.line_end,
    }));
    const lineStart = section.line + 1;
    const lineEnd = lineStart + content.split(/\r?\n/u).length - 1;
    const allowedActions: DocumentEditorialAction[] = ["keep", "repair", "reshape"];
    if (omissionReasonsForSignals(signals).size > 0) allowedActions.push("omit");
    return [{
      fragment_id: fragmentIdentity({ approvedPath: file.relPath, sectionId }),
      view_ref: viewRef,
      approved_path: file.relPath,
      section_id: sectionId,
      source_ref: sourceRef,
      kind: section.kind ?? "section",
      heading_path: [],
      line_start: lineStart,
      line_end: lineEnd,
      line_range: `${lineStart}-${lineEnd}`,
      content,
      input_digest: sha256(content),
      context_digest: sha256(JSON.stringify({ viewRef, sectionId, sourceRef })),
      policy_digest: documentOptimizationPolicyDigest(signals.map((signal) => signal.code)),
      signals,
      allowed_actions: allowedActions,
      keep_requires_assessment: signals.length > 0,
    } satisfies DocumentOptimizationFragment];
  });
}

export function collectDocumentOptimizationFragments(
  files: readonly ApprovedKnowledgeFile[],
): DocumentOptimizationFragment[] {
  const seenContent = new Set<string>();
  return files.flatMap(fragmentsForFile).sort((left, right) =>
    left.approved_path.localeCompare(right.approved_path) ||
    left.line_start - right.line_start ||
    left.fragment_id.localeCompare(right.fragment_id)
  ).map((fragment) => {
    const normalizedContent = fragment.content.trim().replace(/\s+/gu, " ").toLowerCase();
    const contentKey = sha256(normalizedContent);
    if (!seenContent.has(contentKey)) {
      seenContent.add(contentKey);
      return fragment;
    }
    if (normalizedContent.length < 120) return fragment;
    const signals: DocumentEditorialSignal[] = [...fragment.signals, {
      code: "duplicate-fragment",
      line_start: fragment.line_start,
      line_end: fragment.line_end,
      recommended_action: "omit",
      confidence: documentEditorialSignalConfidence("duplicate-fragment"),
      omission_reason: "duplicate-content",
      detail: "The same reader-visible content already appears in another eligible Section.",
    }];
    return {
      ...fragment,
      signals,
      allowed_actions: [...new Set([...fragment.allowed_actions, "omit" as const])],
    };
  });
}

function inlineCodeValues(value: string): string[] {
  const values: string[] = [];
  let previousEnd = -1;
  for (const match of value.matchAll(/`([^`\n]+)`/gu)) {
    const start = match.index;
    const content = match[1]!;
    if (start === previousEnd && values.length > 0) {
      values[values.length - 1] += content;
    } else {
      values.push(content);
    }
    previousEnd = start + match[0].length;
  }
  return values;
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function protectedValues(value: string): {
  destinations: string[];
  code: string[];
  numbers: string[];
  identifiers: string[];
} {
  return {
    destinations: sorted([
      ...[...value.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map((match) => match[1]!),
      ...[...value.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s)\]>`]+/giu)].map((match) => match[0]),
    ]),
    code: sorted([
      ...inlineCodeValues(value),
      ...[...value.matchAll(/```[^\n]*\n[\s\S]*?```/gu)].map((match) => match[0]),
    ]),
    numbers: sorted([...value.matchAll(/\b\d+(?:\.\d+)*(?:%|[a-zA-Z]+)?\b/gu)].map((match) => match[0])),
    identifiers: sorted([...value.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[_./:-][A-Za-z0-9]+)+\b/gu)]
      .map((match) => match[0])
      .filter((item) => !/^[a-z][a-z0-9+.-]*:\/\//iu.test(item))),
  };
}

function semanticTokens(value: string): Set<string> {
  return new Set([
    ...value.toLowerCase().matchAll(/[a-z][a-z0-9_.:/-]{1,}|[\p{Script=Han}]/gu),
  ].map((match) => {
    const token = match[0];
    return token.endsWith(":") && !token.includes("://") ? token.slice(0, -1) : token;
  }));
}

export function assertSafeDocumentOptimizationReplacement(
  fragment: DocumentOptimizationFragment,
  replacement: string,
): void {
  assertSafeDocumentEditorialDecision(fragment, "repair", replacement);
}

function assertReplacementShape(fragment: DocumentOptimizationFragment, replacement: string): void {
  if (replacement.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `optimized fragment cannot be empty: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (/<!--\s*\/?context:section\b|^---\s*$/imu.test(replacement)) {
    throw new ContextError(ExitCode.UserError, `optimized fragment cannot change lifecycle structure: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Edit only reader-visible Section content; keep frontmatter and Context section markers unchanged.",
    });
  }
}

function assertProtectedValues(fragment: DocumentOptimizationFragment, replacement: string): void {
  const before = protectedValues(fragment.content);
  const after = protectedValues(replacement);
  const destinationValues = new Set([...before.destinations, ...after.destinations]);
  const beforeCode = before.code.filter((value) => !destinationValues.has(value));
  const afterCode = after.code.filter((value) => !destinationValues.has(value));
  const addedExternalDestination = after.destinations.some((destination) =>
    !destination.startsWith("#") && !before.destinations.includes(destination)
  );
  const removedDestination = before.destinations.some((destination) => !after.destinations.includes(destination));
  if (
    addedExternalDestination ||
    removedDestination ||
    JSON.stringify(beforeCode) !== JSON.stringify(afterCode) ||
    JSON.stringify(before.numbers) !== JSON.stringify(after.numbers) ||
    JSON.stringify(before.identifiers) !== JSON.stringify(after.identifiers)
  ) {
    throw new ContextError(ExitCode.UserError, `optimized fragment changed protected destinations, code, numbers, or identifiers: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Preserve protected values exactly; change only the reader-visible organization around them.",
    });
  }
}

function similarityMetrics(before: string, after: string): {
  retained: number;
  introduced: number;
  lengthRatio: number;
} {
  const beforeTokens = semanticTokens(before);
  const afterTokens = semanticTokens(after);
  const common = [...beforeTokens].filter((token) => afterTokens.has(token)).length;
  return {
    retained: beforeTokens.size === 0 ? 1 : common / beforeTokens.size,
    introduced: afterTokens.size === 0
      ? 0
      : [...afterTokens].filter((token) => !beforeTokens.has(token)).length / afterTokens.size,
    lengthRatio: after.length / Math.max(before.length, 1),
  };
}

function assertRepairEnvelope(fragment: DocumentOptimizationFragment, replacement: string): void {
  const metrics = similarityMetrics(fragment.content, replacement);
  const labelsRawDestination = fragment.signals.some((signal) => signal.code === "raw-or-unlabeled-link");
  const maximumLengthRatio = labelsRawDestination ? 1.5 : 1.3;
  if (
    metrics.retained < 0.78 ||
    metrics.introduced > 0.12 ||
    metrics.lengthRatio < 0.7 ||
    metrics.lengthRatio > maximumLengthRatio
  ) {
    throw new ContextError(ExitCode.UserError, `optimized fragment exceeds the repair envelope: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      retained_similarity: metrics.retained,
      introduced_token_ratio: metrics.introduced,
      length_ratio: metrics.lengthRatio,
      next: "Use reshape for source-preserving structural reorganization, or keep the repair local.",
    });
  }
}

function assertReshapeEnvelope(fragment: DocumentOptimizationFragment, replacement: string): void {
  const metrics = similarityMetrics(fragment.content, replacement);
  if (metrics.retained < 0.68 || metrics.introduced > 0.2 || metrics.lengthRatio < 0.45 || metrics.lengthRatio > 2) {
    throw new ContextError(ExitCode.UserError, `optimized fragment exceeds the source-constrained reshape envelope: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      retained_similarity: metrics.retained,
      introduced_token_ratio: metrics.introduced,
      length_ratio: metrics.lengthRatio,
      next: "Reorganize only facts already present in this Section; do not summarize away constraints or introduce new claims.",
    });
  }
}

function assertResolvedHighConfidenceSignals(
  fragment: DocumentOptimizationFragment,
  replacement: string,
): void {
  const unresolved = analyzeDocumentEditorialSignals(replacement)
    .filter((signal) => documentEditorialSignalConfidence(signal.code) === "high");
  if (unresolved.length === 0) return;
  throw new ContextError(ExitCode.UserError, `optimized fragment still contains actionable editorial signals: ${fragment.fragment_id}`, {
    category: ErrorCategory.UserInputInvalid,
    signals: unresolved.map((signal) => ({
      code: signal.code,
      line_start: signal.line_start,
      line_end: signal.line_end,
    })),
    next: "Repair or reshape every remaining high-confidence readability issue in the effective Section before applying the decision; use keep with a Section-specific assessment only when the original signal is a genuine false positive.",
  });
}

export function assertSafeDocumentEditorialDecision(
  fragment: DocumentOptimizationFragment,
  action: Exclude<DocumentEditorialAction, "keep">,
  replacement?: string,
  reason?: DocumentEditorialOmissionReason,
): void {
  if (action === "omit") {
    const allowed = omissionReasonsForSignals(fragment.signals);
    if (reason === undefined || !allowed.has(reason)) {
      throw new ContextError(ExitCode.UserError, `document Section cannot be omitted with the supplied reason: ${fragment.fragment_id}`, {
        category: ErrorCategory.UserInputInvalid,
        allowed_reasons: [...allowed].sort(),
        next: allowed.size === 0
          ? "Keep or reshape this Section; request user input when its publication value is ambiguous."
          : "Use one omission reason returned by the current optimization plan.",
      });
    }
    if (fragment.signals.some((signal) => signal.recommended_action === "request-input")) {
      throw new ContextError(ExitCode.UserError, `document Section requires user input before omission: ${fragment.fragment_id}`, {
        category: ErrorCategory.UserInputInvalid,
        signals: fragment.signals.filter((signal) => signal.recommended_action === "request-input").map((signal) => signal.code),
        next: "Ask once for the unresolved publication decision; do not omit a sensitive or ambiguous Section automatically.",
      });
    }
    if (replacement !== undefined && replacement.trim().length > 0) {
      throw new ContextError(ExitCode.UserError, `omit decisions cannot include replacement prose: ${fragment.fragment_id}`, {
        category: ErrorCategory.UserInputInvalid,
      });
    }
    return;
  }
  if (replacement === undefined) {
    throw new ContextError(ExitCode.UserError, `${action} decisions require replacement prose: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  assertReplacementShape(fragment, replacement);
  assertProtectedValues(fragment, replacement);
  if (action === "repair") assertRepairEnvelope(fragment, replacement);
  else assertReshapeEnvelope(fragment, replacement);
  assertResolvedHighConfidenceSignals(fragment, replacement);
}

function inferredOmissionReason(fragment: DocumentOptimizationFragment): DocumentEditorialOmissionReason | undefined {
  return [...omissionReasonsForSignals(fragment.signals)].sort()[0];
}

function assertSafeInferredRevision(fragment: DocumentOptimizationFragment, replacement: string): void {
  if (replacement.trim().length === 0) {
    assertSafeDocumentEditorialDecision(fragment, "omit", undefined, inferredOmissionReason(fragment));
    return;
  }
  try {
    assertSafeDocumentEditorialDecision(fragment, "repair", replacement);
  } catch (repairError) {
    try {
      assertSafeDocumentEditorialDecision(fragment, "reshape", replacement);
    } catch {
      throw repairError;
    }
  }
}

function sectionRanges(content: string): Array<{
  sectionId: string;
  visibleBody: string;
  visibleStart: number;
  visibleEnd: number;
}> {
  const evidence = approvedContextSectionsInMarkdown(content);
  const ranges: Array<{ sectionId: string; visibleBody: string; visibleStart: number; visibleEnd: number }> = [];
  let match: RegExpExecArray | null;
  let index = 0;
  SECTION_RE.lastIndex = 0;
  while ((match = SECTION_RE.exec(content)) !== null) {
    const item = evidence[index];
    const rawBody = match[2] ?? "";
    if (item !== undefined) {
      const offset = rawBody.indexOf(item.readerVisibleBody);
      if (offset >= 0) {
        const rawBodyStart = match.index + match[0].indexOf(rawBody);
        const visibleStart = rawBodyStart + offset;
        ranges.push({
          sectionId: item.id ?? `section-${index + 1}`,
          visibleBody: item.readerVisibleBody,
          visibleStart,
          visibleEnd: visibleStart + item.readerVisibleBody.length,
        });
      }
    }
    index += 1;
  }
  return ranges;
}

function replaceSectionBody(input: {
  approvedPath: string;
  sectionId: string;
  body: string;
  replacements: ReadonlyMap<string, string>;
}): string {
  return input.replacements.get(fragmentIdentity({
    approvedPath: input.approvedPath,
    sectionId: input.sectionId,
  })) ?? input.body;
}

export function renderDocumentOptimizationPage(input: {
  file: ApprovedKnowledgeFile;
  replacements: ReadonlyMap<string, string>;
}): string {
  let content = input.file.content;
  for (const section of sectionRanges(input.file.content).sort((left, right) => right.visibleStart - left.visibleStart)) {
    const body = replaceSectionBody({
      approvedPath: input.file.relPath,
      sectionId: section.sectionId,
      body: section.visibleBody,
      replacements: input.replacements,
    });
    content = `${content.slice(0, section.visibleStart)}${body}${content.slice(section.visibleEnd)}`;
  }
  return content;
}

function frontmatterRecord(content: string): { record: Record<string, unknown>; body: string } | null {
  const match = FRONTMATTER_RE.exec(content);
  if (match?.[1] === undefined) return null;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    if (!isRecord(parsed)) return null;
    return { record: parsed, body: content.slice(match[0].length) };
  } catch {
    return null;
  }
}

function canonicalFrontmatter(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalFrontmatter(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalFrontmatter(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function withDocumentRevisionMetadata(input: {
  content: string;
  approvedPath: string;
  sections: ReadonlyMap<string, DocumentOptimizationSectionState>;
}): string {
  const parsed = frontmatterRecord(input.content);
  if (parsed === null) throw new ContextError(ExitCode.WorkspaceStateError, `approved knowledge has invalid frontmatter: ${input.approvedPath}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
  });
  parsed.record.context_revision = stateMetadata(input.sections);
  return `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`;
}

export function parseDocumentRevision(content: string): {
  sections: Map<string, DocumentOptimizationSectionState>;
  content: string;
} | null {
  const parsed = frontmatterRecord(content);
  if (parsed === null) return null;
  const sections = parseStateMetadata(parsed.record.context_revision);
  if (sections === null) return null;
  delete parsed.record.context_revision;
  return {
    sections,
    content: `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`,
  };
}

function sectionState(value: unknown): DocumentOptimizationSectionState | null {
  if (!isRecord(value)) return null;
  const digests = [value.input_digest, value.context_digest, value.policy_digest];
  if (!digests.every((item) => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item))) return null;
  return {
    input_digest: value.input_digest as string,
    context_digest: value.context_digest as string,
    policy_digest: value.policy_digest as string,
  };
}

function parseStateMetadata(value: unknown): Map<string, DocumentOptimizationSectionState> | null {
  if (!isRecord(value) || value.schema !== "context.document-optimization-state.v1" || !isRecord(value.sections)) {
    return null;
  }
  const sections = new Map<string, DocumentOptimizationSectionState>();
  for (const [sectionId, raw] of Object.entries(value.sections)) {
    const state = sectionState(raw);
    if (sectionId.length === 0 || state === null) return null;
    sections.set(sectionId, state);
  }
  return sections;
}

function stateMetadata(
  sections: ReadonlyMap<string, DocumentOptimizationSectionState>,
): DocumentOptimizationStateMetadata {
  return {
    schema: "context.document-optimization-state.v1",
    sections: Object.fromEntries([...sections.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function fragmentSectionState(fragment: DocumentOptimizationFragment): DocumentOptimizationSectionState {
  return {
    input_digest: fragment.input_digest,
    context_digest: fragment.context_digest,
    policy_digest: fragment.policy_digest,
  };
}

export function parseDocumentOptimizationKeepState(content: string): Map<string, DocumentOptimizationSectionState> {
  const parsed = frontmatterRecord(content);
  if (parsed === null) return new Map();
  return parseStateMetadata(parsed.record.context_optimization) ?? new Map();
}

export function withDocumentOptimizationKeepState(input: {
  content: string;
  approvedPath: string;
  sections: ReadonlyMap<string, DocumentOptimizationSectionState>;
}): string {
  const parsed = frontmatterRecord(input.content);
  if (parsed === null) throw new ContextError(ExitCode.WorkspaceStateError, `approved knowledge has invalid frontmatter: ${input.approvedPath}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
  });
  if (input.sections.size === 0) delete parsed.record.context_optimization;
  else parsed.record.context_optimization = stateMetadata(input.sections);
  return `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`;
}

export function inferDocumentRevisionReplacements(input: {
  file: ApprovedKnowledgeFile;
  revisionContent: string;
  revisionSections: ReadonlyMap<string, DocumentOptimizationSectionState>;
}): Map<string, string> | null {
  const baseSections = approvedContextSectionsInMarkdown(input.file.content);
  const revisionSections = approvedContextSectionsInMarkdown(input.revisionContent);
  const fragments = collectDocumentOptimizationFragments([input.file]);
  const replacements = new Map<string, string>();
  const revisionById = new Map(revisionSections.map((section, index) => [
    section.id ?? `section-${index + 1}`,
    section,
  ]));
  if (revisionById.size !== revisionSections.length) return null;
  for (const [sectionId] of input.revisionSections) {
    const index = baseSections.findIndex((section, sectionIndex) =>
      (section.id ?? `section-${sectionIndex + 1}`) === sectionId
    );
    if (index < 0) return null;
    const base = baseSections[index]!;
    const revision = revisionById.get(sectionId);
    if (revision === undefined) return null;
    if (
      base.id !== revision.id || base.contentMode !== revision.contentMode ||
      JSON.stringify(base.refs) !== JSON.stringify(revision.refs)
    ) return null;
    const fragment = fragments.find((item) => item.section_id === sectionId);
    if (fragment === undefined || revision.readerVisibleBody === fragment.content) continue;
    assertSafeInferredRevision(fragment, revision.readerVisibleBody);
    replacements.set(fragment.fragment_id, revision.readerVisibleBody);
  }
  const currentFrontmatter = frontmatterRecord(input.file.content);
  const revisionFrontmatter = frontmatterRecord(input.revisionContent);
  if (currentFrontmatter === null || revisionFrontmatter === null) return null;
  delete currentFrontmatter.record.context_optimization;
  delete revisionFrontmatter.record.context_optimization;
  if (canonicalFrontmatter(currentFrontmatter.record) !== canonicalFrontmatter(revisionFrontmatter.record)) return null;
  return replacements;
}
