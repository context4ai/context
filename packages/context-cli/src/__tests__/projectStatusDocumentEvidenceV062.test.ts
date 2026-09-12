import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectProjectStatus } from "../project/status.js";
import { initContextProject } from "../project/workspace.js";
import { writeCaptureProjectEntry } from "./projectCaptureFileV062Helpers.js";
import { makeProject, writeFileRegistry } from "./projectVerifyV062Helpers.js";

  test("keeps invalid snapshot diagnostics while routing through capture configuration and permission", async () => {
    const root = await makeProject();
    try {
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await writeFileRegistry(initialized.projectRoot, "docs");
      await mkdir(join(initialized.projectRoot, "sources", "file", "docs"), { recursive: true });
      const manifestPath = join(initialized.projectRoot, "sources", "file", "docs", "manifest.json");
      const damaged = "{not-json\n";
      await writeFile(manifestPath, damaged, "utf8");

      const status = await collectProjectStatus(initialized.projectRoot);

      expect(status.state).toBe("route.capture.configuration-required");
      expect(status.workflow.current?.configuration?.file).toBe("src/index.ts");
      expect(status.documentSources[0]?.snapshotReady).toBe(false);
      expect(status.documentSources[0]?.diagnostics.some((diagnostic) => diagnostic.includes("snapshot manifest is invalid"))).toBe(true);

      writeCaptureProjectEntry(initialized.projectRoot, "docs");
      const permission = await collectProjectStatus(initialized.projectRoot);
      expect(permission.workflow.current).toMatchObject({
        node: "authorize-document-capture",
        gate: { id: "source-read-permission", resolution: "user" },
      });
      const authorized = await collectProjectStatus(initialized.projectRoot, {
        authorities: ["context.source-read"],
      });
      expect(authorized.workflow.current?.node).toBe("capture-next");
      expect(authorized.workflow.current?.commands[0]?.command).toContain("run capture:file:docs");
      expect(authorized.documentSources[0]?.snapshotReady).toBe(false);
      expect(authorized.documentSources[0]?.diagnostics.some((diagnostic) => diagnostic.includes("snapshot manifest is invalid"))).toBe(true);
      expect(await readFile(manifestPath, "utf8")).toBe(damaged);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
