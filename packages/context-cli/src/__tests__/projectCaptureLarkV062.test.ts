import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureLark, alignProse, source } from "@c4a/context";
import { createDocumentSourceSpan, formatCanonicalProseSourceRef, parseDocumentSnapshotManifest } from "@c4a/extract";
import { ContextError } from "../lib/errors.js";
import type { LarkRunner } from "../lib/feishu.js";
import { parseLarkCaptureReport } from "../lib/larkCaptureReport.js";
import { runReviewApplyCommand } from "../project/review.js";
import { verifyProjectWorkspace } from "../project/verify.js";
import { initContextProject } from "../project/workspace.js";
import { parseDocumentSnapshotForSource } from "../project/documentBatchManifest.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "../project/documentCaptureContract.js";
import {
  createLarkCaptureProject as createLarkProject,
  makeLarkCaptureTmp as makeTmp,
  runLarkCapturePhase as runPhase,
} from "./projectCaptureLarkV062.fixtures.js";

async function runReviewApply(input: Parameters<typeof runReviewApplyCommand>[0]): Promise<string> {
  const originalStdoutWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await runReviewApplyCommand(input);
    return chunks.join("");
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

function okLarkRunner(calls: string[][]): LarkRunner {
  return async (args) => {
    calls.push(args);
    if (args.includes("--help")) {
      return {
        stdout: "Flags:\n      --api-version string\n      --doc-format string\n",
        stderr: "",
        exitCode: 0,
      };
    }
    return {
      stdout: JSON.stringify({
        ok: true,
        data: {
          title: "Fetched Handbook",
          document: {
            content: "<title>Fetched Handbook</title><p>Intro from Lark.</p>",
          },
          revision_id: "rev-001",
          assets: [{
            path: "cover.png",
            media_type: "image/png",
            base64: Buffer.from("fake-image").toString("base64"),
            id: "asset-1",
          }],
        },
      }),
      stderr: "",
      exitCode: 0,
    };
  };
}


function scopedDraftCandidateIds(projectRoot: string, collection: string): string[] {
  return readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { candidate_id?: unknown; collection?: unknown; status?: unknown })
    .filter((row) => row.status === "draft" && row.collection === collection)
    .map((row) => row.candidate_id)
    .filter((candidateId): candidateId is string => typeof candidateId === "string" && candidateId.length > 0)
    .sort();
}

function candidateIdsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
}

describe("0.6.2 Lark capture phase", () => {
  test("captures a Lark module under a shared date batch", async () => {
    const root = makeTmp();
    try {
      const result = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      const projectRoot = result.projectRoot;
      writeFileSync(join(projectRoot, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: '20260712'",
        "    modules:",
        "      - name: guide-a",
        "        docToken: doc-token-123",
        "        title: Product Handbook",
        "      - name: guide-b",
        "        docToken: doc-token-456",
        "        title: API Handbook",
        "",
      ].join("\n"), "utf8");
      writeFileSync(join(projectRoot, "src", "index.ts"), [
        'import { alignProse, captureLark, defineProject, source } from "@c4a/context";',
        "",
        'const guide = source("20260712", "guide-a", { type: "lark" });',
        'const apiGuide = source("20260712", "guide-b", { type: "lark" });',
        "",
        "export default defineProject({",
        "  sources: [guide, apiGuide],",
        "  phases: [",
        "    captureLark({ source: guide }),",
        "    captureLark({ source: apiGuide }),",
        '    alignProse({ source: guide, collection: "architecture" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n"), "utf8");

      const captured = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:20260712/guide-a",
        format: "json",
        larkRunner: okLarkRunner([]),
      })) as { result: { source: { name: string }; snapshot: { manifest: string }; next_action: { command: string } } };
      expect(captured.result).toMatchObject({
        source: { name: "20260712/guide-a" },
        snapshot: { manifest: "sources/lark/20260712/manifest.json" },
        next_action: {
          kind: "reevaluate_workspace_route",
          command: "context status --format json",
          completed_operation: "capture:lark:20260712/guide-a",
        },
      });
      const manifest = parseDocumentSnapshotForSource(JSON.parse(readFileSync(
        join(projectRoot, "sources", "lark", "20260712", "manifest.json"),
        "utf8",
      )) as unknown, "20260712/guide-a");
      expect(manifest.source_name).toBe("20260712/guide-a");
      expect(manifest.normalizer_version).toBe(LARK_DOCUMENT_NORMALIZER_VERSION);
      expect(manifest.files.map((file) => file.path)).toEqual(["guide-a.md"]);
      expect(existsSync(join(projectRoot, "sources", "lark", "20260712", "guide-a.md"))).toBe(true);
      await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:20260712/guide-b",
        format: "json",
        larkRunner: okLarkRunner([]),
      });
      const batchManifest = JSON.parse(readFileSync(
        join(projectRoot, "sources", "lark", "20260712", "manifest.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(Object.keys(batchManifest.sources as Record<string, unknown>).sort()).toEqual(["guide-a", "guide-b"]);
      expect(parseDocumentSnapshotForSource(batchManifest, "20260712/guide-b").files[0]?.path).toBe("guide-b.md");
      expect(existsSync(join(projectRoot, "sources", "lark", "20260712", "guide-b.md"))).toBe(true);
      const neutralReadPlan = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:20260712/guide-b",
        format: "json",
        align: { view: "read-plan" },
      })) as {
        result: {
          investigation_mode: string;
          collection?: string;
          classification_state: { required: boolean; reason_code: string };
          allowed_actions: string[];
          source: { type: string; name: string };
        };
      };
      expect(neutralReadPlan.result).toMatchObject({
        investigation_mode: "collection-neutral",
        classification_state: {
          required: true,
          reason_code: "route.document.classification-required",
        },
        allowed_actions: ["view", "propose_collection"],
        source: { type: "lark", name: "20260712/guide-b" },
      });
      expect(neutralReadPlan.result.collection).toBeUndefined();
      const readPlan = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:20260712/guide-a:architecture",
        format: "json",
        align: { view: "read-plan" },
      })) as { result: { source: { type: string; name: string }; next_action: { kind: string; effect: string; command: string; required_source_bodies: Array<{ document_path: string; path: string; digest: string }> } } };
      expect(readPlan.result.source).toEqual({ type: "lark", name: "20260712/guide-a" });
      expect(readPlan.result.next_action).toMatchObject({
        kind: "author_structure",
        effect: "write",
        command: expect.stringContaining("--stage --input"),
        required_source_bodies: [expect.objectContaining({
          document_path: "guide-a.md",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        })],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:lark writes committed snapshot metadata and then exposes align evidence", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      const ledgerPath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl");
      expect(existsSync(ledgerPath)).toBe(false);
      const calls: string[][] = [];

      const first = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: okLarkRunner(calls),
      })) as { log: string; result: { snapshot: { changed: boolean; manifest: string }; next_action: { command: string } } };

      expect(first.result.snapshot.changed).toBe(true);
      expect(first.result.next_action.command).toBe("context status --format json");
      expect(calls.some((call) => call.includes("doc-token-123"))).toBe(true);

      const manifestPath = join(projectRoot, "sources", "lark", "handbook", "manifest.json");
      const manifestText = readFileSync(manifestPath, "utf8");
      const manifest = parseDocumentSnapshotManifest(JSON.parse(manifestText) as unknown);
      expect(manifest.source_type).toBe("lark");
      expect(manifest.source_name).toBe("handbook");
      expect(manifest.files[0]).toMatchObject({
        path: "index.md",
        title: "Product Handbook",
        locator: "docToken:doc-token-123",
      });
      expect(manifest.metadata?.source).toMatchObject({
        docToken: "doc-token-123",
        title: "Product Handbook",
        revisionId: "rev-001",
      });
      expect(manifest.assets?.find((asset) => asset.path === "assets/cover.png")).toMatchObject({
        path: "assets/cover.png",
        media_type: "image/png",
      });
      expect(manifest.assets?.find((asset) => asset.path === "assets/capture-report.json")).toMatchObject({
        media_type: "application/vnd.context.lark-capture-report+json",
      });
      expect(manifest.metadata?.capture?.report).toEqual({
        path: "assets/capture-report.json",
        fidelityStatus: "complete",
        evidenceStatus: "complete",
        projectionStatus: "complete",
        resourceStatus: "complete",
      });
      const captureReport = parseLarkCaptureReport(JSON.parse(readFileSync(
        join(projectRoot, "sources", "lark", "handbook", "assets", "capture-report.json"),
        "utf8",
      )) as unknown);
      expect(captureReport.fidelity).toEqual({
        status: "complete",
        evidence_status: "complete",
        projection_status: "complete",
        discovered: { p: 1, title: 1 },
        converted: { p: 1, title: 1 },
        skipped: [],
        issues: [],
      });
      expect(manifest.assets?.find((asset) => asset.path === "assets/source.xml")).toMatchObject({
        media_type: "application/xml",
      });
      expect(readFileSync(join(projectRoot, "sources", "lark", "handbook", "index.md"), "utf8"))
        .toBe("# Fetched Handbook\n\nIntro from Lark.");
      expect(readFileSync(join(projectRoot, "sources", "lark", "handbook", "assets", "cover.png"), "utf8"))
        .toBe("fake-image");
      expect(existsSync(ledgerPath)).toBe(false);
      expect(existsSync(join(projectRoot, "knowledge", "architecture", "handbook"))).toBe(false);

      const log = JSON.parse(readFileSync(join(projectRoot, first.log), "utf8")) as Record<string, unknown>;
      expect(log).toMatchObject({
        phase_id: "capture:lark:handbook",
        phase_kind: "phase.capture.lark",
        status: "success",
      });
      expect(JSON.stringify(log)).not.toMatch(/oauth|session|cookie|api[_-]?token/iu);

      const second = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: okLarkRunner([]),
      })) as { result: { snapshot: { changed: boolean } } };
      expect(second.result.snapshot.changed).toBe(false);
      expect(readFileSync(manifestPath, "utf8")).toBe(manifestText);

      const updatedAssetRunner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return {
            stdout: "Flags:\n      --api-version string\n      --doc-format string\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Fetched Handbook",
              document: {
                content: "<title>Fetched Handbook</title><p>Intro from Lark.</p>",
              },
              revision_id: "rev-002",
              assets: [{
                path: "cover.png",
                media_type: "image/png",
                base64: Buffer.from("updated-image").toString("base64"),
                id: "asset-1",
              }],
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };
      mkdirSync(join(projectRoot, "sources", "lark", "handbook", "assets", "references"), { recursive: true });
      writeFileSync(
        join(projectRoot, "sources", "lark", "handbook", "assets", "references", "image-legacy.json"),
        "{}\n",
        "utf8",
      );
      writeFileSync(join(projectRoot, "sources", "lark", "handbook", "assets", "capture-fidelity.json"), "{}\n", "utf8");
      writeFileSync(join(projectRoot, "sources", "lark", "handbook", "assets", "resource-materialization.json"), "{}\n", "utf8");
      writeFileSync(join(projectRoot, "sources", "lark", "handbook", "assets", "old.png"), "old-image", "utf8");
      const assetRefresh = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: updatedAssetRunner,
      })) as { result: { snapshot: { changed: boolean } } };
      expect(assetRefresh.result.snapshot.changed).toBe(true);
      const refreshedManifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
      expect(refreshedManifest.captured_at).not.toBe(manifest.captured_at);
      expect(refreshedManifest.metadata?.source?.revisionId).toBe("rev-002");
      expect(refreshedManifest.assets?.map((asset) => asset.path)).toEqual([
        "assets/capture-report.json",
        "assets/cover.png",
        "assets/source.xml",
      ]);
      expect(readFileSync(join(projectRoot, "sources", "lark", "handbook", "assets", "cover.png"), "utf8"))
        .toBe("updated-image");
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "assets", "old.png"))).toBe(false);
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "assets", "references", "image-legacy.json"))).toBe(false);
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "assets", "capture-fidelity.json"))).toBe(false);
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "assets", "resource-materialization.json"))).toBe(false);

      const metadataOnlyAssetRunner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return {
            stdout: "Flags:\n      --api-version string\n      --doc-format string\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Fetched Handbook",
              document: {
                content: "<title>Fetched Handbook</title><p>Intro from Lark.</p>",
              },
              revision_id: "rev-003",
              assets: [{
                path: "cover.png",
                media_type: "image/png",
                id: "asset-1",
              }],
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };
      const metadataOnlyRefresh = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: metadataOnlyAssetRunner,
      })) as { result: { snapshot: { changed: boolean } } };
      expect(metadataOnlyRefresh.result.snapshot.changed).toBe(true);
      const metadataOnlyManifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
      expect(metadataOnlyManifest.captured_at).not.toBe(manifest.captured_at);
      expect(metadataOnlyManifest.metadata?.source?.revisionId).toBe("rev-003");
      expect(metadataOnlyManifest.assets?.find((asset) => asset.path === "assets/cover.png")?.content_hash).toBeUndefined();
      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "assets", "cover.png"))).toBe(false);

      const readPlan = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:handbook:architecture",
        format: "json",
        align: { view: "read-plan" },
      })) as { result: { source: { type: string; name: string }; view: string; next_action: { kind: string; effect: string; command: string; required_source_bodies: Array<{ document_path: string; path: string; digest: string }> } } };
      expect(readPlan.result.source).toEqual({ type: "lark", name: "handbook" });
      expect(readPlan.result.view).toBe("read-plan");
      expect(readPlan.result.next_action).toMatchObject({
        kind: "author_structure",
        effect: "write",
        command: expect.stringContaining("--stage --input"),
        required_source_bodies: [expect.objectContaining({
          document_path: "index.md",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        })],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:lark failure writes only a failed run log", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        return {
          stdout: "",
          stderr: "auth failed Authorization: Bearer secret-token session=secret-session api_token=secret-api-token",
          exitCode: 2,
        };
      };

      try {
        await runPhase({
          cwd: projectRoot,
          phaseId: "capture:lark:handbook",
          format: "json",
          larkRunner: runner,
        });
        throw new Error("expected capture failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const contextError = error as ContextError;
        expect(contextError.detail?.category).toBe("external-tool-failed");
        expect(contextError.detail?.next).toBe("Run lark-cli auth login with an account that can read the document, then rerun capture");
        expect(contextError.message).not.toMatch(/secret-token|secret-session|secret-api-token/u);
        expect(JSON.stringify(contextError.detail)).not.toMatch(/secret-token|secret-session|secret-api-token/u);
        const logPath = contextError.detail?.log;
        expect(typeof logPath).toBe("string");
        const log = JSON.parse(readFileSync(join(projectRoot, logPath as string), "utf8")) as Record<string, unknown>;
        expect(log).toMatchObject({
          phase_id: "capture:lark:handbook",
          status: "failed",
        });
        expect(JSON.stringify(log)).not.toMatch(/secret-token|secret-session|secret-api-token/u);
      }

      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:lark classifies unavailable credential storage as a host execution requirement", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        return {
          stdout: "",
          stderr: "secure credential store unavailable: keychain not initialized\nA newer tool version is available",
          exitCode: 2,
        };
      };

      try {
        await runPhase({
          cwd: projectRoot,
          phaseId: "capture:lark:handbook",
          format: "json",
          larkRunner: runner,
        });
        throw new Error("expected capture failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const contextError = error as ContextError;
        expect(contextError.detail).toMatchObject({
          category: "external-tool-failed",
          reason_code: "external.credential-store-unavailable",
          execution: {
            target: "agent-host",
            required_capabilities: ["credential-store"],
          },
        });
        expect(contextError.detail?.next).toContain("Retry the same Context command through the Agent host");
        expect(contextError.detail?.next).toContain("do not downgrade credential protection");
        expect(contextError.detail?.next).not.toMatch(/upgrade|login/iu);
      }

      expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("align:lark refuses stale source identity before exposing evidence", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: okLarkRunner([]),
      });
      writeFileSync(join(projectRoot, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    docToken: doc-token-456",
        "    title: Product Handbook",
        "",
      ].join("\n"), "utf8");

      try {
        await runPhase({
          cwd: projectRoot,
          phaseId: "align:lark:handbook:architecture",
          format: "json",
          align: { view: "read-plan" },
        });
        throw new Error("expected stale lark identity failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        const contextError = error as ContextError;
        expect(contextError.message).toContain("snapshot identity is stale");
        expect(contextError.detail?.next).toBe("context run capture:lark:handbook");
        expect(JSON.stringify(contextError.detail)).toContain("repair_hints");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("captured Lark snapshot can compile source-bound candidates and verify after runtime cache is removed", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      await runPhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: okLarkRunner([]),
      });
      const readPlan = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:handbook:architecture",
        format: "json",
        align: { view: "read-plan" },
      })) as { result: { snapshot: { snapshot_hash: string } } };
      const sourceIndex = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:handbook:architecture",
        format: "json",
        align: { view: "source-index" },
      })) as { result: { source_index: { spans: Array<{ source_ref: string }> } } };
      const sourceRef = sourceIndex.result.source_index.spans[0]?.source_ref;
      expect(sourceRef).toMatch(/^lark:handbook\/index\.md#span:/u);
      const edgeSourceRef = formatCanonicalProseSourceRef({
        sourceType: "lark",
        sourceName: "handbook",
        documentPath: "index.md",
        span: createDocumentSourceSpan("# Fetched Handbook\n\nIntro from Lark.\n", { lineStart: 3, lineEnd: 3 }),
      });

      const structureDraftPath = join(projectRoot, ".tmp", "lark-structure-draft.json");
      const structureDraft = {
        schema_version: "context.structure.v1",
        sources: ["lark:handbook"],
        evidence_snapshot_hash: readPlan.result.snapshot.snapshot_hash,
        nodes: [{
          node_ref: "domain/handbook",
          title: "Handbook",
          node_type: "domain",
          summary: "Captured Lark handbook root.",
        }, {
          node_ref: "entity/fetched-handbook",
          title: "Fetched Handbook",
          node_type: "entity",
          summary: "Captured Lark handbook intro.",
          tags: ["module"],
        }],
        views: [{
          view_ref: "architecture:entity/fetched-handbook",
          node_ref: "entity/fetched-handbook",
          collection: "architecture",
          containment: "fetched-handbook",
          slug: "overview",
          title: "Fetched Handbook",
          node_type: "entity",
          path: "architecture/fetched-handbook/overview.md",
          summary: "Captured Lark handbook intro.",
          sections: [{
            id: "section-1",
            kind: "description",
            summary: "Captured Lark handbook intro.",
            source_refs: [sourceRef],
          }],
        }],
        edges: [{
          type: "contains",
          from: "domain/handbook",
          to: "entity/fetched-handbook",
          source_refs: [edgeSourceRef],
        }],
        unresolved: [],
        lifecycle: { state: "draft" },
      };
      writeFileSync(structureDraftPath, `${JSON.stringify(structureDraft, null, 2)}\n`, "utf8");
      const validated = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:handbook:architecture",
        format: "json",
        align: { validate: true, input: structureDraftPath },
      })) as { result: { structure_digest: string } };
      const structureConfirmedPath = join(projectRoot, ".tmp", "lark-structure-confirmed.json");
      writeFileSync(structureConfirmedPath, `${JSON.stringify({
        ...structureDraft,
        lifecycle: {
          state: "confirmed",
          confirmed_by: "human",
          confirmed_at: "2026-06-24T12:00:00Z",
          structure_digest: validated.result.structure_digest,
        },
      }, null, 2)}\n`, "utf8");
      await runPhase({
        cwd: projectRoot,
        phaseId: "align:lark:handbook:architecture",
        format: "json",
        align: { stage: true, input: structureConfirmedPath },
      });

      const nodeContext = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "compile:lark:handbook:architecture",
        format: "json",
        align: { view: "node-context", source: "architecture:entity/fetched-handbook" },
      })) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const localSourceRef = nodeContext.result.node_context.planned_sections[0]?.local_source_refs[0];
      expect(localSourceRef).toMatch(/^src-1#span:/u);

      const actionPath = join(projectRoot, ".tmp", "lark-compile-actions.json");
      writeFileSync(actionPath, `${JSON.stringify({
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/fetched-handbook",
        actions: [{
          op: "add",
          section_id: "section-1",
          kind: "description",
          summary: "Captured Lark handbook intro.",
          source_refs: [localSourceRef],
        }],
      }, null, 2)}\n`, "utf8");
      const staged = JSON.parse(await runPhase({
        cwd: projectRoot,
        phaseId: "compile:lark:handbook:architecture",
        format: "json",
        align: { stage: true, input: actionPath },
      })) as { result: { candidates: Record<string, number> } };
      expect(staged.result.candidates).toMatchObject({ added: 1 });

      const reviewPayloadPath = join(projectRoot, ".tmp", "approve-lark.jsonl");
      const scopedIds = scopedDraftCandidateIds(projectRoot, "architecture");
      writeFileSync(reviewPayloadPath, `${JSON.stringify({
        schema: "context.review.decisions.v1",
        collection: "architecture",
        scope: {
          kind: "collection",
          collection: "architecture",
          count: scopedIds.length,
          ids_sha256: candidateIdsHash(scopedIds),
          visible_candidate_ids: scopedIds,
        },
        default: "approved",
      })}\n`, "utf8");
      const applied = JSON.parse(await runReviewApply({
        cwd: projectRoot,
        payloadInput: reviewPayloadPath,
        format: "json",
      })) as Record<string, unknown>;
      expect(applied).toMatchObject({
        approved: 1,
        materialized: 1,
        pages: ["knowledge/architecture/fetched-handbook/overview.md"],
      });
      const approved = readFileSync(join(projectRoot, "knowledge", "architecture", "fetched-handbook", "overview.md"), "utf8");
      expect(approved).toContain("sources:\n  - lark:handbook/index.md");
      expect(approved).toContain('source_ref="src-1#span:');
      expect(approved).toContain("Intro from Lark.");

      rmSync(join(projectRoot, ".tmp"), { recursive: true, force: true });
      const verified = await verifyProjectWorkspace(projectRoot);
      expect(verified).toMatchObject({
        ok: true,
        evidenceStatus: "pass",
      });
      expect(verified.issues).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:lark empty and unsupported payload failures do not write snapshots or candidates", async () => {
    const cases: Array<{ name: string; stdout: string; expected: string; expectedNext?: string }> = [
      { name: "empty", stdout: "", expected: "document is empty" },
      { name: "not-json", stdout: "not json", expected: "not JSON", expectedNext: "capture:lark:handbook" },
      { name: "unsupported", stdout: JSON.stringify({ ok: true, data: { nodes: [] } }), expected: "unsupported payload shape", expectedNext: "capture:lark:handbook" },
      {
        name: "markdown-downgrade",
        stdout: JSON.stringify({ ok: true, data: { markdown: "# Legacy response" } }),
        expected: "returned Markdown despite --doc-format xml",
        expectedNext: "capture:lark:handbook",
      },
    ];
    for (const testCase of cases) {
      const root = makeTmp();
      try {
        const projectRoot = await createLarkProject(root);
        const runner: LarkRunner = async (args) => {
          if (args.includes("--help")) {
            return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
          }
          return { stdout: testCase.stdout, stderr: "", exitCode: 0 };
        };

        try {
          await runPhase({
            cwd: projectRoot,
            phaseId: "capture:lark:handbook",
            format: "json",
            larkRunner: runner,
          });
          throw new Error(`expected ${testCase.name} capture failure`);
        } catch (error) {
          expect(error).toBeInstanceOf(ContextError);
          expect((error as ContextError).message).toContain(testCase.expected);
          expect(typeof (error as ContextError).detail?.next).toBe("string");
          if (testCase.expectedNext !== undefined) {
            expect((error as ContextError).detail?.next).toContain(testCase.expectedNext);
          }
        }
        expect(existsSync(join(projectRoot, "sources", "lark", "handbook", "manifest.json"))).toBe(false);
        expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "candidates.jsonl"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("captureLark factory accepts neutral source references for lark phases", () => {
    const phase = captureLark({ source: source("handbook") });
    const align = alignProse({ source: source("handbook"), collection: "sop" });
    expect(phase.id).toBe("capture:lark:handbook");
    expect(align.id).toBe("align:source:handbook:sop");
  });
});
