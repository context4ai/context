import { describe, expect, test } from "bun:test";
import { resolveIndexerArtifactPolicyEligibility } from "@c4a/context";
import {
  BUNDLED_INDEXER_METRIC_IDS,
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";

describe("bundled Indexer base contracts", () => {
  test("registers example metrics only for code profiles", () => {
    const operators = bundledIndexerOperatorContract();
    const contract = bundledIndexerProfileContract(operators);
    const code = contract.profiles.find((profile) => profile.id === "component-library")!;
    const markdown = contract.profiles.find((profile) => profile.id === "technical-guide")!;
    const exampleMetricIds = [
      "example-candidate-decision-coverage",
      "example-representative-coverage",
      "example-public-target-linkage",
    ];
    expect(exampleMetricIds.every((metricId) =>
      code.metrics.some((metric) => metric.id === metricId)
    )).toBe(true);
    expect(exampleMetricIds.some((metricId) =>
      markdown.metrics.some((metric) => metric.id === metricId)
    )).toBe(false);
    expect(exampleMetricIds.every((metricId) =>
      BUNDLED_INDEXER_METRIC_IDS.includes(
        metricId as typeof BUNDLED_INDEXER_METRIC_IDS[number],
      )
    )).toBe(true);
    expect(operators.metric_operators).toEqual(expect.arrayContaining([
      "example-candidate-decision-ratio",
      "example-representative-ratio",
      "example-public-target-linkage-ratio",
    ]));
  });

  test("registers dogfood-derived portable questions and fact-bound Bundle variants", () => {
    const operators = bundledIndexerOperatorContract();
    const contract = bundledIndexerProfileContract(operators);
    const application = contract.profiles.find((profile) => profile.id === "web-application")!;
    const applicationSubjects = contract.subject_key_schemas.find((schema) =>
      schema.profile === "web-application"
    )!;
    const component = contract.profiles.find((profile) => profile.id === "component-library")!;
    const markdown = contract.profiles.find((profile) => profile.id === "technical-guide")!;
    expect(application.reader_question_contracts.map((question) => question.ref)).toEqual([
      "question:behavior-and-purpose",
      "question:responsibility-and-entry",
      "question:dispatch-and-routing",
      "question:state-and-consistency",
      "question:dependency-handoff",
      "question:failure-recovery",
      "question:development-and-delivery",
    ]);
    expect(applicationSubjects.kinds).toEqual([{
      id: "application",
      local_key: { operator: "canonical-module-identity" },
    }, {
      id: "capability",
      local_key: { operator: "canonical-export-family" },
    }]);
    expect(component.reader_question_contracts.map((question) => question.ref)).toContain(
      "question:examples-and-usage",
    );
    expect(markdown.reader_question_contracts.map((question) => [
      question.ref,
      question.coverage_domain,
    ])).toEqual([
      ["question:reader-purpose", "business-semantics"],
      ["question:reader-structure", "technical-structure"],
      ["question:reader-contract", "public-contract"],
      ["question:reader-operation", "operations"],
    ]);
    expect(markdown.reader_question_contracts.map((question) => question.ref))
      .not.toContain("question:source-authority");
    expect(application.artifact_policy_variants.map((variant) => variant.id)).toEqual([
      "compact",
      "standard",
      "expanded",
    ]);
    expect(markdown.artifact_policy_variants.map((variant) => variant.id)).toEqual(["standard"]);

    const supported = ["compact", "standard", "expanded"];
    const standard = resolveIndexerArtifactPolicyEligibility({
      profile_id: application.id,
      canonical_facts: { target: { eligible: true } },
      provider_supported_variants: supported,
      profile_contract: contract,
      operator_contract: operators,
    });
    expect(standard.eligible_variants.map((variant) => variant.id)).toEqual(["standard"]);
    const shaped = resolveIndexerArtifactPolicyEligibility({
      profile_id: application.id,
      canonical_facts: {
        target: {
          eligible: true,
          bundle_compact_eligible: true,
          bundle_expanded_eligible: true,
        },
      },
      provider_supported_variants: supported,
      profile_contract: contract,
      operator_contract: operators,
    });
    expect(shaped.eligible_variants.map((variant) => variant.id)).toEqual([
      "compact",
      "expanded",
      "standard",
    ]);
    expect(shaped.eligible_variants.find((variant) => variant.id === "compact"))
      .toMatchObject({ discretionary_artifact_kinds: [] });
  });
});
