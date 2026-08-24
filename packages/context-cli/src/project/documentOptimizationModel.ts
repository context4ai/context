import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractRawBlocks } from "../incremental/rawBlocks.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { DOCUMENT_OPTIMIZATION_POLICY } from "./documentOptimizationConfig.js";

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
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fragmentLines(body: string, start: number, end: number): string {
  return body.split(/\r?\n/u).slice(start - 1, end).join("\n");
}

function fragmentIdentity(input: {
  approvedPath: string;
  sectionId: string;
  locator: string;
}): string {
  return `opt-${sha256(`${input.approvedPath}\u0000${input.sectionId}\u0000${input.locator}`).slice(0, 24)}`;
}

function eligibleFile(file: ApprovedKnowledgeFile): boolean {
  if (file.relPath === "structure.yaml" || file.relPath.startsWith("codegraph/")) return false;
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
    return extractRawBlocks(section.readerVisibleBody).flatMap((block) => {
      const content = fragmentLines(section.readerVisibleBody, block.line_start, block.line_end);
      if (content.trim().length === 0) return [];
      const fragmentId = fragmentIdentity({
        approvedPath: file.relPath,
        sectionId,
        locator: block.block_locator_id,
      });
      const contextDigest = sha256(JSON.stringify({
        viewRef,
        sectionId,
        sourceRef,
        kind: block.kind,
        headingPath: block.heading_path,
      }));
      return [{
        fragment_id: fragmentId,
        view_ref: viewRef,
        approved_path: file.relPath,
        section_id: sectionId,
        source_ref: sourceRef,
        kind: block.kind,
        heading_path: block.heading_path,
        line_start: section.line + block.line_start - 1,
        line_end: section.line + block.line_end - 1,
        line_range: `${section.line + block.line_start - 1}-${section.line + block.line_end - 1}`,
        content,
        input_digest: sha256(content),
        context_digest: contextDigest,
        policy_digest: sha256(DOCUMENT_OPTIMIZATION_POLICY),
      } satisfies DocumentOptimizationFragment];
    });
  });
}

export function collectDocumentOptimizationFragments(
  files: readonly ApprovedKnowledgeFile[],
): DocumentOptimizationFragment[] {
  return files.flatMap(fragmentsForFile).sort((left, right) =>
    left.approved_path.localeCompare(right.approved_path) ||
    left.line_start - right.line_start ||
    left.fragment_id.localeCompare(right.fragment_id)
  );
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

function protectedValues(value: string): { urls: string[]; code: string[]; numbers: string[] } {
  return {
    urls: [...value.matchAll(/(?:https?:\/\/|mailto:)[^\s)\]>]+/gu)].map((match) => match[0]),
    code: [
      ...inlineCodeValues(value),
      ...[...value.matchAll(/```[^\n]*\n[\s\S]*?```/gu)].map((match) => match[0]),
    ],
    numbers: [...value.matchAll(/\b\d+(?:\.\d+)*\b/gu)].map((match) => match[0]),
  };
}

function semanticTokens(value: string): Set<string> {
  return new Set([
    ...value.toLowerCase().matchAll(/[a-z][a-z0-9_.:/-]{1,}|[\p{Script=Han}]/gu),
  ].map((match) => match[0]));
}

export function assertSafeDocumentOptimizationReplacement(
  fragment: DocumentOptimizationFragment,
  replacement: string,
): void {
  if (replacement.trim().length === 0) {
    throw new ContextError(ExitCode.UserError, `optimized fragment cannot be empty: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
    });
  }
  if (JSON.stringify(protectedValues(fragment.content)) !== JSON.stringify(protectedValues(replacement))) {
    throw new ContextError(ExitCode.UserError, `optimized fragment changed protected URLs, code, or numbers: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      next: "Preserve protected tokens exactly and limit the edit to formatting, Markdown repair, or an obvious typo.",
    });
  }
  const beforeTokens = semanticTokens(fragment.content);
  const afterTokens = semanticTokens(replacement);
  const common = [...beforeTokens].filter((token) => afterTokens.has(token)).length;
  const similarity = beforeTokens.size === 0 ? 1 : common / beforeTokens.size;
  const lengthRatio = replacement.length / Math.max(fragment.content.length, 1);
  if (similarity < 0.78 || lengthRatio < 0.7 || lengthRatio > 1.3) {
    throw new ContextError(ExitCode.UserError, `optimized fragment exceeds the conservative edit envelope: ${fragment.fragment_id}`, {
      category: ErrorCategory.UserInputInvalid,
      similarity,
      length_ratio: lengthRatio,
      next: "Keep the original meaning and ordering; make only local presentation repairs.",
    });
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

function replaceBodyFragments(input: {
  approvedPath: string;
  sectionId: string;
  body: string;
  replacements: ReadonlyMap<string, string>;
}): string {
  let body = input.body;
  const edits = extractRawBlocks(input.body).flatMap((block) => {
    const fragmentId = fragmentIdentity({
      approvedPath: input.approvedPath,
      sectionId: input.sectionId,
      locator: block.block_locator_id,
    });
    const value = input.replacements.get(fragmentId);
    if (value === undefined) return [];
    const lines = input.body.split(/\r?\n/u);
    const before = lines.slice(0, block.line_start - 1).join("\n");
    const target = lines.slice(block.line_start - 1, block.line_end).join("\n");
    const start = before.length + (block.line_start > 1 ? 1 : 0);
    return [{ start, end: start + target.length, value }];
  }).sort((left, right) => right.start - left.start);
  for (const edit of edits) body = `${body.slice(0, edit.start)}${edit.value}${body.slice(edit.end)}`;
  return body;
}

export function renderDocumentOptimizationPage(input: {
  file: ApprovedKnowledgeFile;
  replacements: ReadonlyMap<string, string>;
}): string {
  let content = input.file.content;
  for (const section of sectionRanges(input.file.content).sort((left, right) => right.visibleStart - left.visibleStart)) {
    const body = replaceBodyFragments({
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

function canonicalKnowledgeMarkdown(content: string): string | null {
  const parsed = frontmatterRecord(content);
  if (parsed === null) return null;
  return `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`;
}

export function withDocumentRevisionMetadata(input: {
  content: string;
  approvedPath: string;
  baseDigest: string;
}): string {
  const parsed = frontmatterRecord(input.content);
  if (parsed === null) throw new ContextError(ExitCode.WorkspaceStateError, `approved knowledge has invalid frontmatter: ${input.approvedPath}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
  });
  parsed.record.context_revision = input.baseDigest;
  return `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`;
}

export function parseDocumentRevision(content: string): {
  baseDigest: string;
  content: string;
} | null {
  const parsed = frontmatterRecord(content);
  const baseDigest = parsed?.record.context_revision;
  if (parsed === null || typeof baseDigest !== "string" || !/^[a-f0-9]{64}$/u.test(baseDigest)) return null;
  delete parsed.record.context_revision;
  return {
    baseDigest,
    content: `---\n${stringifyYaml(parsed.record).trimEnd()}\n---\n${parsed.body}`,
  };
}

export function inferDocumentRevisionReplacements(input: {
  file: ApprovedKnowledgeFile;
  revisionContent: string;
}): Map<string, string> | null {
  const baseSections = approvedContextSectionsInMarkdown(input.file.content);
  const revisionSections = approvedContextSectionsInMarkdown(input.revisionContent);
  if (baseSections.length !== revisionSections.length) return null;
  const fragments = collectDocumentOptimizationFragments([input.file]);
  const replacements = new Map<string, string>();
  for (let index = 0; index < baseSections.length; index += 1) {
    const base = baseSections[index]!;
    const revision = revisionSections[index]!;
    if (
      base.id !== revision.id || base.contentMode !== revision.contentMode ||
      JSON.stringify(base.refs) !== JSON.stringify(revision.refs)
    ) return null;
    const sectionId = base.id ?? `section-${index + 1}`;
    const sectionFragments = fragments.filter((fragment) => fragment.section_id === sectionId);
    if (sectionFragments.length === 0) continue;
    const baseBlocks = extractRawBlocks(base.readerVisibleBody).filter((block) =>
      fragmentLines(base.readerVisibleBody, block.line_start, block.line_end).trim().length > 0
    );
    const revisionBlocks = extractRawBlocks(revision.readerVisibleBody).filter((block) =>
      fragmentLines(revision.readerVisibleBody, block.line_start, block.line_end).trim().length > 0
    );
    if (baseBlocks.length !== sectionFragments.length || revisionBlocks.length !== sectionFragments.length) return null;
    for (let blockIndex = 0; blockIndex < sectionFragments.length; blockIndex += 1) {
      const fragment = sectionFragments[blockIndex]!;
      const replacement = fragmentLines(
        revision.readerVisibleBody,
        revisionBlocks[blockIndex]!.line_start,
        revisionBlocks[blockIndex]!.line_end,
      );
      if (replacement === fragment.content) continue;
      assertSafeDocumentOptimizationReplacement(fragment, replacement);
      replacements.set(fragment.fragment_id, replacement);
    }
  }
  const expected = canonicalKnowledgeMarkdown(renderDocumentOptimizationPage({
    file: input.file,
    replacements,
  }));
  const actual = canonicalKnowledgeMarkdown(input.revisionContent);
  if (expected === null || actual === null || expected !== actual) return null;
  return replacements;
}
