import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDEXER_MATERIAL_ANSWER_CURRENT_PATH,
  INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
  acceptIndexerMaterialAnswerRunStore,
  prepareIndexerMaterialAnswerRunStore,
  startIndexerMaterialAnswerRunStore,
} from "../project/indexerMaterialAnswerRunStore.js";
import {
  buildIndexerMaterialAnswerEvidenceReadReceipt,
  materialAnswerEvidenceReadResolver,
} from "../project/indexerMaterialAnswerEvidenceReads.js";
import {
  SOURCE,
  digest,
  executionPlan,
  materialRunResult,
} from "./projectIndexerMaterialAnswerExecutionV070.fixture.js";

async function withTempDir<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await mkdtemp(join(tmpdir(), "context-material-answer-runs-"));
  try {
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

describe("project material-answer runtime store", () => {
  test("recovers an accepted legal empty Result and never schedules it again", async () => {
    await withTempDir(async (projectRoot) => {
      const plan = executionPlan();
      const prepared = await prepareIndexerMaterialAnswerRunStore({
        projectRoot,
        requirement_set_digest: digest("b"),
        registry_digest: digest("1"),
        plan,
      });
      expect(prepared.observation).toMatchObject({ pending: 1, accepted: 0 });
      const started = await startIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: prepared.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
      });
      let injected = false;
      await expect(acceptIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: started.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
        result: materialRunResult({ plan, empty: true }),
        current_sources: [],
        resolve_evidence_digest: () => digest("6"),
        read_receipt_set_digest: digest("7"),
        inject_failure: (point) => {
          if (!injected && point.startsWith("after-target-rename:")) {
            injected = true;
            throw new Error("simulated material-answer accept crash");
          }
        },
      })).rejects.toThrow(/simulated material-answer accept crash/);

      const recovered = await prepareIndexerMaterialAnswerRunStore({
        projectRoot,
        requirement_set_digest: digest("b"),
        registry_digest: digest("1"),
        plan,
      });
      expect(recovered.observation).toMatchObject({
        pending: 0,
        accepted: 1,
        next_refs: [],
        state: "material-required",
      });
      await expect(startIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: recovered.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
      })).rejects.toThrow(/pending or stale/);
      expect(existsSync(join(projectRoot, INDEXER_MATERIAL_ANSWER_CURRENT_PATH))).toBe(true);
      expect(await readdir(join(
        projectRoot,
        INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT,
        "accepted",
      ))).toHaveLength(1);
    });
  });

  test("falls back to pending when the complete accepted cache is unavailable", async () => {
    await withTempDir(async (projectRoot) => {
      const plan = executionPlan();
      const prepared = await prepareIndexerMaterialAnswerRunStore({
        projectRoot,
        requirement_set_digest: digest("b"),
        registry_digest: digest("1"),
        plan,
      });
      const started = await startIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: prepared.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
      });
      await acceptIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: started.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
        result: materialRunResult({ plan, empty: true }),
        current_sources: [],
        resolve_evidence_digest: () => digest("6"),
        read_receipt_set_digest: digest("7"),
      });
      await rm(join(projectRoot, INDEXER_MATERIAL_ANSWER_RUN_STORE_ROOT, "accepted"), {
        recursive: true,
        force: true,
      });
      const rebuilt = await prepareIndexerMaterialAnswerRunStore({
        projectRoot,
        requirement_set_digest: digest("b"),
        registry_digest: digest("1"),
        plan,
      });
      expect(rebuilt.observation).toMatchObject({ accepted: 0, pending: 1 });
    });
  });

  test("accepts candidate evidence only through exact current read receipts", async () => {
    await withTempDir(async (projectRoot) => {
      const plan = executionPlan();
      const prepared = await prepareIndexerMaterialAnswerRunStore({
        projectRoot,
        requirement_set_digest: digest("b"),
        registry_digest: digest("1"),
        plan,
      });
      const started = await startIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: prepared.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
      });
      const receipt = buildIndexerMaterialAnswerEvidenceReadReceipt({
        reader_authority_digest: digest("8"),
        source: SOURCE,
        source_spans: [{ unit: "line", start: 10, end_exclusive: 20 }],
        evidence_digest: digest("6"),
      });
      const reads = materialAnswerEvidenceReadResolver({
        receipts: [receipt],
        expected_reader_authority_digest: digest("8"),
      });
      const accepted = await acceptIndexerMaterialAnswerRunStore({
        projectRoot,
        plan_digest: plan.plan_digest,
        expected_revision: started.ledger.revision,
        run_ref: plan.runs[0]!.run_ref,
        result: materialRunResult({ plan }),
        current_sources: reads.current_sources,
        resolve_evidence_digest: reads.resolve_evidence_digest,
        assert_evidence_reads_consumed: reads.assert_all_consumed,
        read_receipt_set_digest: reads.receipt_set_digest,
        read_receipt_record: receipt,
      });
      expect(accepted.observation).toMatchObject({
        state: "candidates-ready",
        accepted: 1,
      });

      expect(() => materialAnswerEvidenceReadResolver({
        receipts: [{ ...receipt, evidence_digest: digest("9") }],
        expected_reader_authority_digest: digest("8"),
      })).toThrow(/digest/);
    });
  });
});
