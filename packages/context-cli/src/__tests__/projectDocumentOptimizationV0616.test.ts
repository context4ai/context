import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyDocumentOptimizationDecisions,
  beginDocumentRevision,
  collectDocumentOptimizationStatus,
  createDocumentOptimizationRevision,
  createDocumentOptimizationPlan,
  currentDocumentRevisionPlan,
  projectDocumentOptimizedKnowledge,
  reconcileDocumentOptimizationRevisions,
  validateDocumentOptimizationRevisions,
} from "../project/documentOptimization.js";
import {
  disableDocumentOptimization,
  enableDocumentOptimization,
} from "../project/documentOptimizationConfig.js";
import type { ApprovedKnowledgeFile } from "../project/packageIndexes.js";
import { listApprovedKnowledge } from "../project/packageBuilder.js";
import {
  assertSafeDocumentOptimizationReplacement,
  collectDocumentOptimizationFragments,
  sha256,
} from "../project/documentOptimizationModel.js";
import { approvedKnowledgeInputHash } from "../project/close.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "context-optimize-docs-"));
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

describe("document optimization revisions", () => {
  test("repairs adjacent inline-code delimiters without changing protected content", () => {
    const files = [approvedFile("Use `@scope/package@``0.y.z` for this project.")];
    const fragment = collectDocumentOptimizationFragments(files)[0]!;

    expect(() => assertSafeDocumentOptimizationReplacement(
      fragment,
      "Use `@scope/package@0.y.z` for this project.",
    )).not.toThrow();
    expect(() => assertSafeDocumentOptimizationReplacement(
      fragment,
      "Use `@scope/package@1.y.z` for this project.",
    )).toThrow("changed protected URLs, code, or numbers");
  });

  test("stores one revision beside the approved knowledge page", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);

    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(plan.pending_fragments).toBe(1);
    expect(plan.fragments).toHaveLength(1);
    const fragment = plan.fragments[0]!;

    const applied = await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v1",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "replace",
          replacement: "Hello world.",
        }],
      },
    });
    expect(applied.status.current).toBe(true);
    expect(applied.status.revision_pages).toBe(1);
    const revisionPath = join(projectRoot, "knowledge", "architecture", "example__revision.md");
    expect(existsSync(revisionPath)).toBe(true);
    const revision = readFileSync(revisionPath, "utf8");
    expect(revision).toContain("context_revision:");
    expect(revision).not.toContain("approved_path:");
    expect(revision).not.toContain("policy_digest:");
    expect(revision).not.toContain("revised_fragments:");
    const cachePath = join(projectRoot, ".tmp", "context-runtime", "document-optimization", "decisions.json");
    expect(existsSync(cachePath)).toBe(true);
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({
      schema: "context.document-optimization-cache.v4",
      kept_pages: [],
    });

    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).toContain("Hello world.");
    expect(projected.files[0]!.content).not.toContain("Hello  world.");
    expect(projected.files[0]!.content).not.toContain("context_revision");
    expect(files[0]!.content).toContain("Hello  world.");
  });

  test("keeps negative decisions only in the compact runtime cache", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v1",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
        }],
      },
    });
    const status = await collectDocumentOptimizationStatus({ projectRoot, files });
    expect(status.current).toBe(true);
    expect(status.kept_fragments).toBe(1);
    expect(status.revision_pages).toBe(0);
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(false);
    const cache = JSON.parse(readFileSync(
      join(projectRoot, ".tmp", "context-runtime", "document-optimization", "decisions.json"),
      "utf8",
    )) as { schema: string; kept_pages: string[] };
    expect(cache.schema).toBe("context.document-optimization-cache.v4");
    expect(cache.kept_pages).toHaveLength(1);
    expect(cache.kept_pages[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(cache)).not.toContain("fragment_id");
  });

  test("accepts a safe page edit and blocks it when the approved baseline changes", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v1",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "keep",
        }],
      },
    });
    const revision = await createDocumentOptimizationRevision({
      projectRoot,
      files,
      fragmentId: fragment.fragment_id,
    });
    const revisionText = readFileSync(revision.path, "utf8").replace("Hello  world.", "Hello world.");
    writeFileSync(revision.path, revisionText);
    expect((await reconcileDocumentOptimizationRevisions({ projectRoot, files })).revised_fragments).toBe(1);

    const changed = [approvedFile("Hello  changed world.")];
    const status = await collectDocumentOptimizationStatus({ projectRoot, files: changed });
    expect(status.current).toBe(false);
    expect(status.conflict_fragments).toBe(1);
  });

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
    const entry = await beginDocumentRevision({
      projectRoot,
      files: [approvedFile(), secondApprovedFile()],
      selector: "md",
    });
    expect(entry.status).toBe("target-selection-required");
    expect(entry.candidates).toHaveLength(2);
    expect((await collectDocumentOptimizationStatus({
      projectRoot,
      files: [approvedFile(), secondApprovedFile()],
    })).enabled).toBe(false);
    expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "document-optimization"))).toBe(false);
  });

  test("disable removes the active revision and restores baseline projection", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const plan = await createDocumentOptimizationPlan({ projectRoot, files });
    const fragment = plan.fragments[0]!;
    await applyDocumentOptimizationDecisions({
      projectRoot,
      files,
      payload: {
        schema: "context.document-optimization-decisions.v1",
        decisions: [{
          fragment_id: fragment.fragment_id,
          input_digest: fragment.input_digest,
          context_digest: fragment.context_digest,
          policy_digest: fragment.policy_digest,
          action: "replace",
          replacement: "Hello world.",
        }],
      },
    });
    const recoveryPath = await disableDocumentOptimization(projectRoot);
    expect(recoveryPath).toBeDefined();
    expect(existsSync(join(projectRoot, "knowledge", "architecture", "example__revision.md"))).toBe(false);
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).enabled).toBe(false);
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      context: { documentOptimization?: boolean };
    };
    expect(packageJson.context.documentOptimization).toBeUndefined();
  });

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
