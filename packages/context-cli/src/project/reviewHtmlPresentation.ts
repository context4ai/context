import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSpanSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { parseCanonicalProseRef, type ReviewCandidateView } from "./reviewShared.js";
import { STRUCTURE_FILE } from "./proseCompileConstants.js";

export interface EdgePreview {
  type: string;
  from: string;
  to: string;
  sourceRefs: string[];
  confidence?: string;
  note?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function candidatePreview(candidate: ReviewCandidateView): string {
  if (candidate.snapshot === undefined) {
    return "Evidence unavailable. Restore the committed snapshot before approving this candidate.";
  }
  const markdown = candidate.snapshot.markdown ?? candidate.record.review.summary;
  return markdown.trim().slice(0, 1200);
}

export function candidateGroupKey(candidate: ReviewCandidateView): string {
  const proseRef = candidate.record.source_refs
    .map((ref) => ({ ref, parsed: parseCanonicalProseRef(ref) }))
    .find((entry): entry is { ref: string; parsed: NonNullable<ReturnType<typeof parseCanonicalProseRef>> } => entry.parsed !== null);
  if (proseRef !== undefined) {
    const span = parseSpanSourceRef(proseRef.ref);
    return [
      `${proseRef.parsed.sourceType}:${proseRef.parsed.sourceName}`,
      proseRef.parsed.documentPath,
      span?.heading_hint ?? "document",
    ].join(" / ");
  }
  const symbolSource = /^repo:([^#]+)#symbol:/u.exec(candidate.record.source_refs[0] ?? "")?.[1];
  if (symbolSource !== undefined) return `repo:${symbolSource} / symbols`;
  return `${candidate.record.module || "ungrouped"} / ${candidate.record.kind || "candidate"}`;
}

export function candidateGroupLabel(candidate: ReviewCandidateView): string {
  const proseRef = candidate.record.source_refs
    .map((ref) => ({ ref, parsed: parseCanonicalProseRef(ref) }))
    .find((entry): entry is { ref: string; parsed: NonNullable<ReturnType<typeof parseCanonicalProseRef>> } => entry.parsed !== null);
  if (proseRef !== undefined) {
    const span = parseSpanSourceRef(proseRef.ref);
    const heading = span?.heading_hint?.trim();
    return heading === undefined || heading.length === 0
      ? proseRef.parsed.sourceName
      : `${heading} · ${proseRef.parsed.sourceName}`;
  }
  const symbolSource = /^repo:([^#]+)#symbol:/u.exec(candidate.record.source_refs[0] ?? "")?.[1];
  if (symbolSource !== undefined) return `Symbols · ${symbolSource}`;
  return candidate.record.module || candidate.record.kind || "Ungrouped";
}

function endpointFallbackLabel(ref: string): string {
  const collectionSeparator = ref.indexOf(":");
  const withoutCollection = collectionSeparator >= 0 ? ref.slice(collectionSeparator + 1) : ref;
  const withoutSection = withoutCollection.split("#", 1)[0] ?? withoutCollection;
  const parts = withoutSection.split("/").filter((part) => part.length > 0);
  const leaf = parts.at(-1) ?? ref;
  return leaf.replace(/[-_]+/gu, " ");
}

export function endpointLabels(candidates: readonly ReviewCandidateView[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const { record } of candidates) {
    labels.set(record.node_ref, record.review.title);
    labels.set(record.view_ref, record.review.title);
    for (const section of record.sections ?? []) {
      const detail = section.title ?? section.summary ?? section.id;
      labels.set(`${record.view_ref}#${section.id}`, `${record.review.title} · ${detail}`);
    }
  }
  return labels;
}

export function edgeForReview(edge: EdgePreview, labels: ReadonlyMap<string, string>): EdgePreview & {
  fromLabel: string;
  toLabel: string;
} {
  return {
    ...edge,
    fromLabel: labels.get(edge.from) ?? endpointFallbackLabel(edge.from),
    toLabel: labels.get(edge.to) ?? endpointFallbackLabel(edge.to),
  };
}

function endpointRefs(record: ReviewCandidateView["record"]): Set<string> {
  const refs = new Set<string>([record.node_ref, record.view_ref]);
  for (const section of record.sections ?? []) refs.add(`${record.view_ref}#${section.id}`);
  return refs;
}

export function filterEdgePreviewForCandidates(
  candidates: readonly ReviewCandidateView[],
  edges: readonly EdgePreview[],
): EdgePreview[] {
  const endpoints = new Set(candidates.flatMap(({ record }) => [...endpointRefs(record)]));
  return edges.filter((edge) => endpoints.has(edge.from) || endpoints.has(edge.to));
}

export function filterEdgePreviewForCandidate(
  record: ReviewCandidateView["record"],
  edges: readonly EdgePreview[],
): EdgePreview[] {
  const endpoints = endpointRefs(record);
  return edges.filter((edge) => endpoints.has(edge.from) || endpoints.has(edge.to));
}

export async function readEdgePreview(projectRoot: string): Promise<EdgePreview[]> {
  const filePath = join(projectRoot, STRUCTURE_FILE);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = YAML.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const edges = (parsed as Record<string, unknown>).edges;
    if (!Array.isArray(edges)) return [];
    return edges
      .filter((edge): edge is Record<string, unknown> => edge !== null && typeof edge === "object" && !Array.isArray(edge))
      .map((edge) => ({
        type: typeof edge.type === "string" ? edge.type : "unknown",
        from: typeof edge.from === "string" ? edge.from : "unknown",
        to: typeof edge.to === "string" ? edge.to : "unknown",
        sourceRefs: Array.isArray(edge.source_refs)
          ? edge.source_refs.filter((ref): ref is string => typeof ref === "string")
          : [],
        ...(typeof edge.confidence === "string" ? { confidence: edge.confidence } : {}),
        ...(typeof edge.note === "string" ? { note: edge.note } : {}),
      }));
  } catch {
    return [];
  }
}

export function renderEdgePreview(edges: readonly EdgePreview[], labels: ReadonlyMap<string, string>): string {
  if (edges.length === 0) return "";
  return [
    '<details class="edge-preview" aria-label="edge preview">',
    `<summary class="edge-summary">Edge preview（${edges.length} 个关系）</summary>`,
    '<div class="edge-list">',
    ...edges.map((sourceEdge) => {
      const edge = edgeForReview(sourceEdge, labels);
      return '<div class="edge-row">' +
        '<span class="badge">' + escapeHtml(edge.type) + '</span>' +
        (edge.confidence ? '<span class="badge warning">' + escapeHtml(edge.confidence) + '</span>' : '') +
        '<span class="edge-endpoint">' + escapeHtml(edge.fromLabel) + '</span>' +
        '<span class="subtle">→</span>' +
        '<span class="edge-endpoint">' + escapeHtml(edge.toLabel) + '</span>' +
        '<span class="subtle">' + escapeHtml(String(edge.sourceRefs.length)) + ' 条证据</span>' +
        (edge.note ? '<span class="edge-note">' + escapeHtml(edge.note) + '</span>' : '') +
        '<details class="edge-technical"><summary>技术详情</summary>' +
          '<div><code>' + escapeHtml(edge.from) + '</code> → <code>' + escapeHtml(edge.to) + '</code></div>' +
          edge.sourceRefs.map((ref) => '<code>' + escapeHtml(ref) + '</code>').join("") +
        '</details>' +
      '</div>';
    }),
    '</div>',
    '</details>',
  ].join("");
}
