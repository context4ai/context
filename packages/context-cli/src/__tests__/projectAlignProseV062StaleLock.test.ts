import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createCapturedAlignProject, firstSourceRef, invokeCliInDir, makeTmp, runCliInDir, structurePayload, writePayload } from "./projectAlignProseV062Helpers.js";

describe("0.6.6 prose align structure gate", () => {
  test("stale source refs and stale snapshots block structure staging", async () => {
    const root = makeTmp();
    try {
      const { projectRoot, docsDir } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const staleRef = sourceRef.replace(/L\d+-\d+/u, "L1-1");
      const staleRefPayload = writePayload(projectRoot, "stale-ref-structure.yaml", structurePayload(projectRoot, staleRef));

      const validated = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--validate",
        "--input",
        staleRefPayload,
        "--format",
        "json",
      ])) as { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; repair?: Record<string, unknown> }> } };
      expect(validated.result.valid).toBe(false);
      expect(validated.result.diagnostics).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "source_ref.content-drift",
      }));

      const payload = writePayload(projectRoot, "race-structure.yaml", structurePayload(projectRoot, sourceRef));
      writeFileSync(join(docsDir, "guide.md"), "# Guide\n\nThe source changed after structure planning.\n", "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);
      const staged = await invokeCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        payload,
        "--format",
        "json",
      ]);
      expect(staged.status).not.toBe(0);
      expect(staged.stderr).toContain("context.structure.v1 payload is not valid");
      expect(staged.stderr).toContain("payload.digest_stale");
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("structure stage uses the project write lock", async () => {
    const root = makeTmp();
    try {
      const { projectRoot } = await createCapturedAlignProject(root);
      const sourceRef = await firstSourceRef(projectRoot);
      const payload = writePayload(projectRoot, "locked-structure.yaml", structurePayload(projectRoot, sourceRef));
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "locks"), { recursive: true });
      await mkdir(join(projectRoot, ".tmp", "context-runtime", "locks", "project-write.lock"));

      const staged = await invokeCliInDir(projectRoot, [
        "run",
        "align:file:product-docs:architecture",
        "--stage",
        "--input",
        payload,
        "--format",
        "json",
      ]);

      expect(staged.status).not.toBe(0);
      expect(staged.stderr).toContain("context project write lock is already held");
      expect(staged.stderr).toContain("Wait for the running context command to finish");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
