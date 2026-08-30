import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerAuditReport,
  buildIndexerCandidateReviewReadinessInput,
} from "@c4a/context";
import { recordProjectIndexerAuditReport } from "../project/indexerAuditStore.js";
import { inspectProjectIndexerCandidateReviewReadiness } from
  "../project/indexerCandidateReviewReadinessActions.js";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
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

function reports(clear = true) {
  const precompile = buildIndexerAuditReport({
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
          failed_check_ids: ["owner-closure"],
          finding_digests: [digest("7")],
        },
    profile: {
      state: "not-applicable",
      failed_metric_ids: [],
      report_digest: null,
    },
  });
  const postcompile = buildIndexerAuditReport({
    protocol: "context.indexer.audit/v1",
    stage: "postcompile",
    binding,
    baseline: { clear: true, failed_check_ids: [], finding_digests: [] },
    profile: {
      state: "passed",
      failed_metric_ids: [],
      report_digest: digest("8"),
    },
  });
  return { precompile, postcompile };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-review-order-"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "indexer-review-order-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  return root;
}

describe("project Indexer Candidate Review ordering", () => {
  test("keeps the only Graph edge into main Review behind audit readiness", async () => {
    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.entrypoints["candidate-review"]).toBe(
      "inspect-index-candidate-review-readiness",
    );
    expect(graph?.edges.filter((edge) => edge.to === "review-index-candidates"))
      .toEqual([expect.objectContaining({
        from: "inspect-index-candidate-review-readiness",
        outcomes: ["completed"],
      })]);
    const overrideGate = graph?.nodes.find((node) =>
      node.id === "override-index-profile-audit"
    );
    expect(overrideGate?.kind).toBe("gate");
    if (overrideGate?.kind === "gate") {
      expect(overrideGate.gate.delegatable).toBe(false);
    }
    expect(graph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: "inspect-index-candidate-review-readiness",
        to: "revise-index-output",
        outcomes: ["blocked"],
      }),
      expect.objectContaining({
        from: "record-index-profile-revision",
        to: "report-index-profile-failure",
        outcomes: ["completed"],
      }),
      expect.objectContaining({
        from: "report-index-profile-failure",
        to: "override-index-profile-audit",
        outcomes: ["completed"],
      }),
      expect.objectContaining({
        from: "override-index-profile-audit",
        to: "inspect-index-candidate-review-readiness",
        outcomes: ["completed"],
      }),
    ]));
  });

  test("loads only recorded audit reports and exposes the proof through the CLI", async () => {
    const root = await project();
    const { precompile, postcompile } = reports();
    await recordProjectIndexerAuditReport({ projectRoot: root, report: precompile });
    await recordProjectIndexerAuditReport({ projectRoot: root, report: postcompile });
    const request = buildIndexerCandidateReviewReadinessInput({
      binding,
      precompile_audit_report_digest: precompile.report_digest,
      postcompile_audit_report_digest: postcompile.report_digest,
    });
    expect(await inspectProjectIndexerCandidateReviewReadiness({
      projectRoot: root,
      value: request,
    })).toMatchObject({
      state: "ready",
      graph_outcome: "completed",
      reason_code: "index-review-required",
    });

    const path = join(root, "review-readiness.json");
    await writeFile(path, `${JSON.stringify(request, null, 2)}\n`, "utf8");
    expect(JSON.parse(await runCliInDir(root, [
      "indexer", "inspect-index-candidate-review-readiness",
      "--input", path,
      "--format", "json",
    ]))).toMatchObject({ state: "ready", reason_code: "index-review-required" });
  });

  test("fails closed for an absent record and blocks a recorded baseline failure", async () => {
    const root = await project();
    const { precompile, postcompile } = reports(false);
    const request = buildIndexerCandidateReviewReadinessInput({
      binding,
      precompile_audit_report_digest: precompile.report_digest,
      postcompile_audit_report_digest: postcompile.report_digest,
    });
    await expect(inspectProjectIndexerCandidateReviewReadiness({
      projectRoot: root,
      value: request,
    })).rejects.toThrow(/not recorded/);

    await recordProjectIndexerAuditReport({ projectRoot: root, report: precompile });
    await recordProjectIndexerAuditReport({ projectRoot: root, report: postcompile });
    expect(await inspectProjectIndexerCandidateReviewReadiness({
      projectRoot: root,
      value: request,
    })).toMatchObject({
      state: "baseline-blocked",
      graph_outcome: "failed",
      reason_code: "index-baseline-audit-failed",
    });
  });

  test("blocks a secret-bearing audit carrier before persistence", async () => {
    const root = await project();
    const { precompile } = reports();
    await expect(recordProjectIndexerAuditReport({
      projectRoot: root,
      report: { ...precompile, token: "fixture-secret-do-not-store" },
    })).rejects.toThrow("blocked by the common output redaction boundary");
  });
});
