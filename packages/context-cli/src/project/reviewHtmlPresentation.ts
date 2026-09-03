import { dirname } from "node:path";
import type { ReviewCandidateView } from "./reviewShared.js";

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
  const path = candidate.record.indexer_candidate.evidence_bindings[0]?.locator.path;
  const group = path === undefined ? candidate.record.kind : dirname(path).split("\\").join("/");
  return `${candidate.record.module} / ${group === "." ? candidate.record.kind : group}`;
}

export function candidateGroupLabel(candidate: ReviewCandidateView): string {
  const path = candidate.record.indexer_candidate.evidence_bindings[0]?.locator.path;
  const group = path === undefined ? candidate.record.kind : dirname(path).split("\\").join("/");
  return group === "."
    ? candidate.record.module
    : `${candidate.record.module} · ${group}`;
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
    for (const section of record.indexer_candidate.sections) {
      labels.set(
        `${record.view_ref}#${section.section_key}`,
        `${record.review.title} · ${section.section_key}`,
      );
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
  for (const section of record.indexer_candidate.sections) {
    refs.add(`${record.view_ref}#${section.section_key}`);
  }
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

export async function readEdgePreview(_projectRoot: string): Promise<EdgePreview[]> {
  return [];
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
