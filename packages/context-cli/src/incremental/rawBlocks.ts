import YAML from "yaml";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { normalizedEvidenceBodyHash } from "../evidence/blockIdentity.js";
import { normalizeMarkdown } from "../lib/normalize.js";
import { toHashId } from "./hash.js";

export interface RawBlock {
  block_id?: string;
  block_locator_id: string;
  kind: "root" | "paragraph" | "list_item" | "relation" | "code" | "table" | "quote";
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  block_hash: string;
  block_body_hash: string;
  text_preview: string;
  list_path?: string[];
  list_ordinal?: number;
  structural_parent_id?: string;
  is_oversized?: boolean;
}

const RELATION_HEADINGS = new Set([
  "parent",
  "parents",
  "children",
  "child",
  "related",
  "relations",
  "relation",
  "父级",
  "子级",
  "关联",
  "关系",
]);

export type RawBlockDiffStatus =
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "heading-renamed"
  | "unchanged"
  | "unknown-input";

export interface RawBlockDiff {
  status: RawBlockDiffStatus;
  before?: RawBlock;
  after?: RawBlock;
  reason: string;
}

interface HeadingState {
  level: number;
  title: string;
}

interface Chunk {
  kind: RawBlock["kind"];
  headingPath: string[];
  startLine: number;
  endLine: number;
  body: string;
  contentBody: string;
}

interface MdastPoint {
  line?: number;
}

interface MdastPosition {
  start?: MdastPoint;
  end?: MdastPoint;
}

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
  position?: MdastPosition;
}

export interface FenceState {
  marker: "`" | "~";
  length: number;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) out[key] = sortJson(child);
  }
  return out;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function slugSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "root";
}

function locatorPrefixFor(headingPath: readonly string[]): string {
  return headingPath.length > 0
    ? headingPath.map(slugSegment).join("/")
    : "root";
}

function parseCaptureFrontmatter(markdown: string): { title?: string; body: string } {
  const normalized = normalizeMarkdown(markdown);
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)?/u.exec(normalized);
  if (!match) return { body: normalized };
  let title: string | undefined;
  try {
    const parsed = YAML.parse(match[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rawTitle = (parsed as { title?: unknown }).title;
      if (typeof rawTitle === "string" && rawTitle.trim().length > 0) title = rawTitle.trim();
    }
  } catch {
    // Malformed user-authored frontmatter should not stop block extraction.
  }
  return { ...(title !== undefined ? { title } : {}), body: normalized };
}

function normalizeStructureLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

function isHeadingLine(line: string): RegExpExecArray | null {
  return /^(#{1,3})\s+(.+?)\s*#*\s*$/u.exec(line);
}

export function markdownFenceMarker(line: string): FenceState | null {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  if (!match?.[1]) return null;
  return { marker: match[1][0] as "`" | "~", length: match[1].length };
}

export function updateMarkdownFenceState(fence: FenceState | null, line: string): {
  fence: FenceState | null;
  matched: boolean;
} {
  const marker = markdownFenceMarker(line);
  if (!marker) return { fence, matched: false };
  if (fence === null) return { fence: marker, matched: true };
  if (marker.marker === fence.marker && marker.length >= fence.length) {
    return { fence: null, matched: true };
  }
  return { fence, matched: false };
}

export function isMarkdownIndentedCodeLine(line: string): boolean {
  return /^(?: {4,}| {0,3}\t)/u.test(line);
}

function relationKey(value: string): string {
  return value.trim().replace(/[:：]\s*$/u, "").toLowerCase();
}

function isRelationHeading(value: string | undefined): boolean {
  return value !== undefined && RELATION_HEADINGS.has(relationKey(value));
}

export function isRelationHeadingTitle(value: string | undefined): boolean {
  return isRelationHeading(value);
}

function relationLineSignal(line: string): string | null {
  const normalized = line
    .trim()
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/u, "")
    .replace(/^\*\*(.+?)\*\*/u, "$1");
  if (!/^(Parent|Parents|Children|Child|Related|Relations|Relation|父级|子级|关联|关系)\s*[:：]/iu.test(normalized)) {
    return null;
  }
  return normalizeStructureLine(normalized);
}

function isRelationLine(line: string): boolean {
  return relationLineSignal(line) !== null;
}

function dropTrailingRelationHeadings(headings: HeadingState[]): void {
  while (isRelationHeading(headings.at(-1)?.title)) {
    headings.pop();
  }
}

export function computeStructureHash(markdown: string): string {
  const parsed = parseCaptureFrontmatter(markdown);
  const signals: Array<{ kind: string; value: string }> = [];
  if (parsed.title) signals.push({ kind: "frontmatter-title", value: parsed.title });

  const headings: HeadingState[] = [];
  let fence: FenceState | null = null;
  for (const line of parsed.body.split("\n")) {
    const fenceUpdate = updateMarkdownFenceState(fence, line);
    if (fenceUpdate.matched) {
      fence = fenceUpdate.fence;
      continue;
    }
    if (fence !== null) continue;
    if (isMarkdownIndentedCodeLine(line)) continue;

    const heading = isHeadingLine(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = normalizeStructureLine(heading[2] ?? "");
      headings.splice(level - 1);
      headings[level - 1] = { level, title };
      if (level <= 2) {
        signals.push({ kind: `h${level}`, value: headings.slice(0, level).map((item) => item.title).join(" > ") });
      }
      continue;
    }
    const relationSignal = relationLineSignal(line);
    if (relationSignal) {
      signals.push({ kind: "relation-line", value: relationSignal });
      continue;
    }
  }

  return toHashId(JSON.stringify(signals));
}

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);
const SOFT_BLOCK_STANDALONE_CHARS = 200;
const SOFT_BLOCK_HARD_MAX_CHARS = 600;
const URL_LEAD_IN_HARD_MAX_CHARS = 1200;
const SUBHEADING_BLOCK_RE = /^#{4,6}\s+\S/u;
const FRONTMATTER_BLOCK_RE = /^---\n[\s\S]*\n---$/u;
const PLAIN_URL_RE = /^<?(?:https?:\/\/|www\.)[^\s>]+>?$/iu;
const MARKDOWN_REFERENCE_LINK_RE = /^\[[^\]\n]+\]:\s*<?(?:https?:\/\/|www\.)[^\s>]+>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/iu;
const MARKDOWN_INLINE_LINK_ONLY_RE = /^\[[^\n]+\]\(\s*<?(?:https?:\/\/|www\.)[^\s>)]*>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/iu;
const LIST_MARKER_RE = /^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/u;
const REFERENCE_LINE_RE = /^(?:\*\*)?(?:Parent|Parents|Children|Child|Related|Relations|Relation|See also|References?|Links?|Docs?|Documents?|父级|子级|关联|关系|相关文档|参考文档|相关链接|参考链接|相关|参见|参考|链接|文档)(?:\*\*)?\s*[:：]/iu;
const MARKER_QUOTE_RE = /^>\s*(?:outdated|deprecated|archived|last\s+updated(?:\s*[:：].*)?|english\s+version\s+tbd)\s*$/iu;
const LINK_TITLE_ONLY_RE = /^\[[^\]\n]+\][^\n:：;；。]{0,120}$/u;

function classifyChunk(lines: string[], headingPath: string[], mdastType?: string): RawBlock["kind"] {
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (nonEmpty.length === 0) return "paragraph";
  if (mdastType === "code") return "code";
  if (mdastType === "blockquote") return "quote";
  if (mdastType === "table") return "table";
  if (isRelationHeading(headingPath.at(-1)) || nonEmpty.some(isRelationLine)) return "relation";
  return headingPath.length === 0 ? "root" : "paragraph";
}

function flushChunk(input: {
  chunks: Chunk[];
  lines: string[];
  contentLines?: string[];
  headingPath: string[];
  startLine: number;
  endLine: number;
  mdastType?: string;
}): void {
  const body = input.lines.join("\n").trim();
  if (body.length === 0) return;
  const contentBody = (input.contentLines ?? input.lines).join("\n").trim();
  input.chunks.push({
    kind: classifyChunk(input.lines, input.headingPath, input.mdastType),
    headingPath: [...input.headingPath],
    startLine: input.startLine,
    endLine: input.endLine,
    body,
    contentBody,
  });
}

function textLength(value: string): number {
  return [...normalizeMarkdown(value).trim()].length;
}

function sameHeadingPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function chunkLines(chunk: Chunk): string[] {
  return chunk.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isFrontmatterChunk(chunk: Chunk): boolean {
  return chunk.headingPath.length === 0 && FRONTMATTER_BLOCK_RE.test(chunk.body.trim());
}

function isSubheadingChunk(chunk: Chunk): boolean {
  return SUBHEADING_BLOCK_RE.test(chunk.body.trim());
}

function isMarkerQuoteChunk(chunk: Chunk): boolean {
  return chunk.kind === "quote" && chunkLines(chunk).every((line) => MARKER_QUOTE_RE.test(line));
}

function stripListMarker(line: string): string {
  return line.trim().replace(LIST_MARKER_RE, "").trim();
}

function isReferenceLine(line: string): boolean {
  const normalized = stripListMarker(line);
  return REFERENCE_LINE_RE.test(normalized) ||
    PLAIN_URL_RE.test(normalized) ||
    MARKDOWN_REFERENCE_LINK_RE.test(normalized) ||
    MARKDOWN_INLINE_LINK_ONLY_RE.test(normalized);
}

function isReferenceOnlyChunk(chunk: Chunk): boolean {
  const lines = chunkLines(chunk);
  if (lines.length > 0 && lines.every(isReferenceLine)) return true;
  if (lines.length >= 2 && isReferenceLine(lines[0]!) && isReferenceLinkList(lines.slice(1))) return true;
  return isReferenceLinkList(lines);
}

function isReferenceLinkList(lines: readonly string[]): boolean {
  if (lines.length < 5 || !lines.every((line) => LIST_MARKER_RE.test(line.trim()))) return false;
  const stripped = lines.map(stripListMarker);
  const strongLinks = stripped.filter((line) =>
    MARKDOWN_INLINE_LINK_ONLY_RE.test(line) ||
    MARKDOWN_REFERENCE_LINK_RE.test(line) ||
    PLAIN_URL_RE.test(line)
  ).length;
  const weakLinkTitles = stripped.filter((line) => LINK_TITLE_ONLY_RE.test(line)).length;
  return strongLinks >= Math.max(3, Math.ceil(lines.length * 0.6)) &&
    strongLinks + weakLinkTitles === lines.length;
}

function isStandaloneUrlChunk(chunk: Chunk): boolean {
  const lines = chunkLines(chunk);
  return lines.length === 1 && PLAIN_URL_RE.test(lines[0]!);
}

function isLeadInChunk(chunk: Chunk): boolean {
  const lines = chunkLines(chunk);
  return lines.length > 0 && /[:：]\s*$/u.test(lines.at(-1)!);
}

function isHardBoundaryChunk(chunk: Chunk): boolean {
  return chunk.kind === "code" ||
    chunk.kind === "table" ||
    chunk.kind === "relation" ||
    isFrontmatterChunk(chunk) ||
    isMarkerQuoteChunk(chunk);
}

function mergeChunks(left: Chunk, right: Chunk): Chunk {
  const contentBody = [left.contentBody, right.contentBody]
    .filter((value) => value.length > 0)
    .join("\n\n");
  return {
    kind: left.kind === "root" && right.kind === "root" ? "root" : "paragraph",
    headingPath: [...left.headingPath],
    startLine: left.startLine,
    endLine: right.endLine,
    body: `${left.body}\n\n${right.body}`,
    contentBody,
  };
}

function shouldMergeChunks(left: Chunk, right: Chunk): boolean {
  if (!sameHeadingPath(left.headingPath, right.headingPath)) return false;
  if (isHardBoundaryChunk(left) || isHardBoundaryChunk(right)) return false;
  if (isSubheadingChunk(right)) return false;

  const leftIsReference = isReferenceOnlyChunk(left);
  const rightIsReference = isReferenceOnlyChunk(right);
  if (leftIsReference || rightIsReference) {
    if (leftIsReference && rightIsReference) {
      return textLength(left.body) + textLength(right.body) <= SOFT_BLOCK_HARD_MAX_CHARS;
    }
    if (isLeadInChunk(left) && isStandaloneUrlChunk(right)) {
      return textLength(left.body) + textLength(right.body) <= URL_LEAD_IN_HARD_MAX_CHARS;
    }
    return false;
  }

  const leftLength = textLength(left.body);
  const rightLength = textLength(right.body);
  if (right.kind === "quote" && leftLength + rightLength <= SOFT_BLOCK_HARD_MAX_CHARS) {
    return true;
  }
  if (!isSubheadingChunk(left) && !isLeadInChunk(left) && leftLength >= SOFT_BLOCK_STANDALONE_CHARS) {
    return false;
  }
  return leftLength + rightLength <= SOFT_BLOCK_HARD_MAX_CHARS;
}

function coalesceSoftChunks(chunks: readonly Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  let current: Chunk | null = null;
  for (const chunk of chunks) {
    if (current === null) {
      current = { ...chunk, headingPath: [...chunk.headingPath] };
      continue;
    }
    if (shouldMergeChunks(current, chunk)) {
      current = mergeChunks(current, chunk);
      continue;
    }
    out.push(current);
    current = { ...chunk, headingPath: [...chunk.headingPath] };
  }
  if (current !== null) out.push(current);
  return out;
}

function mdastLineRange(node: MdastNode): { startLine: number; endLine: number } | null {
  const startLine = node.position?.start?.line;
  const endLine = node.position?.end?.line;
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;
  if (startLine < 1 || endLine < startLine) return null;
  return { startLine, endLine };
}

function mdastPlainText(node: MdastNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(mdastPlainText).join("");
}

function headingTitleForNode(node: MdastNode, lines: readonly string[]): string {
  const range = mdastLineRange(node);
  if (range !== null) {
    const atxHeading = isHeadingLine(lines[range.startLine - 1] ?? "");
    if (atxHeading) return normalizeStructureLine(atxHeading[2] ?? "");
  }
  return normalizeStructureLine(mdastPlainText(node));
}

function preservedUserFrontmatterEndLine(lines: readonly string[]): number | null {
  if ((lines[0] ?? "").trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (!/^---\s*$/u.test(lines[index] ?? "")) continue;
    const frontmatter = lines.slice(1, index).join("\n");
    if (/^\s*source_id\s*:/mu.test(frontmatter) && /^\s*captured_at\s*:/mu.test(frontmatter)) return null;
    return index + 1;
  }
  return null;
}

function chunkRawBody(body: string): Chunk[] {
  const chunks: Chunk[] = [];
  const headings: HeadingState[] = [];
  const lines = body.split("\n");
  const tree = markdownProcessor.parse(body) as MdastNode;
  const preservedFrontmatterEndLine = preservedUserFrontmatterEndLine(lines);
  let pendingHeadingStartLine: number | null = null;

  const currentHeadingPath = (): string[] =>
    headings
      .filter((heading): heading is HeadingState => heading !== undefined)
      .map((heading) => heading.title);

  if (preservedFrontmatterEndLine !== null) {
    flushChunk({
      chunks,
      lines: lines.slice(0, preservedFrontmatterEndLine),
      headingPath: [],
      startLine: 1,
      endLine: preservedFrontmatterEndLine,
    });
  }

  const updateHeadingPath = (node: MdastNode): void => {
    const level = node.depth ?? 0;
    if (level < 1 || level > 3) return;
    const title = headingTitleForNode(node, lines);
    const relationParent = headings.at(-1);
    if (relationParent && isRelationHeading(relationParent.title) && level > relationParent.level) {
      dropTrailingRelationHeadings(headings);
    }
    headings.splice(level - 1);
    headings[level - 1] = { level, title };
  };

  for (const node of tree.children ?? []) {
    const range = mdastLineRange(node);
    if (range === null) continue;
    if (preservedFrontmatterEndLine !== null && range.startLine <= preservedFrontmatterEndLine) continue;
    if (node.type === "heading" && (node.depth ?? 0) >= 1 && (node.depth ?? 0) <= 3) {
      updateHeadingPath(node);
      // A heading is source text, not merely indexing metadata. Attach its
      // exact Markdown range to the first AST block it introduces without
      // interpreting the heading's subject or choosing a knowledge type.
      pendingHeadingStartLine ??= range.startLine;
      continue;
    }
    if (node.type === "thematicBreak") continue;

    const nodeLines = lines.slice(range.startLine - 1, range.endLine);
    const sourceStartLine = pendingHeadingStartLine ?? range.startLine;
    const sourceLines = lines.slice(sourceStartLine - 1, range.endLine);
    if (isRelationHeading(headings.at(-1)?.title) && !nodeLines.some(isRelationLine)) {
      dropTrailingRelationHeadings(headings);
    }
    flushChunk({
      chunks,
      lines: sourceLines,
      contentLines: nodeLines,
      headingPath: currentHeadingPath(),
      startLine: sourceStartLine,
      endLine: range.endLine,
      mdastType: node.type,
    });
    pendingHeadingStartLine = null;
  }
  if (pendingHeadingStartLine !== null) {
    flushChunk({
      chunks,
      lines: lines.slice(pendingHeadingStartLine - 1),
      contentLines: [],
      headingPath: currentHeadingPath(),
      startLine: pendingHeadingStartLine,
      endLine: lines.length,
    });
  }
  // Markdown AST nodes are often too small for evidence: a lead-in sentence,
  // its URL, and the following list can be separate paragraphs. Keep hard
  // structural boundaries, but coalesce short neighbor chunks into one citeable
  // evidence block so agents do not have to reconstruct local context by hand.
  return coalesceSoftChunks(chunks);
}

function makeBlock(chunk: Chunk, ordinal: number): RawBlock {
  const canonicalBody = normalizeMarkdown(chunk.body).trim();
  const canonicalContentBody = normalizeMarkdown(chunk.contentBody).trim();
  const headingPayload = chunk.headingPath.join(" > ");
  const locatorPrefix = locatorPrefixFor(chunk.headingPath);
  const blockLocatorId = `${locatorPrefix}:${chunk.kind}:${ordinal}`;
  return {
    block_locator_id: blockLocatorId,
    kind: chunk.kind,
    heading_path: chunk.headingPath,
    line_start: chunk.startLine,
    line_end: chunk.endLine,
    line_range: `L${chunk.startLine}-L${chunk.endLine}`,
    block_hash: toHashId(`${headingPayload}\n${chunk.kind}\n${canonicalBody}`),
    block_body_hash: normalizedEvidenceBodyHash(canonicalContentBody),
    text_preview: canonicalBody.replace(/\s+/g, " ").slice(0, 160),
  };
}

export function extractRawBlocks(markdown: string): RawBlock[] {
  const body = normalizeMarkdown(markdown);
  const chunks = chunkRawBody(body);
  const counters = new Map<string, number>();
  return chunks.map((chunk) => {
    const key = `${locatorPrefixFor(chunk.headingPath)}:${chunk.kind}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return makeBlock(chunk, next);
  });
}

function queueByHash(blocks: readonly RawBlock[], key: keyof Pick<RawBlock, "block_hash" | "block_body_hash">): Map<string, RawBlock[]> {
  const out = new Map<string, RawBlock[]>();
  for (const block of blocks) {
    out.set(block[key], [...(out.get(block[key]) ?? []), block]);
  }
  return out;
}

function takeMatch(map: Map<string, RawBlock[]>, hash: string, used: Set<RawBlock>): RawBlock | null {
  const candidates = map.get(hash) ?? [];
  const found = candidates.find((candidate) => !used.has(candidate));
  return found ?? null;
}

export function diffRawBlocks(
  before: readonly RawBlock[] | null | undefined,
  after: readonly RawBlock[] | null | undefined,
): RawBlockDiff[] {
  if (!before || !after) {
    return [{ status: "unknown-input", reason: "raw-block-baseline-missing" }];
  }

  const diffs: RawBlockDiff[] = [];
  const usedBefore = new Set<RawBlock>();
  const usedAfter = new Set<RawBlock>();
  const beforeByBlockHash = queueByHash(before, "block_hash");
  const beforeByBodyHash = queueByHash(before, "block_body_hash");
  const beforeByLocator = new Map(before.map((block) => [block.block_locator_id, block]));

  for (const next of after) {
    const previous = takeMatch(beforeByBlockHash, next.block_hash, usedBefore);
    if (!previous) continue;
    usedBefore.add(previous);
    usedAfter.add(next);
    const status = previous.block_locator_id === next.block_locator_id ? "unchanged" : "moved";
    diffs.push({
      status,
      before: previous,
      after: next,
      reason: status === "unchanged" ? "block-hash-unchanged" : "block-hash-moved",
    });
  }

  for (const next of after) {
    if (usedAfter.has(next)) continue;
    const previous = takeMatch(beforeByBodyHash, next.block_body_hash, usedBefore);
    if (!previous) continue;
    usedBefore.add(previous);
    usedAfter.add(next);
    const status = stableJson(previous.heading_path) === stableJson(next.heading_path) ? "moved" : "heading-renamed";
    diffs.push({
      status,
      before: previous,
      after: next,
      reason: status === "heading-renamed" ? "block-body-hash-heading-renamed" : "block-body-hash-moved",
    });
  }

  for (const next of after) {
    if (usedAfter.has(next)) continue;
    const previous = beforeByLocator.get(next.block_locator_id);
    if (!previous || usedBefore.has(previous)) continue;
    usedBefore.add(previous);
    usedAfter.add(next);
    diffs.push({ status: "changed", before: previous, after: next, reason: "locator-content-changed" });
  }

  for (const previous of before) {
    if (!usedBefore.has(previous)) {
      diffs.push({ status: "removed", before: previous, reason: "block-removed" });
    }
  }
  for (const next of after) {
    if (!usedAfter.has(next)) {
      diffs.push({ status: "added", after: next, reason: "block-added" });
    }
  }

  return diffs;
}
