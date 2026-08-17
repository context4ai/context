import YAML from "yaml";
import { okfTypeForCollection } from "./okfTypes.js";
import type { CandidateRecord } from "./candidateLedger.js";
import {
  parseCanonicalSourceRef,
  type CandidateSnapshot,
  type ParsedCanonicalSourceRef,
} from "./reviewShared.js";
import { renderLocalCodeSymbolSourceRef } from "./codeSymbolSourceRef.js";

function localizeSourceRefs(refs: readonly string[]): {
  sources: string[];
  localRefs: string[];
  parsedRefs: ParsedCanonicalSourceRef[];
} {
  const parsedRefs = refs.map(parseCanonicalSourceRef);
  const sources = [...new Set(parsedRefs.map((ref) => ref.source))];
  const localRefs = parsedRefs.map((ref) => {
    const index = sources.indexOf(ref.source) + 1;
    return renderLocalCodeSymbolSourceRef({
      sourceIndex: index,
      file: ref.file,
      symbol: ref.symbol,
      kind: ref.kind,
      digest: ref.digest,
    });
  });
  return {
    sources: sources.map((source) => `repo:${source}`),
    localRefs,
    parsedRefs,
  };
}

function withoutFirstHeading(markdown: string): string {
  return markdown.replace(/^# .*(?:\r?\n){1,2}/u, "").trim();
}

export function cleanApprovedBody(markdown: string): string {
  return withoutFirstHeading(markdown)
    .split(/\r?\n/u)
    .filter((line) => !/^[-*]\s+(?:kind|visibility|source):\s*/iu.test(line))
    .join("\n")
    .trim();
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export function renderApprovedCodegraphMarkdown(input: {
  record: CandidateRecord;
  snapshot: CandidateSnapshot;
  timestamp: string;
}): string {
  const localized = localizeSourceRefs(input.record.source_refs);
  const root = localized.parsedRefs[0];
  const title = input.record.review.title;
  const symbolName = input.snapshot.symbol?.name ?? root?.symbol ?? title;
  const symbolKind = input.snapshot.symbol?.kind ?? root?.kind ?? input.record.kind;
  const description = input.record.review.summary.trim() || `${title} symbol from ${input.record.module}.`;
  const tags = [...new Set(["code", "symbol", symbolKind, input.record.visibility].filter((tag) => tag.length > 0))];
  const codeSymbols = [...new Set([
    ...localized.parsedRefs.map((ref) =>
      `${input.record.module}|${ref.symbol}|${ref.kind}`
    ),
    ...(input.snapshot.symbol?.members ?? [])
      .filter((member): member is { name: string; kind: string } => typeof member.name === "string" && typeof member.kind === "string")
      .map((member) => `${input.record.module}|${symbolName}|${member.name}|${member.kind}`),
  ])];
  const frontmatter = YAML.stringify({
    title,
    type: okfTypeForCollection(input.record.collection),
    node_ref: input.record.node_ref,
    view_ref: input.record.view_ref,
    node_type: "entity",
    description,
    tags,
    timestamp: input.timestamp,
    resource: root === undefined
      ? `knowledge:${input.record.path.replace(/\.md$/u, "")}`
      : `context://repo/${root.source}/symbol/${encodeURIComponent(symbolName)}?kind=${encodeURIComponent(symbolKind)}`,
    sources: localized.sources,
    visibility: input.record.visibility,
    code_symbols: codeSymbols,
    relationship_mode: "source-backed-ast",
    code_edges: (input.record.code_edges ?? []).map((edge) => ({
      type: edge.type,
      from: edge.from,
      to: edge.to,
      source_refs: edge.source_refs,
      relationship_mode: "source-backed-ast",
      relation_type: edge.relation_type,
      note: `AST relation: ${edge.relation_type}`,
    })),
    candidate_fingerprint: input.record.fingerprint,
  }).trimEnd();
  const body = cleanApprovedBody(input.snapshot.markdown);
  const sectionRef = localized.localRefs[0] ?? "";
  return [
    "---",
    frontmatter,
    "---",
    "",
    `# ${title}`,
    "",
    `<!-- context:section id="section-1" kind="description" source_ref="${escapeHtmlAttribute(sectionRef)}" -->`,
    "",
    body,
    "",
  ].join("\n");
}
