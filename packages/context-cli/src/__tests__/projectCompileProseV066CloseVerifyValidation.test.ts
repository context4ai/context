import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  enableKbPackage,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedRichStructure,
  stageConfirmedStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 compileProse close/build/verify validation", () => {
  test("failed close does not leave approved structure in ready state", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "close-failure-actions.yaml", {
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
      const payload = writeJsonl(projectRoot, "close-failure-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      const approvedPath = join(projectRoot, "knowledge", "architecture", "install", "overview.md");
      writeFileSync(approvedPath, readFileSync(approvedPath, "utf8").replace("Alpha opening paragraph", "Alpha"), "utf8");

      const failedClose = await invokeCliInDir(projectRoot, ["close", "--format", "json"]);
      expect(failedClose.status).not.toBe(0);
      expect(failedClose.stderr).toContain("verify still reports errors");
      expect(existsSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"))).toBe(true);
      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        close: { state: string };
      };
      expect(status.close.state).not.toBe("ready");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("build reruns verify and blocks stale or unavailable evidence after close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      await enableKbPackage(projectRoot);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedRichStructure(projectRoot, refs);
      const actionFile = writeYaml(projectRoot, "build-verify-actions.yaml", {
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
      const payload = writeJsonl(projectRoot, "review-build-verify.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      rmSync(join(projectRoot, "sources", "file", "product-docs", "manifest.json"), { force: true });
      const blocked = await invokeCliInDir(projectRoot, ["build"]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("package build requires verified evidence");
      expect(blocked.stderr).toContain("approved-evidence-snapshot-invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("verify rejects approved structure edge refs without committed evidence and fake structure nodes", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      for (const node of [
        { id: "entity/install", section: "install" },
        { id: "entity/configure", section: "configure" },
      ]) {
        const actionFile = writeYaml(projectRoot, `${node.section}-edge-ref-actions.yaml`, {
          schema_version: "context.compile-actions.v1",
          view_ref: `architecture:${node.id}`,
          actions: [{
            op: "add",
            section_id: node.section,
            kind: "description",
            summary: `${node.section} source span`,
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
      }
      const payload = writeJsonl(projectRoot, "review-edge-ref-nodes.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const structure = YAML.parse(readFileSync(structurePath, "utf8")) as {
        nodes: Array<Record<string, unknown>>;
        edges: Array<{ source_refs: string[]; to?: string }>;
      };
      structure.edges[0]!.source_refs = ["not-a-ref"];
      writeFileSync(structurePath, YAML.stringify(structure), "utf8");
      const invalid = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(invalid.status).not.toBe(0);
      expect(invalid.stdout).toContain("canonical-source-ref-invalid");
      expect(invalid.stdout).toContain("knowledge/structure.yaml");

      structure.edges[0]!.source_refs = ["file:product-docs/missing.md#span:overview L1-1@deadbeef"];
      writeFileSync(structurePath, YAML.stringify(structure), "utf8");
      const unresolved = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(unresolved.status).not.toBe(0);
      expect(unresolved.stdout).toContain("source-document-missing");
      expect(unresolved.stdout).toContain("knowledge/structure.yaml");
      const unresolvedResult = JSON.parse(unresolved.stdout) as {
        issues: Array<{ code: string; collection?: string; view_ref?: string; node_ref?: string }>;
      };
      expect(unresolvedResult.issues).toContainEqual(expect.objectContaining({
        code: "source-document-missing",
        collection: "architecture",
        view_ref: "architecture:entity/install",
        node_ref: "entity/install",
      }));

      structure.nodes.push({
        node_ref: "entity/fake",
        title: "Fake",
        node_type: "entity",
      });
      structure.edges[0]!.source_refs = [refs[0]!];
      structure.edges[0]!.to = "entity/fake";
      writeFileSync(structurePath, YAML.stringify(structure), "utf8");
      const fakeNode = await invokeCliInDir(projectRoot, ["verify", "--format", "json"]);
      expect(fakeNode.status).not.toBe(0);
      expect(fakeNode.stdout).toContain("approved-structure-node-not-approved");
      expect(fakeNode.stdout).toContain("approved-structure-edge-invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
