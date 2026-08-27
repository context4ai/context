import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { collectDocumentOptimizationStatus } from "../project/documentOptimization.js";
import {
  beginDocumentRevision,
  currentDocumentRevisionPlan,
  validateDocumentOptimizationRevisions,
} from "../project/documentRevision.js";
import type { ApprovedKnowledgeFile } from "../project/packageIndexes.js";
import { listApprovedKnowledge } from "../project/packageBuilder.js";
import { sha256 } from "../project/documentOptimizationModel.js";
import { approvedKnowledgeInputHash } from "../project/close.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "context-document-revision-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`);
  return root;
}

function approvedFile(body = "Hello  world."): ApprovedKnowledgeFile {
  const content = [
    "---",
    "title: Example",
    "node_ref: entity/example",
    "node_type: entity",
    "view_ref: architecture:example",
    "---",
    "",
    '<!-- context:section id="intro" kind="paragraph" content_mode="verbatim" source_ref="src-0#span:1-1@sha256:test" -->',
    "",
    body,
    "",
    "<!-- /context:section -->",
    "",
  ].join("\n");
  return { relPath: "architecture/example.md", absPath: "/virtual/example.md", content };
}

function secondApprovedFile(): ApprovedKnowledgeFile {
  const file = approvedFile("Second  page.");
  return {
    ...file,
    relPath: "guides/second-example.md",
    absPath: "/virtual/second-example.md",
    content: file.content
      .replace("title: Example", "title: Example Guide")
      .replace("node_ref: entity/example", "node_ref: guide/second-example")
      .replace("view_ref: architecture:example", "view_ref: guide:second-example"),
  };
}

describe("document revision conversation entry", () => {
  test("starts one conversational correction without opening a whole-workspace batch", async () => {
    const projectRoot = workspace();
    const files = [approvedFile(), secondApprovedFile()];

    const entry = await beginDocumentRevision({
      projectRoot,
      files,
      selector: "architecture/example.md",
    });
    expect(entry).toMatchObject({
      status: "started",
      revision_path: "knowledge/architecture/example__revision.md",
      target: { approved_path: "architecture/example.md" },
    });
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "knowledge", "guides", "second-example__revision.md"))).toBe(false);

    const started = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(started.enabled).toBe(true);
    expect(started.revision_requested).toBe(true);
    expect(started.requested_approved_path).toBe("architecture/example.md");
    expect(started.pending_fragments).toBe(0);
    const current = await currentDocumentRevisionPlan({ projectRoot, files });
    expect(current.changed).toBe(false);

    await expect(validateDocumentOptimizationRevisions({ projectRoot, files })).rejects.toThrow(
      "has not changed",
    );
    const revisionPath = join(projectRoot, current.revision_path);
    writeFileSync(revisionPath, readFileSync(revisionPath, "utf8").replace("Hello  world.", "Hello world."));
    const validated = await validateDocumentOptimizationRevisions({ projectRoot, files });
    expect(validated.revision_requested).toBe(false);
    expect(validated.revised_fragments).toBe(1);
    expect(validated.current).toBe(true);
  });

  test("returns ambiguous correction targets without changing workspace state", async () => {
    const projectRoot = workspace();
    const files = [approvedFile(), secondApprovedFile()];
    const entry = await beginDocumentRevision({ projectRoot, files, selector: "md" });
    expect(entry.status).toBe("target-selection-required");
    expect(entry.candidates).toHaveLength(2);
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).enabled).toBe(false);
    expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "document-optimization"))).toBe(false);
  });
});

describe("document revision storage boundaries", () => {
  test("excludes revision sidecars from approved knowledge discovery", async () => {
    const projectRoot = workspace();
    const file = approvedFile();
    const root = join(projectRoot, "knowledge", "architecture");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "example.md"), file.content);
    writeFileSync(join(root, "example__revision.md"), file.content.replace(
      "view_ref: architecture:example",
      `view_ref: architecture:example\ncontext_revision: ${"a".repeat(64)}`,
    ));
    expect((await listApprovedKnowledge(projectRoot)).map((item) => item.relPath)).toEqual(["architecture/example.md"]);
  });

  test("excludes revision sidecars from the deterministic close input", async () => {
    const projectRoot = workspace();
    const file = approvedFile();
    const root = join(projectRoot, "knowledge", "architecture");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "example.md"), file.content);
    const revisionPath = join(root, "example__revision.md");
    writeFileSync(revisionPath, file.content.replace(
      "view_ref: architecture:example",
      `view_ref: architecture:example\ncontext_revision: ${sha256(file.content)}`,
    ));
    const before = await approvedKnowledgeInputHash(projectRoot);
    writeFileSync(revisionPath, readFileSync(revisionPath, "utf8").replace("Hello  world.", "Hello world."));
    expect(await approvedKnowledgeInputHash(projectRoot)).toBe(before);
  });
});
