import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createCapturedAlignProject, firstSourceRef, makeTmp, runCliInDir, sourceRefForLine, structurePayload, writeCodeindexApprovedStructure, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("classifies orphan risks and approved endpoints", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);

      const orphanRef = sourceRefForLine(projectRoot, "guide.md", 12);
      const orphanPeerRef = sourceRefForLine(projectRoot, "guide.md", 13);
      const orphanPayload = {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [
          ...((structurePayload(projectRoot, sourceRef).nodes as Array<Record<string, unknown>>)),
          {
            node_ref: "entity/orphan",
            title: "Orphan",
            node_type: "entity",
            tags: ["module"],
          },
          {
            node_ref: "entity/orphan-peer",
            title: "Orphan Peer",
            node_type: "entity",
            tags: ["module"],
          },
        ],
        views: [
          ...((structurePayload(projectRoot, sourceRef).views as Array<Record<string, unknown>>)),
          {
            view_ref: "architecture:entity/orphan",
            node_ref: "entity/orphan",
            collection: "architecture",
            containment: "quality",
            slug: "orphan",
            title: "Orphan",
            node_type: "entity",
            path: "architecture/quality/orphan.md",
            sections: [{
              id: "overview",
              section_ref: "architecture:entity/orphan#overview",
              kind: "description",
              source_refs: [orphanRef],
            }],
          },
          {
            view_ref: "architecture:entity/orphan-peer",
            node_ref: "entity/orphan-peer",
            collection: "architecture",
            containment: "quality",
            slug: "orphan-peer",
            title: "Orphan Peer",
            node_type: "entity",
            path: "architecture/quality/orphan-peer.md",
            sections: [{
              id: "overview",
              section_ref: "architecture:entity/orphan-peer#overview",
              kind: "description",
              source_refs: [orphanPeerRef],
            }],
          },
        ],
        edges: [
          ...((structurePayload(projectRoot, sourceRef).edges as Array<Record<string, unknown>>)),
          {
            type: "prerequisite",
            from: "architecture:entity/orphan",
            to: "architecture:entity/orphan-peer",
            source_refs: [orphanRef],
          },
        ],
      };
      const orphanDraftPayload = writePayload(projectRoot, "orphan-draft-structure.yaml", orphanPayload);
      const orphanDraft = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        orphanDraftPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; error_free: boolean; structure_digest: string; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
      expect(orphanDraft.result.valid).toBe(false);
      expect(orphanDraft.result.error_free).toBe(true);
      expect(orphanDraft.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "view.orphan_risk",
        candidate_id: "architecture:entity/orphan",
      }));
      const orphanConfirmedPayload = writePayload(projectRoot, "orphan-confirmed-structure.yaml", {
        ...orphanPayload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: orphanDraft.result.structure_digest,
        },
      });
      const orphanConfirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        orphanConfirmedPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
      expect(orphanConfirmed.result.valid).toBe(false);
      expect(orphanConfirmed.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "view.orphan_risk",
        candidate_id: "architecture:entity/orphan",
      }));

      const singleViewPayload = {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/standalone",
          title: "Standalone Entity",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/standalone",
          node_ref: "entity/standalone",
          collection: "architecture",
          containment: "entities",
          slug: "standalone",
          title: "Standalone Entity",
          node_type: "entity",
          path: "architecture/entities/standalone.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/standalone#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [],
        unresolved: [],
      };
      const singleDraftPayload = writePayload(projectRoot, "single-draft-structure.yaml", singleViewPayload);
      const singleDraft = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        singleDraftPayload,
        "--format",
        "json",
      ])) as { result: { structure_digest: string } };
      const singleConfirmedPayload = writePayload(projectRoot, "single-confirmed-structure.yaml", {
        ...singleViewPayload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: singleDraft.result.structure_digest,
        },
      });
      const singleConfirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        singleConfirmedPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
      expect(singleConfirmed.result.valid).toBe(true);
      expect(singleConfirmed.result.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "view.orphan_risk",
        candidate_id: "architecture:entity/standalone",
      }));

      const islandPayload = {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/island-a",
          title: "Island A",
          node_type: "entity",
          tags: ["module"],
        }, {
          node_ref: "entity/island-b",
          title: "Island B",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/island-a",
          node_ref: "entity/island-a",
          collection: "architecture",
          containment: "quality",
          slug: "island-a",
          title: "Island A",
          node_type: "entity",
          path: "architecture/quality/island-a.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/island-a#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/island-b",
          node_ref: "entity/island-b",
          collection: "architecture",
          containment: "quality",
          slug: "island-b",
          title: "Island B",
          node_type: "entity",
          path: "architecture/quality/island-b.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/island-b#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [{
          type: "corresponds_to",
          from: "entity/island-a",
          to: "entity/island-b",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }],
        unresolved: [],
      };
      const islandDraftPayload = writePayload(projectRoot, "island-draft-structure.yaml", islandPayload);
      const islandDraft = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        islandDraftPayload,
        "--format",
        "json",
      ])) as { result: { structure_digest: string } };
      const islandConfirmedPayload = writePayload(projectRoot, "island-confirmed-structure.yaml", {
        ...islandPayload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: islandDraft.result.structure_digest,
        },
      });
      const islandConfirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        islandConfirmedPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
      expect(islandConfirmed.result.valid).toBe(false);
      expect(islandConfirmed.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "view.orphan_risk",
        candidate_id: "architecture:entity/island-a",
      }));
      expect(islandConfirmed.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "view.orphan_risk",
        candidate_id: "architecture:entity/island-b",
      }));

      const containsRootPayload = {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/container",
          title: "Container",
          node_type: "entity",
          tags: ["module"],
        }, {
          node_ref: "entity/contained",
          title: "Contained",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/container",
          node_ref: "entity/container",
          collection: "architecture",
          containment: "quality",
          slug: "container",
          title: "Container",
          node_type: "entity",
          path: "architecture/quality/container.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/container#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }, {
          view_ref: "architecture:entity/contained",
          node_ref: "entity/contained",
          collection: "architecture",
          containment: "quality",
          slug: "contained",
          title: "Contained",
          node_type: "entity",
          path: "architecture/quality/contained.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/contained#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [{
          type: "contains",
          from: "entity/container",
          to: "entity/contained",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }],
        unresolved: [],
      };
      const containsRootDraftPayload = writePayload(projectRoot, "contains-root-draft-structure.yaml", containsRootPayload);
      const containsRootDraft = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        containsRootDraftPayload,
        "--format",
        "json",
      ])) as { result: { structure_digest: string } };
      const containsRootConfirmedPayload = writePayload(projectRoot, "contains-root-confirmed-structure.yaml", {
        ...containsRootPayload,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: containsRootDraft.result.structure_digest,
        },
      });
      const containsRootConfirmed = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        containsRootConfirmedPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> } };
      expect(containsRootConfirmed.result.valid).toBe(true);
      expect(containsRootConfirmed.result.diagnostics.map((item) => item.code)).not.toContain("view.orphan_risk");

      writeCodeindexApprovedStructure(projectRoot);
      const codeindexEndpointPayload = writePayload(projectRoot, "codeindex-endpoint-structure.yaml", {
        ...structurePayload(projectRoot, sourceRef),
        nodes: [{
          node_ref: "entity/install",
          title: "Install",
          node_type: "entity",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/install",
          node_ref: "entity/install",
          collection: "architecture",
          containment: "product-docs",
          slug: "install",
          title: "Install",
          node_type: "entity",
          path: "architecture/product-docs/install.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/install#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [{
          type: "corresponds_to",
          from: "architecture:entity/install",
          to: "codeindex:entity/gateway",
          source_refs: [sourceRefForLine(projectRoot, "guide.md", 7)],
        }],
        unresolved: [],
      });
      const codeindexEndpoint = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        codeindexEndpointPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string }> } };
      expect(codeindexEndpoint.result.valid).toBe(true);
      expect(codeindexEndpoint.result.diagnostics.map((item) => item.code)).not.toContain("edge.to_unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
