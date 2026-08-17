import { createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectProjectStatus } from "../project/status.js";
import {
  applyEvidenceMaintenance,
  keepOrphanedApprovedPage,
  parseEvidenceMaintenancePayload,
  rePinApprovedPage,
} from "../project/reviewMaintenance.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { initContextProject } from "../project/workspace.js";
import {
  makeProject,
  writeApproved,
  writeFileRegistry,
  writeSnapshot,
} from "./projectVerifyV062Helpers.js";

function localSpanRefForBody(body: string): string {
  return `src-1${formatSpanSourceRef(createDocumentSourceSpan(body, {
    lineStart: 1,
    lineEnd: body.split(/\r?\n/u).length,
  }))}`;
}

describe("0.6.2 document evidence maintenance", () => {
  test("keeps explicitly accepted source-orphaned knowledge as a persistent warning", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({
        cwd: root,
        projectDir: "kb",
        dev: true,
      });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{
          path: "other.md",
          bytes: "# Other\n\nOther text.\n",
          title: "Other",
        }],
      });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("Missing document evidence."),
        body: "Missing document evidence.",
      });

      const result = await keepOrphanedApprovedPage({
        projectRoot: initialized.projectRoot,
        viewRef: "architecture:entity/overview",
      });
      expect(result.changed).toBe(true);
      const verified = await verifyProjectWorkspace(initialized.projectRoot);
      expect(verified.ok).toBe(true);
      expect(verified.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        code: "approved-source-orphaned",
        view_ref: "architecture:entity/overview",
      }));
      expect(verified.issues.map((issue) => issue.code)).not.toContain(
        "source-document-missing",
      );
      const status = await collectProjectStatus(initialized.projectRoot);
      expect(status.evidenceWarnings).toBe("degraded");
      expect(status.workflow.current?.reason_code).not.toBe(
        "route.evidence.decision-required",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("validates the typed maintenance batch before writing any page", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({
        cwd: root,
        projectDir: "kb",
        dev: true,
      });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{
          path: "other.md",
          bytes: "# Other\n\nOther text.\n",
          title: "Other",
        }],
      });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("Missing document evidence."),
        body: "Missing document evidence.",
      });
      const decisions = parseEvidenceMaintenancePayload({
        schema: "context.evidence-maintenance.v1",
        decisions: [{
          view_ref: "architecture:entity/overview",
          action: "keep-orphaned",
        }],
      });
      const result = await applyEvidenceMaintenance({
        projectRoot: initialized.projectRoot,
        decisions,
      });
      expect(result).toMatchObject({
        schema: "context.evidence-maintenance.result.v1",
        applied: 1,
        results: [{
          action: "keep-orphaned",
          id: "architecture:entity/overview",
        }],
      });
      expect(() => parseEvidenceMaintenancePayload({
        schema: "context.evidence-maintenance.v1",
        decisions: [{
          view_ref: "architecture:entity/overview",
          action: "keep-orphaned",
          guessed_path: "knowledge/architecture/overview.md",
        }],
      })).toThrow("unknown field");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects re-pin when approved span content drifted", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      const oldMarkdown = "# Overview\n\nOld evidence text.\n";
      const markdown = "# Overview\n\nCurrent evidence text.\n";
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(oldMarkdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "Old evidence text.",
      });

      await expect(rePinApprovedPage({
        projectRoot: initialized.projectRoot,
        viewRef: "architecture:entity/overview",
      })).rejects.toThrow("content changed and cannot be re-pinned");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects re-pin when approved page has no document span refs", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await mkdir(join(initialized.projectRoot, "knowledge", "architecture", "entity"), { recursive: true });
      await writeFile(join(initialized.projectRoot, "knowledge", "architecture", "entity", "no-span.md"), [
        "---",
        "title: No Span",
        "type: Guide",
        "node_ref: entity/no-span",
        "view_ref: architecture:entity/no-span",
        "node_type: entity",
        "tags:",
        "  - docs",
        "timestamp: 2026-06-28T00:00:00.000Z",
        "resource: file:docs/index.md",
        "sources:",
        "  - file:docs/index.md",
        "---",
        "",
        "# No Span",
        "",
      ].join("\n"), "utf8");

      await expect(rePinApprovedPage({
        projectRoot: initialized.projectRoot,
        viewRef: "architecture:entity/no-span",
      })).rejects.toThrow("has no document span source_refs to re-pin");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
