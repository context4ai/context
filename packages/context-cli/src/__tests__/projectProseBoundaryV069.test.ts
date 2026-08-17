import { describe, expect, test } from "bun:test";
import { detectMechanicalBoundaryDiagnostics } from "../project/proseAlignBoundaryDiagnostics.js";
import { buildValidateResult } from "../project/proseAlignValidateResult.js";
import type { EvidenceChunk } from "../project/proseAlignTypes.js";

function chunk(start: number, end: number, heading: string): EvidenceChunk {
  return {
    chunk_id: `chunk-${start}`,
    source_type: "file",
    source_name: "docs",
    document_path: "guide.md",
    locator: "file:docs/guide.md",
    kind: "paragraph",
    boundary_role: "markdown-ast-block",
    section_candidate: true,
    heading_path: [heading],
    line_start: start,
    line_end: end,
    line_range: `L${start}-${end}`,
    source_ref: `file:docs/guide.md#span:${heading.toLowerCase()} L${start}-${end}@123456789abc`,
    text: "text",
    text_preview: "text",
    token_estimate: 1,
    char_count: 4,
    link_count: 0,
    code_fence_count: 0,
    table_row_count: 0,
  };
}

function section(index: number, start: number, end: number): {
  view_ref: string;
  section_id: string;
  field: string;
  document_path: string;
  line_start: number;
  line_end: number;
} {
  return {
    view_ref: "architecture:entity/guide",
    section_id: `part-${index}`,
    field: `views[0].sections[${index}].source_refs`,
    document_path: "guide.md",
    line_start: start,
    line_end: end,
  };
}

describe("0.6.9 prose mechanical boundaries", () => {
  test("blocks repeated fixed line grids that cut across Markdown AST blocks", () => {
    const diagnostics = detectMechanicalBoundaryDiagnostics({
      sections: [section(0, 1, 200), section(1, 201, 400), section(2, 401, 600)],
      chunks: [chunk(1, 80, "Intro"), chunk(81, 260, "Packages"), chunk(261, 430, "API"), chunk(431, 600, "Components")],
    });
    expect(diagnostics.map((item) => item.code)).toContain("section.artificial_line_grid");
    expect(diagnostics.map((item) => item.code)).toContain("section.crosses_heading_paths");
    expect(diagnostics.find((item) => item.code === "section.crosses_heading_paths")?.repair).toMatchObject({
      action: "split_section_by_markdown_structural_groups",
      automatic_repair: "suggested-splits",
      section_id: "part-0",
    });
    const validation = buildValidateResult({
      payload: undefined,
      diagnostics,
      phaseId: "align:file:docs:architecture",
      phaseCollection: "architecture",
    });
    expect(validation.confirmation_ready).toBe(false);
    expect(validation.confirmation_blockers.map((item) => item.code)).toContain("section.artificial_line_grid");
  });

  test("accepts equal-sized ranges when they exactly match AST block boundaries", () => {
    const chunks = [chunk(1, 100, "One"), chunk(101, 200, "Two"), chunk(201, 300, "Three")];
    const diagnostics = detectMechanicalBoundaryDiagnostics({
      sections: [section(0, 1, 100), section(1, 101, 200), section(2, 201, 300)],
      chunks,
    });
    expect(diagnostics.map((item) => item.code)).not.toContain("section.artificial_line_grid");
  });
});
