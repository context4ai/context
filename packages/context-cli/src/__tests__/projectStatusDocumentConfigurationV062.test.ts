import { createDocumentSnapshotManifest, createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectProjectStatus } from "../project/status.js";
import { initContextProject } from "../project/workspace.js";
import {
  makeProject,
  writeApproved,
  writeFileRegistry,
  writeLarkRegistry,
  writeSnapshot,
} from "./projectVerifyV062Helpers.js";

describe("0.6.2 document source and capture status routing", () => {
  test("routes document-only sources to capture configuration", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.sourceCount).toBe(1);
      expect(status.readySources).toBe(0);
      expect(status.sourceSummary).toMatchObject({
        repo: { total: 0, ready: 0 },
        document: { total: 1, captured: 0 },
        total: 1,
        ready: 0,
      });
      expect(status.state).toBe("route.capture.configuration-required");
      expect(status.routing.configuration?.file).toBe("src/index.ts");
      expect(status.documentSources[0]).toMatchObject({
        type: "file",
        name: "docs",
        snapshotReady: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps an empty workspace at the source-boundary gate", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.source.boundary-required");
      expect(status.routing.reason).toBe("route.source.boundary-required");
      expect(status.routing.human_gate).toMatchObject({
        required: true,
        kind: "source-boundary",
      });
      expect(status.workflow.current?.resources.required.map((resource) => resource.id)).toEqual(
        expect.arrayContaining([
          "procedure.source-boundary",
          "context.source-current",
        ]),
      );
      expect(status.workflow.current?.resources.required.map((resource) => resource.id)).not.toContain(
        "schema.register-source-batch.input",
      );
      expect(status.workflow.current?.gate?.resolution_action?.input_schema).toMatchObject({
        id: "schema.register-source-batch.input",
        kind: "schema",
      });
      expect(status.routing.command_plan).toEqual([
        {
          command: expect.stringContaining(
            "source add batch --input - --format json",
          ),
          availability: "after-human-confirmation",
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes approved knowledge to close gate before package output", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      const markdown = "# Overview\n\nApproved evidence text.\n";
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "Approved evidence text.",
      });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.verifyErrors).toBe(0);
      expect(status.evidenceStatus).toBe("pass");
      expect(status.state).toBe("route.close.projection-stale");
      expect(status.close.state).toBe("missing");
      expect(status.next).toContain("--workflow-revision");
      expect(status.next).toContain("close --format json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("suggests read-plan after captured Lark source", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeLarkRegistry(initialized.projectRoot, "handbook");
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "lark",
        sourceName: "handbook",
        files: [{ path: "doc.md", bytes: "# Handbook\n\nRemote evidence text.\n", title: "Handbook" }],
      });
      await writeFile(join(initialized.projectRoot, "src", "index.ts"), [
        'import { alignProse, captureLark, defineProject, source } from "@c4a/context";',
        "",
        'const handbook = source("handbook");',
        "",
        "export default defineProject({",
        "  sources: [handbook],",
        "  phases: [",
        "    captureLark({ source: handbook }),",
        '    alignProse({ source: handbook, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.prose.configuration-required");
      expect(status.routing.current_state).toBe("route.prose.configuration-required");
      expect(status.routing.human_gate).toMatchObject({
        required: false,
        kind: "none",
      });
      expect(status.routing.reason).toBe("route.prose.configuration-required");
      expect(status.routing.configuration?.file).toBe("src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("treats manifest with missing snapshot file as needs-capture", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await mkdir(join(initialized.projectRoot, "sources", "file", "docs"), { recursive: true });
      const manifest = createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-06-23T00:00:00.000Z",
        files: [{ path: "index.md", bytes: "# Missing\n", title: "Missing" }],
      });
      await writeFile(join(initialized.projectRoot, "sources", "file", "docs", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.capture.configuration-required");
      expect(status.readySources).toBe(0);
      expect(status.documentSources[0]?.snapshotReady).toBe(false);
      expect(status.documentSources[0]?.diagnostics[0]).toContain("snapshot file is missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
