import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { PackageDefinition } from "@c4a/context";
import YAML from "yaml";
import {
  computeDocumentContentHash,
  createDocumentSnapshotManifest,
} from "@c4a/extract";
import {
  knowledgeAssetReferences,
  projectKnowledgeAssets,
  removeOrphanKnowledgeAssets,
  unprojectedSourceAssetLinks,
} from "../project/knowledgeAssets.js";
import { repairApprovedKnowledgeAssetProjections } from "../project/knowledgeAssetRepair.js";
import { projectPackageKnowledgeAssets } from "../project/packageAssets.js";
import { reviewResourcePreviewsFor } from "../project/reviewHtml.js";
import { verifyProjectWorkspace } from "../project/verify.js";

describe("0.6.2 knowledge resource projection", () => {
  test("moves approved resources into knowledge/assets and package others/assets", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-knowledge-assets-"));
    try {
      const sourceBytes = Buffer.from("example-image", "utf8");
      const sourcePath = "assets/materialized/image/example.png";
      const sourceRoot = "sources/lark/20260813/example";
      await mkdir(join(projectRoot, sourceRoot, dirname(sourcePath)), { recursive: true });
      await writeFile(join(projectRoot, sourceRoot, sourcePath), sourceBytes);
      const manifest = createDocumentSnapshotManifest({
        sourceType: "lark",
        sourceName: "20260813/example",
        capturedAt: "2026-08-13T00:00:00.000Z",
        files: [{ path: "index.md", bytes: "# Example\n", title: "Example" }],
        assets: [{
          path: sourcePath,
          content_hash: computeDocumentContentHash(sourceBytes),
          media_type: "image/png",
          role: "evidence",
          source: { kind: "image", locator: "lark:image:example-token" },
        }],
      });
      const pageRelPath = "knowledge/guides/example.md";
      const projected = await projectKnowledgeAssets({
        projectRoot,
        pageRelPath,
        content: "# Example\n\n![One \\[nested\\]](assets/materialized/image/example.png) <!-- lark:image:example-token -->\n",
        sourceMaterializedAt: sourceRoot,
        documentPath: "index.md",
        manifest,
      });

      expect(projected.assets).toHaveLength(1);
      expect(projected.assets[0]?.relPath).toMatch(/^knowledge\/assets\/image\/[a-f0-9]{64}\.png$/u);
      expect(projected.content).toContain("![One \\[nested\\]](../assets/image/");
      expect(knowledgeAssetReferences({ pageRelPath, content: projected.content })).toEqual([
        projected.assets[0]!.relPath,
      ]);
      await mkdir(dirname(projected.assets[0]!.absPath), { recursive: true });
      await writeFile(projected.assets[0]!.absPath, projected.assets[0]!.bytes);

      const pkg = {
        kind: "package.kb",
        name: "example-kb",
        outDir: "dist/example-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
      } as PackageDefinition;
      const packaged = await projectPackageKnowledgeAssets({
        projectRoot,
        pkg,
        file: {
          relPath: "guides/example.md",
          absPath: join(projectRoot, pageRelPath),
          content: projected.content,
        },
        content: projected.content,
      });
      expect(packaged.pageOutputPath).toBe("guides/example.md");
      expect(packaged.assets).toHaveLength(1);
      expect(packaged.assets[0]?.packageRelPath).toMatch(/^others\/assets\/image\/[a-f0-9]{64}\.png$/u);
      expect(packaged.content).toContain("![One \\[nested\\]](../others/assets/image/");
      expect(Buffer.from(packaged.assets[0]!.bytes).toString("utf8")).toBe("example-image");

      const orphan = join(projectRoot, "knowledge", "assets", "image", "orphan.png");
      await writeFile(orphan, "orphan", "utf8");
      await mkdir(dirname(join(projectRoot, pageRelPath)), { recursive: true });
      await writeFile(join(projectRoot, pageRelPath), projected.content, "utf8");
      expect(await removeOrphanKnowledgeAssets(projectRoot)).toEqual(["knowledge/assets/image/orphan.png"]);
      expect(await readFile(projected.assets[0]!.absPath, "utf8")).toBe("example-image");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("repairs approved source asset links deterministically during close preparation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-knowledge-assets-repair-"));
    try {
      const sourceBytes = Buffer.from("escaped-label-image", "utf8");
      const sourceAssetPath = "assets/example/materialized/image/example.png";
      const sourceRoot = join(projectRoot, "sources", "lark", "20260813");
      await mkdir(join(sourceRoot, dirname(sourceAssetPath)), { recursive: true });
      await writeFile(join(sourceRoot, "example.md"), "# Example\n", "utf8");
      await writeFile(join(sourceRoot, sourceAssetPath), sourceBytes);
      const manifest = createDocumentSnapshotManifest({
        sourceType: "lark",
        sourceName: "20260813/example",
        capturedAt: "2026-08-13T00:00:00.000Z",
        files: [{ path: "example.md", bytes: "# Example\n", title: "Example" }],
        assets: [{
          path: sourceAssetPath,
          content_hash: computeDocumentContentHash(sourceBytes),
          media_type: "image/png",
          role: "evidence",
          source: { kind: "image", locator: "lark:image:example-token" },
        }],
      });
      await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify({
        schema_version: "context.document-snapshot-batch.v1",
        source_type: "lark",
        batch: "20260813",
        sources: { example: manifest },
      }, null, 2)}\n`, "utf8");
      await mkdir(join(projectRoot, "sources", "lark"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "lark", "index.yaml"), YAML.stringify({
        sources: [{
          name: "20260813",
          modules: [{ name: "example", url: "https://example.test/docx/example" }],
        }],
      }), "utf8");

      const approvedPath = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(approvedPath), { recursive: true });
      const approved = [
        "---",
        YAML.stringify({
          title: "Example",
          type: "Guide",
          node_ref: "action/example",
          view_ref: "sop:action/example",
          node_type: "action",
          description: "Example resource projection.",
          tags: ["docs"],
          timestamp: "2026-08-13T00:00:00.000Z",
          resource: "lark:20260813/example/example.md",
          sources: ["lark:20260813/example/example.md"],
        }).trimEnd(),
        "---",
        "",
        "![One \\[nested\\]](assets/example/materialized/image/example.png) <!-- lark:image:example-token -->",
        "",
      ].join("\n");
      await writeFile(approvedPath, approved, "utf8");
      expect(unprojectedSourceAssetLinks(approved)).toHaveLength(1);
      expect((await verifyProjectWorkspace(projectRoot)).issues).toContainEqual(expect.objectContaining({
        code: "approved-resource-source-path-unprojected",
        path: "guides/example.md",
      }));

      const repaired = await repairApprovedKnowledgeAssetProjections(projectRoot);
      expect(repaired.repairedPages).toEqual(["guides/example.md"]);
      expect(repaired.writtenAssets).toHaveLength(1);
      const content = await readFile(approvedPath, "utf8");
      expect(content).toMatch(/!\[One \\\[nested\\\]\]\(\.\.\/assets\/image\/[a-f0-9]{64}\.png\)/u);
      expect(unprojectedSourceAssetLinks(content)).toEqual([]);
      expect((await verifyProjectWorkspace(projectRoot)).issues.map((issue) => issue.code))
        .not.toContain("approved-resource-source-path-unprojected");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("verify reports missing projected resources and unresolved required placeholders", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-knowledge-assets-verify-"));
    try {
      const page = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(page), { recursive: true });
      await writeFile(page, [
        "---",
        "title: Example",
        "type: Guide",
        "node_ref: action/example",
        "view_ref: sop:action/example",
        "description: Example.",
        "tags: [action]",
        "timestamp: 2026-08-13T00:00:00.000Z",
        "resource: lark:20260813/example/index.md",
        "sources: [lark:20260813/example/index.md]",
        "---",
        "",
        "![Missing](../assets/image/missing.png)",
        "",
        "> Whiteboard: lark:whiteboard:board-token",
      ].join("\n"), "utf8");
      const result = await verifyProjectWorkspace(projectRoot);
      expect(result.issues.map((issue) => issue.code)).toContain("approved-resource-missing");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-resource-placeholder-unresolved");
      expect(result.issues.find((issue) => issue.code === "approved-resource-placeholder-unresolved")).toMatchObject({
        view_ref: "sop:action/example",
        source_keys: ["lark:20260813/example"],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("Review exposes materialized and reference-only resource status without interpreting content", () => {
    const imageBytes = Buffer.from("image", "utf8");
    const manifest = createDocumentSnapshotManifest({
      sourceType: "lark",
      sourceName: "20260813/review-resources",
      capturedAt: "2026-08-13T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Review\n", title: "Review" }],
      assets: [{
        path: "assets/materialized/image/example.png",
        content_hash: computeDocumentContentHash(imageBytes),
        media_type: "image/png",
        role: "presentation",
        source: { kind: "image", locator: "lark:image:example", title: "Diagram" },
      }],
      metadata: {
        capture: {
          resourceMaterialization: {
            status: "complete",
            discovered: { cite: 1, image: 1 },
            materialized: { image: 1 },
            reference_only: { cite: 1 },
            failed: {},
            items: [
              {
                kind: "image",
                locator: "lark:image:example",
                status: "materialized",
                required: true,
                asset_paths: ["materialized/image/example.png"],
              },
              {
                kind: "cite",
                locator: "lark:cite:reference",
                status: "reference-only",
                required: false,
                asset_paths: [],
                reason: "external navigation reference",
              },
            ],
          },
        },
      },
    });
    const previews = reviewResourcePreviewsFor({
      projectRoot: "/tmp/example-project",
      materializedAt: "sources/lark/20260813/review-resources",
      documentPath: "index.md",
      markdown: [
        "![Diagram](assets/materialized/image/example.png) <!-- lark:image:example -->",
        "[Reference](https://example.test) <!-- lark:cite:reference -->",
      ].join("\n\n"),
      manifest,
    });

    expect(previews).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "image", status: "materialized", image: true }),
      expect.objectContaining({ kind: "cite", status: "reference-only", reason: "external navigation reference" }),
    ]));
  });
});
