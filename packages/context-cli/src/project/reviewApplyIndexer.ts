import YAML from "yaml";
import type { CandidateRecord } from "./candidateLedger.js";
import { ensureMarkdownPageTitle } from "./markdownPageTitle.js";
import { okfTypeForCollection } from "./okfTypes.js";

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function sectionMarkdown(input: {
  section: NonNullable<CandidateRecord["indexer_candidate"]>["sections"][number];
  artifactKind: string;
  sourceRefs: readonly string[];
}): string {
  const refs = input.sourceRefs;
  const primaryRef = refs[0] ?? input.section.section_ref;
  return [
    `<!-- context:section id="${escapeHtmlAttribute(input.section.section_key)}" kind="${escapeHtmlAttribute(input.artifactKind)}" source_ref="${escapeHtmlAttribute(primaryRef)}" -->`,
    "",
    ...(refs.length <= 1
      ? []
      : [
          "<!-- context:source_refs",
          JSON.stringify(refs),
          "/context:source_refs -->",
          "",
        ]),
    input.section.markdown.trimEnd(),
    "",
    "<!-- /context:section -->",
  ].join("\n");
}

export function renderApprovedIndexerMarkdown(input: {
  record: CandidateRecord;
  timestamp: string;
}): string {
  const binding = input.record.indexer_candidate;
  if (input.record.candidate_type !== "indexer-artifact" || binding === undefined) {
    throw new TypeError("Indexer approved renderer requires an indexer-artifact Candidate");
  }
  const sources = [...new Set(binding.evidence_bindings.map((item) => item.source_ref))];
  if (sources.length === 0) sources.push(binding.source_ref);
  const sourceByEvidenceRef = new Map(binding.evidence_bindings.map((item) => [
    item.evidence_ref,
    item.source_ref,
  ]));
  const title = input.record.review.title;
  const frontmatter = YAML.stringify({
    title,
    type: okfTypeForCollection(input.record.collection),
    node_ref: input.record.node_ref,
    view_ref: input.record.view_ref,
    node_type: "entity",
    description: input.record.review.summary,
    tags: ["indexer", input.record.kind, input.record.module],
    timestamp: input.timestamp,
    resource: `knowledge:${input.record.path.replace(/\.md$/u, "")}`,
    sources,
    visibility: input.record.visibility,
  }).trimEnd();
  const body = binding.sections.flatMap((section, index) => [
    ...(index === 0 ? [] : [""]),
    sectionMarkdown({
      section,
      artifactKind: input.record.kind,
      sourceRefs: [...new Set(section.evidence_refs.flatMap((ref) => {
        const sourceRef = sourceByEvidenceRef.get(ref);
        return sourceRef === undefined ? [] : [sourceRef];
      }))].sort(),
    }),
  ]).join("\n");
  return [
    "---",
    frontmatter,
    "---",
    "",
    ensureMarkdownPageTitle(body, title),
    "",
  ].join("\n");
}
