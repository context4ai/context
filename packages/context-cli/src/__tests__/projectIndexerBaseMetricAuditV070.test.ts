import { describe, expect, test } from "bun:test";
import {
  buildIndexerExampleDecisionSet,
  buildIndexerExampleInventory,
  buildIndexerExampleLinkageAudit,
  buildIndexerReaderTargetFactInventory,
  buildIndexerReaderTargetProjection,
  buildIndexerReferenceOnlyReaderTargetAudit,
  indexerExampleLinkageAuditDigest,
  indexerProtocolDigest,
  indexerReferenceOnlyReaderTargetAuditDigest,
  validateIndexerExampleLinkageAudit,
  validateIndexerReferenceOnlyReaderTargetAudit,
  type IndexerMetricContract,
} from "@c4a/context";
import {
  buildBundledCodePostcompileAudit,
  buildBundledCodeProfileMetricAudit,
  type BundledIndexerMetricMeasurement,
} from "../project/indexerBaseMetricAudit.js";
import { bundledIndexerProfileContract } from "../project/indexerBaseContracts.js";

function passingMeasurement(metric: IndexerMetricContract): BundledIndexerMetricMeasurement {
  const minimum = metric.threshold_policy === "explicit" && metric.direction === "minimum";
  return {
    metric_id: metric.id,
    observations: [{
      subject_ref: `metric-subject:${metric.id}`,
      numerator: metric.unit === "ratio" && minimum ? 10 : 0,
      denominator: 10,
    }],
    missing_refs: [],
  };
}

function measurements(): BundledIndexerMetricMeasurement[] {
  const profile = bundledIndexerProfileContract().profiles.find((item) =>
    item.id === "web-application"
  )!;
  const result = profile.metrics.map(passingMeasurement);
  const replace = (
    metricId: string,
    observations: BundledIndexerMetricMeasurement["observations"],
    missingRefs: string[] = [],
  ) => {
    const index = result.findIndex((item) => item.metric_id === metricId);
    result[index] = { metric_id: metricId, observations, missing_refs: missingRefs };
  };
  replace("duplicated-fact-target-ratio", [{
    subject_ref: "artifact:duplicated-facts",
    numerator: 1,
    denominator: 10,
  }], ["fact:duplicate-owner"]);
  replace("example-representative-coverage", [{
    subject_ref: "examples:inventory",
    numerator: 8,
    denominator: 10,
  }], ["example:missing-a", "example:missing-b"]);
  replace("discretionary-artifacts-per-logical-unit", [{
    subject_ref: "logical-unit:a",
    numerator: 2,
    denominator: 1,
  }, {
    subject_ref: "logical-unit:b",
    numerator: 6,
    denominator: 1,
  }]);
  return result;
}

describe("bundled Code profile metric audit", () => {
  test("derives thresholds, metric states, missing samples, and the postcompile audit", () => {
    const binding = {
      requirement_set_digest: indexerProtocolDigest("requirements"),
      registry_digest: indexerProtocolDigest("registry"),
      inventory_digest: indexerProtocolDigest("inventory"),
      layout_digest: indexerProtocolDigest("layout"),
      candidate_set_digest: indexerProtocolDigest("candidates"),
      effective_revision_digest: indexerProtocolDigest("revision"),
    };
    const result = buildBundledCodePostcompileAudit({
      profile_id: "web-application",
      artifact_policy_variant_id: "standard",
      measurements: measurements(),
      binding,
      baseline: { clear: true, failed_check_ids: [], finding_digests: [] },
    });
    const byId = new Map(result.profile_metric_audit.metrics.map((metric) => [
      metric.metric_id,
      metric,
    ]));
    expect(byId.get("duplicated-fact-target-ratio")).toMatchObject({
      actual: 0.1,
      recommended: { min: null, max: 0.03 },
      hard: { min: null, max: 0.05 },
      status: "failed",
      missing: ["fact:duplicate-owner"],
    });
    expect(byId.get("example-representative-coverage")).toMatchObject({
      actual: 0.8,
      status: "warning",
    });
    expect(byId.get("discretionary-artifacts-per-logical-unit")).toMatchObject({
      numerator: 6,
      denominator: 2,
      actual: 6,
      recommended: { min: null, max: 4 },
      hard: { min: null, max: 6 },
      status: "warning",
    });
    expect(result.profile_metric_audit.failed_metric_ids).toEqual([
      "duplicated-fact-target-ratio",
    ]);
    expect(result.audit_report).toMatchObject({
      stage: "postcompile",
      binding,
      profile: {
        state: "revision-required",
        failed_metric_ids: ["duplicated-fact-target-ratio"],
        report_digest: result.profile_metric_audit.audit_digest,
      },
    });
  });

  test("rejects incomplete, duplicate, and invalid CLI measurements", () => {
    const complete = measurements();
    expect(() => buildBundledCodeProfileMetricAudit({
      profile_id: "web-application",
      artifact_policy_variant_id: "standard",
      measurements: complete.slice(1),
    })).toThrow(/missing CLI measurement/);
    expect(() => buildBundledCodeProfileMetricAudit({
      profile_id: "web-application",
      artifact_policy_variant_id: "standard",
      measurements: [...complete, complete[0]!],
    })).toThrow(/duplicate metric measurement/);
    const invalid = structuredClone(complete);
    const ratio = invalid.find((item) => item.metric_id === "inventory-disposition-coverage")!;
    ratio.observations[0]!.numerator = 11;
    expect(() => buildBundledCodeProfileMetricAudit({
      profile_id: "web-application",
      artifact_policy_variant_id: "standard",
      measurements: invalid,
    })).toThrow(/numerator exceeds/);
  });

  test("keeps profile requirements and metric arithmetic under CLI authority", () => {
    const complete = measurements();
    const removedRequirement = complete.filter((measurement) =>
      measurement.metric_id !== "example-public-target-linkage"
    );
    expect(() => buildBundledCodeProfileMetricAudit({
      profile_id: "web-application",
      artifact_policy_variant_id: "standard",
      measurements: removedRequirement,
    })).toThrow(/missing CLI measurement for example-public-target-linkage/);

    const factInventory = buildIndexerReaderTargetFactInventory({
      source_scope_digest: indexerProtocolDigest("source-scope"),
      observations: [{
        canonical_identity_ref: "symbol:button",
        observation_kind: "public-export",
        source_ref: "repo:sample@revision",
        module_ref: "module:components",
        content_digest: indexerProtocolDigest("button"),
        evidence_refs: ["evidence:button-export"],
      }, {
        canonical_identity_ref: "symbol:helper-alias",
        observation_kind: "import-alias",
        source_ref: "repo:sample@revision",
        module_ref: "module:components",
        content_digest: indexerProtocolDigest("helper"),
        evidence_refs: ["evidence:helper-import"],
      }],
    });
    const targetProjection = buildIndexerReaderTargetProjection({
      artifact_set_digest: indexerProtocolDigest("artifact-set"),
      targets: [{
        canonical_identity_ref: "symbol:button",
        target_kind: "public-capability",
        landing_refs: ["artifact:button"],
      }, {
        canonical_identity_ref: "symbol:helper-alias",
        target_kind: "symbol",
        landing_refs: ["artifact:helper"],
      }],
    });
    const referenceAudit = buildIndexerReferenceOnlyReaderTargetAudit({
      fact_inventory: factInventory,
      target_projection: targetProjection,
    });
    expect(referenceAudit).toMatchObject({
      reference_only_target_count: 1,
      metric: { actual: 1, denominator: 2 },
      pass: false,
    });

    const forgedReferenceAudit = structuredClone(referenceAudit);
    forgedReferenceAudit.reference_only_target_count = 0;
    forgedReferenceAudit.reference_only_target_refs = [];
    forgedReferenceAudit.metric.actual = 0;
    forgedReferenceAudit.metric.denominator = 1;
    forgedReferenceAudit.metric.target_refs = [];
    forgedReferenceAudit.pass = true;
    forgedReferenceAudit.audit_digest = indexerReferenceOnlyReaderTargetAuditDigest(
      forgedReferenceAudit,
    );
    expect(() => validateIndexerReferenceOnlyReaderTargetAudit({
      value: forgedReferenceAudit,
      fact_inventory: factInventory,
      target_projection: targetProjection,
    })).toThrow(/does not match current inputs/);

    const exampleInventory = buildIndexerExampleInventory({
      source_scope_digest: indexerProtocolDigest("example-scope"),
      observations: [{
        public_target_ref: "target:button",
        scenario_key: "basic-usage",
        source_ref: "repo:sample@revision",
        module_ref: "module:components",
        full_relative_path: "stories/basic.tsx",
        content_digest: indexerProtocolDigest("basic-example"),
        evidence_refs: ["evidence:basic-example"],
      }],
    });
    const emptyDecisions = buildIndexerExampleDecisionSet({
      inventory: exampleInventory,
      decisions: [],
    });
    const exampleAudit = buildIndexerExampleLinkageAudit({
      inventory: exampleInventory,
      decision_set: emptyDecisions,
    });
    expect(exampleAudit.metrics[0]).toMatchObject({
      numerator: 0,
      denominator: 1,
      actual: 0,
    });
    expect(exampleAudit.decision_closure_pass).toBe(false);

    const forgedExampleAudit = structuredClone(exampleAudit);
    forgedExampleAudit.metrics[0]!.numerator = 1;
    forgedExampleAudit.metrics[0]!.denominator = 1;
    forgedExampleAudit.metrics[0]!.actual = 1;
    forgedExampleAudit.metrics[0]!.covered_example_refs = [
      exampleInventory.observations[0]!.example_ref,
    ];
    forgedExampleAudit.metrics[0]!.missing_example_refs = [];
    forgedExampleAudit.decision_closure_pass = true;
    forgedExampleAudit.audit_digest = indexerExampleLinkageAuditDigest(forgedExampleAudit);
    expect(() => validateIndexerExampleLinkageAudit({
      value: forgedExampleAudit,
      inventory: exampleInventory,
      decision_set: emptyDecisions,
    })).toThrow(/does not match its current inputs/);
  });
});
