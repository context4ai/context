import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
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
      ])) as {
        state: string;
        targets: number;
        ready: number;
        written: number;
        validations: Array<{ diagnostic_codes: string[]; confirmation_blocker_codes: string[] }>;
      };
      expect(validated).toMatchObject({ state: "ready", targets: 2, ready: 2, written: 0 });
      expect(validated.validations).toEqual([
        expect.objectContaining({
          diagnostic_codes: expect.arrayContaining(["node.thin_concrete_entity"]),
          confirmation_blocker_codes: [],
        }),
        expect.objectContaining({
          diagnostic_codes: expect.arrayContaining(["node.thin_concrete_entity"]),
          confirmation_blocker_codes: [],
        }),
      ]);

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

  test("reports semantic repair blockers without classifying the batch as invalid", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as { pendingStructureTargets: Array<{ alignPhaseId: string }> };
      const readyInput = writeDraftStructure(projectRoot, SOURCE_NAMES[0]);
      const repairInput = writeDraftStructure(projectRoot, SOURCE_NAMES[1]);
      const repairPayload = YAML.parse(readFileSync(repairInput, "utf8")) as {
        nodes: Array<Record<string, unknown>>;
        views: Array<Record<string, unknown> & {
          sections: Array<Record<string, unknown> & { source_refs: string[] }>;
        }>;
        edges: Array<Record<string, unknown>>;
      };
      const sourceRef = repairPayload.views[0]!.sections[0]!.source_refs[0]!;
      repairPayload.nodes.push(
        { node_ref: "entity/secondary-a", title: "Secondary A", node_type: "entity", tags: ["module"] },
        { node_ref: "entity/secondary-b", title: "Secondary B", node_type: "entity", tags: ["module"] },
      );
      repairPayload.views.push(
        {
          view_ref: "architecture:entity/secondary-a",
          node_ref: "entity/secondary-a",
          collection: "architecture",
          containment: "secondary",
          slug: "secondary-a",
          title: "Secondary A",
          node_type: "entity",
          path: "architecture/secondary/secondary-a.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/secondary-a#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        },
        {
          view_ref: "architecture:entity/secondary-b",
          node_ref: "entity/secondary-b",
          collection: "architecture",
          containment: "secondary",
          slug: "secondary-b",
          title: "Secondary B",
          node_type: "entity",
          path: "architecture/secondary/secondary-b.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/secondary-b#overview",
            kind: "description",
            source_refs: [sourceRef],
          }],
        },
      );
      repairPayload.edges.push({
        type: "prerequisite",
        from: "architecture:entity/secondary-a",
        to: "architecture:entity/secondary-b",
        source_refs: [sourceRef],
      });
      writeFileSync(repairInput, YAML.stringify(repairPayload), "utf8");
      const batchInput = writeYaml(projectRoot, "repair-structure-batch.yaml", {
        schema: "context.prose.structure-batch.v1",
        items: [
          { phase_id: status.pendingStructureTargets[0]!.alignPhaseId, input: readyInput },
          { phase_id: status.pendingStructureTargets[1]!.alignPhaseId, input: repairInput },
        ],
      });

      const validated = JSON.parse(await runCliInDir(projectRoot, [
        "run", "--batch-input", batchInput, "--validate", "--managed", "--format", "json",
      ])) as {
        state: string;
        ready: number;
        written: number;
        validations: Array<{
          state: string;
          diagnostic_codes: string[];
          confirmation_blocker_codes: string[];
        }>;
      };
      expect(validated).toMatchObject({ state: "repair-required", ready: 1, written: 0 });
      expect(validated).toMatchObject({
        next_action: { reason_code: "prose-structure-batch-repair-required" },
      });
      expect(validated.validations[1]).toMatchObject({
        state: "repair-required",
        diagnostic_codes: expect.arrayContaining(["view.orphan_risk"]),
        confirmation_blocker_codes: expect.arrayContaining(["view.orphan_risk"]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
