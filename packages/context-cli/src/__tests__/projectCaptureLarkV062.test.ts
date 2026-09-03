import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureLark, source } from "@c4a/context";
import { parseDocumentSnapshotManifest } from "@c4a/extract";
import { ContextError } from "../lib/errors.js";
import type { LarkRunner } from "../lib/feishu.js";
import { parseLarkCaptureReport } from "../lib/larkCaptureReport.js";
import { initContextProject } from "../project/workspace.js";
import { parseDocumentSnapshotForSource } from "../project/documentBatchManifest.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "../project/documentCaptureContract.js";
import {
  createLarkCaptureProject as createLarkProject,
  makeLarkCaptureTmp as makeTmp,
  runLarkCapturePhase as runPhase,
} from "./projectCaptureLarkV062.fixtures.js";

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
        'import { captureLark, defineProject, source } from "@c4a/context";',
        "",
        'const guide = source("20260712", "guide-a", { type: "lark" });',
        'const apiGuide = source("20260712", "guide-b", { type: "lark" });',
        "",
        "export default defineProject({",
        "  sources: [guide, apiGuide],",
        "  phases: [",
        "    captureLark({ source: guide }),",
        "    captureLark({ source: apiGuide }),",
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("capture:lark writes committed snapshot metadata and refreshes assets", async () => {
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

  test("capture:lark gives an executable recovery for an outdated lark-cli", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createLarkProject(root);
      const runner: LarkRunner = async () => ({
        stdout: "Flags:\n      --api-version string\n",
        stderr: "",
        exitCode: 0,
      });

      try {
        await runPhase({
          cwd: projectRoot,
          phaseId: "capture:lark:handbook",
          format: "json",
          larkRunner: runner,
        });
        throw new Error("expected outdated lark-cli failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextError);
        expect((error as ContextError).detail).toMatchObject({
          reason_code: "external.tool-version-unsupported",
          next: "Run lark-cli update, confirm docs +fetch --help lists --doc-format, then rerun capture",
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("captureLark factory accepts neutral source references for lark phases", () => {
    const phase = captureLark({ source: source("handbook") });
    expect(phase.id).toBe("capture:lark:handbook");
  });
});
