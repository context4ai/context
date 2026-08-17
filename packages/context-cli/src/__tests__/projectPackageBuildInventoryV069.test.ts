import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import {
  packageBuildInventory,
  packageScopedKnowledgeStructure,
  readKnowledgeStructure,
  type SelectedApprovedKnowledgeFile,
} from "../project/packageBuildInventory.js";

function approvedPage(input: {
  title: string;
  nodeRef: string;
  viewRef: string;
}): string {
  return [
    "---",
    `title: ${input.title}`,
    "type: Skill",
    `node_ref: ${input.nodeRef}`,
    `view_ref: ${input.viewRef}`,
    "node_type: action",
    `description: ${input.title}`,
    "tags:",
    "  - runbook",
    "timestamp: 2026-06-28T00:00:00.000Z",
    "sources:",
    "  - file:docs/index.md",
    "---",
    "",
    `# ${input.title}`,
    "",
  ].join("\n");
}

describe("0.6.9 package build inventory collection summaries", () => {
  test("summarizes selected knowledge by internal collection instead of navigation group", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "context-cli-inventory-v069-"));
    mkdirSync(join(projectRoot, "knowledge"), { recursive: true });
    writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), `${JSON.stringify({
      schema_version: "context.approved-structure.v1",
      nodes: [{
        node_ref: "action/alpha",
        title: "Alpha Feature",
        node_type: "action",
      }, {
        node_ref: "action/beta",
        title: "Beta Experiment",
        node_type: "action",
      }, {
        node_ref: "action/gamma",
        title: "Gamma Unselected",
        node_type: "action",
      }],
      views: [{
        view_ref: "feats:action/alpha",
        node_ref: "action/alpha",
        collection: "feats",
        path: "feats/feature/alpha.md",
        sections: [{ section_ref: "feats:action/alpha#overview" }],
      }, {
        view_ref: "architecture:action/alpha",
        node_ref: "action/alpha",
        collection: "architecture",
        path: "architecture/feature/alpha.md",
        sections: [{ section_ref: "architecture:action/alpha#overview" }],
      }, {
        view_ref: "feats:action/beta",
        node_ref: "action/beta",
        collection: "feats",
        path: "feats/experiment/beta.md",
        sections: [{ section_ref: "feats:action/beta#overview" }],
      }, {
        view_ref: "feats:action/gamma",
        node_ref: "action/gamma",
        collection: "feats",
        path: "feats/experiment/gamma.md",
        sections: [{ section_ref: "feats:action/gamma#overview" }],
      }],
      edges: [{
        type: "depends_on",
        from: "action/alpha",
        to: "feats:action/beta",
        source_refs: ["file:docs/index.md#span:alpha L1-1@abcdef123456"],
      }, {
        type: "depends_on",
        from: "feats:action/gamma",
        to: "feats:action/beta",
        source_refs: ["file:docs/index.md#span:gamma L2-2@abcdef123456"],
      }],
    })}\n`, "utf8");
    const selected: SelectedApprovedKnowledgeFile[] = [{
      relPath: "feats/feature/alpha.md",
      absPath: join(projectRoot, "knowledge", "feats", "feature", "alpha.md"),
      content: approvedPage({
        title: "Alpha Feature",
        nodeRef: "action/alpha",
        viewRef: "feats:action/alpha",
      }),
      selectedBy: [{ kind: "collection", value: "feats" }],
    }, {
      relPath: "feats/experiment/beta.md",
      absPath: join(projectRoot, "knowledge", "feats", "experiment", "beta.md"),
      content: approvedPage({
        title: "Beta Experiment",
        nodeRef: "action/beta",
        viewRef: "feats:action/beta",
      }),
      selectedBy: [{ kind: "collection", value: "feats" }],
    }];

    const scopedStructure = packageScopedKnowledgeStructure({
      selected,
      structure: await readKnowledgeStructure(projectRoot),
    });
    expect(JSON.stringify(scopedStructure.parsed)).not.toContain("action/gamma");
    expect(JSON.stringify(scopedStructure.parsed)).not.toContain("architecture:action/alpha");

    const inventory = packageBuildInventory({
      pkg: {
        kind: "package.kb",
        name: "sample-kb",
        outDir: "dist/sample-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
      } as PackageDefinition,
      selected,
      structure: scopedStructure,
      verifyEvidenceStatus: "pass",
    }) as {
      approved_knowledge: {
        groups: Array<{ name: string; internal_collection: string; count: number }>;
        collections: Array<{
          collection: string;
          internal_collection: string;
          okf_root: string;
          count: number;
          edge_count: number;
          edge_contract: { validation_scope: string; valid: boolean; checked: number };
        }>;
      };
      structure: {
        scope: string;
        nodes: number;
        edges: number;
        edge_contract: { validation_scope: string; valid: boolean; checked: number };
        edge_records_scope: string;
        edge_records: Array<{
          type: string;
          from: string;
          to: string;
          source_refs: string[];
          collections: string[];
          okf_roots: string[];
        }>;
        relationship_coverage: {
          state: string;
          codegraph_views: number;
          emitted_edges: number;
        };
      };
    };

    expect(inventory.approved_knowledge.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "feature", internal_collection: "feats", count: 1 }),
      expect.objectContaining({ name: "experiment", internal_collection: "feats", count: 1 }),
    ]));
    expect(inventory.approved_knowledge.collections).toEqual([expect.objectContaining({
      collection: "feats",
      internal_collection: "feats",
      okf_root: "feats",
      count: 2,
      edge_count: 1,
      edge_contract: expect.objectContaining({
        validation_scope: "collection",
        valid: true,
        checked: 1,
      }),
    })]);
    expect(inventory.structure).toMatchObject({
      scope: "selected-package",
      nodes: 2,
      edges: 1,
      edge_contract: {
        validation_scope: "structure",
        valid: true,
        checked: 1,
      },
    });
    expect(inventory.structure.edge_records_scope).toBe("selected-package");
    expect(inventory.structure.edge_records).toEqual([expect.objectContaining({
      type: "depends_on",
      from: "action/alpha",
      to: "feats:action/beta",
      source_refs: ["file:docs/index.md#span:alpha L1-1@abcdef123456"],
      collections: ["feats"],
      okf_roots: ["feats"],
    })]);
    expect(inventory.structure.relationship_coverage).toEqual(expect.objectContaining({
      state: "not-applicable",
      codegraph_views: 0,
      emitted_edges: 0,
    }));
  });
});
