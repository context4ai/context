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
  stageConfirmedParentIndexStructure,
  writeJsonl,
} from "./projectCompileProseV066Helpers.js";
import {
  readCandidateRecords,
  writeCandidateRecords,
  type CandidateRecord,
} from "../project/candidateLedger.js";
import { writeCompileCandidates } from "../project/proseCompileCandidates.js";
import { parseAlignPayload } from "../project/proseAlignPayloadParse.js";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";

const PHASE_ID = "compile:file:product-docs:architecture";

describe("0.6.9 batched human review", () => {
  test("replaces one path identity without shrinking a 148-candidate batch", async () => {
    const root = makeTmp();
    try {
      const records = Array.from({ length: 148 }, (_, index): CandidateRecord => ({
        candidate_id: `architecture/entity/item-${index}`,
        node_ref: `entity/item-${index}`,
        view_ref: `architecture:entity/item-${index}`,
        collection: "architecture",
        status: "draft",
        candidate_type: "prose-align",
        kind: "entity",
        visibility: "exported",
        module: "sample-source",
        path: `architecture/items/item-${index}.md`,
        structure_digest: "sha256:previous",
        source_refs: [`file:sample-source/reference.md#span:item-${index} L1-1@abcdef123456`],
        fingerprint: `fingerprint-${index}`,
        review: {
          title: `Item ${index}`,
          summary: "Source-backed candidate.",
          signals: ["source-backed"],
          reason: "Generated for lifecycle testing.",
        },
        updated: "2026-01-01T00:00:00Z",
      }));
      await writeCandidateRecords(root, records);
      const replacement: CandidateRecord = {
        ...records[0]!,
        candidate_id: "architecture/entity/item-zero-stable",
        node_ref: "entity/item-zero-stable",
        view_ref: "architecture:entity/item-zero-stable",
        structure_digest: "sha256:current",
        fingerprint: "fingerprint-current",
      };

      const result = await writeCompileCandidates({ projectRoot: root, records: [replacement] });
      const recovered = await readCandidateRecords(root);
      expect(result.replacedIdentityConflicts).toBe(1);
      expect(recovered).toHaveLength(148);
      expect(recovered).toContainEqual(expect.objectContaining({
        candidate_id: replacement.candidate_id,
        path: replacement.path,
      }));
      expect(recovered).not.toContainEqual(expect.objectContaining({
        candidate_id: records[0]!.candidate_id,
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("coordinates a resumed path identity conflict before compile, Review, and close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      const refs = await sourceRefs(projectRoot);
      await stageConfirmedStructure(projectRoot, [refs[0]!]);
      const currentStructure = YAML.parse(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "structure.yaml",
      ), "utf8")) as AlignPayload;
      await runCliInDir(projectRoot, ["run", PHASE_ID, "--stage", "--format", "json"]);
      const initialCandidates = await readCandidateRecords(projectRoot);
      const firstReview = writeJsonl(projectRoot, "first-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", firstReview, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);

      const draftBody = {
        ...currentStructure,
        nodes: currentStructure.nodes.map((node) =>
          node.node_ref === "entity/install"
            ? { ...node, node_ref: "entity/install-replacement" }
            : node
        ),
        views: currentStructure.views.map((view) =>
          view.view_ref === "architecture:entity/install"
            ? {
                ...view,
                node_ref: "entity/install-replacement",
                view_ref: "architecture:entity/install-replacement",
                sections: view.sections.map((section) => ({
                  ...section,
                  section_ref: section.section_ref.replace(
                    "architecture:entity/install",
                    "architecture:entity/install-replacement",
                  ),
                })),
              }
            : view
        ),
        edges: currentStructure.edges.map((edge) => ({
          ...edge,
          from: edge.from === "entity/install" ? "entity/install-replacement" : edge.from,
          to: edge.to === "entity/install" ? "entity/install-replacement" : edge.to,
        })),
        lifecycle: { state: "draft" as const },
      };
      const draft = parseAlignPayload(draftBody).payload;
      expect(draft).toBeDefined();
      const replacement = parseAlignPayload({
        ...draftBody,
        lifecycle: {
          state: "confirmed",
          phase_collection: "architecture",
          confirmed_by: "legacy-runtime",
          confirmed_at: "structure-snapshot",
          structure_digest: draft!.structure_digest,
        },
      }).payload;
      expect(replacement).toBeDefined();
      await writeStructureSnapshot(projectRoot, replacement!);

      await writeCandidateRecords(projectRoot, initialCandidates.map((record) => {
        const conflicted = record.view_ref === "architecture:entity/install";
        return {
          ...record,
          status: "draft" as const,
          structure_digest: replacement!.structure_digest,
          ...(conflicted
            ? {
                candidate_id: record.candidate_id.replace(
                  "entity/install",
                  "entity/install-replacement",
                ),
                node_ref: "entity/install-replacement",
                view_ref: "architecture:entity/install-replacement",
              }
            : {}),
        };
      }));
      const before = (await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft");
      expect(before).toHaveLength(2);
      expect(before).toContainEqual(expect.objectContaining({
        path: "architecture/install/overview.md",
        view_ref: "architecture:entity/install-replacement",
      }));

      const conflictStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        reviewIdentityConflicts: { count: number; sourceKeys: string[] };
        workflow: { current: { reason_code: string; commands: Array<{ command: string }> } };
      };
      expect(conflictStatus.state).toBe("route.indexer.lifecycle-required");
      expect(conflictStatus.reviewIdentityConflicts).toMatchObject({
        count: 1,
        sourceKeys: ["file:product-docs"],
      });
      expect(conflictStatus.workflow.current).toMatchObject({
        reason_code: "route.indexer.lifecycle-required",
        commands: [],
      });

      const blockedReview = await invokeCliInDir(projectRoot, [
        "review", "approve-all", "--all", "--managed", "--format", "json",
      ]);
      expect(blockedReview.status).not.toBe(0);
      expect(blockedReview.stderr).toContain("review-path-identity-conflict");
      expect((await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft"))
        .toHaveLength(2);

      const beforeMigrationAttempt = readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "candidates.jsonl",
      ), "utf8");
      const migration = await invokeCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        "file:product-docs",
        "--strategy",
        "migrate",
        "--format",
        "json",
      ]);
      expect(migration.status).not.toBe(0);
      expect(migration.stderr).toContain("identity-migration-authority-required");
      expect(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "candidates.jsonl",
      ), "utf8")).toBe(beforeMigrationAttempt);

      const reconciled = JSON.parse(await runCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        "file:product-docs",
        "--strategy",
        "preserve-approved",
        "--format",
        "json",
      ])) as {
        conflictsResolved: number;
        affectedViews: number;
        migrationPerformed: boolean;
        structureDigests: string[];
      };
      expect(reconciled).toMatchObject({
        conflictsResolved: 1,
        affectedViews: 2,
        migrationPerformed: false,
      });

      const compileStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        compileBatch: { remainingViewRefs: string[]; nextSourceKeys?: string[] };
      };
      expect(compileStatus.state).toBe("route.indexer.lifecycle-required");
      expect(compileStatus.compileBatch.remainingViewRefs).toHaveLength(2);
      expect(compileStatus.compileBatch.nextSourceKeys).toEqual(["file:product-docs"]);

      const recompiled = JSON.parse(await runCliInDir(projectRoot, [
        "run", PHASE_ID, "--stage", "--format", "json",
      ])) as { result: { candidates: { replacedIdentityConflicts: number } } };
      expect(recompiled.result.candidates.replacedIdentityConflicts).toBe(1);
      const recovered = (await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft");
      expect(recovered).toHaveLength(2);
      expect(recovered).toContainEqual(expect.objectContaining({
        path: "architecture/install/overview.md",
        view_ref: "architecture:entity/install",
      }));
      expect(recovered).not.toContainEqual(expect.objectContaining({
        view_ref: "architecture:entity/install-replacement",
      }));
      expect([...new Set(recovered.map((record) => record.structure_digest))])
        .toEqual(reconciled.structureDigests);

      const readyStatus = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        compileBatch: { structureDigests: string[]; remainingViewRefs: string[] };
      };
      expect(readyStatus.compileBatch.structureDigests).toEqual(reconciled.structureDigests);
      expect(readyStatus.compileBatch.remainingViewRefs).toEqual([]);

      const finalReview = writeJsonl(projectRoot, "final-review.json", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", finalReview, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      expect((await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft"))
        .toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("compile evidence Views are parallel-safe and do not freeze or rewrite structure", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      await stageConfirmedParentIndexStructure(projectRoot, await sourceRefs(projectRoot));
      const structurePath = join(projectRoot, ".tmp", "context-runtime", "lifecycle", "structure.yaml");
      const before = readFileSync(structurePath, "utf8");

      const results = await Promise.all([
        "architecture:action/runbook/install",
        "architecture:action/runbook/commands",
      ].map((viewRef) => invokeCliInDir(projectRoot, [
        "run", PHASE_ID, "--view", "node-context", "--source", viewRef, "--format", "json",
      ])));

      expect(results.map((result) => result.status)).toEqual([0, 0]);
      expect(readFileSync(structurePath, "utf8")).toBe(before);
      expect(YAML.parse(before).lifecycle.state).toBe("confirmed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prose compile prepares every confirmed view before one Review and one close", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      await stageConfirmedParentIndexStructure(projectRoot, await sourceRefs(projectRoot));

      const compiled = JSON.parse(await runCliInDir(projectRoot, [
        "run", PHASE_ID, "--stage", "--format", "json",
      ])) as {
        result: {
          views: number;
          sections: number;
          candidates: { added: number };
          next_action: { kind: string; command: string };
        };
      };
      expect(compiled.result).toMatchObject({
        views: 3,
        sections: 4,
        candidates: { added: 3 },
      });
      expect(compiled.result.next_action).toMatchObject({
        kind: "reevaluate_workspace_route",
        command: "context status --format json",
      });

      const reviewStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        draftCandidates: number;
        compileBatch: { readyForReview: boolean; draftViewRefs: string[]; remainingViewRefs: string[] };
      };
      expect(reviewStatus.state).toBe("route.indexer.lifecycle-required");
      expect(reviewStatus.draftCandidates).toBe(0);
      expect(reviewStatus.compileBatch.readyForReview).toBe(true);
      expect(reviewStatus.compileBatch.draftViewRefs).toHaveLength(3);
      expect(reviewStatus.compileBatch.remainingViewRefs).toEqual([]);

      const review = JSON.parse(await runCliInDir(projectRoot, [
        "review", "html", "architecture", "--format", "json",
      ])) as { candidates: number };
      expect(review.candidates).toBe(3);
      const payload = writeJsonl(projectRoot, "batch-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);

      const closeStatus = JSON.parse(await runCliInDir(projectRoot, ["status", "--format", "json", "--view", "full"])) as {
        state: string;
        compileBatch: { complete: boolean; approvedViewRefs: string[] };
      };
      expect(closeStatus.state).toBe("route.indexer.lifecycle-required");
      expect(closeStatus.compileBatch.complete).toBe(true);
      expect(closeStatus.compileBatch.approvedViewRefs).toHaveLength(3);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recapturing a compiled source routes stale candidates back through align and compile before Review", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createCapturedCompileProject(root);
      await stageConfirmedParentIndexStructure(projectRoot, await sourceRefs(projectRoot));
      await runCliInDir(projectRoot, ["run", PHASE_ID, "--stage", "--format", "json"]);

      const sourcePath = join(root, "docs", "guide.md");
      writeFileSync(sourcePath, `${readFileSync(sourcePath, "utf8").trimEnd()}\n\n## Later update\n\nNew source evidence.\n`, "utf8");
      await runCliInDir(projectRoot, ["run", "capture:file:product-docs", "--format", "json"]);

      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        pendingStructureTargets: Array<{ sourceKey: string; collection: string }>;
        pendingReview?: unknown;
        activeStructures: { slots: Array<{ snapshotCurrent: boolean; evidenceSnapshotHash?: string; currentSnapshotHash?: string }> };
        compileBatch: { staleViewRefs: string[]; staleSourceKeys: string[]; readyForReview: boolean };
        routing: { command_plan: Array<{ command: string }> };
      };
      expect(status.state).toBe("route.indexer.lifecycle-required");
      expect(status.pendingStructureTargets).toContainEqual(expect.objectContaining({
        sourceKey: "file:product-docs",
        collection: "architecture",
      }));
      expect(status.pendingReview).toBeUndefined();
      expect(status.activeStructures.slots).toContainEqual(expect.objectContaining({
        snapshotCurrent: false,
        evidenceSnapshotHash: expect.stringMatching(/^sha256:/u),
        currentSnapshotHash: expect.stringMatching(/^sha256:/u),
      }));
      expect(status.activeStructures.slots[0]?.evidenceSnapshotHash)
        .not.toBe(status.activeStructures.slots[0]?.currentSnapshotHash);
      expect(status.compileBatch.readyForReview).toBe(false);
      expect(status.compileBatch.staleViewRefs).toHaveLength(3);
      expect(status.compileBatch.staleSourceKeys).toEqual(["file:product-docs"]);
      expect(status.routing.command_plan).toEqual([]);

      const payload = writeJsonl(projectRoot, "stale-review.jsonl", [{
        schema: "context.review.decisions.v1",
        collection: "architecture",
        default: "approved",
      }]);
      const apply = await invokeCliInDir(projectRoot, ["review", "apply", payload, "--format", "json"]);
      expect(apply.status).not.toBe(0);
      expect(apply.stderr).toContain("review is blocked because prose candidates target an older source snapshot");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
