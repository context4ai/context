import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefsForRanges,
} from "./projectCompileProseV066Helpers.js";

function localSourceRef(canonical: string): string {
  return canonical.replace(/^file:product-docs\/guide\.md/u, "src-1");
}

function writeApprovedPage(input: {
  projectRoot: string;
  collection: "architecture" | "product";
  type: "Guide" | "Wiki";
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
    "",
    "Alpha opening paragraph for compile.",
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.9 verify affected collection views", () => {
  test("missing approved source refs report affected collection and ViewRef", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const absPath = join(projectRoot, "knowledge", "architecture", "install", "overview.md");
      mkdirSync(join(absPath, ".."), { recursive: true });
      writeFileSync(absPath, [
        "---",
        "title: Install",
        "type: Guide",
        "description: Install source span.",
        "tags:",
        "  - module",
        "timestamp: 2026-06-24T12:00:00Z",
        "resource: file:product-docs/guide.md",
        "sources:",
        "  - file:product-docs/guide.md",
        "node_ref: entity/install",
        "view_ref: architecture:entity/install",
        "node_type: entity",
        "---",
        "",
        "Approved content without a context section.",
        "",
      ].join("\n"), "utf8");

      const verify = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      const result = JSON.parse(verify.stdout) as {
        issues: Array<{
          code: string;
          path?: string;
          collection?: string;
          view_ref?: string;
          node_ref?: string;
          source_keys?: string[];
        }>;
      };
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "approved-source-ref-missing",
        collection: "architecture",
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("source refresh stale evidence reports affected views without inventing a replacement batch", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const [sourceRef] = await sourceRefsForRanges(projectRoot, [{ lineStart: 3, lineEnd: 3 }]);
      if (sourceRef === undefined) throw new Error("expected source ref");

      writeApprovedPage({
        projectRoot,
        collection: "architecture",
        type: "Guide",
        viewRef: "architecture:entity/install",
        nodeRef: "entity/install",
        relPath: "architecture/install/overview.md",
        sourceRef,
      });
      writeApprovedPage({
        projectRoot,
        collection: "product",
        type: "Wiki",
        viewRef: "product:entity/install-requirement",
        nodeRef: "entity/install-requirement",
        relPath: "product/install/requirement.md",
        sourceRef,
      });

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
        issues: Array<{
          code: string;
          path?: string;
          collection?: string;
          view_ref?: string;
          node_ref?: string;
          source_keys?: string[];
        }>;
      };
      const staleIssues = result.issues.filter((issue) => issue.code === "approved-source-ref-stale");
      expect(staleIssues, JSON.stringify(result.issues, null, 2)).toContainEqual(expect.objectContaining({
        collection: "architecture",
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
        source_keys: ["file:product-docs"],
      }));
      expect(staleIssues, JSON.stringify(result.issues, null, 2)).toContainEqual(expect.objectContaining({
        collection: "product",
        view_ref: "product:entity/install-requirement",
        node_ref: "entity/install-requirement",
        source_keys: ["file:product-docs"],
      }));
      const status = await invokeCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"]);
      expect(status.status).toBe(0);
      const statusJson = JSON.parse(status.stdout) as {
        state: string;
        diagnostics: string[];
        routing: { reason: string };
        workflow: { current?: { resources: { required: Array<{ id: string }> } } };
      };
      expect(statusJson.state).toBe("route.evidence.decision-required");
      expect(statusJson.routing.reason).toBe("route.evidence.decision-required");
      expect(statusJson.workflow.current?.resources.required.map((resource) => resource.id)).toContain(
        "procedure.evidence-maintenance",
      );
      expect(statusJson.diagnostics.join("\n")).toContain("collection=architecture view_ref=architecture:entity/install");
      expect(statusJson.diagnostics.join("\n")).toContain("collection=product view_ref=product:entity/install-requirement");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
