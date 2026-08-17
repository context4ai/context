import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { createCapturedAlignProject, firstSourceRef, invokeCliInDir, makeTmp, runCliInDir, sourceRefForLine, structurePayload, writeApprovedStructure, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("blocks confirmation when a planned ViewRef takes an approved knowledge path", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      await writeApprovedStructure(projectRoot, sourceRef);
      const structure = structurePayload(projectRoot, sourceRef);
      const views = structure.views as Array<Record<string, unknown>>;
      views[1] = {
        ...views[1],
        slug: "setup",
        path: "architecture/product-docs/setup.md",
      };
      const payload = writePayload(projectRoot, "path-identity-conflict.yaml", structure);

      const validation = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          confirmation_ready: boolean;
          diagnostics: Array<{ code: string; repair?: { action?: string } }>;
        };
      };
      expect(validation.result.confirmation_ready).toBe(false);
      expect(validation.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "existing_approved.path_identity_conflict",
        repair: expect.objectContaining({ action: "preserve_approved_path_identity" }),
      }));

      const stage = await invokeCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        payload,
        "--format",
        "json",
      ]);
      expect(stage.status).not.toBe(0);
      expect(stage.stderr).toContain("existing_approved.path_identity_conflict");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks confirmation when an approved ViewRef is assigned a different path", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      await writeApprovedStructure(projectRoot, sourceRef);
      const structure = structurePayload(projectRoot, sourceRef);
      const views = structure.views as Array<Record<string, unknown>>;
      views[0] = {
        ...views[0],
        containment: "alternate",
        path: "architecture/alternate/overview.md",
      };
      const payload = writePayload(projectRoot, "view-path-conflict.yaml", structure);

      const validation = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          confirmation_ready: boolean;
          diagnostics: Array<{ code: string; repair?: { action?: string } }>;
        };
      };
      expect(validation.result.confirmation_ready).toBe(false);
      expect(validation.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "existing_approved.view_path_conflict",
        repair: expect.objectContaining({ action: "preserve_approved_view_path" }),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("summarizes stages and reports approved structure context", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);

      await writeApprovedStructure(projectRoot, sourceRef);
      const payload = writePayload(projectRoot, "valid-structure.yaml", structurePayload(projectRoot, sourceRef));
      const valid = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          valid: boolean;
          nodes: number;
          edges: number;
          structure_digest: string;
          review_notice: {
            review_report: { path: string };
            confirmation_ready: boolean;
            confirmation_blockers: unknown[];
          };
          structure_summary_compact: {
            counts: { nodes: number; sections: number; edges: number; unresolved: number };
            views_by_collection: Array<{ collection: string; view_count: number }>;
          };
          diagnostics: Array<{ code: string; candidate_id?: string }>;
          structure_report: { path: string; absolute_path: string; file_url: string; title: string };
          next_action: { command: string };
        };
      };
      expect(valid.result.valid).toBe(true);
      expect(valid.result.next_action.command).toContain(`--stage --input ${payload} --format json`);
      expect(valid.result.nodes).toBe(2);
      expect(valid.result.edges).toBe(1);
      expect(valid.result.structure_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(valid.result.review_notice).toMatchObject({
        review_report: { path: expect.stringMatching(/^\.tmp\/context-runtime\/reports\/structure-summary-[a-f0-9]+\.html$/u) },
        confirmation_ready: true,
        confirmation_blockers: [],
      });
      expect(valid.result.structure_summary_compact.counts).toMatchObject({
        nodes: 2,
        sections: 2,
        edges: 1,
        unresolved: 1,
      });
      expect(valid.result.structure_summary_compact.views_by_collection).toContainEqual(expect.objectContaining({
        collection: "architecture",
        view_count: 2,
      }));
      expect(valid.result).not.toHaveProperty("structure_summary");
      expect(valid.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "existing_approved.duplicate_or_unresolved",
        candidate_id: "entity/install",
      }));
      expect(valid.result.structure_report.path).toMatch(/^\.tmp\/context-runtime\/reports\/structure-summary-[a-f0-9]+\.html$/u);
      expect(valid.result.structure_report.absolute_path.endsWith(valid.result.structure_report.path)).toBe(true);
      expect(valid.result.structure_report.file_url).toMatch(/^file:\/\//u);
      const reportHtml = readFileSync(join(projectRoot, valid.result.structure_report.path), "utf8");
      expect(reportHtml).toContain("Structure Summary");
      expect(reportHtml).toContain('data-theme="light"');
      expect(reportHtml).toContain('class="theme-toggle" id="theme"');
      expect(reportHtml).toContain('[data-theme="dark"]');
      expect(reportHtml).not.toContain("prefers-color-scheme");
      expect(reportHtml).toContain("Attention");
      expect(reportHtml).toContain("Structure");
      expect(reportHtml).toContain("Page Plan");
      expect(reportHtml).toContain("Machine Appendix");
      expect(reportHtml).toContain("Source coverage");
      expect(reportHtml).toContain("Shared source refs");
      expect(reportHtml).toContain("Existing approved structure");
      expect(reportHtml).toContain("same_title_different_node_ref");
      expect(reportHtml).toContain("domain/product-docs");
      expect(valid.result.next_action.command).toContain("--stage");

      const summaryView = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "structure-summary",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          view: string;
          valid: boolean;
          review_notice: { review_report: { path: string; absolute_path: string; file_url: string } };
          structure_summary_compact: { counts: { nodes: number; edges: number } };
          structure_summary: {
            counts: { nodes: number; sections: number; edges: number; unresolved: number };
            nodes: Array<{ node_ref: string }>;
            views: Array<{
              view_ref: string;
              connected_edges: Array<{ type: string; from: string; to: string }>;
              shared_source_refs: Array<{ source_ref: string; owners: string[] }>;
              unresolved: Array<{ issue: string; source_ref_count: number }>;
            }>;
            shared_source_refs: Array<{ source_ref: string; owners: string[] }>;
            existing_approved_structure: {
              present: boolean;
              reusable: { node_refs: string[]; view_refs: string[]; section_refs: string[] };
              duplicate_or_unresolved: Array<{ planned_ref: string; approved_ref?: string; reason: string }>;
              related_edges: Array<{ type: string; from: string; to: string }>;
            };
            views_by_collection: Array<{ collection: string; view_count: number; views: Array<{ view_ref: string }> }>;
          };
          structure_report: { path: string; absolute_path: string; file_url: string };
        };
      };
      expect(summaryView.result.view).toBe("structure-summary");
      expect(summaryView.result.valid).toBe(true);
      expect(summaryView.result.review_notice.review_report.path).toBe(valid.result.structure_report.path);
      expect(summaryView.result.review_notice.review_report.file_url).toBe(valid.result.structure_report.file_url);
      expect(summaryView.result.structure_summary_compact.counts.nodes).toBe(2);
      expect(summaryView.result.structure_summary.counts.nodes).toBe(2);
      expect(summaryView.result.structure_summary.counts.edges).toBe(1);
      expect(summaryView.result.structure_summary.counts).toMatchObject({
        nodes: 2,
        sections: 2,
        edges: 1,
        unresolved: 1,
      });
      expect(summaryView.result.structure_summary.nodes.map((node) => node.node_ref)).toContain("domain/product-docs");
      const overviewView = summaryView.result.structure_summary.views.find((view) => view.view_ref === "architecture:domain/product-docs");
      expect(overviewView).toMatchObject({
        view_ref: "architecture:domain/product-docs",
        shared_source_refs: [expect.objectContaining({
          source_ref: sourceRef,
        })],
        unresolved: [expect.objectContaining({
          issue: "weak_evidence",
          source_ref_count: 1,
        })],
      });
      expect(overviewView?.connected_edges).toContainEqual(expect.objectContaining({
        type: "contains",
        from: "domain/product-docs",
        to: "entity/install",
      }));
      expect(summaryView.result.structure_summary.shared_source_refs).toContainEqual(expect.objectContaining({
        source_ref: sourceRef,
        owners: [
          "architecture:domain/product-docs#overview",
          "architecture:entity/install#install",
        ],
      }));
      expect(summaryView.result.structure_summary.existing_approved_structure.present).toBe(true);
      expect(summaryView.result.structure_summary.existing_approved_structure.reusable.node_refs).toContain("domain/product-docs");
      expect(summaryView.result.structure_summary.existing_approved_structure.reusable.view_refs).toContain("architecture:domain/product-docs");
      expect(summaryView.result.structure_summary.existing_approved_structure.duplicate_or_unresolved).toContainEqual(expect.objectContaining({
        planned_ref: "entity/install",
        approved_ref: "entity/setup",
        reason: "same_title_different_node_ref",
      }));
      expect(summaryView.result.structure_summary.existing_approved_structure.related_edges).toContainEqual(expect.objectContaining({
        type: "contains",
        from: "domain/product-docs",
        to: "architecture:entity/setup",
      }));
      expect(summaryView.result.structure_summary.views_by_collection).toContainEqual(expect.objectContaining({
        collection: "architecture",
        view_count: 2,
        views: expect.arrayContaining([
          expect.objectContaining({ view_ref: "architecture:domain/product-docs" }),
          expect.objectContaining({ view_ref: "architecture:entity/install" }),
        ]),
      }));
      expect(summaryView.result.structure_report.path).toBe(valid.result.structure_report.path);
      expect(summaryView.result.structure_report.absolute_path).toBe(valid.result.structure_report.absolute_path);
      expect(summaryView.result.structure_report.file_url).toBe(valid.result.structure_report.file_url);

      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        payload,
        "--format",
        "json",
      ])) as {
        result: {
          kind: string;
          operation: string;
          phase_collection: string;
          nodes: number;
          edges: number;
          structureFile: string;
          structure_report: { path: string; absolute_path: string; file_url: string };
          next_action: { kind: string; command: string; completed_operation: string; reason_code: string };
        };
      };
      expect(staged.result).toMatchObject({
        kind: "prose.align.structure-write.result",
        operation: "staged",
        phase_collection: "architecture",
        nodes: 2,
        edges: 1,
        structureFile: ".tmp/context-runtime/lifecycle/structure.yaml",
      });
      expect(staged.result.next_action).toMatchObject({
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
        completed_operation: "align:file:product-docs:architecture",
        reason_code: "prose-align-structure-staged",
      });
      expect(staged.result).not.toHaveProperty("review_notice");
      expect(staged.result).not.toHaveProperty("structure_summary_compact");
      expect(staged.result.structure_report.path).toBe(valid.result.structure_report.path);
      expect(staged.result.next_action).not.toHaveProperty("review_report");
      const structure = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), "utf8")) as Record<string, unknown>;
      expect(structure).toMatchObject({
        schema_version: "context.structure.v1",
        nodes: [{
          node_ref: "domain/product-docs",
          ownership: "Owns product documentation overview.",
        }, {
          node_ref: "entity/install",
          ownership: "Owns installation guidance.",
        }],
        views: [{
          view_ref: "architecture:domain/product-docs",
          node_ref: "domain/product-docs",
          collection: "architecture",
          containment: "product-docs",
          slug: "overview",
          path: "architecture/product-docs/overview.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:domain/product-docs#overview",
            ownership: "Overview source span",
          }],
        }, {
          view_ref: "architecture:entity/install",
          node_ref: "entity/install",
          collection: "architecture",
          containment: "product-docs",
          slug: "install",
          path: "architecture/product-docs/install.md",
          sections: [{
            id: "install",
            section_ref: "architecture:entity/install#install",
            ownership: "Install source span",
          }],
        }],
        user_or_agent_hints: {
          grouping_notes: ["Keep setup concepts together when evidence supports it."],
        },
        lifecycle: {
          state: "draft",
        },
      });
      expect(JSON.stringify(structure)).toContain("file:product-docs/guide.md#span:");
      expect(JSON.stringify(structure)).not.toContain("block");
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);

      const unsupportedHintPayload = writePayload(projectRoot, "unsupported-hint-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        user_or_agent_hints: {
          preferred_nodes: [{
            node_ref: "entity/not-staged",
            reason: "User mentioned it, but evidence did not support staging it.",
          }],
        },
      });
      const unsupportedHint = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        unsupportedHintPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
      expect(unsupportedHint.result.valid).toBe(true);
      expect(unsupportedHint.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "hint.preferred_node_not_staged",
      }));

      const collectionEndpointPayload = writePayload(projectRoot, "collection-endpoint-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        edges: [{
          type: "contains",
          from: "collection:architecture",
          to: "entity/install",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }],
      });
      const collectionEndpoint = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        collectionEndpointPayload,
        "--format",
        "json",
        "--verbose",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; field?: string }> } };
      expect(collectionEndpoint.result.valid).toBe(false);
      expect(collectionEndpoint.result.diagnostics).toContainEqual(expect.objectContaining({
        code: "edge.from_unknown",
        field: "edges[0].from",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
