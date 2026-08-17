import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocumentSnapshotManifest } from "@c4a/extract";
import type { LarkRunner } from "../lib/feishu.js";
import { parseLarkCaptureReport, type LarkCaptureReport } from "../lib/larkCaptureReport.js";
import { collectProjectStatus } from "../project/status.js";
import {
  createLarkCaptureProject,
  makeLarkCaptureTmp,
  runLarkCapturePhase,
} from "./projectCaptureLarkV062.fixtures.js";

async function expectFidelityFailure(run: Promise<string>): Promise<void> {
  try {
    await run;
    throw new Error("expected capture fidelity failure");
  } catch (error) {
    expect(error).toMatchObject({
      code: 2,
      detail: {
        category: "partial-failure",
        code: "lark.capture.fidelity-loss",
        next: "context status --format json",
      },
    });
  }
}

function captureReport(snapshotRoot: string): LarkCaptureReport {
  return parseLarkCaptureReport(JSON.parse(
    readFileSync(join(snapshotRoot, "assets", "capture-report.json"), "utf8"),
  ) as unknown);
}

describe("0.6.2 Lark capture fidelity", () => {
  test("preserves unknown XML blocks through a generic projection without blocking capture", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        if (args.includes("source-document")) {
          return {
            stdout: JSON.stringify({
              ok: true,
              data: {
                document: { content: '<p id="source-block">Shared evidence.</p>' },
              },
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        expect(args).toEqual(expect.arrayContaining(["--as", "user", "--detail", "full", "--doc-format", "xml"]));
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Fetched Handbook",
              revision_id: "rev-xml",
              document: {
                content: [
                  "<title>Fetched Handbook</title>",
                  '<p>See <cite doc-id="reference-token" file-type="docx" title="Reference"/>.</p>',
                  '<bookmark name="External schedule" href="https://calendar.example.com/shared/schedule"></bookmark>',
                  '<synced_reference src-token="source-document" src-block-id="source-block"></synced_reference>',
                  '<future_block><p>Evidence requiring a renderer.</p></future_block>',
                ].join("\n"),
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      const capture = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { fidelity: { status: string; evidence_status: string; projection_status: string } } };
      expect(capture.result.fidelity).toMatchObject({
        status: "warning",
        evidence_status: "complete",
        projection_status: "generic",
      });

      const snapshotRoot = join(projectRoot, "sources", "lark", "handbook");
      const markdown = readFileSync(join(snapshotRoot, "index.md"), "utf8");
      expect(markdown).toContain("[Reference](lark:docx:reference-token)");
      expect(markdown).toContain("Lark block (generic projection): `future_block`");
      expect(readFileSync(join(snapshotRoot, "assets", "source.xml"), "utf8")).toContain("<future_block>");
      const manifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8")) as unknown);
      expect(manifest.assets?.some((asset) => asset.path === "assets/source.xml")).toBe(true);
      expect(manifest.assets?.some((asset) => asset.path.startsWith("assets/references/"))).toBe(false);
      expect(captureReport(snapshotRoot).resources.map((resource) => resource.kind)).toEqual(
        expect.arrayContaining(["cite", "bookmark", "synced-reference"]),
      );
      expect(manifest.metadata?.capture?.report).toMatchObject({
        path: "assets/capture-report.json",
        fidelityStatus: "warning",
        evidenceStatus: "complete",
        projectionStatus: "generic",
      });
      expect(captureReport(snapshotRoot).fidelity).toMatchObject({
        status: "warning",
        evidence_status: "complete",
        projection_status: "generic",
      });

      const status = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(status.documentSources[0]?.snapshotReady).toBe(true);
      expect(status.documentSources[0]?.captureFidelity?.status).toBe("warning");
      expect(status.pendingCapturePhases).toEqual([]);
      expect(status.documentSources[0]?.diagnostics).toEqual(expect.arrayContaining([
        expect.stringContaining("future_block"),
      ]));
      expect(status.workflow.current?.node).not.toBe("repair-workspace-state");
      expect(status.draftCandidates).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("continues after preserving a diagram that the source API confirms no longer exists", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        if (args.includes("+media-download")) {
          return {
            stdout: "",
            stderr: JSON.stringify({ error: { code: 2890003, message: "The whiteboard Not Exists" } }),
            exitCode: 1,
          };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Handbook",
              revision_id: "rev-missing-diagram",
              document: {
                content: '<title>Handbook</title><readonly-block id="missing-board" type="diagram"></readonly-block>',
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      const capture = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { resource_materialization: { status: string; failed: Record<string, number> } } };
      expect(capture.result.resource_materialization).toMatchObject({
        status: "warning",
        failed: { diagram: 1 },
      });

      const status = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(status.documentSources[0]?.snapshotReady).toBe(true);
      expect(status.documentSources[0]?.resourceMaterialization?.status).toBe("warning");
      expect(status.documentSources[0]?.diagnostics).toEqual(expect.arrayContaining([
        expect.stringContaining("document.resource.source-missing"),
      ]));
      expect(status.pendingCapturePhases).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("continues with an auditable unavailable notice when media export permission is denied", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        if (args.includes("+media-download")) {
          return {
            stdout: "",
            stderr: JSON.stringify({
              ok: false,
              error: {
                type: "authorization",
                subtype: "permission_denied",
                message: "current identity does not have export permission for this document media",
              },
            }),
            exitCode: 1,
          };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Handbook",
              revision_id: "rev-restricted-image",
              document: {
                content: '<title>Handbook</title><img token="restricted-token" alt="Restricted image"/>',
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      const capture = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { resource_materialization: { status: string; failed: Record<string, number> } } };
      expect(capture.result.resource_materialization).toMatchObject({
        status: "warning",
        failed: { image: 1 },
      });

      const markdown = readFileSync(join(projectRoot, "sources", "lark", "handbook", "index.md"), "utf8");
      expect(markdown).toContain("Resource unavailable:");
      expect(markdown).toContain("export permission denied");
      expect(markdown).not.toContain("> Image:");

      const status = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(status.documentSources[0]?.resourceMaterialization?.status).toBe("warning");
      expect(status.documentSources[0]?.diagnostics).toEqual(expect.arrayContaining([
        expect.stringContaining("document.resource.permission-denied"),
      ]));
      expect(status.pendingCapturePhases).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("re-captures a historical evidence error after a stable resource identity becomes available", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      let resourceIdentityAvailable = false;
      const runner: LarkRunner = async (args, options) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        if (args.includes("+media-download")) {
          const output = args[args.indexOf("--output") + 1];
          if (output !== undefined) writeFileSync(resolve(options?.cwd ?? process.cwd(), output), "image-bytes", "utf8");
          return { stdout: JSON.stringify({ ok: true, data: { saved: true } }), stderr: "", exitCode: 0 };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Reference handbook",
              revision_id: "rev-references",
              document: {
                content: resourceIdentityAvailable
                  ? '<title>Reference handbook</title><img token="diagram-token" alt="Diagram"/>'
                  : '<title>Reference handbook</title><img alt="Diagram"/>',
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      await expectFidelityFailure(runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      }));

      const blocked = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(blocked.workflow.current?.node).toBe("capture-next");
      expect(blocked.workflow.current?.commands).toContainEqual(expect.objectContaining({
        command: expect.stringContaining("run capture:lark:handbook --format json"),
      }));

      resourceIdentityAvailable = true;
      const recovered = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { fidelity: { status: string } } };
      expect(recovered.result.fidelity.status).toBe("complete");

      const status = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(status.documentSources[0]?.snapshotReady).toBe(true);
      expect(status.documentSources[0]?.captureFidelity?.status).toBe("complete");
      expect(status.pendingCapturePhases).toEqual([]);
      expect(status.workflow.current?.node).not.toBe("repair-workspace-state");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("captures checked and unchecked Lark checklist blocks as readable Markdown", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Checklist handbook",
              revision_id: "rev-checklist",
              document: {
                content: [
                  "<title>Checklist handbook</title>",
                  '<checkbox done="true">Completed item</checkbox>',
                  '<checkbox done="false">Open item</checkbox>',
                ].join("\n"),
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      const capture = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { fidelity: { status: string } } };
      expect(capture.result.fidelity.status).toBe("complete");

      const snapshotRoot = join(projectRoot, "sources", "lark", "handbook");
      const markdown = readFileSync(join(snapshotRoot, "index.md"), "utf8");
      expect(markdown).toContain("- [x] Completed item");
      expect(markdown).toContain("- [ ] Open item");
      const manifest = parseDocumentSnapshotManifest(
        JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8")) as unknown,
      );
      expect(manifest.metadata?.capture?.report?.fidelityStatus).toBe("complete");
      expect(captureReport(snapshotRoot).fidelity.status).toBe("complete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves sub-page lists without blocking the document source", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      let fetchCalls = 0;
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        fetchCalls += 1;
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Document index",
              revision_id: "rev-sub-pages",
              document: {
                content: fetchCalls === 1
                  ? '<title>Document index</title><sub-page-list space-id="space-token" wiki-token="parent-token"></sub-page-list>'
                  : [
                      "<title>Document index</title>",
                      '<sub-page-list space-id="space-token" wiki-token="parent-token">',
                      '  <sub-page doc-id="document-alpha" file-type="docx" title="Alpha guide"/>',
                      '  <sub-page doc-id="document-beta" file-type="docx" title="Beta guide"/>',
                      "</sub-page-list>",
                    ].join(""),
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      const capture = JSON.parse(await runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      })) as { result: { fidelity: { status: string } } };
      expect(capture.result.fidelity.status).toBe("complete");
      expect(fetchCalls).toBe(2);

      const snapshotRoot = join(projectRoot, "sources", "lark", "handbook");
      const markdown = readFileSync(join(snapshotRoot, "index.md"), "utf8");
      expect(markdown).toContain("Alpha guide");
      expect(markdown).toContain("Beta guide");
      const manifest = parseDocumentSnapshotManifest(JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8")) as unknown);
      expect(manifest.assets?.filter((asset) => asset.path.startsWith("assets/references/"))).toHaveLength(0);
      expect(captureReport(snapshotRoot).resources.filter((resource) => resource.kind === "document")).toHaveLength(2);
      expect(manifest.metadata?.capture?.report?.fidelityStatus).toBe("complete");

      const status = await collectProjectStatus(projectRoot);
      expect(status.documentSources[0]?.snapshotReady).toBe(true);
      expect(status.documentSources[0]?.captureFidelity?.status).toBe("complete");
      expect(status.workflow.current?.node).not.toBe("repair-workspace-state");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails closed when a sub-page list remains empty after one retry", async () => {
    const root = makeLarkCaptureTmp();
    try {
      const projectRoot = await createLarkCaptureProject(root);
      let fetchCalls = 0;
      const runner: LarkRunner = async (args) => {
        if (args.includes("--help")) {
          return { stdout: "Flags:\n      --api-version string\n      --doc-format string\n", stderr: "", exitCode: 0 };
        }
        fetchCalls += 1;
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              title: "Document index",
              revision_id: "rev-empty-list",
              document: {
                content: '<title>Document index</title><sub-page-list space-id="space-token" wiki-token="parent-token"></sub-page-list>',
              },
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      };

      await expectFidelityFailure(runLarkCapturePhase({
        cwd: projectRoot,
        phaseId: "capture:lark:handbook",
        format: "json",
        larkRunner: runner,
      }));
      expect(fetchCalls).toBe(2);

      const snapshotRoot = join(projectRoot, "sources", "lark", "handbook");
      const manifest = parseDocumentSnapshotManifest(
        JSON.parse(readFileSync(join(snapshotRoot, "manifest.json"), "utf8")) as unknown,
      );
      expect(manifest.metadata?.capture?.report?.fidelityStatus).toBe("error");
      expect(captureReport(snapshotRoot).fidelity.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "lark.capture.sub-page-list-empty" }),
      ]));

      const status = await collectProjectStatus(projectRoot, {
        managed: true,
        authorities: ["context.source-read"],
      });
      expect(status.documentSources[0]?.snapshotReady).toBe(false);
      expect(status.pendingCapturePhases).toEqual(["capture:lark:handbook"]);
      expect(status.workflow.current?.node).toBe("capture-next");
      expect(status.workflow.current?.node).not.toMatch(/review/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
