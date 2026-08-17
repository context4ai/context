import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AlignProsePhaseDefinition,
  CaptureFilePhaseDefinition,
  CaptureLarkPhaseDefinition,
  CompileProsePhaseDefinition,
} from "@c4a/context";
import {
  createDocumentSourceSpan,
  formatCanonicalProseSourceRef,
  type DocumentSourceType,
} from "@c4a/extract";
import { extractRawBlocks } from "../incremental/rawBlocks.js";
import { slugify } from "../lib/normalize.js";
import { estimateTokenCount } from "../lib/tokenBudget.js";
import { buildCommittedEvidenceIndex } from "./documentEvidenceIndex.js";
import { resolveDocumentPhaseSource } from "./documentRun.js";
import { assertDocumentSnapshotFresh } from "./documentSnapshotFreshness.js";
import { buildRawOutline, type AlignRelationHint } from "./proseAlignOutline.js";
import type {
  EvidenceChunk,
  EvidenceContext,
  EvidenceRelationRef,
  EvidenceWindow,
} from "./proseAlignTypes.js";

function snapshotLines(markdown: string): string[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split("\n");
  if (markdown.endsWith("\n")) lines.pop();
  return lines;
}

function textForRange(markdown: string, start: number, end: number): string {
  return snapshotLines(markdown).slice(start - 1, end).join("\n");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function locatorFor(input: { sourceType: DocumentSourceType; sourceName: string; documentPath: string }): string {
  return `${input.sourceType}:${input.sourceName}/${input.documentPath.split("/").map(encodeURIComponent).join("/")}`;
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function mechanicalStats(text: string): Pick<EvidenceChunk, "char_count" | "link_count" | "code_fence_count" | "table_row_count"> {
  return {
    char_count: text.length,
    link_count: countMatches(text, /\[[^\]]+\]\([^)]+\)|https?:\/\/\S+/gu),
    code_fence_count: countMatches(text, /^(?: {0,3})(?:`{3,}|~{3,})/gmu),
    table_row_count: text.split("\n").filter((line) => line.includes("|")).length,
  };
}

function relationTargetRefKind(href: string | undefined): EvidenceRelationRef["target_ref_kind"] {
  if (href === undefined || href.trim().length === 0) return "external_or_unknown";
  return /^[a-z][a-z0-9+.-]*:|^\/\//iu.test(href) ? "external_or_unknown" : "local_markdown";
}

function relationTargetSlugHint(target: { title: string; href?: string }): string | undefined {
  const href = target.href?.trim();
  if (href !== undefined && href.length > 0) {
    if (relationTargetRefKind(href) === "external_or_unknown") return undefined;
    const clean = href
      .split(/[?#]/u, 1)[0]
      ?.replace(/\\/gu, "/")
      .replace(/\/+$/u, "");
    const leaf = clean?.split("/").filter((part) => part.length > 0).at(-1);
    const stem = leaf?.replace(/\.md$/iu, "");
    if (stem !== undefined && stem.trim().length > 0) return slugify(stem);
    return undefined;
  }
  const titleSlug = slugify(target.title);
  return titleSlug === "untitled" ? undefined : titleSlug;
}

function relationLineSourceRef(input: {
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
  markdown: string;
  line: number;
}): string {
  const lineCount = Math.max(1, input.markdown.split(/\r?\n/u).length);
  const line = Math.max(1, Math.min(input.line, lineCount));
  const span = createDocumentSourceSpan(input.markdown, { lineStart: line, lineEnd: line });
  return formatCanonicalProseSourceRef({
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    documentPath: input.documentPath,
    span,
  });
}

function relationRefsForChunk(input: {
  hints: readonly AlignRelationHint[];
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
  markdown: string;
  lineStart: number;
  lineEnd: number;
}): EvidenceRelationRef[] {
  return input.hints
    .filter((hint) => hint.line >= input.lineStart && hint.line <= input.lineEnd)
    .flatMap((hint) => hint.targets.map((target) => {
      const targetHref = target.href?.trim();
      const targetSlugHint = relationTargetSlugHint(target);
      return {
        relation_kind: hint.kind,
        line: hint.line,
        line_range: `L${input.lineStart}-${input.lineEnd}`,
        source_ref: relationLineSourceRef({ ...input, line: hint.line }),
        quote: hint.quote,
        target_title: target.title,
        ...(targetHref !== undefined && targetHref.length > 0 ? { target_href: targetHref } : {}),
        target_ref_kind: relationTargetRefKind(targetHref),
        ...(targetSlugHint !== undefined ? { target_slug_hint: targetSlugHint } : {}),
      };
    }));
}

function relationRefsForDocument(input: {
  hints: readonly AlignRelationHint[];
  sourceType: DocumentSourceType;
  sourceName: string;
  documentPath: string;
  markdown: string;
}): EvidenceRelationRef[] {
  return input.hints.flatMap((hint) => hint.targets.map((target) => {
    const targetHref = target.href?.trim();
    const targetSlugHint = relationTargetSlugHint(target);
    return {
      relation_kind: hint.kind,
      line: hint.line,
      source_ref: relationLineSourceRef({ ...input, line: hint.line }),
      quote: hint.quote,
      target_title: target.title,
      ...(targetHref !== undefined && targetHref.length > 0 ? { target_href: targetHref } : {}),
      target_ref_kind: relationTargetRefKind(targetHref),
      ...(targetSlugHint !== undefined ? { target_slug_hint: targetSlugHint } : {}),
    };
  }));
}

function sameWindowBoundary(left: EvidenceChunk, right: EvidenceChunk): boolean {
  return left.document_path === right.document_path &&
    (left.heading_path[0] ?? "") === (right.heading_path[0] ?? "");
}

function uniqueHeadingPaths(chunks: readonly EvidenceChunk[]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const chunk of chunks) {
    const key = JSON.stringify(chunk.heading_path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk.heading_path);
  }
  return out;
}

function pushWindow(windows: EvidenceWindow[], group: readonly EvidenceChunk[]): void {
  const first = group[0];
  const last = group.at(-1);
  if (first === undefined || last === undefined) return;
  const headingPaths = uniqueHeadingPaths(group);
  windows.push({
    window_id: `window-${shortHash(`${first.document_path}:${first.chunk_id}:${last.chunk_id}`)}`,
    document_path: first.document_path,
    locator: first.locator,
    chunk_ids: group.map((chunk) => chunk.chunk_id),
    heading_path: first.heading_path,
    ...(headingPaths.length > 1 ? { heading_paths: headingPaths, multi_subsection: true } : {}),
    line_start: first.line_start,
    line_end: last.line_end,
    line_range: `L${first.line_start}-${last.line_end}`,
    source_refs: group.map((chunk) => chunk.source_ref),
    text_preview: group.map((chunk) => chunk.text_preview).join(" / ").slice(0, 320),
    token_estimate: group.reduce((sum, chunk) => sum + chunk.token_estimate, 0),
  });
}

function buildWindows(chunks: readonly EvidenceChunk[]): EvidenceWindow[] {
  const windows: EvidenceWindow[] = [];
  let current: EvidenceChunk[] = [];
  for (const chunk of chunks) {
    const previous = current.at(-1);
    if (previous !== undefined && !sameWindowBoundary(previous, chunk)) {
      pushWindow(windows, current);
      current = [];
    }
    current.push(chunk);
  }
  pushWindow(windows, current);
  return windows;
}

export async function loadProseEvidence(input: {
  projectRoot: string;
  phase: AlignProsePhaseDefinition | CompileProsePhaseDefinition | CaptureFilePhaseDefinition | CaptureLarkPhaseDefinition;
}): Promise<EvidenceContext> {
  const resolved = await resolveDocumentPhaseSource({ projectRoot: input.projectRoot, phase: input.phase });
  const indexResult = await buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: resolved.sourceType,
    sourceName: resolved.sourceName,
    materializedAt: resolved.entry.materializedAt,
    ...(resolved.entry.snapshot?.manifest !== undefined ? { manifestPath: resolved.entry.snapshot.manifest } : {}),
  });
  assertDocumentSnapshotFresh({
    projectRoot: input.projectRoot,
    sourceType: resolved.sourceType,
    sourceName: resolved.sourceName,
    entry: resolved.entry,
    manifest: indexResult.manifest,
  });
  const source = {
    sourceType: resolved.sourceType,
    sourceName: resolved.sourceName,
    materializedAt: resolved.entry.materializedAt,
    ...(resolved.entry.snapshot?.manifest !== undefined ? { manifestPath: resolved.entry.snapshot.manifest } : {}),
  };
  const documents: EvidenceContext["documents"] = [];
  const chunks: EvidenceChunk[] = [];

  for (const [documentIndex, document] of indexResult.index.documents.entries()) {
    const markdown = await readFile(join(input.projectRoot, indexResult.index.materialized_at, document.path), "utf8");
    const locator = locatorFor({
      sourceType: resolved.sourceType,
      sourceName: resolved.sourceName,
      documentPath: document.path,
    });
    const rawChunks = extractRawBlocks(markdown);
    const outline = buildRawOutline({
      sourceId: `${resolved.sourceType}:${resolved.sourceName}`,
      rawFile: document.path,
      markdown,
      blocks: rawChunks,
      sourceType: resolved.sourceType,
    });
    documents.push({
      document,
      markdown,
      locator,
      token_estimate: estimateTokenCount(markdown),
      heading_tree: outline.headings,
      relation_hints: relationRefsForDocument({
        hints: outline.relation_hints,
        sourceType: resolved.sourceType,
        sourceName: resolved.sourceName,
        documentPath: document.path,
        markdown,
      }),
    });
    const effectiveChunks = rawChunks.length > 0
      ? rawChunks
      : document.line_count > 0
        ? [{
            kind: "paragraph",
            heading_path: [],
            line_start: 1,
            line_end: document.line_count,
            text_preview: markdown.replace(/\s+/gu, " ").slice(0, 160),
          }]
        : [];
    for (const [chunkIndex, rawChunk] of effectiveChunks.entries()) {
      const lineStart = Math.max(1, Math.min(rawChunk.line_start, document.line_count));
      const lineEnd = Math.max(lineStart, Math.min(rawChunk.line_end, document.line_count));
      const text = textForRange(markdown, lineStart, lineEnd);
      const span = createDocumentSourceSpan(markdown, { lineStart, lineEnd });
      const sourceRef = formatCanonicalProseSourceRef({
        sourceType: resolved.sourceType,
        sourceName: resolved.sourceName,
        documentPath: document.path,
        span,
      });
      const relationHints = relationRefsForChunk({
        hints: outline.relation_hints,
        sourceType: resolved.sourceType,
        sourceName: resolved.sourceName,
        documentPath: document.path,
        markdown,
        lineStart,
        lineEnd,
      });
      chunks.push({
        chunk_id: `chunk-${documentIndex + 1}-${chunkIndex + 1}`,
        source_type: resolved.sourceType,
        source_name: resolved.sourceName,
        document_path: document.path,
        locator,
        kind: rawChunk.kind,
        boundary_role: "markdown-ast-block",
        section_candidate: true,
        heading_path: [...rawChunk.heading_path],
        line_start: lineStart,
        line_end: lineEnd,
        line_range: `L${lineStart}-${lineEnd}`,
        source_ref: sourceRef,
        text,
        text_preview: text.replace(/\s+/gu, " ").slice(0, 220),
        token_estimate: estimateTokenCount(text),
        ...mechanicalStats(text),
        ...(relationHints.length > 0 ? { relation_hints: relationHints } : {}),
      });
    }
  }

  return {
    source,
    index: indexResult.index,
    snapshotMarkdownCache: indexResult.snapshotMarkdownCache,
    documents,
    chunks,
    windows: buildWindows(chunks),
  };
}
