import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createCapturedCompileProject,
  enableKbPackage,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedRichStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 package build evidence status gate", () => {
  test("build allows pass-with-unverifiable-evidence after deterministic close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      await enableKbPackage(projectRoot);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "warning-build-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: "architecture:entity/install",
        actions: [{
          op: "add",
          section_id: "install-1",
          kind: "description",
          summary: "Install source span",
          source_refs: [refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--stage",
        "--input",
        actionFile,
        "--format",
        "json",
      ]);
      const payload = writeJsonl(projectRoot, "review-warning-build.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      rmSync(join(projectRoot, "sources", "file", "product-docs"), { recursive: true, force: true });
      const verify = JSON.parse(await runCliInDir(projectRoot, ["verify", "--format", "json"])) as {
        evidence_status: string;
        issues: Array<{ code: string; severity: string }>;
      };
      expect(verify.evidence_status).toBe("pass-with-unverifiable-evidence");
      expect(verify.issues.some((issue) => issue.severity === "warning")).toBe(true);
      expect(verify.issues.some((issue) => issue.severity === "error")).toBe(false);

      const build = await invokeCliInDir(projectRoot, ["build"]);
      expect(build.status).toBe(0);
      expect(build.stdout).toContain("✓ built project packages");
      expect(existsSync(join(projectRoot, "dist", "sample-kb", "guides", "architecture", "install", "overview.md"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
