import { describe, expect, test } from "bun:test";
import {
  buildIndexerAuditReport,
  buildIndexerCandidateReviewReadinessInput,
  evaluateIndexerCandidateReviewReadiness,
  validateIndexerAuditReport,
} from "../index.js";

const digest = (value: string): string => `sha256:${value.repeat(64)}`;

const reviewBinding = {
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
      requirement_set_digest: reviewBinding.requirement_set_digest,
      registry_digest: reviewBinding.registry_digest,
      inventory_digest: reviewBinding.inventory_digest,
      layout_digest: null,
      candidate_set_digest: null,
      effective_revision_digest: null,
    },
    baseline: clear
      ? { clear: true, failed_check_ids: [], finding_digests: [] }
      : {
          clear: false,
          failed_check_ids: ["inventory-closure"],
          finding_digests: [digest("7")],
        },
    profile: {
      state: "not-applicable",
      failed_metric_ids: [],
      report_digest: null,
    },
  });
}

function postcompile(profile: "passed" | "revision-required" = "passed") {
  return buildIndexerAuditReport({
    protocol: "context.indexer.audit/v1",
    stage: "postcompile",
    binding: reviewBinding,
    baseline: { clear: true, failed_check_ids: [], finding_digests: [] },
    profile: profile === "passed"
      ? {
          state: "passed",
          failed_metric_ids: [],
          report_digest: digest("8"),
        }
      : {
          state: "revision-required",
          failed_metric_ids: ["template-repetition"],
          report_digest: digest("9"),
        },
  });
}

function request(pre = precompile(), post = postcompile()) {
  return buildIndexerCandidateReviewReadinessInput({
    binding: reviewBinding,
    precompile_audit_report_digest: pre.report_digest,
    postcompile_audit_report_digest: post.report_digest,
  });
}

describe("Indexer mechanical audit ordering", () => {
  test("opens main Candidate Review only for exact current pre/post audit records", () => {
    const pre = precompile();
    const post = postcompile();
    expect(evaluateIndexerCandidateReviewReadiness({
      request: request(pre, post),
      precompile_report: pre,
      postcompile_report: post,
    })).toMatchObject({
      state: "ready",
      graph_outcome: "completed",
      baseline_failed_check_ids: [],
      profile_state: "passed",
    });
  });

  test("keeps baseline and profile failures ahead of user Review", () => {
    const failedBaseline = precompile(false);
    const passedProfile = postcompile();
    expect(evaluateIndexerCandidateReviewReadiness({
      request: request(failedBaseline, passedProfile),
      precompile_report: failedBaseline,
      postcompile_report: passedProfile,
    })).toMatchObject({
      state: "baseline-blocked",
      graph_outcome: "failed",
      baseline_failed_check_ids: ["inventory-closure"],
    });

    const passedBaseline = precompile();
    const failedProfile = postcompile("revision-required");
    expect(evaluateIndexerCandidateReviewReadiness({
      request: request(passedBaseline, failedProfile),
      precompile_report: passedBaseline,
      postcompile_report: failedProfile,
    })).toMatchObject({
      state: "profile-blocked",
      graph_outcome: "blocked",
      profile_failed_metric_ids: ["template-repetition"],
    });
  });

  test("rejects stale bindings and tampered report digests", () => {
    const pre = precompile();
    const post = postcompile();
    expect(() => evaluateIndexerCandidateReviewReadiness({
      request: buildIndexerCandidateReviewReadinessInput({
        binding: { ...reviewBinding, candidate_set_digest: digest("a") },
        precompile_audit_report_digest: pre.report_digest,
        postcompile_audit_report_digest: post.report_digest,
      }),
      precompile_report: pre,
      postcompile_report: post,
    })).toThrow(/candidate_set_digest is stale/);
    expect(() => validateIndexerAuditReport({
      ...post,
      profile: { ...post.profile, report_digest: digest("b") },
    })).toThrow(/report digest is invalid/);
  });
});
