import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerAuditReport,
  buildIndexerCandidateReviewReadinessInput,
  buildIndexerProfileFailureReportInput,
  buildIndexerProfileFailureInspectionInput,
  buildIndexerProfileOverrideDecision,
  buildIndexerProfileProblemLineage,
  buildIndexerProfileRevisionRecordInput,
  emptyIndexerProfileAuditLedger,
} from "@c4a/context";
import { recordProjectIndexerAuditReport } from "../project/indexerAuditStore.js";
import { inspectProjectIndexerCandidateReviewReadiness } from
  "../project/indexerCandidateReviewReadinessActions.js";
import {
  overrideProjectIndexerProfileAudit,
  inspectProjectIndexerProfileFailure,
  recordProjectIndexerProfileRevision,
  reportProjectIndexerProfileFailure,
} from "../project/indexerProfileAuditActions.js";
import { readProjectIndexerProfileAuditLedger } from
  "../project/indexerProfileAuditStore.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const digest = (value: string): string => `sha256:${value.repeat(64)}`;
const binding = {
  requirement_set_digest: digest("1"),
  registry_digest: digest("2"),
  inventory_digest: digest("3"),
  layout_digest: digest("4"),
  candidate_set_digest: digest("5"),
  effective_revision_digest: digest("6"),
};

function precompile() {
  return buildIndexerAuditReport({
    protocol: "context.indexer.audit/v1",
    stage: "precompile",
    binding: {
      requirement_set_digest: binding.requirement_set_digest,
      registry_digest: binding.registry_digest,
      inventory_digest: binding.inventory_digest,
      layout_digest: null,
      candidate_set_digest: null,
      effective_revision_digest: null,
    },
    baseline: { clear: true, failed_check_ids: [], finding_digests: [] },
    profile: {
      state: "not-applicable",
      failed_metric_ids: [],
      report_digest: null,
    },
  });
}

function failedAudit(seed: string, state: "revision-required" | "human-guidance-required") {
  return buildIndexerAuditReport({
    protocol: "context.indexer.audit/v1",
    stage: "postcompile",
    binding,
    baseline: { clear: true, failed_check_ids: [], finding_digests: [] },
    profile: {
      state,
      failed_metric_ids: ["template-repetition"],
      report_digest: digest(seed),
    },
  });
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-profile-audit-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "indexer-profile-audit-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  return root;
}

describe("project Indexer three-revision override Route", () => {
  test("persists three revisions, reports all risk, then accepts only the explicit receipt", async () => {
    const root = await project();
    const pre = precompile();
    const audits = [
      failedAudit("a", "revision-required"),
      failedAudit("b", "revision-required"),
      failedAudit("c", "human-guidance-required"),
    ];
    await recordProjectIndexerAuditReport({ projectRoot: root, report: pre });
    for (const audit of audits) {
      await recordProjectIndexerAuditReport({ projectRoot: root, report: audit });
    }
    const lineage = buildIndexerProfileProblemLineage({
      requirement_lineage_id: digest("d"),
      source_material_epoch: digest("e"),
      unit_ref: "module:packages/context",
      problem_class: "profile-quality",
    });

    const first = buildIndexerProfileRevisionRecordInput({
      lineage,
      precompile_audit_report_digest: pre.report_digest,
      audit_report_digest: audits[0]!.report_digest,
      indexer_result_fingerprint: digest("7"),
      actions_taken: ["rewrite module-specific contract"],
      unresolved_reasons: ["template repetition remains above hard gate"],
      expected_ledger_digest: emptyIndexerProfileAuditLedger().ledger_digest,
    });
    const firstPath = join(root, "first-revision.json");
    await writeFile(firstPath, `${JSON.stringify(first, null, 2)}\n`, "utf8");
    expect(JSON.parse(await runCliInDir(root, [
      "indexer", "record-index-profile-revision",
      "--input", firstPath,
      "--format", "json",
    ]))).toMatchObject({ attempt: 1, graph_outcome: "partial" });

    for (const index of [1, 2]) {
      const ledger = await readProjectIndexerProfileAuditLedger(root);
      const recorded = await recordProjectIndexerProfileRevision({
        projectRoot: root,
        value: buildIndexerProfileRevisionRecordInput({
          lineage,
          precompile_audit_report_digest: pre.report_digest,
          audit_report_digest: audits[index]!.report_digest,
          indexer_result_fingerprint: digest(String(index + 7)),
          actions_taken: [`revision action ${index + 1}`],
          unresolved_reasons: ["template repetition remains above hard gate"],
          expected_ledger_digest: ledger.ledger_digest,
        }),
      });
      expect(recorded).toMatchObject({
        attempt: index + 1,
        graph_outcome: index === 2 ? "completed" : "partial",
        audit_facts: {
          audit: {
            baseline_clear: true,
            profile_attempt_count: index + 1,
            profile_override_eligible: false,
          },
        },
      });
    }

    const ledger = await readProjectIndexerProfileAuditLedger(root);
    const reportRequest = buildIndexerProfileFailureReportInput({
      lineage_id: lineage.lineage_id,
      precompile_audit_report_digest: pre.report_digest,
      audit_report_digest: audits[2]!.report_digest,
      expected_ledger_digest: ledger.ledger_digest,
      module_profiles: [{
        unit_ref: "module:packages/context",
        classification: "typescript-library",
        primary_profile: "backend-core",
        additional_profiles: ["runtime-protocol"],
        composers: ["typescript-symbol-composer"],
        profile_contract_digests: [digest("f")],
      }],
      expected_artifacts: [{
        classification: "typescript-library",
        bundle_variant: "backend-core",
        expected_artifact_kinds: ["module-contract"],
        anonymous_example: "A module contract distinguishes its runtime failure behavior.",
        anonymous_anti_example: "A repeated template lists files without semantic differences.",
      }],
      metrics: [{
        metric_id: "template-repetition",
        unit: "percent",
        recommended: 10,
        hard_gate: 25,
        observed: 31,
        denominator: 13,
        sample_refs: ["candidate:module-contract-1"],
      }],
      likely_missing_inputs: ["runtime-specific failure examples"],
      capability_losses: ["readers may collapse distinct module contracts"],
      options: [
        "provide-material",
        "change-scope",
        "correct-classification",
        "force-approve-risk",
      ],
    });
    const reportResult = await reportProjectIndexerProfileFailure({
      projectRoot: root,
      value: reportRequest,
    });
    expect(reportResult).toMatchObject({
      state: "explicit-decision-required",
      attempts: expect.any(Array),
      capability_losses: ["readers may collapse distinct module contracts"],
      audit_facts: {
        audit: {
          profile_attempt_count: 3,
          profile_override_eligible: true,
        },
      },
    });
    expect((await reportProjectIndexerProfileFailure({
      projectRoot: root,
      value: reportRequest,
    })).failure_report_digest).toBe(reportResult.failure_report_digest);
    expect(await inspectProjectIndexerProfileFailure({
      projectRoot: root,
      value: buildIndexerProfileFailureInspectionInput({
        failure_report_digest: reportResult.failure_report_digest,
      }),
    })).toMatchObject({
      state: "explicit-decision-required",
      failure_report: {
        report_digest: reportResult.failure_report_digest,
        attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
      },
      graph_outcome: "completed",
    });

    const decision = buildIndexerProfileOverrideDecision({
      failure_report_digest: reportResult.failure_report_digest,
      audit_report_digest: audits[2]!.report_digest,
      binding,
      indexer_result_fingerprint: ledger.lineages[0]!.attempts[2]!
        .indexer_result_fingerprint,
      failed_metric_ids: ["template-repetition"],
      confirmed_by: "user:workspace-owner",
      confirmed_at: "2026-08-28T08:00:00.000Z",
    });
    const override = await overrideProjectIndexerProfileAudit({
      projectRoot: root,
      value: decision,
    });
    expect(override).toMatchObject({
      state: "profile-risk-overridden",
      graph_outcome: "completed",
      audit_facts: {
        audit: {
          profile_override_eligible: false,
          profile_override_receipt_digest: override.profile_override_receipt_digest,
        },
      },
    });
    expect((await overrideProjectIndexerProfileAudit({
      projectRoot: root,
      value: decision,
    })).profile_override_receipt_digest).toBe(override.profile_override_receipt_digest);

    const readiness = buildIndexerCandidateReviewReadinessInput({
      binding,
      precompile_audit_report_digest: pre.report_digest,
      postcompile_audit_report_digest: audits[2]!.report_digest,
      profile_override_receipt_digest: override.profile_override_receipt_digest,
    });
    expect(await inspectProjectIndexerCandidateReviewReadiness({
      projectRoot: root,
      value: readiness,
    })).toMatchObject({
      state: "ready",
      profile_override_applied: true,
      reason_code: "index-review-required",
      audit_facts: {
        audit: {
          baseline_clear: true,
          profile_attempt_count: 3,
          profile_override_eligible: false,
          profile_override_receipt_digest: override.profile_override_receipt_digest,
        },
      },
    });
  });

  test("rejects a stale revision ledger CAS before consuming another attempt", async () => {
    const root = await project();
    const pre = precompile();
    const audit = failedAudit("a", "revision-required");
    await recordProjectIndexerAuditReport({ projectRoot: root, report: pre });
    await recordProjectIndexerAuditReport({ projectRoot: root, report: audit });
    const lineage = buildIndexerProfileProblemLineage({
      requirement_lineage_id: digest("d"),
      source_material_epoch: digest("e"),
      unit_ref: "module:packages/context",
      problem_class: "profile-quality",
    });
    const request = buildIndexerProfileRevisionRecordInput({
      lineage,
      precompile_audit_report_digest: pre.report_digest,
      audit_report_digest: audit.report_digest,
      indexer_result_fingerprint: digest("7"),
      actions_taken: ["rewrite contract"],
      unresolved_reasons: ["metric still fails"],
      expected_ledger_digest: emptyIndexerProfileAuditLedger().ledger_digest,
    });
    await recordProjectIndexerProfileRevision({ projectRoot: root, value: request });
    await expect(recordProjectIndexerProfileRevision({ projectRoot: root, value: request }))
      .rejects.toThrow(/stale ledger/);
  });
});
