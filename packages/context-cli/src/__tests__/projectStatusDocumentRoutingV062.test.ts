import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { collectProjectStatus } from "../project/status.js";
import { initContextProject } from "../project/workspace.js";
import {
  makeProject,
  writeFileRegistry,
  writeSnapshot,
} from "./projectVerifyV062Helpers.js";

describe("0.6.2 document workflow status routing", () => {
  test("reports missing SOP compile instead of falling back to an existing FAQ phase", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await writeFileRegistry(projectRoot, "docs", "sources/file/docs/manifest.json");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "guide.md", bytes: "# Guide\n\nMigration steps.\n", title: "Guide" }],
      });
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, compileProse, defineProject, reviewValidity, source } from "@c4a/context";',
        "",
        'const docs = source("docs");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "sop" }),',
        '    compileProse({ source: docs, collection: "faq" }),',
        '    reviewValidity({ collection: "faq" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify({
        schema_version: "context.structure.v1",
        sources: ["file:docs"],
        views: [{ collection: "sop", view_ref: "sop:action/migration" }],
        lifecycle: { state: "confirmed", structure_digest: "digest" },
        structure_digest: "digest",
      }), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.routing.reason).toBe("route.indexer.lifecycle-required");
      expect(status.next).toContain("sole registry-and-Provider indexing lifecycle");
      expect(status.next).not.toContain("compile:file:docs:faq");
      expect(status.routing.command_plan).toEqual([]);
      expect(status.compilePhaseResolution).toMatchObject({
        state: "missing",
        requestedSourceKeys: ["file:docs"],
        requestedCollections: ["sop"],
        matches: [],
        missingCollections: ["sop"],
      });
      expect(status.declarationGraph.rows).toContainEqual(expect.objectContaining({
        sourceKey: "file:docs",
        collection: "sop",
        capture: "declared",
        align: "declared",
        compile: "missing",
        review: "missing",
        gaps: ["compile", "review"],
      }));
      expect(status.configurationGaps).toEqual(expect.arrayContaining([
        "file:docs:sop:compile",
        "file:docs:sop:review",
      ]));
      expect(status.declarationGraph.rows[0]?.suggestions.join("\n")).toContain(
        'compileProse({ source: source("docs", { type: "file" }), collection: "sop" })',
      );

      const projectEntryPath = join(projectRoot, "src", "index.ts");
      const projectEntry = await readFile(projectEntryPath, "utf8");
      await writeFile(
        projectEntryPath,
        projectEntry.replace('reviewValidity({ collection: "faq" })', 'reviewValidity({ scope: "all" })'),
        "utf8",
      );
      const allScopeReview = await collectProjectStatus(projectRoot);
      expect(allScopeReview.declarationGraph.rows[0]).toMatchObject({
        collection: "sop",
        compile: "missing",
        review: "covered-by-all",
        gaps: ["compile"],
      });
      expect(allScopeReview.configurationGaps).not.toContain("file:docs:sop:review");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes a staged structure through the matching collection and canonical source alias", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
        sources: [{
          id: "docs-alias",
          name: "docs",
          snapshot: { manifest: "sources/file/docs/manifest.json" },
        }],
      }), "utf8");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "guide.md", bytes: "# Guide\n\nMigration steps.\n", title: "Guide" }],
      });
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, compileProse, defineProject, reviewValidity, source } from "@c4a/context";',
        "",
        'const docs = source("docs-alias");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "architecture" }),',
        '    alignProse({ source: docs, collection: "sop" }),',
        '    compileProse({ source: docs, collection: "architecture" }),',
        '    compileProse({ source: docs, collection: "sop" }),',
        '    reviewValidity({ collection: "architecture" }),',
        '    reviewValidity({ collection: "sop" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify({
        schema_version: "context.structure.v1",
        sources: ["file:docs"],
        views: [{ collection: "sop", view_ref: "sop:action/migration" }],
        lifecycle: { state: "draft" },
      }), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.routing.command_plan).toEqual([]);
      expect(status.next).not.toContain("could not resolve the alignProse source");
      expect(status.alignPhaseResolution).toMatchObject({
        state: "resolved",
        requestedSourceKeys: ["file:docs"],
        requestedCollections: ["sop"],
        matches: [{
          phaseId: "align:source:docs-alias:sop",
          sourceKey: "file:docs",
          collection: "sop",
          command: "context run align:file:docs:sop",
        }],
      });
      expect(status.alignPhaseResolution?.checked).toEqual(expect.arrayContaining([
        expect.objectContaining({ collection: "architecture", sourceKey: "file:docs", matched: false }),
        expect.objectContaining({ collection: "sop", sourceKey: "file:docs", matched: true }),
      ]));

      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify({
        schema_version: "context.structure.v1",
        sources: ["file:missing-docs"],
        views: [{ collection: "sop", view_ref: "sop:action/migration" }],
        lifecycle: { state: "draft" },
      }), "utf8");
      const unresolved = await collectProjectStatus(projectRoot);
      expect(unresolved.state).toBe("route.indexer.lifecycle-required");
      expect(unresolved.routing.reason).toBe("route.indexer.lifecycle-required");
      expect(unresolved.routing.command_plan).toEqual([]);
      expect(unresolved.alignPhaseResolution).toMatchObject({
        state: "unresolved",
        requestedSourceKeys: ["file:missing-docs"],
        requestedCollections: ["sop"],
        matches: [],
      });
      expect(unresolved.alignPhaseResolution?.checked).toEqual(expect.arrayContaining([
        expect.objectContaining({ phaseId: "align:source:docs-alias:sop", sourceKey: "file:docs", matched: false }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("classifies every captured source before routing an already declared align source", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
        sources: [
          { name: "docs-a", snapshot: { manifest: "sources/file/docs-a/manifest.json" } },
          { name: "docs-b", snapshot: { manifest: "sources/file/docs-b/manifest.json" } },
          { name: "docs-c", snapshot: { manifest: "sources/file/docs-c/manifest.json" } },
        ],
      }), "utf8");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs-a",
        files: [{ path: "a.md", bytes: "# A\n\nAlpha evidence.\n", title: "A" }],
      });
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs-b",
        files: [{ path: "b.md", bytes: "# B\n\nBeta evidence.\n", title: "B" }],
      });
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs-c",
        files: [{ path: "c.md", bytes: "# C\n\nGamma evidence.\n", title: "C" }],
      });
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const docsA = source("docs-a");',
        'const docsB = source("docs-b");',
        'const docsC = source("docs-c");',
        "",
        "export default defineProject({",
        "  sources: [docsA, docsB, docsC],",
        "  phases: [",
        "    captureFile({ source: docsA }),",
        "    captureFile({ source: docsB }),",
        "    captureFile({ source: docsC }),",
        '    alignProse({ source: docsB, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      const commands = status.routing.command_plan.map((item) => item.command);
      expect(commands).toEqual([]);
      expect(status.routing.reason).toBe("route.indexer.lifecycle-required");
      const sourceBodies = status.workflow.current?.resources.required.filter(
        (resource) => resource.id.startsWith("context.source-body/"),
      ) ?? [];
      expect(sourceBodies).toEqual([]);

      const managedStatus = await collectProjectStatus(projectRoot, {
        managed: true,
      });
      expect(managedStatus.state).toBe(
        "route.indexer.lifecycle-required",
      );
      expect(managedStatus.workflow.current).toMatchObject({
        node: "run-indexer-lifecycle",
        availability: "immediate",
        commands: [],
      });
      expect(managedStatus.workflow.current?.resources.required.filter(
        (resource) => resource.id.startsWith("context.source-body/"),
      )).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes captured read-plan through registry source id aliases", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
        sources: [
          {
            id: "docs-alias",
            name: "docs",
            snapshot: { manifest: "sources/file/docs/manifest.json" },
          },
        ],
      }), "utf8");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: "# Docs\n\nAlias evidence.\n", title: "Docs" }],
      });
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const docs = source("docs-alias");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.documentSources[0]).toMatchObject({ id: "docs-alias", name: "docs" });
      const commands = status.routing.command_plan.map((item) => item.command);
      expect(commands).toEqual([]);
      expect(status.routing.reason).toBe("route.indexer.lifecycle-required");
      expect(status.routing.configuration).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not invent a read-plan command when multiple align phases match one captured source", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await writeFileRegistry(projectRoot, "docs");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: "# Docs\n\nEvidence.\n", title: "Docs" }],
      });
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, defineProject, source } from "@c4a/context";',
        "",
        'const docs = source("docs");',
        "",
        "export default defineProject({",
        "  sources: [docs],",
        "  phases: [",
        "    captureFile({ source: docs }),",
        '    alignProse({ source: docs, collection: "architecture" }),',
        '    alignProse({ source: docs, collection: "product" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.routing.command_plan).toEqual([]);
      expect(status.routing.reason).toBe("route.indexer.lifecycle-required");
      expect(status.routing.configuration).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves neutral align phase commands to the phase source instead of the first captured source", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "index.yaml"), YAML.stringify({
        sources: [
          { name: "docs-a", snapshot: { manifest: "sources/file/docs-a/manifest.json" } },
          { name: "docs-b", snapshot: { manifest: "sources/file/docs-b/manifest.json" } },
        ],
      }), "utf8");
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs-a",
        files: [{ path: "a.md", bytes: "# A\n\nAlpha evidence.\n", title: "A" }],
      });
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs-b",
        files: [{ path: "b.md", bytes: "# B\n\nBeta evidence.\n", title: "B" }],
      });
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify({
        schema_version: "context.structure.v1",
        sources: ["file:docs-b"],
        views: [{
          collection: "architecture",
          view_ref: "architecture:entity/docs-b",
        }],
        lifecycle: { state: "draft" },
      }), "utf8");
      await writeFile(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureFile, compileProse, defineProject, reviewValidity, source } from "@c4a/context";',
        "",
        'const docsA = source("docs-a");',
        'const docsB = source("docs-b");',
        "",
        "export default defineProject({",
        "  sources: [docsA, docsB],",
        "  phases: [",
        "    captureFile({ source: docsA }),",
        "    captureFile({ source: docsB }),",
        '    alignProse({ source: docsB, collection: "architecture" }),',
        '    compileProse({ source: docsB, collection: "architecture" }),',
        '    reviewValidity({ collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const status = await collectProjectStatus(projectRoot);

      expect(status.state).toBe("route.indexer.lifecycle-required");
      const commands = status.routing.command_plan.map((item) => item.command);
      expect(commands).toEqual([]);
      expect(status.routing.human_gate).toMatchObject({
        required: false,
        kind: "none",
      });
      const confirmed = await collectProjectStatus(projectRoot, {
        authorities: ["context.structure-confirmation"],
      });
      expect(confirmed.workflow.current?.node).toBe("run-indexer-lifecycle");
      expect(confirmed.workflow.current?.gate).toBeUndefined();
      expect(confirmed.routing.command_plan).toEqual([]);
      expect(commands.join("\n")).not.toContain("align:file:docs-a:architecture");
      expect(commands.join("\n")).not.toContain("align:source:docs-b:architecture");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
