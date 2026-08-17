import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import type {
  CandidateRecord,
  ProseCandidateSection,
} from "./candidateLedger.js";
import { okfTypeForCollection } from "./okfTypes.js";
import { PARENT_INDEX_GENERATED_KIND } from "./parentIndexView.js";
import {
  parseCanonicalProseRef,
  proseResourceForSource,
  type CandidateSnapshot,
  type ParsedCanonicalProseRef,
} from "./reviewShared.js";

function localizeProseSourceRefs(refs: readonly string[]): {
  sources: string[];
  localRefs: string[];
  parsedRefs: ParsedCanonicalProseRef[];
} {
  const parsedRefs = refs.map((ref) => {
    const parsed = parseCanonicalProseRef(ref);
    if (parsed === null) {
      throw new ContextError(ExitCode.WorkspaceStateError, `unsupported canonical prose source_ref: ${ref}`, {
        category: ErrorCategory.SchemaInvalid,
        source_ref: ref,
      });
    }
    return parsed;
  });
  const sources = [...new Set(parsedRefs.map((ref) => ref.locator))];
  const localRefs = parsedRefs.map((ref) => {
    const index = sources.indexOf(ref.locator) + 1;
    return `src-${index}${ref.spanBody}`;
  });
  return { sources, localRefs, parsedRefs };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function renderProseSections(input: {
  sections: readonly ProseCandidateSection[];
  localRefFor: (sourceRef: string) => string;
}): string {
  return input.sections.map((section) => {
    if (section.body === undefined) {
      throw new ContextError(ExitCode.WorkspaceStateError, `prose section body is required before review apply: ${section.id}`, {
        category: ErrorCategory.SchemaInvalid,
        section_id: section.id,
        next: "Rerun compileProse so the CLI materializes section bodies from source evidence.",
      });
    }
    const body = section.body;
    if (section.content_mode === "empty" && (body.trim().length > 0 || section.summary !== undefined)) {
      throw new ContextError(ExitCode.WorkspaceStateError, `empty prose section must not contain reader-facing content: ${section.id}`, {
        category: ErrorCategory.SchemaInvalid,
        section_id: section.id,
        next: "Rerun compileProse with an empty body and no section summary, or choose verbatim content_mode.",
      });
    }
    if ((section.content_mode as string | undefined) === "rewritten") {
      throw new ContextError(ExitCode.WorkspaceStateError, `rewritten prose sections are no longer written to approved knowledge: ${section.id}`, {
        category: ErrorCategory.SchemaInvalid,
        section_id: section.id,
        next: "Rerun compileProse without explicit content, or return to align and split the source evidence into source-mirrored sections.",
      });
    }
    const attrs: Array<[string, string]> = [
      ["id", section.id],
      ["kind", section.kind ?? "body"],
      ["source_ref", input.localRefFor(section.source_ref)],
      ["content_mode", section.content_mode ?? "verbatim"],
    ];
    const attrText = attrs
      .map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`)
      .join(" ");
    const summaryBlock = section.summary !== undefined
      ? [
          "<!-- context:summary",
          JSON.stringify({ text: section.summary }),
          "/context:summary -->",
          "",
        ]
      : [];
    return [
      `<!-- context:section ${attrText} -->`,
      "",
      ...summaryBlock,
      body,
      "",
      "<!-- /context:section -->",
    ].join("\n").trimEnd();
  }).join("\n\n");
}

function renderApprovedParentIndexMarkdown(input: {
  record: CandidateRecord;
  timestamp: string;
}): string {
  const localized = localizeProseSourceRefs([...new Set(input.record.source_refs)]);
  const title = input.record.review.title;
  const description = input.record.review.behavior_summary?.trim() || `${title} parent index.`;
  const nodeType = input.record.kind;
  const children = input.record.parent_index?.children;
  if (children === undefined || children.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `parent-index candidate must contain children: ${input.record.candidate_id}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: input.record.candidate_id,
      next: "Rerun compileProse for the parent-index view.",
    });
  }
  if (input.record.body === undefined || input.record.body.trim().length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `parent-index candidate must contain generated body: ${input.record.candidate_id}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: input.record.candidate_id,
      next: "Rerun compileProse for the parent-index view.",
    });
  }
  const tags = [...new Set(["docs", "prose", "parent-index", nodeType, input.record.module].filter((tag) => tag.length > 0))];
  const frontmatter = YAML.stringify({
    title,
    type: okfTypeForCollection(input.record.collection),
    node_ref: input.record.node_ref,
    view_ref: input.record.view_ref,
    ...(input.record.structure_digest === undefined
      ? {}
      : { structure_digest: input.record.structure_digest }),
    node_type: nodeType,
    generated: PARENT_INDEX_GENERATED_KIND,
    children,
    description,
    tags,
    ...(input.record.node_tags !== undefined ? { node_tags: input.record.node_tags } : {}),
    timestamp: input.timestamp,
    resource: proseResourceForSource(localized.sources[0], `knowledge:${input.record.path.replace(/\.md$/u, "")}`),
    sources: localized.sources,
  }).trimEnd();
  return [
    "---",
    frontmatter,
    "---",
    "",
    input.record.body.trimEnd(),
    "",
  ].join("\n");
}

export function renderApprovedProseMarkdown(input: {
  record: CandidateRecord;
  snapshot: CandidateSnapshot;
  timestamp: string;
}): string {
  if (input.record.generated === PARENT_INDEX_GENERATED_KIND) {
    return renderApprovedParentIndexMarkdown({
      record: input.record,
      timestamp: input.timestamp,
    });
  }
  const sectionRefs = input.record.sections?.flatMap((section) => [section.source_ref, ...(section.source_refs ?? [])]) ?? [];
  const canonicalRefs = [...new Set([...input.record.source_refs, ...sectionRefs])];
  const localized = localizeProseSourceRefs(canonicalRefs);
  const localRefsByCanonicalRef = new Map(canonicalRefs.map((ref, index) => [ref, localized.localRefs[index] ?? ""]));
  const title = input.record.review.title;
  const description = input.record.review.behavior_summary?.trim() || `${title} document knowledge.`;
  const nodeType = input.record.kind;
  const tags = [...new Set(["docs", "prose", nodeType, input.record.module].filter((tag) => tag.length > 0))];
  const frontmatter = YAML.stringify({
    title,
    type: okfTypeForCollection(input.record.collection),
    node_ref: input.record.node_ref,
    view_ref: input.record.view_ref,
    ...(input.record.structure_digest === undefined
      ? {}
      : { structure_digest: input.record.structure_digest }),
    node_type: nodeType,
    description,
    tags,
    ...(input.record.node_tags !== undefined ? { node_tags: input.record.node_tags } : {}),
    timestamp: input.timestamp,
    resource: proseResourceForSource(localized.sources[0], `knowledge:${input.record.path.replace(/\.md$/u, "")}`),
    sources: localized.sources,
  }).trimEnd();
  const sections = input.record.sections;
  if (sections === undefined || sections.length === 0) {
    throw new ContextError(ExitCode.WorkspaceStateError, `prose-align candidate must contain materialized sections: ${input.record.candidate_id}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: input.record.candidate_id,
      next: "Rerun compileProse so review apply can materialize approved prose sections.",
    });
  }
  const body = renderProseSections({
    sections,
    localRefFor: (sourceRef) => {
      const localRef = localRefsByCanonicalRef.get(sourceRef);
      if (localRef === undefined || localRef.length === 0) {
        throw new ContextError(ExitCode.WorkspaceStateError, `section source_ref is not declared on candidate: ${sourceRef}`, {
          category: ErrorCategory.SchemaInvalid,
          source_ref: sourceRef,
        });
      }
      return localRef;
    },
  });
  return [
    "---",
    frontmatter,
    "---",
    "",
    body,
    "",
  ].join("\n");
}
