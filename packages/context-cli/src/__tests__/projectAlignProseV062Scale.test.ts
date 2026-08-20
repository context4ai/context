import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  createCapturedAlignProject,
  firstSourceRef,
  largeNarrativePayload,
  makeTmp,
  runCliInDir,
  writePayload,
} from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure scale guidance", () => {
  test("keeps size-based split guidance advisory for draft and confirmed structures", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const normalPayload = writePayload(
        projectRoot,
        "normal-multi-section-draft.yaml",
        largeNarrativePayload(projectRoot, sourceRef, 24),
      );
      const normal = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "structure-summary",
        "--input",
        normalPayload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          confirmation_blockers: Array<{ code: string }>;
          structure_summary: { views: Array<{ split_recommendation: { status: string } }> };
        };
      };
      expect(normal.result.confirmation_blockers).not.toContainEqual(expect.objectContaining({
        code: "view.split_recommended",
      }));
      expect(normal.result.structure_summary.views[0]?.split_recommendation.status).toBe("not_recommended");

      const largePayload = writePayload(
        projectRoot,
        "large-narrative-draft.yaml",
        largeNarrativePayload(projectRoot, sourceRef),
      );
      const large = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--view",
        "structure-summary",
        "--input",
        largePayload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          valid: boolean;
          error_free: boolean;
          confirmation_ready: boolean;
          confirmation_blockers: Array<{ code: string; candidate_id?: string }>;
          next_action: { kind: string; command: string };
          diagnostics: Array<{ severity: string; code: string; candidate_id?: string }>;
          structure_digest: string;
          structure_summary: {
            structure_digest: string;
            views: Array<{
              split_recommendation: {
                status: string;
                reason: string;
                parent_index_view_ref?: string;
                suggested_child_views: Array<{
                  group_id: string;
                  section_ids: string[];
                  section_count: number;
                  node_ref: string;
                  view_ref: string;
                  title: string;
                  source_ref_count: number;
                  source_refs: string[];
                }>;
                suggested_child_view_refs: string[];
                contains_edge_drafts: Array<{
                  type: string;
                  from: string;
                  to: string;
                  source_refs: string[];
                  generated?: string;
                }>;
              };
            }>;
          };
        };
      };
      expect(large.result.valid).toBe(true);
      expect(large.result.error_free).toBe(true);
      expect(large.result.confirmation_ready).toBe(true);
      expect(large.result.confirmation_blockers).toEqual([]);
      expect(large.result.next_action).toMatchObject({
        kind: "stage_structure",
        command: expect.stringContaining(
          "--stage --input .tmp/agent-payloads/align-file-product-docs-architecture-structure.yaml",
        ),
      });
      expect(large.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "view.split_recommended",
        candidate_id: "architecture:action/large-runbook",
      }));
      expect(large.result.structure_summary.views[0]?.split_recommendation).toMatchObject({
        status: "split_recommended",
        reason: "too_many_sections",
        parent_index_view_ref: "architecture:action/large-runbook",
      });
      expect(large.result.structure_summary.views[0]?.split_recommendation.suggested_child_views).toEqual([
        expect.objectContaining({
          group_id: "part-01",
          section_ids: Array.from({ length: 13 }, (_, index) => `segment-${index + 1}`),
          section_count: 13,
          node_ref: "action/large-runbook/part-01",
          view_ref: "architecture:action/large-runbook/part-01",
          title: "Part 1",
          source_ref_count: 1,
          source_refs: expect.arrayContaining([sourceRef]),
        }),
        expect.objectContaining({
          group_id: "part-02",
          section_ids: Array.from({ length: 12 }, (_, index) => `segment-${index + 14}`),
          section_count: 12,
          node_ref: "action/large-runbook/part-02",
          view_ref: "architecture:action/large-runbook/part-02",
          title: "Part 2",
          source_ref_count: 1,
          source_refs: expect.arrayContaining([sourceRef]),
        }),
      ]);
      expect(large.result.structure_summary.views[0]?.split_recommendation.suggested_child_view_refs)
        .toEqual([
          "architecture:action/large-runbook/part-01",
          "architecture:action/large-runbook/part-02",
        ]);
      expect(large.result.structure_summary.views[0]?.split_recommendation.contains_edge_drafts).toContainEqual(
        expect.objectContaining({
          type: "contains",
          from: "architecture:action/large-runbook",
          to: "architecture:action/large-runbook/part-01",
          source_refs: expect.arrayContaining([sourceRef]),
        }),
      );
      expect(large.result.structure_summary.views[0]?.split_recommendation.contains_edge_drafts[0])
        .not.toHaveProperty("generated");

      const confirmedPayload = writePayload(projectRoot, "large-narrative-confirmed.yaml", {
        ...largeNarrativePayload(projectRoot, sourceRef),
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: large.result.structure_summary.structure_digest,
        },
      });
      const confirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        confirmedPayload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: {
          valid: boolean;
          diagnostics: Array<{ severity: string; code: string; candidate_id?: string }>;
        };
      };
      expect(confirmed.result.valid).toBe(true);
      expect(confirmed.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "view.split_recommended",
        candidate_id: "architecture:action/large-runbook",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
