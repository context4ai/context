import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  sourceRefsForRanges,
  stageConfirmedRichStructure,
  writeYaml,
} from "../__tests__/projectCompileProseV066Helpers.js";

function localSourceRef(canonical: string): string {
  return canonical.replace(/^file:product-docs\/guide\.md/u, "src-1");
}

function writeApprovedPage(input: {
  projectRoot: string;
  collection: "architecture" | "product";
  type: "Wiki" | "Rule";
  viewRef: string;
  nodeRef: string;
  relPath: string;
  sourceRef: string;
}): void {
  const absPath = join(input.projectRoot, "knowledge", input.relPath);
  mkdirSync(join(absPath, ".."), { recursive: true });
  writeFileSync(absPath, [
    "---",
    "title: Install",
    `type: ${input.type}`,
    "description: Install source span.",
    "tags:",
    "  - module",
    "timestamp: 2026-06-24T12:00:00Z",
    "resource: file:product-docs/guide.md",
    "sources:",
    "  - file:product-docs/guide.md",
    `node_ref: ${input.nodeRef}`,
    `view_ref: ${input.viewRef}`,
    "node_type: entity",
    "---",
    "",
    `<!-- context:section id="overview" kind="description" source_ref="${localSourceRef(input.sourceRef)}" content_mode="verbatim" -->`,
    "Alpha opening paragraph for compile.",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.9 regression E2E", () => {
  test("prose align rejects codegraph and feats collection payloads", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const [sourceRef] = await sourceRefs(projectRoot);
      const manifest = JSON.parse(readFileSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), "utf8")) as {
        snapshot_hash: string;
      };

      for (const collection of ["codegraph", "feats"]) {
        const payloadPath = writeYaml(projectRoot, `${collection}-e2e-structure.yaml`, {
          schema_version: "context.structure.v1",
          sources: ["file:product-docs"],
          evidence_snapshot_hash: manifest.snapshot_hash,
          nodes: [{
            node_ref: "entity/install",
            title: "Install",
            node_type: "entity",
            tags: ["module"],
          }],
          views: [{
            view_ref: `${collection}:entity/install`,
            node_ref: "entity/install",
            collection,
            containment: "approved",
            slug: "install",
            title: "Install",
            node_type: "entity",
            path: `${collection}/approved/install.md`,
            sections: [{
              id: "overview",
              section_ref: `${collection}:entity/install#overview`,
              kind: "description",
              source_refs: [sourceRef],
            }],
          }],
          edges: [],
          unresolved: [],
          lifecycle: { state: "draft" },
        });

        const result = JSON.parse(await runCliInDir(projectRoot, [
          "run",
          "align:file:product-docs:architecture",
          "--validate",
          "--input",
          payloadPath,
          "--format",
          "json",
        ])) as {
          result: {
            valid: boolean;
            diagnostics: Array<{ code: string; field?: string; repair?: Record<string, unknown> }>;
            next_action: { reason_code: string; command: string };
          };
        };

        expect(result.result.valid).toBe(false);
        expect(result.result.next_action).toMatchObject({ reason_code: "prose-align-structure-invalid" });
        expect(result.result.next_action.command).toContain("--view read-plan");
        expect(result.result.diagnostics).toContainEqual(expect.objectContaining({
          code: "schema.collection_invalid",
          field: "views[0].collection",
          repair: expect.objectContaining({ action: "choose_document_mainline_collection" }),
        }));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source drift reports affected collection views and blocks stale candidate apply", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const [sourceRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 3, lineEnd: 3 }]);
      if (sourceRef === undefined) throw new Error("expected source ref");

      writeApprovedPage({
        projectRoot,
        collection: "architecture",
        type: "Wiki",
        viewRef: "architecture:entity/install",
        nodeRef: "entity/install",
        relPath: "architecture/install/overview.md",
        sourceRef,
      });
      writeApprovedPage({
        projectRoot,
        collection: "product",
        type: "Rule",
        viewRef: "product:entity/install-requirement",
        nodeRef: "entity/install-requirement",
        relPath: "product/install/requirement.md",
        sourceRef,
      });

      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const context = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as {
        result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } };
      };
      const actionFile = writeYaml(projectRoot, "stale-candidate-e2e-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ]);

      writeFileSync(join(root, "docs", "guide.md"), [
        "# Guide",
        "",
        "Changed opening paragraph for compile.",
        "",
        "## Install",
        "",
        "- Keep the first install step.",
        "- Preserve the second install step.",
        "",
      ].join("\n"), "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      const verify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      const result = JSON.parse(verify.stdout) as {
        issues: Array<{ code: string; collection?: string; view_ref?: string; node_ref?: string }>;
      };
      const staleIssues = result.issues.filter((issue) => issue.code === "approved-source-ref-stale");
      expect(staleIssues).toContainEqual(expect.objectContaining({
        collection: "architecture",
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
      }));
      expect(staleIssues).toContainEqual(expect.objectContaining({
        collection: "product",
        view_ref: "product:entity/install-requirement",
        node_ref: "entity/install-requirement",
      }));

      const status = await invokeCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"]);
      expect(status.status).toBe(0);
      const statusJson = JSON.parse(status.stdout) as {
        state: string;
        diagnostics: string[];
        compileBatch: { staleViewRefs: string[]; staleSourceKeys: string[] };
      };
      expect(statusJson.state).toBe("route.verify.failed");
      expect(statusJson.compileBatch.staleViewRefs).toContain("architecture:entity/install");
      expect(statusJson.compileBatch.staleSourceKeys).toContain("file:product-docs");
      expect(statusJson.diagnostics.join("\n")).toContain("collection=architecture view_ref=architecture:entity/install");
      expect(statusJson.diagnostics.join("\n")).toContain("collection=product view_ref=product:entity/install-requirement");

      const staleApply = await invokeCliInDir(projectRoot, [
        "review",
        "approve",
        "architecture/entity/install",
        "--collection",
        "architecture",
        "--format",
        "json",
      ]);
      expect(staleApply.status).not.toBe(0);
      expect(staleApply.stderr).toContain("review is blocked because prose candidates target an older source snapshot");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
