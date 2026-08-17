import {
  computeDocumentContentHash,
  createDocumentSnapshotManifest,
  createDocumentSourceSpan,
  formatSpanSourceRef,
} from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { closeProjectWorkspace } from "../project/close.js";
import { projectKnowledgeAssets } from "../project/knowledgeAssets.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ctx-project-verify-section-refs-v062-"));
}

async function writeFileRegistry(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
    sources: [
      {
        name: "docs",
        snapshot: {
          manifest: "sources/file/docs/manifest.json",
        },
      },
    ],
  }), "utf8");
}

async function writeSnapshot(input: {
  projectRoot: string;
  bytes: string;
}): Promise<void> {
  const root = join(input.projectRoot, "sources", "file", "docs");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "index.md"), input.bytes, "utf8");
  const manifest = createDocumentSnapshotManifest({
    sourceType: "file",
    sourceName: "docs",
    capturedAt: "2026-06-23T00:00:00.000Z",
    files: [{ path: "index.md", bytes: input.bytes, title: "Overview" }],
  });
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("0.6.2 approved section source_ref validation", () => {
  test("accepts deterministic resource-link projection while preserving verbatim fidelity", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = "# Overview\n\nSee [Reference](assets/materialized/synced-reference/reference.md).\n";
      const assetBytes = Buffer.from("# External reference\n", "utf8");
      const sourceRoot = join(projectRoot, "sources", "file", "docs");
      const assetPath = "assets/materialized/synced-reference/reference.md";
      await mkdir(join(sourceRoot, "assets", "materialized", "synced-reference"), { recursive: true });
      await writeFile(join(sourceRoot, "index.md"), markdown, "utf8");
      await writeFile(join(sourceRoot, assetPath), assetBytes);
      const manifest = createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-06-23T00:00:00.000Z",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
        assets: [{
          path: assetPath,
          content_hash: computeDocumentContentHash(assetBytes),
          media_type: "text/markdown",
          role: "evidence",
          source: { kind: "synced-reference", locator: "file:reference" },
        }],
      });
      await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      const pageRelPath = "knowledge/architecture/entity/resource-reference.md";
      const projected = await projectKnowledgeAssets({
        projectRoot,
        pageRelPath,
        content: span.text,
        sourceMaterializedAt: "sources/file/docs",
        documentPath: "index.md",
        manifest,
      });
      for (const asset of projected.assets) {
        await mkdir(dirname(asset.absPath), { recursive: true });
        await writeFile(asset.absPath, asset.bytes);
      }
      const approvedPath = join(projectRoot, pageRelPath);
      await mkdir(dirname(approvedPath), { recursive: true });
      await writeFile(approvedPath, [
        "---",
        YAML.stringify({
          title: "Resource reference",
          type: "Guide",
          node_ref: "entity/resource-reference",
          view_ref: "architecture:entity/resource-reference",
          node_type: "entity",
          description: "Resource projection evidence.",
          tags: ["docs"],
          timestamp: "2026-06-23T00:00:00.000Z",
          resource: "file:docs/index.md",
          sources: ["file:docs/index.md"],
        }).trimEnd(),
        "---",
        "",
        "# Resource reference",
        "",
        `<!-- context:section id="reference" kind="description" source_ref="src-1${formatSpanSourceRef(span)}" content_mode="verbatim" -->`,
        "",
        projected.content,
        "",
        "<!-- /context:section -->",
        "",
      ].join("\n"), "utf8");

      const verified = await verifyProjectWorkspace(projectRoot);
      expect(verified.issues).toEqual([]);
      await expect(closeProjectWorkspace(projectRoot)).resolves.toMatchObject({
        action: "closed",
        nodes: 1,
        views: 1,
        verifyErrors: 0,
      });

      const changed = (await readFile(approvedPath, "utf8")).replace("See [Reference]", "Changed [Reference]");
      await writeFile(approvedPath, changed, "utf8");
      const changedResult = await verifyProjectWorkspace(projectRoot);
      expect(changedResult.issues.map((issue) => issue.code)).toContain("approved-verbatim-body-hash-mismatch");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("preserves boundary whitespace and bare JSX in verbatim section hashes", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = [
        "# Overview",
        "",
        "  方案不再支持，可以使用",
        "import { Component, createRoot } from '@example/ui-runtime';",
        "export default class App extends Component<>{",
        "const root = createRoot();",
        "root.render(",
        "  <page>",
        "    <App />",
        "  </page>",
        ");  ",
        "",
        "# Next",
        "",
      ].join("\n");
      await writeSnapshot({ projectRoot, bytes: markdown });
      const span = createDocumentSourceSpan(markdown, { lineStart: 2, lineEnd: 12 });
      const path = join(projectRoot, "knowledge", "architecture", "entity", "jsx.md");
      await mkdir(join(path, ".."), { recursive: true });
      const approved = [
        "---",
        YAML.stringify({
          title: "JSX",
          type: "Wiki",
          node_type: "entity",
          description: "JSX evidence.",
          tags: ["docs"],
          timestamp: "2026-06-23T00:00:00.000Z",
          resource: "file:docs/index.md",
          sources: ["file:docs/index.md"],
        }).trimEnd(),
        "---",
        "",
        "# JSX",
        "",
        `<!-- context:section id="jsx" kind="description" source_ref="src-1${formatSpanSourceRef(span)}" content_mode="verbatim" -->`,
        "",
        "<!-- context:summary",
        JSON.stringify({ text: "Bare JSX source evidence." }),
        "/context:summary -->",
        "",
        span.text,
        "",
        "<!-- /context:section -->",
        "",
      ].join("\n");
      await writeFile(path, approved, "utf8");

      const [section] = approvedContextSectionsInMarkdown(approved);
      expect(section?.readerVisibleBody).toBe(span.text);
      expect(section?.readerVisibleBody.startsWith("\n  方案")).toBe(true);
      expect(section?.readerVisibleBody.endsWith(");  \n")).toBe(true);

      const result = await verifyProjectWorkspace(projectRoot);
      expect(result.issues.map((issue) => issue.code)).not.toContain("approved-verbatim-body-hash-mismatch");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when any context section is missing source_ref", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({ projectRoot, bytes: markdown });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      const path = join(projectRoot, "knowledge", "architecture", "entity", "document.md");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, [
        "---",
        YAML.stringify({
          title: "Document",
          type: "Wiki",
          node_type: "entity",
          description: "Document knowledge.",
          tags: ["docs"],
          timestamp: "2026-06-23T00:00:00.000Z",
          resource: "file:docs/index.md",
          sources: ["file:docs/index.md"],
        }).trimEnd(),
        "---",
        "",
        "# Document",
        "",
        `<!-- context:section id="section-1" kind="description" source_ref="src-1${formatSpanSourceRef(span)}" content_mode="verbatim" -->`,
        "",
        "File evidence text.",
        "",
        "<!-- /context:section -->",
        "",
        '<!-- context:section id="section-2" kind="note" content_mode="verbatim" -->',
        "",
        "Uncited note.",
        "",
        "<!-- /context:section -->",
        "",
      ].join("\n"), "utf8");

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "approved-section-source-ref-missing",
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
