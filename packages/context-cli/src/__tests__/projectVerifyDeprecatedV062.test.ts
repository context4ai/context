import { createDocumentSnapshotManifest } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { collectProjectStatus } from "../project/status.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { initContextProject } from "../project/workspace.js";

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ctx-project-verify-deprecated-v062-"));
}

async function writeSnapshot(input: {
  projectRoot: string;
  sourceName: string;
  files: Array<{ path: string; bytes: string; title?: string }>;
}): Promise<void> {
  const root = join(input.projectRoot, "sources", "file", input.sourceName);
  await mkdir(root, { recursive: true });
  for (const file of input.files) {
    await mkdir(join(root, file.path, ".."), { recursive: true });
    await writeFile(join(root, file.path), file.bytes, "utf8");
  }
  const manifest = createDocumentSnapshotManifest({
    sourceType: "file",
    sourceName: input.sourceName,
    capturedAt: "2026-06-23T00:00:00.000Z",
    files: input.files,
  });
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writeFileRegistry(projectRoot: string, name = "docs"): Promise<void> {
  await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
    sources: [
      {
        name,
        snapshot: {
          manifest: `sources/file/${name}/manifest.json`,
        },
      },
    ],
  }), "utf8");
}

async function writeApproved(input: {
  projectRoot: string;
  sources: string[];
  sourceRef: string;
}): Promise<void> {
  const path = join(input.projectRoot, "knowledge", "architecture", "entity", "document.md");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, [
    "---",
    YAML.stringify({
      title: "Document",
      type: "Wiki",
      node_ref: "entity/document",
      view_ref: "architecture:entity/document",
      node_type: "entity",
      description: "Document knowledge.",
      tags: ["docs"],
      timestamp: "2026-06-23T00:00:00.000Z",
      resource: "file:docs/index.md",
      sources: input.sources,
      deprecated: true,
      deprecated_at: "2026-06-23T01:00:00.000Z",
    }).trimEnd(),
    "---",
    "",
    "# Document",
    "",
    `<!-- context:section id="section-1" kind="description" source_ref="${input.sourceRef}" -->`,
    "",
    "Document knowledge.",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.2 deprecated approved prose evidence", () => {
  test("ignores deprecated approved prose source_ref freshness when source document disappears", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot);
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceName: "docs",
        files: [{ path: "other.md", bytes: "# Other\n\nOther text.\n", title: "Other" }],
      });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: "src-1#span:overview L3-3@aaaaaaaaaaaa",
      });

      const result = await verifyProjectWorkspace(initialized.projectRoot);
      const status = await collectProjectStatus(initialized.projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass");
      expect(result.issues.map((issue) => issue.code)).not.toContain("source-document-missing");
      expect(result.issues.map((issue) => issue.code)).not.toContain("approved-source-ref-stale");
      expect(status.evidenceStatus).toBe("pass");
      expect(status.evidenceWarnings).toBe("none");
      expect(status.state).not.toBe("route.evidence.decision-required");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
