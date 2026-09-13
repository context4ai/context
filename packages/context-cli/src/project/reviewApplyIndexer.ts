import YAML from "yaml";
import type { CandidateRecord } from "./candidateLedger.js";
import { ensureMarkdownPageTitle } from "./markdownPageTitle.js";
import { okfTypeForCollection } from "./okfTypes.js";
import { readerKnowledgeDescription } from "./packageKnowledgeProjection.js";
import { compactApprovedKnowledgeMarkdown, ensureApprovedKnowledgePresentation } from "./approvedKnowledgeMetadata.js";

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function sectionMarkdown(section: CandidateRecord["indexer_candidate"]["sections"][number]): string {
  return [
    `<!-- context:section id="${escapeHtmlAttribute(section.section_key)}" -->`,
    "", section.markdown.trimEnd(), "", "<!-- /context:section -->",
  ].join("\n");
}

export function renderApprovedIndexerMarkdown(input: {
  record: CandidateRecord;
  timestamp: string;
}): string {
  if (input.record.approved_revision !== undefined) {
    const content = compactApprovedKnowledgeMarkdown(ensureApprovedKnowledgePresentation(input.record.body));
    return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/u, (_match, header: string) => {
      const metadata = YAML.parse(header) as Record<string, unknown>;
      return ["---", YAML.stringify({ ...metadata, type: metadata.type ?? okfTypeForCollection(input.record.collection),
        timestamp: input.timestamp }).trimEnd(), "---"].join("\n");
    });
  }
  const binding = input.record.indexer_candidate;
  if (input.record.candidate_type !== "indexer-artifact" || binding === undefined) {
    throw new TypeError("Indexer approved renderer requires an indexer-artifact Candidate");
  }
  const title = input.record.review.title;
  const body = binding.sections.flatMap((section, index) => [
    ...(index === 0 ? [] : [""]),
    sectionMarkdown(section),
  ]).join("\n");
  const description = readerKnowledgeDescription({
    description: input.record.review.summary,
    markdown: body,
    title,
  });
  const frontmatter = YAML.stringify({
    title,
    type: okfTypeForCollection(input.record.collection),
    description,
    timestamp: input.timestamp,
  }).trimEnd();
  return [
    "---",
    frontmatter,
    "---",
    "",
    ensureMarkdownPageTitle(body, title),
    "",
  ].join("\n");
}
