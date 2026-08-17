import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createCapturedCompileProject,
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  sourceRefs,
  stageConfirmedStructure,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";

describe("0.6.6 compileProse approved structure restore", () => {
  test("compile rejects invalid approved structure edges before node context restore", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      for (const node of [
        { id: "entity/install", section: "install" },
        { id: "entity/configure", section: "configure" },
      ]) {
        const actionFile = writeYaml(projectRoot, `${node.section}-restore-actions.yaml`, {
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
      const payload = writeJsonl(projectRoot, "review-restore-edges.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), { force: true });

      const structurePath = join(projectRoot, "knowledge", "structure.yaml");
      const original = YAML.parse(readFileSync(structurePath, "utf8")) as {
        input_hash: string;
        edges: Array<{ type: string; source_refs: string[] }>;
      };
      expect(original.edges.length).toBe(1);

      const staleInputHash = { ...original, input_hash: "sha256:stale" };
      writeFileSync(structurePath, YAML.stringify(staleInputHash), "utf8");
      const stale = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("knowledge/structure.yaml is stale for compile");

      const oldSchema = { ...original, schema_version: "context.structure.v1" };
      writeFileSync(structurePath, YAML.stringify(oldSchema), "utf8");
      const unsupportedSchema = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(unsupportedSchema.status).not.toBe(0);
      expect(unsupportedSchema.stderr).toContain("unsupported approved structure schema");

      writeFileSync(structurePath, YAML.stringify(original), "utf8");

      const invalidType = { ...original, edges: original.edges.map((edge) => ({ ...edge, type: "related" })) };
      writeFileSync(structurePath, YAML.stringify(invalidType), "utf8");
      const badType = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(badType.status).not.toBe(0);
      expect(badType.stderr).toContain("structure edge has invalid type");

      const invalidRef = { ...original, edges: original.edges.map((edge) => ({ ...edge, source_refs: ["not-a-source-ref"] })) };
      writeFileSync(structurePath, YAML.stringify(invalidRef), "utf8");
      const badRef = await invokeCliInDir(projectRoot, [
        "run",
        "compile:file:product-docs:architecture",
        "--view",
        "read-plan",
        "--format",
        "json",
      ]);
      expect(badRef.status).not.toBe(0);
      expect(badRef.stderr).toContain("knowledge/structure.yaml is stale for compile");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
