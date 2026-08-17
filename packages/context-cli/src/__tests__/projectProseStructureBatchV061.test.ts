import { rmSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";
import {
  COLLECTION,
  SOURCE_NAMES,
  createProject,
  writeDraftStructure,
} from "./projectMultiSourceReviewV071Fixtures.js";

describe("multi-source prose structure batch", () => {
  test("validates and stages multiple source structures through one managed batch", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        pendingStructureTargets: Array<{ alignPhaseId: string; payloadTarget: string }>;
        workflow: {
          current: {
            action: { input_schema: { path: string } };
            batch: {
              schema: string;
              input_schema: { path: string };
              input: string;
              targets: Array<{ phase_id: string; input: string }>;
              validate: { command: string };
              stage: { command: string };
            };
          };
        };
      };
      expect(status.workflow.current.action.input_schema.path.endsWith(
        "schemas/prose-structure-batch.schema.json",
      )).toBe(true);
      expect(status.workflow.current.batch).toMatchObject({
        schema: "context.prose.structure-batch.v1",
        input: ".tmp/agent-payloads/prose-structure-batch.yaml",
      });
      expect(status.workflow.current.batch.input_schema.path.endsWith(
        "schemas/prose-structure-batch.schema.json",
      )).toBe(true);
      expect(status.workflow.current.batch.targets).toEqual(
        status.pendingStructureTargets.map((target) => ({
          phase_id: target.alignPhaseId,
          input: target.payloadTarget,
          source_key: expect.any(String),
          collection: COLLECTION,
        })),
      );
      expect(status.workflow.current.batch.validate.command).toContain("--workflow-revision");
      expect(status.workflow.current.batch.stage.command).toContain("--stage --managed");

      const items = status.pendingStructureTargets.map((target, index) => ({
        phase_id: target.alignPhaseId,
        input: writeDraftStructure(projectRoot, SOURCE_NAMES[index]!),
      }));
      const batchInput = writeYaml(projectRoot, "structure-batch.yaml", {
        schema: "context.prose.structure-batch.v1",
        items,
      });
      const validated = JSON.parse(await runCliInDir(projectRoot, [
        "run", "--batch-input", batchInput, "--validate", "--managed", "--format", "json",
      ])) as { state: string; targets: number; ready: number; written: number };
      expect(validated).toMatchObject({ state: "ready", targets: 2, ready: 2, written: 0 });

      const staged = JSON.parse(await runCliInDir(projectRoot, [
        "run", "--batch-input", batchInput, "--stage", "--managed", "--format", "json",
      ])) as { state: string; targets: number; ready: number; written: number };
      expect(staged).toMatchObject({ state: "confirmed", targets: 2, ready: 2, written: 2 });

      const after = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        pendingStructureTargets: unknown[];
        activeStructures: { slotCount: number };
        state: string;
      };
      expect(after.pendingStructureTargets).toEqual([]);
      expect(after.activeStructures.slotCount).toBe(2);
      expect(after.state).toBe("route.compile.pending-target");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("batch preflight writes no structure when one target is invalid", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as { pendingStructureTargets: Array<{ alignPhaseId: string }> };
      const validInput = writeDraftStructure(projectRoot, SOURCE_NAMES[0]);
      const invalidInput = writeYaml(projectRoot, "invalid-structure.yaml", {
        schema_version: "context.structure.v1",
      });
      const batchInput = writeYaml(projectRoot, "invalid-structure-batch.yaml", {
        schema: "context.prose.structure-batch.v1",
        items: [
          { phase_id: status.pendingStructureTargets[0]!.alignPhaseId, input: validInput },
          { phase_id: status.pendingStructureTargets[1]!.alignPhaseId, input: invalidInput },
        ],
      });
      const staged = await invokeCliInDir(projectRoot, [
        "run", "--batch-input", batchInput, "--stage", "--managed", "--format", "json",
      ]);
      expect(staged.status).not.toBe(0);
      expect(staged.stderr).toContain("no structure was written");
      const after = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--format", "json", "--view", "full",
      ])) as { activeStructures: { slotCount: number }; pendingStructureTargets: unknown[] };
      expect(after.activeStructures.slotCount).toBe(0);
      expect(after.pendingStructureTargets).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
