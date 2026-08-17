import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { collectProjectStatus } from "../project/status.js";
import { initContextProject } from "../project/workspace.js";
import { makeProject, writeSnapshot } from "./projectVerifyV062Helpers.js";

async function writeDateBatchProject(input: {
  projectRoot: string;
  sourceType: "file" | "lark";
}): Promise<void> {
  const { projectRoot, sourceType } = input;
  await mkdir(join(projectRoot, "sources", sourceType), { recursive: true });
  const modules = sourceType === "file"
    ? [
        { name: "manual-a", local: "docs/manual-a" },
        { name: "manual-b", local: "docs/manual-b" },
      ]
    : [
        { name: "manual-a", url: "https://example.test/wiki/a" },
        { name: "manual-b", url: "https://example.test/wiki/b" },
      ];
  await writeFile(join(projectRoot, "sources", sourceType, "index.yaml"), YAML.stringify({
    sources: [{ name: "20260712", modules }],
  }), "utf8");

  const factory = sourceType === "file" ? "captureFile" : "captureLark";
  const sourceKind = sourceType;
  await writeFile(join(projectRoot, "src", "index.ts"), [
    `import { ${factory}, defineProject, source } from "@c4a/context";`,
    "",
    `const manualA = source("20260712", "manual-a", { type: "${sourceKind}" });`,
    `const manualB = source("20260712", "manual-b", { type: "${sourceKind}" });`,
    "",
    "export default defineProject({",
    "  sources: [manualA, manualB],",
    "  phases: [",
    `    ${factory}({ source: manualA }),`,
    `    ${factory}({ source: manualB }),`,
    "  ],",
    "  packages: [],",
    "});",
    "",
  ].join("\n"), "utf8");
}

describe("0.6.2 document date-batch status routing", () => {
  test("returns every pending capture command for one confirmed Lark batch", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeDateBatchProject({ projectRoot: initialized.projectRoot, sourceType: "lark" });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.capture.permission-required");
      expect(status.sourceSummary.document).toEqual({ total: 2, captured: 0 });
      expect(status.pendingCapturePhases).toEqual([
        "capture:lark:20260712/manual-a",
        "capture:lark:20260712/manual-b",
      ]);
      expect(status.routing.command_plan).toEqual([{
        availability: "after-human-confirmation",
        command: "context status --authority 'context.source-read' --format json",
      }]);
      expect(status.routing.human_gate).toMatchObject({ required: true, kind: "source-read-permission" });
      const authorized = await collectProjectStatus(initialized.projectRoot, {
        authorities: ["context.source-read"],
      });
      expect(authorized.routing.human_gate.required).toBe(false);
      expect(authorized.routing.command_plan).toHaveLength(1);
      expect(authorized.routing.command_plan[0]?.command).toContain("--workflow-revision");
      expect(authorized.routing.command_plan[0]?.command).toContain(
        "run capture:lark:20260712/manual-a --format json",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("continues only the uncaptured file modules in the date batch", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeDateBatchProject({ projectRoot: initialized.projectRoot, sourceType: "file" });
      await writeSnapshot({
        projectRoot: initialized.projectRoot,
        sourceType: "file",
        sourceName: "20260712/manual-a",
        files: [{ path: "index.md", bytes: "# Manual A\n", title: "Manual A" }],
      });

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.capture.permission-required");
      expect(status.sourceSummary.document).toEqual({ total: 2, captured: 1 });
      expect(status.pendingCapturePhases).toEqual(["capture:file:20260712/manual-b"]);
      expect(status.routing.command_plan).toEqual([{
        availability: "after-human-confirmation",
        command: "context status --authority 'context.source-read' --format json",
      }]);
      expect(status.routing.human_gate).toMatchObject({ required: true, kind: "source-read-permission" });
      const authorized = await collectProjectStatus(initialized.projectRoot, {
        authorities: ["context.source-read"],
      });
      expect(authorized.routing.command_plan).toHaveLength(1);
      expect(authorized.routing.command_plan[0]?.command).toContain(
        "run capture:file:20260712/manual-b --format json",
      );
      expect(status.next).not.toContain("capture:file:20260712/manual-a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
