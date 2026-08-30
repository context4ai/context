import { describe, expect, test } from "bun:test";
import {
  authorizeIndexerProfileOverride,
  buildIndexerAuditFacts,
  buildIndexerAuditReport,
  buildIndexerCandidateReviewReadinessInput,
  buildIndexerProfileFailureReport,
  buildIndexerProfileOverrideDecision,
  buildIndexerProfileProblemLineage,
  emptyIndexerProfileAuditLedger,
  evaluateIndexerCandidateReviewReadinessWithOverride,
  indexerProtocolDigest,
  recordIndexerProfileAuditAttempt,
  validateIndexerAuditFacts,
  validateIndexerProfileFailureReport,
} from "../index.js";

const digest = (value: string): string => `sha256:${value.repeat(64)}`;
const binding = {
  requirement_set_digest: digest("1"),
  registry_digest: digest("2"),
  inventory_digest: digest("3"),
  layout_digest: digest("4"),
  candidate_set_digest: digest("5"),
  effective_revision_digest: digest("6"),
};

function precompile(clear = true) {
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
    baseline: clear
      ? { clear: true, failed_check_ids: [], finding_digests: [] }
      : {
          clear: false,
          failed_check_ids: ["inventory-closure"],
          finding_digests: [digest("a")],
        },
    profile: {
      state: "not-applicable",
      failed_metric_ids: [],
      report_digest: null,
    },
  });
}

function failedAudit(seed: string, baselineClear = true) {
  return buildIndexerAuditReport({
    protocol: "context.indexer.audit/v1",
    stage: "postcompile",
    binding,
    baseline: baselineClear
      ? { clear: true, failed_check_ids: [], finding_digests: [] }
      : {
          clear: false,
          failed_check_ids: ["owner-closure"],
          finding_digests: [digest("b")],
        },
    profile: {
      state: seed === "3" ? "human-guidance-required" : "revision-required",
      failed_metric_ids: ["template-repetition"],
      report_digest: digest(seed),
    },
  });
}

const lineage = buildIndexerProfileProblemLineage({
  requirement_lineage_id: digest("c"),
  source_material_epoch: digest("d"),
  unit_ref: "module:packages/context",
  problem_class: "profile-quality",
});

function recordThree(baselineClear = true) {
  let ledger = emptyIndexerProfileAuditLedger();
  const reports = ["1", "2", "3"].map((seed) => failedAudit(seed, baselineClear));
  for (const [index, audit] of reports.entries()) {
    ledger = recordIndexerProfileAuditAttempt({
      ledger,
      lineage,
      audit_report: audit,
      indexer_result_fingerprint: digest(String(index + 4)),
      actions_taken: [`revision-${index + 1}`],
      unresolved_reasons: ["profile threshold remains below the hard gate"],
    }).ledger;
  }
  return { ledger, reports };
}

function reportInput(baselineClear = true, precompileClear = true) {
  const { ledger, reports } = recordThree(baselineClear);
  return {
    ledger,
    reports,
    report: buildIndexerProfileFailureReport({
      ledger,
      lineage_id: lineage.lineage_id,
      precompile_audit_report: precompile(precompileClear),
      audit_report: reports[2],
      module_profiles: [{
        unit_ref: "module:packages/context",
        classification: "typescript-library",
        primary_profile: "backend-core",
        additional_profiles: ["runtime-protocol"],
        composers: ["typescript-symbol-composer"],
        profile_contract_digests: [digest("e")],
      }],
      expected_artifacts: [{
        classification: "typescript-library",
        bundle_variant: "backend-core",
        expected_artifact_kinds: ["module-contract"],
        anonymous_example: "A module contract explains inputs, outputs, and failure behavior.",
        anonymous_anti_example: "A file list repeats names without explaining behavior.",
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
      likely_missing_inputs: ["runtime examples with failure semantics"],
      capability_losses: ["readers may infer a generic contract for distinct modules"],
      options: [
        "provide-material",
        "change-scope",
        "correct-classification",
        "force-approve-risk",
      ],
    }),
  };
}

describe("Indexer profile revision and explicit override protocol", () => {
  test("counts three distinct revisions under one stable problem lineage", () => {
    const { ledger, reports } = recordThree();
    expect(ledger.lineages).toHaveLength(1);
    expect(ledger.lineages[0]?.attempts.map((attempt) => attempt.attempt))
      .toEqual([1, 2, 3]);
    expect(() => recordIndexerProfileAuditAttempt({
      ledger,
      lineage,
      audit_report: reports[2],
      indexer_result_fingerprint: digest("f"),
      actions_taken: ["revision-4"],
      unresolved_reasons: ["still below threshold"],
    })).toThrow(/three-attempt limit/);
  });

  test("keeps the revision ledger across same-Skill re-resolution and origin changes", () => {
    const firstInstall = {
      distribution: "plugin://context/context-code-indexer",
      transport_root: "/temporary/host-a",
      origin_comment: "context-code-indexer@0.7.0",
    };
    const reinstalled = {
      distribution: firstInstall.distribution,
      transport_root: "/temporary/host-b",
      origin_comment: "reinstalled context-code-indexer@0.7.0",
    };
    expect(firstInstall).not.toEqual(reinstalled);

    const sameProblem = buildIndexerProfileProblemLineage({
      requirement_lineage_id: lineage.requirement_lineage_id,
      source_material_epoch: lineage.source_material_epoch,
      unit_ref: lineage.unit_ref,
      problem_class: lineage.problem_class,
    });
    expect(sameProblem.lineage_id).toBe(lineage.lineage_id);

    const first = recordIndexerProfileAuditAttempt({
      ledger: emptyIndexerProfileAuditLedger(),
      lineage,
      audit_report: failedAudit("1"),
      indexer_result_fingerprint: digest("4"),
      actions_taken: ["first revision"],
      unresolved_reasons: ["profile threshold remains below the hard gate"],
    });
    const second = recordIndexerProfileAuditAttempt({
      ledger: first.ledger,
      lineage: sameProblem,
      audit_report: failedAudit("2"),
      indexer_result_fingerprint: digest("5"),
      actions_taken: ["revision after reinstall"],
      unresolved_reasons: ["profile threshold remains below the hard gate"],
    });
    expect(second.attempt.attempt).toBe(2);
    expect(second.ledger.lineages).toHaveLength(1);
  });

  test("requires the third exact audit before building the complete human report", () => {
    const first = failedAudit("1");
    const once = recordIndexerProfileAuditAttempt({
      ledger: emptyIndexerProfileAuditLedger(),
      lineage,
      audit_report: first,
      indexer_result_fingerprint: digest("4"),
      actions_taken: ["revision-1"],
      unresolved_reasons: ["still below threshold"],
    }).ledger;
    expect(() => buildIndexerProfileFailureReport({
      ledger: once,
      lineage_id: lineage.lineage_id,
      precompile_audit_report: precompile(),
      audit_report: first,
      module_profiles: [],
      expected_artifacts: [],
      metrics: [],
      likely_missing_inputs: [],
      capability_losses: [],
      options: [],
    })).toThrow(/exactly three/);

    const { report } = reportInput();
    expect(validateIndexerProfileFailureReport(report)).toMatchObject({
      attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
      metrics: [{ metric_id: "template-repetition" }],
      options: expect.arrayContaining(["force-approve-risk"]),
    });
  });

  test("requires an explicit decision and binds its receipt to the current candidate set", () => {
    const { ledger, report, reports } = reportInput();
    const eligibleFacts = buildIndexerAuditFacts({
      precompile_report: precompile(),
      postcompile_report: reports[2],
      lineage,
      ledger,
      failure_report: report,
    });
    expect(eligibleFacts).toMatchObject({
      audit: {
        baseline_clear: true,
        problem_lineage_id: lineage.lineage_id,
        profile_attempt_count: 3,
        profile_override_eligible: true,
        profile_override_receipt_digest: null,
      },
    });
    expect(() => validateIndexerAuditFacts({
      ...eligibleFacts,
      audit: { ...eligibleFacts.audit, profile_attempt_count: 2 },
    })).toThrow(/Facts digest/);
    const decision = buildIndexerProfileOverrideDecision({
      failure_report_digest: report.report_digest,
      audit_report_digest: reports[2]!.report_digest,
      binding,
      indexer_result_fingerprint: report.attempts[2]!.indexer_result_fingerprint,
      failed_metric_ids: ["template-repetition"],
      confirmed_by: "user:owner",
      confirmed_at: "2026-08-28T08:00:00.000Z",
    });
    const receipt = authorizeIndexerProfileOverride({
      failure_report: report,
      precompile_audit_report: precompile(),
      audit_report: reports[2],
      decision,
    });
    expect(buildIndexerAuditFacts({
      precompile_report: precompile(),
      postcompile_report: reports[2],
      lineage,
      ledger,
      failure_report: report,
      override_receipt: receipt,
    })).toMatchObject({
      audit: {
        profile_attempt_count: 3,
        profile_override_eligible: false,
        profile_override_receipt_digest: receipt.receipt_digest,
      },
    });
    const mismatchedReceiptPayload = {
      ...receipt,
      binding: { ...receipt.binding, candidate_set_digest: digest("9") },
    };
    expect(() => buildIndexerAuditFacts({
      precompile_report: precompile(),
      postcompile_report: reports[2],
      lineage,
      ledger,
      failure_report: report,
      override_receipt: {
        ...mismatchedReceiptPayload,
        receipt_digest: indexerProtocolDigest(Object.fromEntries(
          Object.entries(mismatchedReceiptPayload).filter(([key]) => key !== "receipt_digest"),
        )),
      },
    })).toThrow(/override receipt is stale/);
    const request = buildIndexerCandidateReviewReadinessInput({
      binding,
      precompile_audit_report_digest: precompile().report_digest,
      postcompile_audit_report_digest: reports[2]!.report_digest,
      profile_override_receipt_digest: receipt.receipt_digest,
    });
    expect(evaluateIndexerCandidateReviewReadinessWithOverride({
      request,
      precompile_report: precompile(),
      postcompile_report: reports[2],
      profile_override_receipt: receipt,
    })).toMatchObject({
      state: "ready",
      graph_outcome: "completed",
      profile_override_applied: true,
    });
    expect(() => authorizeIndexerProfileOverride({
      failure_report: report,
      precompile_audit_report: precompile(),
      audit_report: reports[2],
      decision: { ...decision, decision: "approve" },
    })).toThrow();
  });

  test("never authorizes an override while a baseline integrity check fails", () => {
    expect(() => recordIndexerProfileAuditAttempt({
      ledger: emptyIndexerProfileAuditLedger(),
      lineage,
      audit_report: failedAudit("1", false),
      indexer_result_fingerprint: digest("4"),
      actions_taken: ["rewrite contract"],
      unresolved_reasons: ["baseline still fails"],
    })).toThrow(/clear-baseline/);
    expect(() => reportInput(true, false)).toThrow(/clear, current precompile baseline/);
    const valid = reportInput();
    const validDecision = buildIndexerProfileOverrideDecision({
      failure_report_digest: valid.report.report_digest,
      audit_report_digest: valid.reports[2]!.report_digest,
      binding,
      indexer_result_fingerprint: valid.report.attempts[2]!.indexer_result_fingerprint,
      failed_metric_ids: ["template-repetition"],
      confirmed_by: "user:owner",
      confirmed_at: "2026-08-28T08:00:00.000Z",
    });
    expect(() => authorizeIndexerProfileOverride({
      failure_report: valid.report,
      precompile_audit_report: precompile(false),
      audit_report: valid.reports[2],
      decision: validDecision,
    })).toThrow(/current clear audits/);
    const validReceipt = authorizeIndexerProfileOverride({
      failure_report: valid.report,
      precompile_audit_report: precompile(),
      audit_report: valid.reports[2],
      decision: validDecision,
    });
    const failedPrecompile = precompile(false);
    expect(() => evaluateIndexerCandidateReviewReadinessWithOverride({
      request: buildIndexerCandidateReviewReadinessInput({
        binding,
        precompile_audit_report_digest: failedPrecompile.report_digest,
        postcompile_audit_report_digest: valid.reports[2]!.report_digest,
        profile_override_receipt_digest: validReceipt.receipt_digest,
      }),
      precompile_report: failedPrecompile,
      postcompile_report: valid.reports[2],
      profile_override_receipt: validReceipt,
    })).toThrow(/stale or outside its profile failure/);
  });
});
