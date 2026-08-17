import { createDocumentSnapshotManifest, createDocumentSourceSpan, formatSpanSourceRef } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { collectProjectStatus } from "../project/status.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { initContextProject } from "../project/workspace.js";
import {
  makeProject,
  writeApproved,
  writeFileRegistry,
  writeLarkRegistry,
  writeSnapshot,
} from "./projectVerifyV062Helpers.js";

function localSpanRefForBody(body: string): string {
  return `src-1${formatSpanSourceRef(createDocumentSourceSpan(body, { lineStart: 1, lineEnd: body.split(/\r?\n/u).length }))}`;
}

describe("0.6.2 project verify evidence refs", () => {
  test("verifies prose-only approved Markdown against committed file snapshot", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "File evidence text.",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass");
      expect(result.issues).toEqual([]);
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "evidence", "file", "docs", "source-index.json"))).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects legacy approved context source_refs blocks", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      const sourceRef = `src-1${formatSpanSourceRef(span)}`;
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef,
        body: "File evidence text.",
      });
      const approvedPath = join(projectRoot, "knowledge", "architecture", "entity", "overview.md");
      const approved = await readFile(approvedPath, "utf8");
      await writeFile(
        approvedPath,
        approved.replace("File evidence text.", `<!-- context:source_refs ${JSON.stringify([sourceRef])} /context:source_refs -->\n\nFile evidence text.`),
        "utf8",
      );

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("approved-section-source-refs-unsupported");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects candidate_id in approved Markdown frontmatter", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "File evidence text.",
        extraFrontmatter: { candidate_id: "architecture/entity/overview" },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "approved-frontmatter-duplicate-state",
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses registry snapshot manifest path when verifying prose evidence", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot, "docs", "sources/file/docs/meta/manifest.json");
      const markdown = "# Overview\n\nCustom manifest evidence text.\n";
      const root = join(projectRoot, "sources", "file", "docs");
      await mkdir(join(root, "meta"), { recursive: true });
      await writeFile(join(root, "index.md"), markdown, "utf8");
      const manifest = createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-06-23T00:00:00.000Z",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      await writeFile(join(root, "meta", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "Custom manifest evidence text.",
      });

      const result = await verifyProjectWorkspace(projectRoot);
      const status = await collectProjectStatus(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass");
      expect(result.issues).toEqual([]);
      expect(status.readySources).toBe(1);
      expect(status.state).not.toBe("needs-capture");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("warns instead of failing when prose snapshot is unavailable", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("File evidence text."),
        contentMode: "verbatim",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-evidence-unavailable");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("warns instead of failing when approved lark prose snapshot is unavailable", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = initialized.projectRoot;
      await writeLarkRegistry(projectRoot);
      await writeApproved({
        projectRoot,
        sources: ["lark:handbook/index.md"],
        sourceRef: localSpanRefForBody("File evidence text."),
        contentMode: "verbatim",
      });

      const result = await verifyProjectWorkspace(projectRoot);
      const status = await collectProjectStatus(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-evidence-unavailable");
      expect(status.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(status.evidenceWarnings).toBe("degraded");
      expect(status.state).toBe("route.close.projection-stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("allows an approved view to have a pending prose replacement with the same stable id", async () => {
    const projectRoot = await makeProject();
    try {
      const sourceRef = localSpanRefForBody("File evidence text.");
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef,
        contentMode: "verbatim",
      });
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify({
        candidate_id: "architecture/entity/overview",
        node_ref: "entity/overview",
        view_ref: "architecture:entity/overview",
        collection: "architecture",
        status: "draft",
        candidate_type: "prose-align",
        kind: "entity",
        visibility: "exported",
        module: "docs",
        path: "architecture/entity/overview.md",
        source_refs: [sourceRef],
        sections: [{
          id: "section-1",
          kind: "description",
          body: "File evidence text.",
          source_ref: sourceRef,
          content_mode: "verbatim",
        }],
        fingerprint: "sha256:test",
        review: {
          title: "Overview",
          summary: "Draft copy of an approved view.",
          signals: ["node_type:entity"],
          reason: "test fixture",
        },
        updated: "2026-06-23T00:00:00.000Z",
      })}\n`, "utf8");

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.issues.map((issue) => issue.code)).not.toContain("entity-id-duplicate");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("allows a prose replacement when the approved path uses a containment slug", async () => {
    const projectRoot = await makeProject();
    try {
      const sourceRef = localSpanRefForBody("File evidence text.");
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef,
        contentMode: "verbatim",
        extraFrontmatter: {
          title: "Install",
          node_ref: "entity/install",
          view_ref: "architecture:entity/install",
        },
      });
      const originalPath = join(projectRoot, "knowledge", "architecture", "entity", "overview.md");
      const approved = await readFile(originalPath, "utf8");
      await mkdir(join(projectRoot, "knowledge", "architecture", "install"), { recursive: true });
      await writeFile(join(projectRoot, "knowledge", "architecture", "install", "overview.md"), approved, "utf8");
      await rm(originalPath, { force: true });

      await mkdir(join(projectRoot, ".tmp", "context-runtime", "lifecycle"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), `${JSON.stringify({
        candidate_id: "architecture/entity/install",
        node_ref: "entity/install",
        view_ref: "architecture:entity/install",
        collection: "architecture",
        status: "draft",
        candidate_type: "prose-align",
        kind: "entity",
        visibility: "exported",
        module: "docs",
        path: "architecture/install/overview.md",
        source_refs: [sourceRef],
        sections: [{
          id: "section-1",
          kind: "description",
          body: "File evidence text.",
          source_ref: sourceRef,
          content_mode: "verbatim",
        }],
        fingerprint: "sha256:test",
        review: {
          title: "Install",
          summary: "Draft copy of an approved view with a non-identity path.",
          signals: ["node_type:entity"],
          reason: "test fixture",
        },
        updated: "2026-06-23T00:00:00.000Z",
      })}\n`, "utf8");

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.issues.map((issue) => issue.code)).not.toContain("entity-id-duplicate");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when source span hash drifts but document still exists", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      const oldMarkdown = "# Overview\n\nOld evidence text.\n";
      const markdown = "# Overview\n\nCurrent evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(oldMarkdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "Old evidence text.",
        contentMode: "verbatim",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-source-ref-stale");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when source document disappears", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "other.md", bytes: "# Other\n\nOther text.\n", title: "Other" }],
      });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: localSpanRefForBody("File evidence text."),
        contentMode: "verbatim",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("source-document-missing");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when source scheme does not match source_ref kind", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: "# Overview\n\nText.\n", title: "Overview" }],
      });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: "src-1#symbol:src/Button.ts:Button:function@abc123abc123",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: ["docs|Button|function"],
        },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-source-ref-kind-mismatch");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("status routes source_ref verification failures back to upstream gates", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot);
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: "# Overview\n\nText.\n", title: "Overview" }],
      });
      await writeApproved({
        projectRoot: initialized.projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: "src-1#symbol:src/Button.ts:Button:function@abc123abc123",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: ["docs|Button|function"],
        },
      });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.verify.failed");
      expect(status.routing.reason).toBe("route.verify.failed");
      expect(status.routing.command_plan).toEqual([
        {
          command: expect.stringContaining("verify --format json"),
          availability: "immediate",
        },
      ]);
      expect(status.workflow.current?.resources.required.map((resource) => resource.id)).toContain(
        "context.verification-current",
      );
      expect(status.next).not.toContain("dist/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("verifies mixed repo symbol and prose span evidence per section", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
      await writeFileRegistry(projectRoot);
      await writeFile(join(projectRoot, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [
          {
            name: "20260712",
            modules: [{
              name: "sample",
              git: {
                remote: "https://git.example.com/sample.git",
                ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            }],
          },
        ],
      }), "utf8");
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "extract"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "extract", "source-fingerprints.json"), `${JSON.stringify({
        version: 1,
        phases: {
          "extract:20260712/sample:codegraph": {
            phaseId: "extract:20260712/sample:codegraph",
            collection: "codegraph",
            fingerprint: "sha256:fingerprint",
            sources: [],
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`, "utf8");
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "extract", "source-symbols.json"), `${JSON.stringify({
        version: 2,
        phaseFingerprints: {
          "extract:20260712/sample:codegraph": "sha256:fingerprint",
        },
        symbols: [
          {
            source: "20260712/sample",
            file: "src/Button.ts",
            name: "Button",
            kind: "function",
            digest: "abc123abc123",
          },
        ],
      }, null, 2)}\n`, "utf8");

      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      const path = join(projectRoot, "knowledge", "architecture", "entity", "button.md");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, [
        "---",
        YAML.stringify({
          title: "Button",
          type: "Wiki",
          node_ref: "entity/button",
          view_ref: "architecture:entity/button",
          node_type: "entity",
          description: "Mixed evidence page.",
          tags: ["docs"],
          timestamp: "2026-06-23T00:00:00.000Z",
          resource: "repo:20260712/sample",
          sources: ["repo:20260712/sample", "file:docs/index.md"],
          visibility: "exported",
          code_symbols: ["20260712/sample/ui|Button|function"],
        }).trimEnd(),
        "---",
        "",
        "# Button",
        "",
        '<!-- context:section id="section-1" kind="api" source_ref="src-1#symbol:src/Button.ts:Button:function@abc123abc123" -->',
        "",
        "Button API.",
        "",
        `<!-- context:section id="section-2" kind="description" source_ref="src-2${formatSpanSourceRef(span)}" content_mode="verbatim" -->`,
        "",
        "File evidence text.",
        "",
        "<!-- /context:section -->",
      ].join("\n"), "utf8");

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass");
      expect(result.issues).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when code_symbols do not express the approved symbol source_ref", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [
          {
            name: "20260712",
            modules: [{
              name: "sample",
              git: {
                remote: "https://git.example.com/sample.git",
                ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            }],
          },
        ],
      }), "utf8");
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "extract"), { recursive: true });
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "extract", "source-fingerprints.json"), `${JSON.stringify({
        version: 1,
        phases: {
          "extract:20260712/sample:codegraph": {
            phaseId: "extract:20260712/sample:codegraph",
            collection: "codegraph",
            fingerprint: "sha256:fingerprint",
            sources: [],
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
        },
      }, null, 2)}\n`, "utf8");
      await writeFile(join(projectRoot, ".tmp", "context-runtime", "extract", "source-symbols.json"), `${JSON.stringify({
        version: 2,
        phaseFingerprints: {
          "extract:20260712/sample:codegraph": "sha256:fingerprint",
        },
        symbols: [
          {
            source: "20260712/sample",
            file: "src/Button.ts",
            name: "Button",
            kind: "function",
            digest: "abc123abc123",
          },
        ],
      }, null, 2)}\n`, "utf8");
      await writeApproved({
        projectRoot,
        sources: ["repo:20260712/sample"],
        sourceRef: "src-1#symbol:src/Button.ts:Button:function@abc123abc123",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: ["20260712/sample|Other|function"],
        },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-code-symbols-missing-source-ref");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails code_symbols coverage even when symbol index is unavailable", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "repo", "index.yaml"), YAML.stringify({
        sources: [
          {
            name: "20260712",
            modules: [{
              name: "sample",
              git: {
                remote: "https://git.example.com/sample.git",
                ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            }],
          },
        ],
      }), "utf8");
      await writeApproved({
        projectRoot,
        sources: ["repo:20260712/sample"],
        sourceRef: "src-1#symbol:src/Button.ts:Button:function@abc123abc123",
        extraFrontmatter: {
          visibility: "exported",
          code_symbols: ["20260712/sample|Other|function"],
        },
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-code-symbols-missing-source-ref");
      expect(result.issues.map((issue) => issue.code)).toContain("extract-symbol-index-missing");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });


  test("warns when available snapshot paths are gitignored", async () => {
    const projectRoot = await makeProject();
    try {
      await writeFileRegistry(projectRoot);
      execFileSync("git", ["init", "-q"], { cwd: projectRoot });
      await writeFile(join(projectRoot, ".gitignore"), "sources/file/docs/**\n", "utf8");
      const markdown = "# Overview\n\nIgnored evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "Ignored evidence text.",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(true);
      expect(result.evidenceStatus).toBe("pass-with-unverifiable-evidence");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-evidence-unverifiable");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails when prose source is not registered", async () => {
    const projectRoot = await makeProject();
    try {
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      await writeApproved({
        projectRoot,
        sources: ["file:docs/index.md"],
        sourceRef: `src-1${formatSpanSourceRef(span)}`,
        body: "File evidence text.",
      });

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues.map((issue) => issue.code)).toContain("approved-source-missing");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports the document registry path when file registry is invalid", async () => {
    const projectRoot = await makeProject();
    try {
      await mkdir(join(projectRoot, "sources", "file"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "index.yaml"), "files: []\n", "utf8");

      const result = await verifyProjectWorkspace(projectRoot);

      expect(result.ok).toBe(false);
      expect(result.evidenceStatus).toBe("fail");
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "sources-registry-invalid",
        path: "sources/file/index.yaml",
      }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

});
