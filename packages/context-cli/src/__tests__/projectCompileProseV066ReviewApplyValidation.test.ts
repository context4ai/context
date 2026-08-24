import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedStructure,
  stageConfirmedRichStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 compileProse review/apply validation", () => {
  test("review apply routes missing prose-align snapshots back to compile by source type", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const sourceRef = "lark:lark-docs/guide.md#span:overview L1-1@abcdef123456";
      mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify({
        candidate_id: "architecture/entity/lark-install",
        node_ref: "entity/lark-install",
        view_ref: "architecture:entity/lark-install",
        collection: "architecture",
        status: "draft",
        candidate_type: "prose-align",
        kind: "entity",
        visibility: "exported",
        module: "lark-docs",
        path: "architecture/entity/lark-install.md",
        source_refs: [sourceRef],
        source: {
          type: "lark",
          name: "lark-docs",
          document_path: "guide.md",
          locator: "lark:lark-docs/guide.md",
          source_ref: sourceRef,
        },
        fingerprint: "sha256:test",
        review: {
          title: "Lark Install",
          summary: "Missing source-bound candidate body.",
          signals: ["node_type:entity"],
          reason: "Fixture for missing snapshot recovery.",
        },
        updated: "2026-06-24T12:00:00Z",
      })}\n`, "utf8");
      const payload = writeJsonl(projectRoot, "review-approve.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const result = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("candidate snapshot is missing or stale: architecture/entity/lark-install");
      expect(result.stderr).toContain("context run compile:lark:lark-docs:architecture");
      expect(result.stderr).not.toContain("Rerun the extract phase");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply rejects unsafe approved candidate paths before materialization", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const sourceRef = "repo:pkg#symbol:Component:function@abcdef123456";
      mkdirSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify({
        candidate_id: "architecture/entity/unsafe",
        node_ref: "entity/unsafe",
        view_ref: "architecture:entity/unsafe",
        collection: "architecture",
        status: "draft",
        candidate_type: "code-symbol",
        kind: "entity",
        visibility: "exported",
        module: "pkg",
        path: "architecture/../../escape.md",
        source_refs: [sourceRef],
        fingerprint: "sha256:test",
        review: {
          title: "Unsafe",
          summary: "Unsafe path fixture.",
          signals: ["node_type:entity"],
          reason: "Fixture for path validation.",
        },
        updated: "2026-06-24T12:00:00Z",
      })}\n`, "utf8");
      const payload = writeJsonl(projectRoot, "review-unsafe-path.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const result = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("field path must be an approved knowledge path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("review apply rejects invalid content modes and non-empty empty prose sections", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
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
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const actionFile = writeYaml(projectRoot, "apply-mode-actions.yaml", {
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
      const ledgerPath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
      const original = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as { sections: Array<{ content_mode?: string }> };
      const payload = writeJsonl(projectRoot, "review-approve-invalid-mode.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);

      writeFileSync(ledgerPath, `${JSON.stringify({
        ...original,
        sections: original.sections.map((section) => ({ ...section, content_source_digest: "sha256:unexpected" })),
      })}\n`, "utf8");
      const digest = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(digest.status).not.toBe(0);
      expect(digest.stderr).toContain("field sections[].content_source_digest is not supported");

      writeFileSync(ledgerPath, `${JSON.stringify({
        ...original,
        sections: original.sections.map((section) => ({ ...section, content_mode: "mechanical" })),
      })}\n`, "utf8");
      const invalidMode = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(invalidMode.status).not.toBe(0);
      expect(invalidMode.stderr).toContain("field sections[].content_mode must be verbatim or empty");

      writeFileSync(ledgerPath, `${JSON.stringify({
        ...original,
        sections: original.sections.map((section) => ({ ...section, content_mode: "empty" })),
      })}\n`, "utf8");
      const empty = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(empty.status).not.toBe(0);
      expect(empty.stderr).toContain("empty prose section must not contain reader-facing content");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile stage uses the project-wide write lock", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const context = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "node-context",
        "--source",
        "architecture:entity/install",
        "--format",
        "json",
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const actionFile = writeYaml(projectRoot, "locked-compile-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install",
          kind: "description",
          summary: "Install source span",
          source_refs: [context.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      mkdirSync(join(projectRoot, ".tmp", "context-runtime", "locks", "project-write.lock"), { recursive: true });

      const locked = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ]);
      expect(locked.status).not.toBe(0);
      expect(locked.stderr).toContain("context project write lock is already held");
      expect(locked.stderr).toContain('"reason_code": "project-write-in-progress"');
      expect(locked.stderr).toContain('"kind": "inspect-project-write-lock"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
