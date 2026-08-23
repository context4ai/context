import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyDocumentOptimizationDecisions,
  collectDocumentOptimizationStatus,
  createDocumentOptimizationOverride,
  createDocumentOptimizationPlan,
  projectDocumentOptimizedKnowledge,
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
  test("persists decisions outside knowledge and projects only current fragments", async () => {
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

    const projected = await projectDocumentOptimizedKnowledge({ projectRoot, files });
    expect(projected.files[0]!.content).toContain("Hello world.");
    expect(projected.files[0]!.content).not.toContain("Hello  world.");
    expect(files[0]!.content).toContain("Hello  world.");
  });

  test("invalidates only changed fragments and protects stale manual overrides", async () => {
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
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).override_fragments).toBe(1);

    const changed = [approvedFile("Hello  changed world.")];
    const status = await collectDocumentOptimizationStatus({ projectRoot, files: changed });
    expect(status.current).toBe(false);
    expect(status.conflict_fragments).toBe(1);
  });

  test("disable removes the active overlay and restores baseline projection", async () => {
    const projectRoot = workspace();
    const files = [approvedFile()];
    await enableDocumentOptimization(projectRoot);
    const recoveryPath = await disableDocumentOptimization(projectRoot);
    expect(recoveryPath).toBeDefined();
    expect((await collectDocumentOptimizationStatus({ projectRoot, files })).enabled).toBe(false);
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      context: { documentOptimization?: boolean };
    };
    expect(packageJson.context.documentOptimization).toBeUndefined();
  });
});
