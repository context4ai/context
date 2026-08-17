import { createDocumentSourceSpan, formatCanonicalProseSourceRef } from "@c4a/extract";
import { slugify } from "../lib/normalize.js";
import {
  type AlignDiagnostic,
  type AlignPayload,
  type EvidenceContext,
  type StructureSectionPlan,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import { parseAlignPayload } from "./proseAlignPayloadParse.js";
import { nodeLocalSources, plannedSectionMirrorHint } from "./proseCompileViews.js";

interface MechanicalSectionSplit {
  section_id: string;
  kind: string;
  source_refs: string[];
  document_path: string;
  line_range: string;
  reason: string;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function structuralGroupSplits(input: {
  diagnostics: readonly AlignDiagnostic[];
  evidence: EvidenceContext;
  section: StructureSectionPlan;
  viewRef: string;
}): MechanicalSectionSplit[] | undefined {
  const diagnostic = input.diagnostics.find((item) =>
    item.code === "section.crosses_heading_paths" &&
    item.candidate_id === input.viewRef &&
    item.repair?.section_id === input.section.id
  );
  const groups = Array.isArray(diagnostic?.repair?.structural_groups)
    ? diagnostic.repair.structural_groups
    : [];
  const splits = groups.flatMap((value, index): MechanicalSectionSplit[] => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    const group = value as Record<string, unknown>;
    const documentPath = typeof group.document_path === "string" ? group.document_path : undefined;
    const lineRange = typeof group.line_range === "string" ? group.line_range : undefined;
    if (documentPath === undefined || lineRange === undefined) return [];
    const match = lineRange === undefined ? null : /^L(\d+)-(\d+)$/u.exec(lineRange);
    const document = input.evidence.documents.find((item) => item.document.path === documentPath);
    if (document === undefined || match === null) return [];
    const lineStart = Number(match[1]);
    const lineEnd = Number(match[2]);
    if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) return [];
    const headingPath = stringArray(group.heading_path);
    const headingSlug = slugify(headingPath.at(-1) ?? `part-${index + 1}`);
    const sectionId = index === 0
      ? input.section.id
      : `${input.section.id}-${headingSlug === "untitled" ? `part-${index + 1}` : headingSlug}`;
    const span = createDocumentSourceSpan(document.markdown, { lineStart, lineEnd });
    return [{
      section_id: sectionId,
      kind: input.section.kind,
      source_refs: [formatCanonicalProseSourceRef({
        sourceType: input.evidence.source.sourceType,
        sourceName: input.evidence.source.sourceName,
        documentPath,
        span,
      })],
      document_path: documentPath,
      line_range: lineRange,
      reason: "crosses_markdown_heading_paths",
    }];
  });
  return splits.length >= 2 ? splits : undefined;
}

function uniqueSectionId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (usedIds.has(candidate)) continue;
    usedIds.add(candidate);
    return candidate;
  }
}

export interface SuggestedSplitRepair {
  changed: boolean;
  sectionsSplit: number;
  reasons: Array<{
    code: string;
    sections: number;
  }>;
  payload: Record<string, unknown>;
}

export async function repairSuggestedSplitPayload(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  payload: AlignPayload;
  diagnostics: readonly AlignDiagnostic[];
}): Promise<SuggestedSplitRepair> {
  let sectionsSplit = 0;
  const reasonCounts = new Map<string, number>();
  const repairedViews: StructureViewPlan[] = [];
  for (const view of input.payload.views) {
    const usedIds = new Set(view.sections.map((section) => section.id));
    const localSources = nodeLocalSources(view);
    const sections: StructureSectionPlan[] = [];
    for (const section of view.sections) {
      usedIds.delete(section.id);
      const hint = await plannedSectionMirrorHint({
        projectRoot: input.projectRoot,
        evidence: input.evidence,
        section,
        localSources,
      });
      const suggestedSplits = hint.status === "split_required" && hint.suggested_splits !== undefined
        ? hint.suggested_splits
        : structuralGroupSplits({
            diagnostics: input.diagnostics,
            evidence: input.evidence,
            section,
            viewRef: view.view_ref,
          });
      if (suggestedSplits === undefined || suggestedSplits.length < 2) {
        usedIds.add(section.id);
        sections.push(section);
        continue;
      }
      sectionsSplit += 1;
      for (const reason of new Set(suggestedSplits.map((split) => split.reason))) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      for (const split of suggestedSplits) {
        const id = uniqueSectionId(split.section_id, usedIds);
        sections.push({
          id,
          section_ref: `${view.view_ref}#${id}`,
          kind: split.kind,
          ...(section.summary !== undefined ? { summary: section.summary } : {}),
          ...(section.ownership !== undefined ? { ownership: section.ownership } : {}),
          source_refs: split.source_refs,
        });
      }
    }
    repairedViews.push({ ...view, sections });
  }

  const repairedBody = {
    schema_version: input.payload.schema_version,
    sources: input.payload.sources,
    evidence_snapshot_hash: input.payload.evidence_snapshot_hash,
    nodes: input.payload.nodes,
    views: repairedViews,
    edges: input.payload.edges,
    unresolved: input.payload.unresolved,
    ...(input.payload.user_or_agent_hints !== undefined ? { user_or_agent_hints: input.payload.user_or_agent_hints } : {}),
    lifecycle: { state: "draft" },
  };
  const reparsed = parseAlignPayload(repairedBody);
  return {
    changed: sectionsSplit > 0,
    sectionsSplit,
    reasons: [...reasonCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, sections]) => ({ code, sections })),
    payload: reparsed.payload === undefined ? repairedBody : {
      schema_version: reparsed.payload.schema_version,
      sources: reparsed.payload.sources,
      evidence_snapshot_hash: reparsed.payload.evidence_snapshot_hash,
      nodes: reparsed.payload.nodes,
      views: reparsed.payload.views,
      edges: reparsed.payload.edges,
      unresolved: reparsed.payload.unresolved,
      ...(reparsed.payload.user_or_agent_hints !== undefined ? { user_or_agent_hints: reparsed.payload.user_or_agent_hints } : {}),
      lifecycle: {
        ...reparsed.payload.lifecycle,
        structure_digest: reparsed.payload.structure_digest,
      },
    },
  };
}
