import { describe, expect, test } from "bun:test";
import {
  buildIndexerProfileMetricAudit,
  validateCurrentIndexerProfileMetricAudit,
  validateIndexerProfileMetricAudit,
} from "../index.js";

const digest = (value: string) => `sha256:${value.repeat(64)}`;

describe("Indexer profile metric audit", () => {
  test("binds independent passed, warning, and failed metric results", () => {
    const audit = buildIndexerProfileMetricAudit({
      profile_id: "web-application",
      profile_contract_digest: digest("a"),
      artifact_policy_variant_id: "standard",
      metrics: [{
        metric_id: "representative-coverage",
        operator: "representative-ratio",
        unit: "ratio",
        numerator: 8,
        denominator: 10,
        actual: 0.8,
        recommended: { min: 0.9, max: null },
        hard: { min: 0.7, max: null },
        status: "warning",
        evidence: ["subject:b", "subject:a"],
        missing: ["subject:d", "subject:c"],
        repair_guidance: ["bundle:indexer/references/metrics.md#representative-coverage"],
      }, {
        metric_id: "template-repetition",
        operator: "template-repetition-ratio",
        unit: "ratio",
        numerator: 2,
        denominator: 10,
        actual: 0.2,
        recommended: { min: null, max: 0.1 },
        hard: { min: null, max: 0.15 },
        status: "failed",
        evidence: ["artifact:overview"],
        missing: [],
        repair_guidance: ["bundle:indexer/references/metrics.md#template-repetition"],
      }],
    });

    expect(audit.metrics.map((metric) => metric.metric_id)).toEqual([
      "representative-coverage",
      "template-repetition",
    ]);
    expect(audit.metrics[0]!.evidence).toEqual(["subject:a", "subject:b"]);
    expect(audit.failed_metric_ids).toEqual(["template-repetition"]);
    expect(validateIndexerProfileMetricAudit(audit)).toEqual(audit);
  });

  test("rejects status and digest claims that do not match metric evidence", () => {
    const audit = buildIndexerProfileMetricAudit({
      profile_id: "web-application",
      profile_contract_digest: digest("b"),
      artifact_policy_variant_id: "standard",
      metrics: [{
        metric_id: "orphan-count",
        operator: "orphan-count",
        unit: "count",
        numerator: 0,
        denominator: 4,
        actual: 0,
        recommended: { min: null, max: 0 },
        hard: { min: null, max: 0 },
        status: "passed",
        evidence: ["inventory:current"],
        missing: [],
        repair_guidance: ["bundle:indexer/references/metrics.md#orphan-count"],
      }],
    });
    expect(() => validateIndexerProfileMetricAudit({
      ...audit,
      metrics: [{ ...audit.metrics[0]!, status: "failed" }],
    })).toThrow(/status does not match/);
    expect(() => validateIndexerProfileMetricAudit({
      ...audit,
      profile_id: "sdk-library",
    })).toThrow(/digest/);
  });

  test("treats a valid prior audit as stale after the profile contract changes", () => {
    const audit = buildIndexerProfileMetricAudit({
      profile_id: "web-application",
      profile_contract_digest: digest("a"),
      artifact_policy_variant_id: "standard",
      metrics: [{
        metric_id: "orphan-count",
        operator: "orphan-count",
        unit: "count",
        numerator: 0,
        denominator: 4,
        actual: 0,
        recommended: { min: null, max: 0 },
        hard: { min: null, max: 0 },
        status: "passed",
        evidence: ["inventory:current"],
        missing: [],
        repair_guidance: ["bundle:indexer/references/metrics.md#orphan-count"],
      }],
    });

    expect(validateCurrentIndexerProfileMetricAudit({
      audit,
      profile_id: "web-application",
      profile_contract_digest: digest("a"),
      artifact_policy_variant_id: "standard",
    })).toEqual(audit);
    expect(() => validateCurrentIndexerProfileMetricAudit({
      audit,
      profile_id: "web-application",
      profile_contract_digest: digest("b"),
      artifact_policy_variant_id: "standard",
    })).toThrow(/stale/);
  });
});
