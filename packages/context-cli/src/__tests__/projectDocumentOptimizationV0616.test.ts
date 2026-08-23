import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyDocumentOptimizationDecisions,
  collectDocumentOptimizationStatus,
  createDocumentOptimizationOverride,
  createDocumentOptimizationPlan,
  projectDocumentOptimizedKnowledge,
  reconcileDocumentOptimizationOverlays,
} from "../project/documentOptimization.js";
import {
  disableDocumentOptimization,
  enableDocumentOptimization,
} from "../project/documentOptimizationConfig.js";
import type { ApprovedKnowledgeFile } from "../project/packageIndexes.js";

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

describe("document optimization overlays", () => {
  test("stores one page overlay beside the matching knowledge path", async () => {
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
    expect(applied.status.overlay_pages).toBe(1);
    expect(existsSync(join(projectRoot, "overlays", "architecture", "example.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "overlays", "document-optimization"))).toBe(false);
    expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "document-optimization", "decisions.json"))).toBe(true);

    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).toContain("Hello world.");
    expect(projected.files[0]!.content).not.toContain("Hello  world.");
    expect(projected.files[0]!.content).not.toContain("context_overlay");
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
    expect(status.overlay_pages).toBe(0);
    expect(existsSync(join(projectRoot, "overlays", "architecture", "example.md"))).toBe(false);
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
    const override = await createDocumentOptimizationOverride({
      projectRoot,
      files,
      fragmentId: fragment.fragment_id,
    });
    const overrideText = readFileSync(override.path, "utf8").replace("Hello  world.", "Hello world.");
    writeFileSync(override.path, overrideText);
    expect((await reconcileDocumentOptimizationOverlays({ projectRoot, files })).override_fragments).toBe(1);

    const changed = [approvedFile("Hello  changed world.")];
    const status = await collectDocumentOptimizationStatus({ projectRoot, files: changed });
    expect(status.current).toBe(false);
    expect(status.conflict_fragments).toBe(1);
  });

  test("disable removes the active overlay and restores baseline projection", async () => {
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
    expect(existsSync(join(projectRoot, "overlays", "architecture", "example.md"))).toBe(false);
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).enabled).toBe(false);
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      context: { documentOptimization?: boolean };
    };
    expect(packageJson.context.documentOptimization).toBeUndefined();
  });

  test("migrates legacy fragment records into one page overlay", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const fragment = (await createDocumentOptimizationPlan({ projectRoot, files })).fragments[0]!;
    const legacy = join(projectRoot, "overlays", "document-optimization", "generated", "fragments");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "legacy.json"), `${JSON.stringify({
      schema: "context.document-optimization-fragment.v1",
      fragment_id: fragment.fragment_id,
      input_digest: fragment.input_digest,
      context_digest: fragment.context_digest,
      policy_digest: "legacy-policy",
      action: "replace",
      replacement: "Hello world.",
    })}\n`);

    const migrated = await createDocumentOptimizationPlan({ projectRoot, files });
    expect(migrated.current).toBe(true);
    expect(migrated.fragments).toHaveLength(0);
    expect(existsSync(join(projectRoot, "overlays", "architecture", "example.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "overlays", "document-optimization"))).toBe(false);
  });
});
