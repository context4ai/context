import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { createCapturedAlignProject, firstSourceRef, makeTmp, runCliInDir, sourceRefForLine, sourceRefForRange, structurePayload, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("compacts oversized default diagnostics and exposes an exact continuation View", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = sourceRefForLine(projectRoot, "guide.md", 3);
      const payload = writePayload(projectRoot, "many-diagnostics.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`unknown_${index + 1}`, true])),
      });
      const compact = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--validate", "--input", payload, "--format", "json",
      ])) as {
        result: {
          diagnostics: unknown[];
          diagnostics_summary: { total: number; returned: number; truncated: boolean; continuation: { command: string } };
        };
      };
      expect(compact.result.diagnostics).toHaveLength(8);
      expect(compact.result.diagnostics_summary).toMatchObject({ returned: 8, truncated: true });
      expect(compact.result.diagnostics_summary.total).toBeGreaterThan(25);
      expect(compact.result.diagnostics_summary.continuation.command).toContain("--view diagnostics");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("expands a broad cross-heading section into continuous sibling sections in the same View", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const baseRef = sourceRefForLine(projectRoot, "guide.md", 3);
      const broadRef = sourceRefForRange(projectRoot, "guide.md", 5, 17);
      const base = structurePayload(projectRoot, baseRef);
      const broadPayload = writePayload(projectRoot, "broad-section.yaml", {
        ...base,
        views: (base.views as Array<Record<string, unknown>>).map((view) =>
          view.view_ref === "architecture:entity/install"
            ? {
                ...view,
                sections: [{
                  id: "details",
                  section_ref: "architecture:entity/install#details",
                  kind: "description",
                  source_refs: [broadRef],
                }],
              }
            : view
        ),
      });

      const validation = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--validate", "--input", broadPayload, "--format", "json",
      ])) as {
        result: {
          state: string;
          diagnostics: Array<{ code: string }>;
          next_action: { command: string };
        };
      };
      expect(validation.result.state).toBe("ready");
      expect(validation.result.diagnostics.map((item) => item.code)).toContain("section.crosses_heading_paths");
      expect(validation.result.next_action.command).toContain("--stage");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects malformed structure and edge evidence issues", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);

      const invalidPayload = writePayload(projectRoot, "invalid-structure.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        nodes: [{
          node_ref: "domain/product-docs",
          node_type: "domain",
        }, {
          node_ref: "entity/type-mismatch",
          title: "Type Mismatch",
          node_type: "domain",
        }, {
          node_ref: "concept/unknown",
          title: "Unknown Node Type",
          node_type: "concept",
        }],
        views: [{
          view_ref: "architecture:domain/product-docs",
          node_ref: "domain/product-docs",
          collection: "architecture",
          containment: "product-docs",
          slug: "overview",
          title: "Product Docs",
          path: "architecture/custom/product-docs.md",
          source: "legacy-owner-field",
          sections: [{
            id: "overview",
            section_ref: "architecture:domain/product-docs#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [{
          type: "related",
          from: "domain/product-docs",
          to: "missing/node",
          source_refs: [sourceRef],
        }, {
          type: "contains",
          from: "domain/product-docs",
          to: "missing/node",
          source_refs: [sourceRef],
        }],
        lifecycle: { state: "draft" },
      });
      const invalid = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        invalidPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; family: string }> } };
      expect(invalid.result.valid).toBe(false);
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("schema.node_title_missing");
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("schema.view_path_not_derived");
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("schema.node_ref_type_mismatch");
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("schema.node_type_invalid");
      expect(invalid.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "schema.unknown_field",
        field: "views[0].source",
      }));
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("edge.type_invalid");
      expect(invalid.result.diagnostics.map((item) => item.code)).toContain("edge.to_unknown");
      const diagnosticPage = JSON.parse(await runCliInDir(projectRoot, [
        "run", "align:file:product-docs:architecture", "--view", "diagnostics",
        "--input", invalidPayload, "--page-size", "2", "--format", "json",
      ])) as {
        result: {
          diagnostics_summary: { total: number; returned: number; truncated: boolean };
          diagnostics: Array<{ severity: string }>;
          next_action: { command: string };
        };
      };
      expect(diagnosticPage.result.diagnostics_summary).toMatchObject({ returned: 2, truncated: true });
      expect(diagnosticPage.result.diagnostics_summary.total).toBeGreaterThan(2);
      expect(diagnosticPage.result.diagnostics.every((item) => item.severity === "error")).toBe(true);
      expect(diagnosticPage.result.next_action.command).toContain("--page-token 2");

      const nonContiguousSectionPayload = writePayload(projectRoot, "non-contiguous-section-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        views: [
          ...(structurePayload(projectRoot, sourceRef).views as Array<Record<string, unknown>>).map((view) =>
            view.view_ref === "architecture:entity/install"
              ? {
                  ...view,
                  sections: [{
                    id: "install",
                    section_ref: "architecture:entity/install#install",
                    kind: "description",
                    source_refs: [
                      sourceRefForLine(projectRoot, "guide.md", 7),
                      sourceRefForLine(projectRoot, "guide.md", 17),
                    ],
                  }],
                }
              : view
          ),
        ],
      });
      const nonContiguousSection = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        nonContiguousSectionPayload,
        "--format",
        "json",
      ])) as {
        result: {
          valid: boolean;
          state: string;
          self_healed: {
            kind: string;
            input_sections: number;
            sections_split: number;
            output_sections: number;
            reasons: Array<{ code: string; sections: number }>;
          };
          next_action: {
            kind: string;
            reason_code: string;
            command: string;
          };
        };
      };
      expect(nonContiguousSection.result.valid).toBe(true);
      expect(nonContiguousSection.result.state).toBe("ready");
      expect(nonContiguousSection.result.self_healed).toEqual({
        kind: "suggested-splits",
        input_sections: 2,
        sections_split: 1,
        output_sections: 3,
        reasons: [{
          code: "non_contiguous_source_refs",
          sections: 1,
        }],
      });
      expect(nonContiguousSection.result.next_action).toMatchObject({
        kind: "stage_structure",
        reason_code: "prose-align-structure-valid",
        command: expect.stringContaining("--stage"),
      });
      const stagedResult = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        nonContiguousSectionPayload,
        "--format",
        "json",
      ])) as { result: { self_healed: { input_sections: number; output_sections: number } } };
      expect(stagedResult.result.self_healed).toMatchObject({
        input_sections: 2,
        output_sections: 3,
      });
      const staged = YAML.parse(
        readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8"),
      ) as {
        views: Array<{
          view_ref: string;
          sections: Array<{ id: string; section_ref: string; source_refs: string[] }>;
        }>;
      };
      const repairedInstall = staged.views.find((view) =>
        view.view_ref === "architecture:entity/install"
      );
      expect(repairedInstall?.sections.map((section) => section.id)).toEqual([
        "install",
        "install-2",
      ]);
      expect(repairedInstall?.sections[1]?.section_ref).toBe(
        "architecture:entity/install#install-2",
      );

      const duplicatePathPayload = writePayload(projectRoot, "duplicate-view-path-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [
          {
            node_ref: "domain/product-docs",
            title: "Product Docs",
            node_type: "domain",
          },
          {
            node_ref: "entity/gateway",
            title: "Gateway",
            node_type: "entity",
            tags: ["service"],
          },
          {
            node_ref: "entity/api-gateway",
            title: "API Gateway",
            node_type: "entity",
            tags: ["service"],
          },
        ],
        views: [
          {
            view_ref: "architecture:domain/product-docs",
            node_ref: "domain/product-docs",
            collection: "architecture",
            containment: "product-docs",
            slug: "overview",
            title: "Product Docs",
            node_type: "domain",
            path: "architecture/product-docs/overview.md",
            sections: [{
              id: "overview",
              section_ref: "architecture:domain/product-docs#overview",
              kind: "description",
              source_refs: [sourceRef],
            }],
          },
          {
            view_ref: "architecture:entity/gateway",
            node_ref: "entity/gateway",
            collection: "architecture",
            containment: "entity",
            slug: "gateway",
            title: "Gateway",
            node_type: "entity",
            path: "architecture/entity/gateway.md",
            sections: [{
              id: "overview",
              section_ref: "architecture:entity/gateway#overview",
              kind: "description",
              source_refs: [sourceRef],
            }],
          },
          {
            view_ref: "architecture:entity/api-gateway",
            node_ref: "entity/api-gateway",
            collection: "architecture",
            containment: "entity",
            slug: "gateway",
            title: "API Gateway",
            node_type: "entity",
            path: "architecture/entity/gateway.md",
            sections: [{
              id: "overview",
              section_ref: "architecture:entity/api-gateway#overview",
              kind: "description",
              source_refs: [sourceRef],
            }],
          },
        ],
        edges: [{
          type: "contains",
          from: "domain/product-docs",
          to: "entity/gateway",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }, {
          type: "contains",
          from: "domain/product-docs",
          to: "entity/api-gateway",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }],
        unresolved: [],
      });
      const duplicatePath = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        duplicatePathPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(duplicatePath.result.valid).toBe(false);
      expect(duplicatePath.result.diagnostics.map((item) => item.code)).toContain("duplicate.view_path");

      const hedgedRef = sourceRefForLine(projectRoot, "guide.md", 17);
      const hedgedWithoutConfidencePayload = writePayload(projectRoot, "hedged-edge-without-confidence.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        edges: [{
          type: "contains",
          from: "domain/product-docs",
          to: "entity/install",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }, {
          type: "prerequisite",
          from: "entity/install",
          to: "domain/product-docs",
          source_refs: [hedgedRef],
        }],
      });
      const hedgedWithoutConfidence = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        hedgedWithoutConfidencePayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; field?: string }> } };
      expect(hedgedWithoutConfidence.result.valid).toBe(true);

      const hedgedWithConfidencePayload = writePayload(projectRoot, "hedged-edge-with-confidence.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        edges: [{
          type: "contains",
          from: "domain/product-docs",
          to: "entity/install",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }, {
          type: "prerequisite",
          from: "entity/install",
          to: "domain/product-docs",
          source_refs: [hedgedRef],
          confidence: "possible",
        }],
      });
      const hedgedWithConfidence = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "structure-summary",
        "--input",
        hedgedWithConfidencePayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; structure_summary: { edges: Array<{ confidence?: string; source_refs: string[] }> } } };
      expect(hedgedWithConfidence.result.valid).toBe(true);
      expect(hedgedWithConfidence.result.structure_summary.edges.find((edge) => edge.confidence === "possible")).toMatchObject({
        confidence: "possible",
        source_refs: [hedgedRef],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
