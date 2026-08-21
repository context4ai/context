import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import { writeApprovedStructureProjection } from "../project/close.js";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";
import {
  invokeCliInDir,
  makeTmp,
  runCliInDir,
  writeJsonl,
  writeYaml,
} from "./projectCompileProseV066Helpers.js";
import {
  COLLECTION,
  SOURCE_NAMES,
  compileView,
  createProject,
  stageStructure,
  writeApprovedPage,
  writeEdgeSnapshot,
} from "./projectMultiSourceReviewV071Fixtures.js";

describe("multi-source prose review", () => {
  test("routes the next unprepared view through its owning source compile phase", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const firstView = stageStructure(projectRoot, SOURCE_NAMES[0]);
      const firstStructure = YAML.parse(readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
        "utf8",
      )) as AlignPayload & { lifecycle: { structure_digest: string } };
      await writeStructureSnapshot(projectRoot, {
        ...firstStructure,
        structure_digest: firstStructure.lifecycle.structure_digest,
      });

      const secondView = stageStructure(projectRoot, SOURCE_NAMES[1]);
      await compileView(projectRoot, SOURCE_NAMES[1], secondView);

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        routing: { command_plan: Array<{ command: string }> };
        compileBatch: {
          nextViewRef: string;
          nextSourceKeys: string[];
          nextCollection: string;
        };
      };
      expect(status.state).toBe("route.compile.pending-target");
      expect(status.compileBatch).toMatchObject({
        nextViewRef: firstView,
        nextSourceKeys: [`file:${SOURCE_NAMES[0]}`],
        nextCollection: COLLECTION,
      });
      expect(status.routing.command_plan).toHaveLength(1);
      expect(status.routing.command_plan[0]?.command).toContain("--workflow-revision");
      expect(status.routing.command_plan[0]?.command).toContain(
        `run compile:file:${SOURCE_NAMES[0]}:${COLLECTION} --stage --format json`,
      );
      const compiled = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        `compile:file:${SOURCE_NAMES[0]}:${COLLECTION}`,
        "--stage",
        "--format",
        "json",
      ])) as { result: { views: number; candidates: { added: number } } };
      expect(compiled.result.views).toBe(1);
      expect(compiled.result.candidates.added).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("managed execution compiles every ready source in one isolated host loop", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const packagePath = join(projectRoot, "package.json");
      const projectPackage = JSON.parse(readFileSync(packagePath, "utf8")) as {
        context: Record<string, unknown>;
      };
      projectPackage.context.debug = true;
      writeFileSync(packagePath, `${JSON.stringify(projectPackage, null, 2)}\n`, "utf8");
      stageStructure(projectRoot, SOURCE_NAMES[0]);
      const firstStructure = YAML.parse(readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
        "utf8",
      )) as AlignPayload & { lifecycle: { structure_digest: string } };
      await writeStructureSnapshot(projectRoot, {
        ...firstStructure,
        structure_digest: firstStructure.lifecycle.structure_digest,
      });
      stageStructure(projectRoot, SOURCE_NAMES[1]);

      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--managed",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        workflow: {
          current: {
            resources: { required: Array<{ id: string; digest?: string }> };
          };
        };
      };
      const receiptPath = join(".tmp", "managed-compile-receipts.json");
      writeFileSync(join(projectRoot, receiptPath), `${JSON.stringify({
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts: status.workflow.current.resources.required.flatMap((resource) =>
          resource.digest === undefined ? [] : [{ id: resource.id, digest: resource.digest }]
        ),
      })}\n`, "utf8");

      const result = JSON.parse(await runCliInDir(projectRoot, [
        "--workflow-resource-receipts",
        `@${receiptPath}`,
        "run",
        "--managed",
        "--until",
        "blocked-or-complete",
        "--max-steps",
        "4",
        "--format",
        "json",
      ])) as {
        state: string;
        steps: Array<{ receipt?: { exitCode: number } }>;
        stop: { reasonCode: string };
      };
      expect(result.steps).toHaveLength(3);
      expect(result.steps.every((step) => step.receipt?.exitCode === 0)).toBe(true);
      expect(result).toMatchObject({
        state: "blocked",
        stop: { reasonCode: "workflow.until.agent-context-required" },
      });

      const after = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as { draftCandidates: number; compileBatch: { remainingViewRefs: string[] } };
      expect(after.draftCandidates).toBe(0);
      expect(after.compileBatch.remainingViewRefs).toEqual([]);
      const scopeEvents = readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "debug", "events.jsonl"),
        "utf8",
      ).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
        kind: string;
        data: { executor?: string };
      }).filter((event) => event.kind === "workflow.scope-opened");
      expect(scopeEvents.filter((event) => event.data.executor === "in-process")).toHaveLength(3);
      expect(scopeEvents.some((event) => event.data.executor === "subprocess")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finishes every declared source slot before opening one collection Review", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const initial = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        structureBatch: {
          state: string;
          sourceCount: number;
          slotCount: number;
          slots: Array<{ sourceKey: string; collection: string; stage: string; nextCommand: string }>;
        };
        routing: { command_plan: Array<{ command: string }> };
      };
      expect(initial.state).toBe("route.structure.pending-target");
      expect(initial.structureBatch).toMatchObject({
        state: "awaiting-structure",
        sourceCount: 2,
        slotCount: 2,
      });
      expect(initial.structureBatch.slots.map((slot) => slot.stage)).toEqual([
        "structure-pending",
        "structure-pending",
      ]);
      expect(initial.routing.command_plan.map((item) => item.command)).toEqual(
        initial.structureBatch.slots.map((slot) => expect.stringContaining(
          slot.nextCommand.slice("context ".length),
        )),
      );
      const firstView = stageStructure(projectRoot, SOURCE_NAMES[0]);
      await compileView(projectRoot, SOURCE_NAMES[0], firstView);

      const betweenSources = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        draftCandidates: number;
        pendingStructureTargets: Array<{ sourceKey: string }>;
        pendingReview?: unknown;
      };
      expect(betweenSources.state).toBe("route.structure.pending-target");
      expect(betweenSources.draftCandidates).toBe(1);
      expect(betweenSources.pendingStructureTargets.map((target) => target.sourceKey))
        .toEqual([`file:${SOURCE_NAMES[1]}`]);
      expect(betweenSources.pendingReview).toBeUndefined();

      const secondView = stageStructure(projectRoot, SOURCE_NAMES[1]);
      await compileView(projectRoot, SOURCE_NAMES[1], secondView);
      const batchReady = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        draftCandidates: number;
        pendingStructureTargets: unknown[];
        pendingReview: { count: number; collection: string };
      };
      expect(batchReady.state).toBe("route.review.decision-required");
      expect(batchReady.draftCandidates).toBe(2);
      expect(batchReady.pendingStructureTargets).toEqual([]);
      expect(batchReady.pendingReview).toMatchObject({ count: 2, collection: COLLECTION });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not treat approved views from an older structure as a prepared managed Review batch", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        await compileView(projectRoot, sourceName, viewRef);
      }
      const initialPayload = writeJsonl(projectRoot, "initial-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", initialPayload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      for (const sourceName of SOURCE_NAMES) {
        const approved = readFileSync(
          join(projectRoot, "knowledge", COLLECTION, sourceName, "overview.md"),
          "utf8",
        );
        expect(approved).toContain("structure_digest: sha256:");
      }

      for (const sourceName of SOURCE_NAMES) {
        writeFileSync(
          join(root, sourceName, "reference.md"),
          "# Reference\n\nUpdated source paragraph.\n",
          "utf8",
        );
        await runCliInDir(projectRoot, [
          "run",
          `capture:file:${sourceName}`,
          "--format",
          "json",
        ]);
      }

      const revisedViews = new Map<string, string>();
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName, "revised");
        revisedViews.set(sourceName, viewRef);
        const structure = YAML.parse(readFileSync(
          join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
          "utf8",
        )) as AlignPayload & { lifecycle: { structure_digest: string } };
        await writeStructureSnapshot(projectRoot, {
          ...structure,
          structure_digest: structure.lifecycle.structure_digest,
        });
      }
      await compileView(
        projectRoot,
        SOURCE_NAMES[0],
        revisedViews.get(SOURCE_NAMES[0])!,
        "update",
      );

      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--managed",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        state: string;
        draftCandidates: number;
        compileBatch: {
          readyForReview: boolean;
          remainingViewRefs: string[];
          nextSourceKeys: string[];
        };
        pendingReview?: unknown;
        routing: { command_plan: Array<{ command: string }> };
      };
      expect(status.state).toBe("route.compile.pending-target");
      expect(status.draftCandidates).toBe(1);
      expect(status.compileBatch.readyForReview).toBe(false);
      expect(status.compileBatch.remainingViewRefs).toEqual([
        revisedViews.get(SOURCE_NAMES[1])!,
      ]);
      expect(status.compileBatch.nextSourceKeys).toEqual([
        `file:${SOURCE_NAMES[1]}`,
      ]);
      expect(status.pendingReview).toBeUndefined();
      expect(status.routing.command_plan[0]?.command).toContain(
        `run compile:file:${SOURCE_NAMES[1]}:${COLLECTION} --stage --format json`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finishes an active prose round before refreshing an older stale projection", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      writeApprovedPage(projectRoot, SOURCE_NAMES[0], "baseline");
      await writeApprovedStructureProjection(projectRoot);
      writeApprovedPage(projectRoot, SOURCE_NAMES[0], "newly-approved");

      const firstView = stageStructure(projectRoot, SOURCE_NAMES[0]);
      const beforeCompile = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        state: string;
        close: { state: string };
        routing: { command_plan: Array<{ command: string }> };
      };
      expect(beforeCompile.close.state).toBe("stale");
      expect(beforeCompile.state).toBe("route.compile.pending-target");
      expect(beforeCompile.routing.command_plan[0]?.command).toContain(
        `run compile:file:${SOURCE_NAMES[0]}:${COLLECTION} --stage --format json`,
      );

      await compileView(projectRoot, SOURCE_NAMES[0], firstView);
      const betweenSources = JSON.parse(await runCliInDir(projectRoot, [
        "status",
        "--format",
        "json",
        "--view",
        "full",
      ])) as {
        state: string;
        close: { state: string };
        pendingStructureTargets: Array<{ sourceKey: string }>;
      };
      expect(betweenSources.close.state).toBe("stale");
      expect(betweenSources.state).toBe("route.structure.pending-target");
      expect(betweenSources.pendingStructureTargets).toEqual([
        expect.objectContaining({ sourceKey: `file:${SOURCE_NAMES[1]}` }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("continues with an unprocessed captured source after the first structure round", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const firstSource = SOURCE_NAMES[0];
      const viewRef = stageStructure(projectRoot, firstSource);
      await compileView(projectRoot, firstSource, viewRef);
      const payload = writeJsonl(projectRoot, "first-round-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        pendingStructureTargets: Array<{
          sourceKey: string;
          collection: string;
          alignPhaseId: string;
          configurationGaps: string[];
          suggestions: string[];
          command: string;
          payloadTarget: string;
        }>;
        routing: { command_plan: Array<{ command: string }> };
      };
      const alignPhaseId = `align:source:${SOURCE_NAMES[1]}:${COLLECTION}`;
      const command = `context run ${alignPhaseId} --view read-plan --format json`;
      expect(status.state).toBe("route.structure.pending-target");
      expect(status.pendingStructureTargets).toEqual([{
        sourceKey: `file:${SOURCE_NAMES[1]}`,
        collection: COLLECTION,
        alignPhaseId,
        configurationGaps: [],
        suggestions: [],
        command,
        payloadTarget: ".tmp/agent-payloads/align-source-source-b-architecture-structure.yaml",
      }]);
      expect(status.routing.command_plan.map((item) => item.command)).toEqual([
        expect.stringContaining(command.slice("context ".length)),
      ]);

      const summary = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--format", "json",
      ])) as {
        workflow: { protocol: string; current: { node: string; commands: Array<{ command: string }> } };
        currentTarget: { sourceKeys: string[]; collections: string[] };
        routing?: unknown;
      };
      expect(summary.workflow).toMatchObject({
        protocol: "context.workflow.status.v1",
        current: {
          node: "align-next",
          commands: [{ command: expect.stringContaining(command.slice("context ".length)) }],
        },
      });
      expect(summary.currentTarget).toMatchObject({
        sourceKeys: [`file:${SOURCE_NAMES[1]}`],
        collections: [COLLECTION],
      });
      expect(summary.routing).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("applies one collection review against each candidate's immutable structure snapshot", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        await compileView(projectRoot, sourceName, viewRef);
      }

      const status = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        draftCandidates: number;
        pendingReview: { count: number; candidateSetDigest: string };
        stagedStructure: { sourceKeys: string[] };
        activeStructures: { count: number; sourceKeys: string[]; structureDigests: string[] };
        alignPhaseResolution: { state: string; requestedTargets: Array<{ sourceKey: string; collection: string }> };
        compileBatch: {
          plannedViewRefs: string[];
          draftViewRefs: string[];
          structureDigests: string[];
          missingStructureDigests: string[];
        };
      };
      expect(status.draftCandidates).toBe(SOURCE_NAMES.length);
      expect(status.pendingReview.count).toBe(SOURCE_NAMES.length);
      expect(status.compileBatch.plannedViewRefs).toHaveLength(SOURCE_NAMES.length);
      expect(status.compileBatch.draftViewRefs).toHaveLength(SOURCE_NAMES.length);
      expect(status.compileBatch.structureDigests).toHaveLength(SOURCE_NAMES.length);
      expect(status.compileBatch.missingStructureDigests).toEqual([]);
      expect(status.pendingReview.candidateSetDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(status.stagedStructure.sourceKeys).toHaveLength(1);
      expect(status.activeStructures.count).toBe(SOURCE_NAMES.length);
      expect(status.activeStructures.sourceKeys).toEqual(SOURCE_NAMES.map((name) => `file:${name}`));
      expect(status.activeStructures.structureDigests).toHaveLength(SOURCE_NAMES.length);
      expect(status.alignPhaseResolution.state).toBe("resolved-multiple");
      expect(status.alignPhaseResolution.requestedTargets).toHaveLength(SOURCE_NAMES.length);

      const reviewHtml = JSON.parse(await runCliInDir(projectRoot, [
        "review",
        "html",
        COLLECTION,
        "--format",
        "json",
      ])) as { candidate_set_digest: string; structure_digests: string[] };
      expect(reviewHtml.candidate_set_digest).toBe(status.pendingReview.candidateSetDigest);
      expect(reviewHtml.structure_digests).toHaveLength(SOURCE_NAMES.length);
      const reviewList = JSON.parse(await runCliInDir(projectRoot, [
        "review",
        "list",
        COLLECTION,
        "--format",
        "json",
      ])) as Array<{ fingerprint?: string; structure_digest?: string }>;
      expect(reviewList).toHaveLength(SOURCE_NAMES.length);
      expect(reviewList.every((candidate) => candidate.fingerprint?.startsWith("sha256:") === true)).toBe(true);
      expect(reviewList.every((candidate) => candidate.structure_digest?.startsWith("sha256:") === true)).toBe(true);

      const payload = writeJsonl(projectRoot, "review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      const applied = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(applied.status).toBe(0);
      for (const sourceName of SOURCE_NAMES) {
        expect(readFileSync(join(projectRoot, "knowledge", COLLECTION, sourceName, "overview.md"), "utf8"))
          .toContain(`resource: file:${sourceName}/reference.md`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an old candidate after its source and collection slot advances", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const sourceName = SOURCE_NAMES[0];
      const viewRef = stageStructure(projectRoot, sourceName);
      await compileView(projectRoot, sourceName, viewRef);

      stageStructure(projectRoot, sourceName, "revised");
      const revisedStructure = YAML.parse(readFileSync(
        join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"),
        "utf8",
      )) as AlignPayload & { lifecycle: { structure_digest: string } };
      await writeStructureSnapshot(projectRoot, {
        ...revisedStructure,
        structure_digest: revisedStructure.lifecycle.structure_digest,
      });
      const revisedContext = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        `compile:file:${sourceName}:${COLLECTION}`,
        "--view",
        "node-context",
        "--source",
        viewRef,
        "--format",
        "json",
      ])) as { result: { node_context: { planned_sections: Array<{ local_source_refs: string[] }> } } };
      const revisedActions = writeYaml(projectRoot, "revised-actions.yaml", {
        schema_version: "context.compile-actions.v1",
        view_ref: viewRef,
        actions: [{
          op: "add",
          section_id: "overview",
          kind: "description",
          summary: "Revised source-backed overview.",
          source_refs: [revisedContext.result.node_context.planned_sections[0]!.local_source_refs[0]],
        }],
      });
      await runCliInDir(projectRoot, [
        "run",
        `compile:file:${sourceName}:${COLLECTION}`,
        "--validate",
        "--input",
        revisedActions,
        "--format",
        "json",
      ]);

      const payload = writeJsonl(projectRoot, "stale-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      const applied = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(applied.status).not.toBe(0);
      expect(applied.stderr).toContain("review is blocked until the confirmed compile batch is prepared");
      expect(applied.stderr).toContain(viewRef);
      expect(() => readFileSync(join(projectRoot, "knowledge", COLLECTION, sourceName, "overview.md"), "utf8")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("restores confirmation only for an identical source and collection structure slot", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        await compileView(projectRoot, sourceName, viewRef);
      }
      const slots = YAML.parse(readFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure-slots.yaml"), "utf8")) as {
        slots: Array<{ source: string; collection: string; structure_digest: string }>;
      };
      const target = slots.slots.find((slot) => slot.source === `file:${SOURCE_NAMES[0]}` && slot.collection === COLLECTION)!;
      const snapshotPath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structures", `${target.structure_digest.slice("sha256:".length)}.yaml`);
      const draft = YAML.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown> & { lifecycle: Record<string, unknown> };
      draft.lifecycle = { state: "draft" };
      writeFileSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml"), YAML.stringify(draft), "utf8");

      const restored = JSON.parse(await runCliInDir(projectRoot, [
        "run",
        `align:file:${SOURCE_NAMES[0]}:${COLLECTION}`,
        "--stage",
        "--input",
        ".tmp/context-runtime/lifecycle/structure.yaml",
        "--format",
        "json",
      ])) as {
        result: {
          kind: string;
          operation: string;
          confirmation_restored: boolean;
          lifecycle_state: string;
          structure_digest_changed?: boolean;
          next_action: { human_gate?: boolean; reason_code: string };
        };
      };
      expect(restored.result.kind).toBe("prose.align.structure-write.result");
      expect(restored.result.operation).toBe("confirmation-restored");
      expect(restored.result.confirmation_restored).toBe(true);
      expect(restored.result.lifecycle_state).toBe("confirmed");
      expect(restored.result.structure_digest_changed).toBeUndefined();
      expect(restored.result.next_action.human_gate).not.toBe(true);
      expect(restored.result.next_action.reason_code).toBe("prose-align-structure-confirmation-restored");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps review atomic when a source-bound structure snapshot cannot be reconstructed", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        await compileView(projectRoot, sourceName, viewRef);
      }
      rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structures"), { recursive: true, force: true });
      rmSync(join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure-slots.yaml"), { force: true });

      const payload = writeJsonl(projectRoot, "missing-structure-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      const applied = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(applied.status).not.toBe(0);
      expect(applied.stderr).toContain("review is blocked because candidate structure snapshots are missing");
      expect(applied.stderr).toContain("missing_structure_digests");
      for (const sourceName of SOURCE_NAMES) {
        expect(() => readFileSync(join(projectRoot, "knowledge", COLLECTION, sourceName, "overview.md"), "utf8"))
          .toThrow();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("close projection merges active source snapshots and replaces only their managed edges", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      for (const sourceName of SOURCE_NAMES) {
        writeApprovedPage(projectRoot, sourceName, "parent");
        writeApprovedPage(projectRoot, sourceName, "child");
        await writeEdgeSnapshot(projectRoot, sourceName);
      }
      writeApprovedPage(projectRoot, SOURCE_NAMES[0], "secondary-parent", "sop");
      writeApprovedPage(projectRoot, SOURCE_NAMES[0], "secondary-child", "sop");
      writeFileSync(join(projectRoot, "knowledge", "structure.yaml"), YAML.stringify({
        schema_version: "context.approved-structure.v1",
        edges: [{
          type: "depends_on",
          from: `${COLLECTION}:entity/source-a/child`,
          to: `${COLLECTION}:entity/source-b/child`,
          source_refs: ["repo:shared#symbol:src/shared.ts:shared:function@abcdef123456"],
        }, {
          type: "depends_on",
          from: `${COLLECTION}:entity/source-a/parent`,
          to: `${COLLECTION}:entity/source-a/child`,
          source_refs: ["file:source-a/reference.md#span:obsolete L1-1@abcdef123456"],
        }, {
          type: "prerequisite",
          from: "sop:entity/source-a/secondary-parent",
          to: "sop:entity/source-a/secondary-child",
          source_refs: ["file:source-a/reference.md#span:secondary L1-1@abcdef123456"],
        }],
      }), "utf8");

      await writeApprovedStructureProjection(projectRoot);

      const approved = YAML.parse(readFileSync(join(projectRoot, "knowledge", "structure.yaml"), "utf8")) as {
        edges: Array<{ type: string; from: string; to: string }>;
      };
      expect(approved.edges).toHaveLength(4);
      expect(approved.edges.filter((edge) => edge.type === "contains").map((edge) => [edge.from, edge.to]))
        .toEqual(expect.arrayContaining(SOURCE_NAMES.map((sourceName) => [
          `${COLLECTION}:entity/${sourceName}/parent`,
          `${COLLECTION}:entity/${sourceName}/child`,
        ])));
      expect(approved.edges).toContainEqual(expect.objectContaining({
        type: "depends_on",
        from: `${COLLECTION}:entity/source-a/child`,
        to: `${COLLECTION}:entity/source-b/child`,
      }));
      expect(approved.edges).not.toContainEqual(expect.objectContaining({
        type: "depends_on",
        from: `${COLLECTION}:entity/source-a/parent`,
        to: `${COLLECTION}:entity/source-a/child`,
      }));
      expect(approved.edges).toContainEqual(expect.objectContaining({
        type: "prerequisite",
        from: "sop:entity/source-a/secondary-parent",
        to: "sop:entity/source-a/secondary-child",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
