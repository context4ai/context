import { computeDocumentContentHash, createDocumentSnapshotManifest, createDocumentSourceSpan, formatCanonicalProseSourceRef } from "@c4a/extract";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildCommittedEvidenceIndex,
  resolveProseSourceRef,
} from "../project/documentEvidenceIndex.js";

async function writeSnapshot(input: {
  projectRoot: string;
  sourceType: "file" | "lark";
  sourceName: string;
  files: Array<{ path: string; bytes: string; title?: string; locator?: string }>;
  assets?: Array<{ path: string; content_hash?: string; media_type?: string }>;
}): Promise<void> {
  const root = join(input.projectRoot, "sources", input.sourceType, input.sourceName);
  await mkdir(root, { recursive: true });
  for (const file of input.files) {
    await mkdir(join(root, file.path, ".."), { recursive: true });
    await writeFile(join(root, file.path), file.bytes, "utf8");
  }
  const manifest = createDocumentSnapshotManifest({
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    capturedAt: "2026-06-23T00:00:00.000Z",
    files: input.files,
    ...(input.assets !== undefined ? { assets: input.assets } : {}),
  });
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("0.6.2 document evidence index", () => {
  test("rebuilds file source index from committed snapshot after .tmp deletion", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-file-"));
    try {
      const markdown = "# Overview\n\nFile evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "evidence"), { recursive: true });
      await rm(join(projectRoot, ".tmp"), { recursive: true, force: true });

      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const span = createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 });
      const sourceRef = formatCanonicalProseSourceRef({
        sourceType: "file",
        sourceName: "docs",
        documentPath: "index.md",
        span,
      });

      expect(result.runtimeIndexPath).toBe(join(".tmp", "context-runtime", "evidence", "file", "docs", "source-index.json"));
      expect(basename(result.runtimeIndexPath)).toBe("source-index.json");
      expect(await readFile(result.absoluteRuntimeIndexPath, "utf8")).toContain("\"schema_version\": \"document.runtime-evidence-index.v1\"");
      expect((await resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef,
      }))?.span.canonical_source_ref).toBe(sourceRef);
      expect(JSON.stringify(result.index)).not.toContain("#asset:");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("resolver reuses cached snapshot markdown from index rebuild", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-cache-"));
    try {
      const markdown = "# Overview\n\nCached evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "index.md", bytes: markdown, title: "Overview" }],
      });
      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const sourceRef = formatCanonicalProseSourceRef({
        sourceType: "file",
        sourceName: "docs",
        documentPath: "index.md",
        span: createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 }),
      });

      await rm(join(projectRoot, "sources", "file", "docs", "index.md"), { force: true });

      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef,
        snapshotMarkdownCache: result.snapshotMarkdownCache,
      })).resolves.toMatchObject({
        status: "exact",
        span: { document_path: "index.md" },
      });
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef,
      })).rejects.toThrow(/document snapshot file is unreadable/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rebuilds lark source index and resolves prose refs without local registry hints", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-lark-"));
    try {
      const markdown = "# Handbook\n\nLark evidence text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "lark",
        sourceName: "handbook",
        files: [{ path: "wiki/home.md", bytes: markdown, locator: "wiki:home" }],
      });

      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "lark",
        sourceName: "handbook",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const ref = formatCanonicalProseSourceRef({
        sourceType: "lark",
        sourceName: "handbook",
        documentPath: "wiki/home.md",
        span: createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 }),
      });

      expect(ref).toMatch(/^lark:handbook\/wiki\/home\.md#span:handbook L3-3@[a-f0-9]{12}$/u);
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: ref,
      })).resolves.toMatchObject({
        span: {
          source_type: "lark",
          source_name: "handbook",
          document_path: "wiki/home.md",
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("resolves escaped document locator paths and reports line, heading, and content drift", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-drift-"));
    try {
      const markdown = "# Getting Started\n\nEscaped path evidence.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "Getting Started #1.md", bytes: markdown, title: "Getting Started" }],
      });

      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const ref = formatCanonicalProseSourceRef({
        sourceType: "file",
        sourceName: "docs",
        documentPath: "Getting Started #1.md",
        span: createDocumentSourceSpan(markdown, { lineStart: 3, lineEnd: 3 }),
      });

      expect(ref).toContain("file:docs/Getting%20Started%20%231.md#span:getting-started");
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: ref,
      })).resolves.toMatchObject({
        status: "exact",
        headingHintMatches: true,
        lineRangeMatches: true,
        hashMatches: true,
        span: { document_path: "Getting Started #1.md" },
      });
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: ref.replace(" L3-3@", " L8-8@"),
      })).resolves.toMatchObject({
        status: "line-drift",
        headingHintMatches: true,
        lineRangeMatches: false,
        hashMatches: true,
      });
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: ref.replace("#span:getting-started", "#span:old-getting-started"),
      })).resolves.toMatchObject({
        status: "heading-drift",
        headingHintMatches: false,
        hashMatches: true,
      });
      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: ref.replace(/@[a-f0-9]{12}$/u, "@000000000000"),
      })).resolves.toMatchObject({
        status: "content-drift",
        headingHintMatches: true,
        lineRangeMatches: true,
        hashMatches: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports content drift when a heading remains but the old line range no longer exists", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-content-drift-"));
    try {
      const previousMarkdown = "# Getting Started\n\nOld line one.\nOld line two.\nOld line three.\n";
      const currentMarkdown = "# Getting Started\n\nEdited shorter text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "Getting Started.md", bytes: currentMarkdown, title: "Getting Started" }],
      });

      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const oldRef = formatCanonicalProseSourceRef({
        sourceType: "file",
        sourceName: "docs",
        documentPath: "Getting Started.md",
        span: createDocumentSourceSpan(previousMarkdown, { lineStart: 3, lineEnd: 5 }),
      });

      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: oldRef,
      })).resolves.toMatchObject({
        status: "content-drift",
        headingHintMatches: true,
        lineRangeMatches: false,
        hashMatches: false,
        span: {
          document_path: "Getting Started.md",
          line_start: 1,
          line_end: 3,
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses the current heading span instead of stale exact lines for edited moved content", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-content-moved-"));
    try {
      const previousMarkdown = "# Getting Started\n\nOld line one.\nOld line two.\n";
      const currentMarkdown = "# Intro\n\nPreamble.\n\n# Getting Started\n\nEdited current text.\n";
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "Getting Started.md", bytes: currentMarkdown, title: "Getting Started" }],
      });

      const result = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const oldRef = formatCanonicalProseSourceRef({
        sourceType: "file",
        sourceName: "docs",
        documentPath: "Getting Started.md",
        span: createDocumentSourceSpan(previousMarkdown, { lineStart: 3, lineEnd: 4 }),
      });

      await expect(resolveProseSourceRef({
        projectRoot,
        index: result.index,
        sourceRef: oldRef,
      })).resolves.toMatchObject({
        status: "content-drift",
        headingHintMatches: true,
        lineRangeMatches: false,
        hashMatches: false,
        span: {
          document_path: "Getting Started.md",
          heading_hint: "getting-started",
          line_start: 5,
          line_end: 7,
        },
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects snapshot manifests whose line counts do not match committed bytes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-line-count-"));
    try {
      const snapshotRoot = join(projectRoot, "sources", "file", "docs");
      const markdown = "# Guide\n\nFact one.\nFact two.\n";
      await mkdir(snapshotRoot, { recursive: true });
      await writeFile(join(snapshotRoot, "guide.md"), markdown, "utf8");
      const manifest = createDocumentSnapshotManifest({
        sourceType: "file",
        sourceName: "docs",
        capturedAt: "2026-06-23T00:00:00.000Z",
        files: [{ path: "guide.md", bytes: markdown, title: "Guide" }],
      });
      await writeFile(join(snapshotRoot, "manifest.json"), `${JSON.stringify({
        ...manifest,
        files: [{ ...manifest.files[0], line_count: 1 }],
      }, null, 2)}\n`, "utf8");

      await expect(buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
      })).rejects.toThrow(/line count mismatch/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects unsafe source names before building runtime paths", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-unsafe-"));
    try {
      await expect(buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "../docs",
      })).rejects.toThrow(/document source name/u);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("assets stay outside text spans while committed audit assets retain integrity", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ctx-doc-evidence-index-assets-"));
    try {
      await writeSnapshot({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        files: [{ path: "guide.md", bytes: "# Guide\n\nTranscribed attachment fact.\n", title: "Guide" }],
        assets: [
          {
            path: "assets/audit.xml",
            content_hash: computeDocumentContentHash("<document/>\n"),
            media_type: "application/xml",
          },
        ],
      });
      await mkdir(join(projectRoot, "sources", "file", "docs", "assets"), { recursive: true });
      await writeFile(join(projectRoot, "sources", "file", "docs", "assets", "audit.xml"), "<document/>\n", "utf8");

      const first = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:00:00.000Z"),
      });
      const second = await buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
        now: new Date("2026-06-23T00:01:00.000Z"),
      });

      expect(second.index.documents).toEqual(first.index.documents);
      expect(JSON.stringify(first.index)).not.toContain("#asset:");
      expect(existsSync(join(projectRoot, "sources", "evidence.jsonl"))).toBe(false);
      expect(existsSync(join(projectRoot, "raw"))).toBe(false);
      expect(existsSync(join(projectRoot, "capture"))).toBe(false);
      expect(first.runtimeIndexPath.startsWith(join(".tmp", "context-runtime", "evidence"))).toBe(true);

      await writeFile(join(projectRoot, "sources", "file", "docs", "assets", "audit.xml"), "<changed/>\n", "utf8");
      await expect(buildCommittedEvidenceIndex({
        projectRoot,
        sourceType: "file",
        sourceName: "docs",
      })).rejects.toThrow(/audit asset hash mismatch/u);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
