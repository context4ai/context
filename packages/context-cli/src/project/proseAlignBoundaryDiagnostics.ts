import { diagnostic } from "./proseAlignSchemaUtils.js";
import { resolveProseSourceRef } from "./documentEvidenceIndex.js";
import type {
  AlignDiagnostic,
  AlignPayload,
  EvidenceChunk,
  EvidenceContext,
} from "./proseAlignTypes.js";

interface SectionBoundary {
  view_ref: string;
  section_id: string;
  field: string;
  document_path: string;
  line_start: number;
  line_end: number;
}

function headingKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function chunksForBoundary(boundary: SectionBoundary, chunks: readonly EvidenceChunk[]): EvidenceChunk[] {
  return chunks.filter((chunk) =>
    chunk.document_path === boundary.document_path &&
    chunk.line_end >= boundary.line_start &&
    chunk.line_start <= boundary.line_end
  );
}

function structuralGroups(boundaries: readonly SectionBoundary[], chunks: readonly EvidenceChunk[]): Array<Record<string, unknown>> {
  if (boundaries.length === 0) return [];
  const start = Math.min(...boundaries.map((item) => item.line_start));
  const end = Math.max(...boundaries.map((item) => item.line_end));
  const documentPath = boundaries[0]!.document_path;
  const relevant = chunks.filter((chunk) =>
    chunk.document_path === documentPath && chunk.line_end >= start && chunk.line_start <= end
  );
  const groups: EvidenceChunk[][] = [];
  for (const chunk of relevant) {
    const last = groups.at(-1);
    if (last !== undefined && headingKey(last[0]!.heading_path) === headingKey(chunk.heading_path)) last.push(chunk);
    else groups.push([chunk]);
  }
  return groups.map((group) => {
    const lineStart = Math.max(start, group[0]!.line_start);
    const lineEnd = Math.min(end, group.at(-1)!.line_end);
    return {
      document_path: documentPath,
      heading_path: group[0]!.heading_path,
      line_range: `L${lineStart}-${lineEnd}`,
      source_refs: group.map((chunk) => chunk.source_ref),
      boundary_role: "markdown-ast-block-group",
    };
  });
}

function crossesHeadingPaths(boundary: SectionBoundary, chunks: readonly EvidenceChunk[]): boolean {
  return new Set(chunksForBoundary(boundary, chunks).map((chunk) => headingKey(chunk.heading_path))).size > 1;
}

function isAstBoundaryAligned(boundary: SectionBoundary, chunks: readonly EvidenceChunk[]): boolean {
  const relevant = chunksForBoundary(boundary, chunks);
  return relevant.some((chunk) => chunk.line_start === boundary.line_start) &&
    relevant.some((chunk) => chunk.line_end === boundary.line_end);
}

export function detectMechanicalBoundaryDiagnostics(input: {
  sections: readonly SectionBoundary[];
  chunks: readonly EvidenceChunk[];
}): AlignDiagnostic[] {
  const diagnostics: AlignDiagnostic[] = [];
  for (const boundary of input.sections) {
    if (!crossesHeadingPaths(boundary, input.chunks)) continue;
    diagnostics.push(diagnostic(
      "warning",
      "section.crosses_heading_paths",
      "ownership",
      "Section range crosses multiple Markdown heading paths; review the returned structural groups before confirmation.",
      boundary.field,
      {
        candidate_id: boundary.view_ref,
        repair: {
          action: "split_section_by_markdown_structural_groups",
          automatic_repair: "suggested-splits",
          recommendation: "Split when the structural groups should be independently retrievable; otherwise keep the section and explain the grouping in structure review.",
          section_id: boundary.section_id,
          line_range: `L${boundary.line_start}-${boundary.line_end}`,
          structural_groups: structuralGroups([boundary], input.chunks),
        },
      },
    ));
  }

  const grouped = new Map<string, SectionBoundary[]>();
  for (const section of input.sections) {
    const key = `${section.view_ref}\0${section.document_path}`;
    grouped.set(key, [...(grouped.get(key) ?? []), section]);
  }
  for (const sections of grouped.values()) {
    const sorted = [...sections].sort((left, right) => left.line_start - right.line_start);
    let run: SectionBoundary[] = [];
    const flush = (): void => {
      if (run.length < 3) {
        run = [];
        return;
      }
      const width = run[0]!.line_end - run[0]!.line_start + 1;
      const hasArtificialBoundary = run.some((item) => !isAstBoundaryAligned(item, input.chunks));
      if (width >= 50 && hasArtificialBoundary) {
        diagnostics.push(diagnostic(
          "warning",
          "section.artificial_line_grid",
          "ownership",
          "Adjacent sections use the same fixed line width but do not align with Markdown AST boundaries.",
          run[0]!.field.replace(/\.sections\[\d+\].*$/u, ".sections"),
          {
            candidate_id: run[0]!.view_ref,
            repair: {
              action: "replace_line_grid_with_markdown_structural_groups",
              line_width: width,
              line_ranges: run.map((item) => `L${item.line_start}-${item.line_end}`),
              structural_groups: structuralGroups(run, input.chunks),
            },
          },
        ));
      }
      run = [];
    };
    for (const section of sorted) {
      const previous = run.at(-1);
      const width = section.line_end - section.line_start + 1;
      const expectedWidth = run[0] === undefined ? width : run[0].line_end - run[0].line_start + 1;
      if (previous !== undefined && (section.line_start !== previous.line_end + 1 || width !== expectedWidth)) flush();
      run.push(section);
    }
    flush();
  }
  return diagnostics;
}

export async function addMechanicalBoundaryDiagnostics(input: {
  projectRoot: string;
  evidence: EvidenceContext;
  payload: AlignPayload | undefined;
  diagnostics: AlignDiagnostic[];
}): Promise<void> {
  if (input.payload === undefined) return;
  const sections: SectionBoundary[] = [];
  for (const [viewIndex, view] of input.payload.views.entries()) {
    for (const [sectionIndex, section] of view.sections.entries()) {
      if (section.source_refs.length === 0) continue;
      const resolved = await Promise.all(section.source_refs.map((sourceRef) => resolveProseSourceRef({
        projectRoot: input.projectRoot,
        index: input.evidence.index,
        sourceRef,
        snapshotMarkdownCache: input.evidence.snapshotMarkdownCache,
      })));
      if (resolved.some((item) => item === null || item.status !== "exact")) continue;
      const exact = resolved.filter((item): item is NonNullable<typeof item> => item !== null && item.status === "exact");
      const documentPath = exact[0]?.span.document_path;
      if (documentPath === undefined || exact.some((item) => item.span.document_path !== documentPath)) continue;
      sections.push({
        view_ref: view.view_ref,
        section_id: section.id,
        field: `views[${viewIndex}].sections[${sectionIndex}].source_refs`,
        document_path: documentPath,
        line_start: Math.min(...exact.map((item) => item.span.line_start)),
        line_end: Math.max(...exact.map((item) => item.span.line_end)),
      });
    }
  }
  input.diagnostics.push(...detectMechanicalBoundaryDiagnostics({ sections, chunks: input.evidence.chunks }));
}
