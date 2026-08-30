import {
  compareIndexerCanonicalText,
  indexerProtocolDigest,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "@c4a/context";

const SELECTOR_OPERATORS = ["all-inventory", "eligible-standard"] as const;
const GROUPING_OPERATORS = ["by-subject-key"] as const;
const THRESHOLD_OPERATORS = ["explicit", "inflation-sensitive"] as const;
const SELECTOR_FACT_PATHS = [
  "evidence.current",
  "target.bundle_compact_eligible",
  "target.bundle_expanded_eligible",
  "target.eligible",
] as const;

const HARD_RULES = {
  "inventory-disposition-coverage": {
    operator: "disposition-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["canonical-inventory", "structured-disposition-set"],
  },
  "duplicated-fact-target-ratio": {
    operator: "duplicated-fact-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["canonical-fact-inventory", "structured-candidate"],
  },
  "narrative-enumeration-ratio": {
    operator: "narrative-enumeration-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["structured-candidate"],
  },
  "normalized-template-repetition-ratio": {
    operator: "template-repetition-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["structured-candidate", "structured-template-projection"],
  },
  "implementation-body-ratio": {
    operator: "implementation-body-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["structured-candidate", "structured-section-block"],
  },
  "reference-only-reader-targets": {
    operator: "reference-only-count",
    aggregation: "sum-count",
    input_authorities: ["canonical-identity-inventory", "structured-reader-projection"],
  },
  "unresolved-ordinal-partitions": {
    operator: "ordinal-partition-count",
    aggregation: "sum-count",
    input_authorities: ["canonical-inventory", "structured-partition-plan"],
  },
  "discretionary-artifacts-per-logical-unit": {
    operator: "discretionary-artifact-count",
    aggregation: "max-count",
    input_authorities: ["structured-artifact-candidate", "structured-policy-eligibility"],
  },
  "example-candidate-decision-coverage": {
    operator: "example-candidate-decision-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["canonical-example-inventory", "structured-example-decision"],
  },
  "example-representative-coverage": {
    operator: "example-representative-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["canonical-example-inventory", "structured-example-decision"],
  },
  "example-public-target-linkage": {
    operator: "example-public-target-linkage-ratio",
    aggregation: "sum-ratio",
    input_authorities: ["canonical-example-inventory", "structured-linkage-declaration"],
  },
} as const;

type HardRuleId = keyof typeof HARD_RULES;

export interface BundledIndexerHardRuleConformanceReport {
  protocol: "context.indexer.hard-rule-conformance/v1";
  operator_contract_digest: string;
  profile_contract_digest: string;
  profiles: Array<{
    profile_id: string;
    rules: Array<{
      metric_id: HardRuleId;
      operator: string;
      aggregation: string;
      input_authorities: string[];
    }>;
  }>;
  report_digest: string;
}

function assertExactSet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const left = [...actual].sort(compareIndexerCanonicalText);
  const right = [...expected].sort(compareIndexerCanonicalText);
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    throw new TypeError(`${label} does not match the standard CLI implementation registry`);
  }
}

export function validateBundledIndexerHardRuleConformance(input: {
  operator_contract: IndexerOperatorContract;
  profile_contract: IndexerProfileContract;
}): BundledIndexerHardRuleConformanceReport {
  const operators = validateIndexerOperatorContract(input.operator_contract);
  const contract = validateIndexerProfileContract(input.profile_contract, operators);
  assertExactSet(operators.selector_operators, SELECTOR_OPERATORS, "selector operators");
  assertExactSet(operators.grouping_operators, GROUPING_OPERATORS, "grouping operators");
  assertExactSet(
    operators.metric_operators,
    Object.values(HARD_RULES).map((rule) => rule.operator),
    "metric operators",
  );
  assertExactSet(operators.threshold_operators, THRESHOLD_OPERATORS, "threshold operators");
  assertExactSet(operators.selector_fact_paths, SELECTOR_FACT_PATHS, "selector fact paths");

  const profiles = contract.profiles.map((profile) => ({
    profile_id: profile.id,
    rules: profile.metrics.map((metric) => {
      const rule = HARD_RULES[metric.id as HardRuleId];
      if (rule === undefined) {
        throw new TypeError(
          `profile ${profile.id} hard rule ${metric.id} has no standard CLI implementation`,
        );
      }
      if (metric.operator !== rule.operator) {
        throw new TypeError(
          `profile ${profile.id} hard rule ${metric.id} is not bound to ${rule.operator}`,
        );
      }
      return {
        metric_id: metric.id as HardRuleId,
        operator: rule.operator,
        aggregation: rule.aggregation,
        input_authorities: [...rule.input_authorities],
      };
    }).sort((left, right) =>
      compareIndexerCanonicalText(left.metric_id, right.metric_id)
    ),
  })).sort((left, right) =>
    compareIndexerCanonicalText(left.profile_id, right.profile_id)
  );
  const payload = {
    protocol: "context.indexer.hard-rule-conformance/v1" as const,
    operator_contract_digest: operators.contract_digest,
    profile_contract_digest: contract.contract_digest,
    profiles,
  };
  return {
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  };
}
