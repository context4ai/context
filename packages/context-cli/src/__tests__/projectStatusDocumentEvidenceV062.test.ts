import { createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectProjectStatus } from "../project/status.js";
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

describe("0.6.2 document evidence status routing", () => {
  test("routes approved prose with missing snapshot to degraded evidence", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("File evidence text."),
      });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.readySources).toBe(0);
      expect(status.verifyErrors).toBe(0);
      expect(status.verifyWarnings).toBeGreaterThan(0);
      expect(status.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(status.evidenceWarnings).toBe("degraded");
      expect(status.state).toBe("route.close.projection-stale");
      expect(status.routing.reason).toBe("route.close.projection-stale");
      expect(status.workflow.diagnostics).toContainEqual(expect.objectContaining({
        code: "diagnostic.evidence-degraded",
        severity: "warning",
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports an invalid document manifest through the workspace diagnostic route", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await mkdir(join(initialized.projectRoot, "sources", "file", "docs"), { recursive: true });
      await writeFile(join(initialized.projectRoot, "sources", "file", "docs", "manifest.json"), "{not-json\n", "utf8");

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.workspace.state-invalid");
      expect(status.diagnostics.some((diagnostic) => diagnostic.includes("snapshot manifest is invalid"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes stale document evidence errors to approved source drift maintenance", async () => {
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

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.verifyErrors).toBeGreaterThan(0);
      expect(status.evidenceStatus).toBe("fail");
      expect(status.state).toBe("route.evidence.decision-required");
      expect(status.routing.reason).toBe("route.evidence.decision-required");
      expect(status.workflow.current?.resources.required.map((resource) => resource.id)).toContain(
        "context.verification-current",
      );
      expect(status.diagnostics.join("\n")).toContain("approved-source-ref-stale");
      expect(status.diagnostics.join("\n")).toContain("architecture:entity/overview");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes missing approved source document errors to orphaned approved maintenance", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "other.md", bytes: "# Other\n\nOther text.\n", title: "Other" }],
      });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("Missing document evidence."),
        body: "Missing document evidence.",
      });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.verifyErrors).toBeGreaterThan(0);
      expect(status.evidenceStatus).toBe("fail");
      expect(status.state).toBe("route.evidence.decision-required");
      expect(status.routing.reason).toBe("route.evidence.decision-required");
      expect(status.workflow.current?.resources.required.map((resource) => resource.id)).toContain(
        "context.verification-current",
      );
      expect(status.diagnostics.join("\n")).toContain("source-document-missing");
      expect(status.diagnostics.join("\n")).toContain("architecture:entity/overview");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
