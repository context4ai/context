import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import { readCandidateRecords, writeCandidateRecords } from "../project/candidateLedger.js";
import { parseAlignPayload } from "../project/proseAlignPayloadParse.js";
import type { AlignPayload } from "../project/proseAlignTypes.js";
import { readReviewPathIdentityConflicts } from "../project/reviewIdentityConflicts.js";
import { writeStructureSnapshot } from "../project/proseStructureStore.js";
import {
  makeTmp,
  runCliInDir,
  writeJsonl,
} from "./projectCompileProseV066Helpers.js";
import {
  COLLECTION,
  SOURCE_NAMES,
  compileView,
  createProject,
  stageStructure,
} from "./projectMultiSourceReviewV071Fixtures.js";

describe("multi-source prose review identity coordination", () => {
  test("preserves an approved ViewRef path and recompiles only its owning source", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const initialStructures: AlignPayload[] = [];
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        const structure = YAML.parse(readFileSync(join(
          projectRoot,
          ".tmp",
          "context-runtime",
          "lifecycle",
          "structure.yaml",
        ), "utf8")) as AlignPayload & { lifecycle: { structure_digest: string } };
        initialStructures.push({ ...structure, structure_digest: structure.lifecycle.structure_digest });
        await compileView(projectRoot, sourceName, viewRef);
      }
      const initialCandidates = await readCandidateRecords(projectRoot);
      const initialPayload = writeJsonl(projectRoot, "path-baseline-review.json", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", initialPayload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      await writeStructureSnapshot(projectRoot, initialStructures[1]!);

      const viewRef = stageStructure(projectRoot, SOURCE_NAMES[0]);
      const staged = YAML.parse(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "structure.yaml",
      ), "utf8")) as AlignPayload;
      const movedBody = {
        ...staged,
        views: staged.views.map((view) => view.view_ref === viewRef
          ? {
              ...view,
              containment: `${SOURCE_NAMES[0]}-moved`,
              path: `${COLLECTION}/${SOURCE_NAMES[0]}-moved/overview.md`,
            }
          : view),
        lifecycle: { state: "draft" as const },
      };
      const movedDraft = parseAlignPayload(movedBody).payload!;
      const moved = parseAlignPayload({
        ...movedBody,
        lifecycle: {
          state: "confirmed",
          phase_collection: COLLECTION,
          confirmed_by: "legacy-runtime",
          confirmed_at: "structure-snapshot",
          structure_digest: movedDraft.structure_digest,
        },
      }).payload!;
      await writeStructureSnapshot(projectRoot, moved);
      await writeCandidateRecords(projectRoot, initialCandidates.map((record) => ({
        ...record,
        status: "draft" as const,
        ...(record.source?.name === SOURCE_NAMES[0]
          ? {
              structure_digest: moved.structure_digest,
              path: `${COLLECTION}/${SOURCE_NAMES[0]}-moved/overview.md`,
            }
          : {}),
      })));

      const detected = await readReviewPathIdentityConflicts(projectRoot);
      expect(detected.conflicts).toContainEqual(expect.objectContaining({
        kind: "approved-identity-at-other-path",
        approvedPath: `${COLLECTION}/${SOURCE_NAMES[0]}/overview.md`,
      }));
      const routed = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        reviewIdentityConflicts: { conflicts: Array<{ kind: string; approvedPath: string }> };
      };
      expect(routed.state).toBe("route.review.identity-conflict");
      expect(routed.reviewIdentityConflicts.conflicts).toContainEqual(expect.objectContaining({
        kind: "approved-identity-at-other-path",
        approvedPath: `${COLLECTION}/${SOURCE_NAMES[0]}/overview.md`,
      }));

      await runCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        `file:${SOURCE_NAMES[0]}`,
        "--strategy",
        "preserve-approved",
        "--format",
        "json",
      ]);
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        draftCandidates: number;
        compileBatch: { remainingViewRefs: string[]; nextSourceKeys: string[] };
      };
      expect(status.state).toBe("route.compile.pending-target");
      expect(status.draftCandidates).toBe(2);
      expect(status.compileBatch.remainingViewRefs).toEqual([viewRef]);
      expect(status.compileBatch.nextSourceKeys).toEqual([`file:${SOURCE_NAMES[0]}`]);

      await compileView(projectRoot, SOURCE_NAMES[0], viewRef, "update");
      const recovered = (await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft");
      expect(recovered).toHaveLength(2);
      expect(recovered.find((record) => record.view_ref === viewRef)?.path)
        .toBe(`${COLLECTION}/${SOURCE_NAMES[0]}/overview.md`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("recompiles only the source affected by approved path identity coordination", async () => {
    const root = makeTmp();
    try {
      const projectRoot = await createProject(root);
      const initialStructures: AlignPayload[] = [];
      for (const sourceName of SOURCE_NAMES) {
        const viewRef = stageStructure(projectRoot, sourceName);
        const structure = YAML.parse(readFileSync(join(
          projectRoot,
          ".tmp",
          "context-runtime",
          "lifecycle",
          "structure.yaml",
        ), "utf8")) as AlignPayload & { lifecycle: { structure_digest: string } };
        initialStructures.push({
          ...structure,
          structure_digest: structure.lifecycle.structure_digest,
        });
        await compileView(projectRoot, sourceName, viewRef);
      }
      const initialCandidates = await readCandidateRecords(projectRoot);
      const initialPayload = writeJsonl(projectRoot, "identity-baseline-review.json", [{
        schema: "context.review.decisions.v1",
        collection: COLLECTION,
        default: "approved",
      }]);
      await runCliInDir(projectRoot, ["review", "apply", initialPayload, "--format", "json"]);
      await runCliInDir(projectRoot, ["close", "--format", "json"]);
      await writeStructureSnapshot(projectRoot, initialStructures[1]!);

      stageStructure(projectRoot, SOURCE_NAMES[0]);
      const staged = YAML.parse(readFileSync(join(
        projectRoot,
        ".tmp",
        "context-runtime",
        "lifecycle",
        "structure.yaml",
      ), "utf8")) as AlignPayload;
      const oldNodeRef = `entity/${SOURCE_NAMES[0]}`;
      const oldViewRef = `${COLLECTION}:${oldNodeRef}`;
      const nextNodeRef = `${oldNodeRef}-replacement`;
      const nextViewRef = `${COLLECTION}:${nextNodeRef}`;
      const draftBody = {
        ...staged,
        nodes: staged.nodes.map((node) =>
          node.node_ref === oldNodeRef ? { ...node, node_ref: nextNodeRef } : node
        ),
        views: staged.views.map((view) =>
          view.view_ref === oldViewRef
            ? {
                ...view,
                node_ref: nextNodeRef,
                view_ref: nextViewRef,
                sections: view.sections.map((section) => ({
                  ...section,
                  section_ref: section.section_ref.replace(oldViewRef, nextViewRef),
                })),
              }
            : view
        ),
        lifecycle: { state: "draft" as const },
      };
      const draft = parseAlignPayload(draftBody).payload!;
      const conflicted = parseAlignPayload({
        ...draftBody,
        lifecycle: {
          state: "confirmed",
          phase_collection: COLLECTION,
          confirmed_by: "legacy-runtime",
          confirmed_at: "structure-snapshot",
          structure_digest: draft.structure_digest,
        },
      }).payload!;
      await writeStructureSnapshot(projectRoot, conflicted);
      await writeCandidateRecords(projectRoot, initialCandidates.map((record) => {
        if (record.source?.name !== SOURCE_NAMES[0]) return { ...record, status: "draft" as const };
        return {
          ...record,
          status: "draft" as const,
          structure_digest: conflicted.structure_digest,
          candidate_id: record.candidate_id.replace(oldNodeRef, nextNodeRef),
          node_ref: nextNodeRef,
          view_ref: nextViewRef,
        };
      }));

      await runCliInDir(projectRoot, [
        "review",
        "reconcile-identities",
        "--source",
        `file:${SOURCE_NAMES[0]}`,
        "--strategy",
        "preserve-approved",
        "--format",
        "json",
      ]);
      const status = JSON.parse(await runCliInDir(projectRoot, [
        "status", "--managed", "--format", "json", "--view", "full",
      ])) as {
        state: string;
        draftCandidates: number;
        compileBatch: { remainingViewRefs: string[]; nextSourceKeys: string[] };
      };
      expect(status.state).toBe("route.compile.pending-target");
      expect(status.draftCandidates).toBe(2);
      expect(status.compileBatch.remainingViewRefs).toEqual([oldViewRef]);
      expect(status.compileBatch.nextSourceKeys).toEqual([`file:${SOURCE_NAMES[0]}`]);

      await compileView(projectRoot, SOURCE_NAMES[0], oldViewRef, "update");
      const recovered = (await readCandidateRecords(projectRoot)).filter((record) => record.status === "draft");
      expect(recovered).toHaveLength(2);
      expect(recovered.map((record) => record.source?.name).sort()).toEqual([...SOURCE_NAMES].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
