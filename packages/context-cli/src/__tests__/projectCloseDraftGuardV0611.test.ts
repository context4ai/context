import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCandidateRecords } from "../project/candidateLedger.js";
import { closeProjectWorkspace } from "../project/close.js";
import { initContextProject } from "../project/workspace.js";

describe("project close draft guard", () => {
  test("does not clear an unresolved draft candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-close-draft-"));
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeCandidateRecords(initialized.projectRoot, [{
        candidate_id: "codegraph/sample/widget",
        node_ref: "sample/widget",
        view_ref: "codegraph:sample/widget",
        collection: "codegraph",
        status: "draft",
        candidate_type: "code-symbol",
        change: "add",
        kind: "component",
        visibility: "exported",
        module: "sample",
        path: "codegraph/sample/widget.md",
        source_refs: ["repo:20260811/sample#symbol:src/widget.ts:Widget:function@0123456789ab"],
        fingerprint: "sha256:0123456789abcdef",
        review: {
          title: "Widget",
          summary: "Widget summary",
          signals: ["fixture"],
          reason: "Review required",
        },
        updated: "2026-08-11T00:00:00.000Z",
      }]);

      await expect(closeProjectWorkspace(initialized.projectRoot)).rejects.toMatchObject({
        message: "close is blocked while draft candidates still need Review",
        detail: expect.objectContaining({
          code: "close-draft-candidates-pending",
          draftCandidates: 1,
          collections: ["codegraph"],
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
