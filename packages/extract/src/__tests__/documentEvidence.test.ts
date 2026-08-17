import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
  DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
  computeDocumentContentHash,
  computeLogicalRawHash,
  createDocumentSourceSpan,
  createDocumentSnapshotManifest,
  decodeSnapshotLocatorPath,
  formatSpanSourceRef,
  formatCanonicalProseSourceRef,
  normalizeMarkdownDocument,
  parseDocumentSourceLocator,
  parseSpanSourceRef,
  parseDocumentSnapshotManifest,
  sourceSpanHashMatches,
} from "../documentEvidence.js";

describe("document evidence utilities", () => {
  test("normalizes markdown and emits stable source span refs with 12 lower hex hash", () => {
    const normalized = normalizeMarkdownDocument("\uFEFF# Overview\r\n\r\n* First fact.   \r\n+ Second fact.\r\n\r\n\r\n## Details\r\n\r\nBody text.\r\n");

    expect(normalized).toBe("# Overview\n\n- First fact.\n- Second fact.\n\n## Details\n\nBody text.\n");

    const span = createDocumentSourceSpan(normalized, { lineStart: 3, lineEnd: 4 });
    expect(span).toMatchObject({
      heading_hint: "overview",
      heading_path: ["Overview"],
      line_start: 3,
      line_end: 4,
      line_range: "L3-4",
    });
    expect(span.span_hash).toMatch(/^[a-f0-9]{12}$/u);
    expect(span.full_span_hash).toMatch(/^[a-f0-9]{64}$/u);

    const sourceRef = formatSpanSourceRef(span);
    expect(sourceRef).toMatch(/^#span:overview L3-4@[a-f0-9]{12}$/u);
    expect(parseSpanSourceRef(sourceRef)).toEqual({
      heading_hint: "overview",
      line_start: 3,
      line_end: 4,
      span_hash: span.span_hash,
    });
  });

  test("logical raw hash sorts POSIX paths and uses fixed byte framing", () => {
    const files = [
      { path: "zeta.md", bytes: "Z\n" },
      { path: "alpha.md", bytes: "Alpha\n" },
    ];
    const framed = createHash("sha256")
      .update("alpha.md")
      .update("\0")
      .update(String(Buffer.byteLength("Alpha\n")))
      .update("\0")
      .update("Alpha\n")
      .update("\n")
      .update("zeta.md")
      .update("\0")
      .update(String(Buffer.byteLength("Z\n")))
      .update("\0")
      .update("Z\n")
      .update("\n")
      .digest("hex");

    expect(computeLogicalRawHash(files)).toBe(`sha256:${framed}`);
    expect(computeLogicalRawHash([...files].reverse())).toBe(`sha256:${framed}`);
  });

  test("snapshot hash includes only document bodies and evidence-role assets", () => {
    const textFiles = [{ path: "index.md", bytes: "# Handbook\n" }];
    const withNonEvidence = [
      ...textFiles,
      { path: "manifest.json", bytes: "{}\n" },
      { path: "assets/logo.png", bytes: new Uint8Array([1, 2, 3]) },
    ];

    expect(computeLogicalRawHash(textFiles)).not.toBe(computeLogicalRawHash(withNonEvidence));
    expect(createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n", title: "Handbook" }],
      assets: [{ path: "assets/logo.png", content_hash: computeDocumentContentHash(new Uint8Array([1, 2, 3])) }],
    }).snapshot_hash).toBe(computeLogicalRawHash(textFiles));
    const evidenceHash = computeDocumentContentHash(new Uint8Array([1, 2, 3]));
    const withEvidence = createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n", title: "Handbook" }],
      assets: [{ path: "assets/logo.png", content_hash: evidenceHash, role: "evidence" }],
    });
    const withPresentation = createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n", title: "Handbook" }],
      assets: [{ path: "assets/logo.png", content_hash: evidenceHash, role: "presentation" }],
    });
    expect(withEvidence.snapshot_hash).not.toBe(computeLogicalRawHash(textFiles));
    expect(withPresentation.snapshot_hash).toBe(computeLogicalRawHash(textFiles));
  });

  test("manifest files entries can rebuild evidence without host absolute paths", () => {
    const manifest = createDocumentSnapshotManifest({
      sourceType: "lark",
      sourceName: "handbook",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [
        { path: "index.md", source_path: "docs/index.md", bytes: "# Handbook\n\nPolicy text.\n", title: "Handbook" },
      ],
    });

    expect(manifest.files).toEqual([{
      path: "index.md",
      source_path: "docs/index.md",
      content_hash: computeDocumentContentHash("# Handbook\n\nPolicy text.\n"),
      line_count: 3,
      title: "Handbook",
    }]);
    expect(parseDocumentSnapshotManifest(manifest).files[0]?.source_path).toBe("docs/index.md");
    expect(() => createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "docs",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "/tmp/index.md", bytes: "Body\n", title: "Bad" }],
    })).toThrow(/POSIX relative/u);
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      files: [{ path: "../escape.md", content_hash: computeDocumentContentHash("x"), line_count: 1, title: "Bad" }],
    })).toThrow(/traversal/u);
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      files: [
        { path: "docs/index.md", content_hash: computeDocumentContentHash("A\n"), line_count: 1, title: "A" },
        { path: "docs/index.md", content_hash: computeDocumentContentHash("B\n"), line_count: 1, title: "B" },
      ],
    })).toThrow(/duplicate path/u);
  });

  test("manifest capture fidelity requires closed discovered, converted, and skipped counts", () => {
    const manifest = createDocumentSnapshotManifest({
      sourceType: "lark",
      sourceName: "handbook",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n", title: "Handbook" }],
      metadata: {
        capture: {
          fidelity: {
            status: "warning",
            evidence_status: "complete",
            projection_status: "warning",
            discovered: { paragraph: 2, empty_extension: 1 },
            converted: { paragraph: 2 },
            skipped: [{ block_type: "empty_extension", count: 1, reason: "unknown empty block omitted" }],
            issues: [{
              severity: "warning",
              impact: "projection",
              code: "lark.capture.unsupported-empty-block",
              block_type: "empty_extension",
              count: 1,
              reason: "unknown empty block omitted",
            }],
          },
        },
      },
    });

    expect(parseDocumentSnapshotManifest(manifest).metadata?.capture?.fidelity?.status).toBe("warning");
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      metadata: {
        capture: {
          fidelity: {
            ...manifest.metadata!.capture!.fidelity!,
            converted: { paragraph: 1 },
          },
        },
      },
    })).toThrow(/does not close for paragraph/u);
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      metadata: {
        capture: {
          fidelity: {
            ...manifest.metadata!.capture!.fidelity!,
            converted: { paragraph: 2, undiscovered: 1 },
          },
        },
      },
    })).toThrow(/does not close for undiscovered/u);
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      metadata: {
        capture: {
          fidelity: {
            ...manifest.metadata!.capture!.fidelity!,
            status: "complete",
          },
        },
      },
    })).toThrow(/status must be warning/u);
  });

  test("manifest stores a compact capture report pointer and status summary", () => {
    const manifest = createDocumentSnapshotManifest({
      sourceType: "lark",
      sourceName: "handbook",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n", title: "Handbook" }],
      metadata: {
        capture: {
          report: {
            path: "assets/capture-report.json",
            fidelityStatus: "warning",
            evidenceStatus: "complete",
            projectionStatus: "generic",
            resourceStatus: "complete",
          },
        },
      },
    });

    expect(parseDocumentSnapshotManifest(manifest).metadata?.capture?.report).toEqual({
      path: "assets/capture-report.json",
      fidelityStatus: "warning",
      evidenceStatus: "complete",
      projectionStatus: "generic",
      resourceStatus: "complete",
    });
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      metadata: {
        capture: {
          report: {
            ...manifest.metadata!.capture!.report!,
            path: "../capture-report.json",
          },
        },
      },
    })).toThrow(/traversal/u);
  });

  test("a required external resource confirmed missing is a warning, not a retryable capture error", () => {
    const manifest = createDocumentSnapshotManifest({
      sourceType: "lark",
      sourceName: "handbook",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "# Handbook\n\n> Diagram unavailable.\n", title: "Handbook" }],
      metadata: {
        capture: {
          resourceMaterialization: {
            status: "warning",
            discovered: { diagram: 1 },
            materialized: {},
            reference_only: {},
            failed: { diagram: 1 },
            items: [{
              kind: "diagram",
              locator: "lark:diagram:missing-board",
              status: "failed",
              required: true,
              asset_paths: [],
              reason_code: DOCUMENT_RESOURCE_SOURCE_MISSING_REASON_CODE,
              reason: "source API confirmed the resource no longer exists",
            }],
          },
        },
      },
    });

    expect(parseDocumentSnapshotManifest(manifest).metadata?.capture?.resourceMaterialization).toMatchObject({
      status: "warning",
      failed: { diagram: 1 },
    });
    expect(() => parseDocumentSnapshotManifest({
      ...manifest,
      metadata: {
        capture: {
          resourceMaterialization: {
            ...manifest.metadata!.capture!.resourceMaterialization!,
            items: manifest.metadata!.capture!.resourceMaterialization!.items.map((item) => {
              const withoutReasonCode = { ...item };
              delete withoutReasonCode.reason_code;
              return withoutReasonCode;
            }),
          },
        },
      },
    })).toThrow(/status must be error/u);

    const permissionDenied = {
      ...manifest,
      metadata: {
        capture: {
          resourceMaterialization: {
            ...manifest.metadata!.capture!.resourceMaterialization!,
            items: manifest.metadata!.capture!.resourceMaterialization!.items.map((item) => ({
              ...item,
              reason_code: DOCUMENT_RESOURCE_PERMISSION_DENIED_REASON_CODE,
              reason: "source API denied export permission",
            })),
          },
        },
      },
    };
    expect(parseDocumentSnapshotManifest(permissionDenied).metadata?.capture?.resourceMaterialization).toMatchObject({
      status: "warning",
      failed: { diagram: 1 },
    });
  });

  test("rejects unsafe source names and compacts skipped heading levels", () => {
    const span = createDocumentSourceSpan("# H1\n\n### H3\n\nText\n", { lineStart: 5, lineEnd: 5 });
    expect(span.heading_path).toEqual(["H1", "H3"]);
    expect(span.heading_path).not.toContain(null);

    expect(() => formatCanonicalProseSourceRef({
      sourceType: "file",
      sourceName: "../docs",
      documentPath: "index.md",
      span,
    })).toThrow(/document source name/u);
    expect(() => createDocumentSnapshotManifest({
      sourceType: "file",
      sourceName: "bad/name",
      capturedAt: "2026-06-23T00:00:00.000Z",
      files: [{ path: "index.md", bytes: "Body\n", title: "Bad" }],
    })).toThrow(/document source name/u);
    expect(() => parseDocumentSnapshotManifest({
      schema_version: "document.snapshot.v2",
      source_type: "file",
      source_name: "bad/name",
      captured_at: "2026-06-23T00:00:00.000Z",
      snapshot_hash: computeLogicalRawHash([{ path: "index.md", bytes: "Body\n" }]),
      normalizer_version: "document-evidence-normalizer.v1",
      files: [{ path: "index.md", content_hash: computeDocumentContentHash("Body\n"), line_count: 1, title: "Bad" }],
    })).toThrow(/document source name/u);
  });

  test("canonical prose source refs escape snapshot document locator paths", () => {
    const span = createDocumentSourceSpan("# Getting Started\n\nIntro text.\n", { lineStart: 3, lineEnd: 3 });
    const sourceRef = formatCanonicalProseSourceRef({
      sourceType: "file",
      sourceName: "docs",
      documentPath: "Getting Started #1.md",
      span,
    });
    const parsed = parseSpanSourceRef(sourceRef);

    expect(sourceRef).toContain("file:docs/Getting%20Started%20%231.md#span:getting-started");
    expect(parsed).not.toBeNull();
    expect(parsed?.locator).toBe("file:docs/Getting%20Started%20%231.md");
    expect(decodeSnapshotLocatorPath("Getting%20Started%20%231.md")).toBe("Getting Started #1.md");
  });

  test("canonical prose source refs preserve date batch and module identity", () => {
    const span = createDocumentSourceSpan("# Guide\n\nBatch content.\n", { lineStart: 3, lineEnd: 3 });
    const sourceRef = formatCanonicalProseSourceRef({
      sourceType: "lark",
      sourceName: "20260712/user-manual",
      documentPath: "index.md",
      span,
    });
    const parsed = parseSpanSourceRef(sourceRef);
    expect(sourceRef).toContain("lark:20260712/user-manual/index.md#span:guide");
    expect(parseDocumentSourceLocator(parsed!.locator!)).toEqual({
      sourceType: "lark",
      sourceName: "20260712/user-manual",
      documentPath: "index.md",
    });
  });

  test("snapshot source spans are hashed without rerunning normalizer", () => {
    const committedSnapshot = "# Overview\n\n+ Alpha fact.\n";
    const span = createDocumentSourceSpan(committedSnapshot, { lineStart: 3, lineEnd: 3 });
    const ref = formatCanonicalProseSourceRef({
      sourceType: "file",
      sourceName: "docs",
      documentPath: "index.md",
      span,
    });
    const parsed = parseSpanSourceRef(ref);

    expect(parsed).toEqual({
      locator: "file:docs/index.md",
      heading_hint: "overview",
      line_start: 3,
      line_end: 3,
      span_hash: span.span_hash,
    });
    expect(sourceSpanHashMatches(parsed!.span_hash, span.full_span_hash)).toBe(true);
    expect(span.text).toBe("+ Alpha fact.");
    expect(normalizeMarkdownDocument(committedSnapshot)).toContain("- Alpha fact.");
  });
});
