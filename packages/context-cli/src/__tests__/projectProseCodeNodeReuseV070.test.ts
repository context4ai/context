import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedAlignProject,
  makeTmp,
  runCliInDir,
  sourceRefForLine,
  writePayload,
} from "./projectAlignProseV062Helpers.js";

describe("0.7.0 prose and code NodeRef reuse", () => {
  test("allows an exact approved codeindex NodeRef without inventing a typed duplicate", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = sourceRefForLine(projectRoot, "guide.md", 7);
      mkdirSync(join(projectRoot, "knowledge", "codeindex", "sample-web"), { recursive: true });
      writeFileSync(join(projectRoot, "knowledge", "codeindex", "sample-web", "overview.md"), [
        "---",
        "title: Sample Web",
        "node_ref: sample-web/overview",
        "node_type: entity",
        "view_ref: codeindex:sample-web/overview",
        "sources:",
        "  - file:product-docs/guide.md",
        "---",
        "",
        `<!-- context:section id="overview" kind="description" content_mode="verbatim" source_ref="${sourceRef}" -->`,
        "Install the package before configuring it.",
        "<!-- /context:section -->",
        "",
      ].join("\n"), "utf8");

      const payload = writePayload(projectRoot, "reuse-code-node.yaml", {
        schema_version: "context.structure.v1",
        sources: ["file:product-docs"],
        nodes: [{
          node_ref: "sample-web/overview",
          title: "Sample Web",
          node_type: "entity",
          tags: ["lib"],
        }],
        views: [{
          view_ref: "architecture:sample-web/overview",
          node_ref: "sample-web/overview",
          collection: "architecture",
          containment: "faq",
          slug: "sample-web",
          title: "Sample Web FAQ",
          node_type: "entity",
          path: "architecture/faq/sample-web.md",
          sections: [{
            id: "faq",
            section_ref: "architecture:sample-web/overview#faq",
            kind: "description",
            source_refs: [sourceRef],
          }],
        }],
        edges: [],
        unresolved: [],
        lifecycle: { state: "draft" },
      });
      const output = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        payload,
        "--format",
        "json",
        "--verbose",
      ])) as {
        result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; candidate_id?: string }> };
      };
      expect(output.result.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "schema.node_ref_type_mismatch",
        candidate_id: "sample-web/overview",
      }));
      expect(output.result.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "existing_approved.duplicate_or_unresolved",
        candidate_id: "sample-web/overview",
      }));
      expect(output.result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
      expect(output.result.valid).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
