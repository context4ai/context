import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  validateIndexerProfileContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "@c4a/context";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { materializeBundledIndexerDistribution } from
  "../project/indexerDistributionBuild.js";
import { validateBundledIndexerHardRuleConformance } from
  "../project/indexerHardRuleConformance.js";

function rehashOperators(contract: IndexerOperatorContract): IndexerOperatorContract {
  const { contract_digest: _digest, ...payload } = contract;
  void _digest;
  return { ...payload, contract_digest: indexerOperatorContractDigest(payload) };
}

function rehashProfiles(
  contract: IndexerProfileContract,
  operators: IndexerOperatorContract,
): IndexerProfileContract {
  const { contract_digest: _digest, ...current } = contract;
  void _digest;
  const payload = {
    ...current,
    operator_contract_version: operators.version,
    operator_contract_digest: operators.contract_digest,
  };
  return { ...payload, contract_digest: indexerProfileContractDigest(payload) };
}

describe("bundled profile hard-rule conformance", () => {
  test("binds every published hard rule to canonical or structured CLI authority", () => {
    const operators = bundledIndexerOperatorContract();
    const profiles = bundledIndexerProfileContract(operators);
    const report = validateBundledIndexerHardRuleConformance({
      operator_contract: operators,
      profile_contract: profiles,
    });
    expect(report.profiles.map((profile) => profile.profile_id)).toEqual(
      [...profiles.profiles.map((profile) => profile.id)].sort(),
    );
    expect(report.profiles.flatMap((profile) => profile.rules)).not.toContainEqual(
      expect.objectContaining({ input_authorities: expect.arrayContaining(["semantic-label"]) }),
    );
    expect(report.profiles.flatMap((profile) => profile.rules).every((rule) =>
      rule.input_authorities.every((authority) =>
        authority.startsWith("canonical-") || authority.startsWith("structured-")
      )
    )).toBe(true);
    expect(report.report_digest).toMatch(/^sha256:/);
  });

  test("rejects self-registered semantic operators and semantic-label metric aliases", () => {
    const baseOperators = bundledIndexerOperatorContract();
    const semanticOperators = rehashOperators({
      ...structuredClone(baseOperators),
      metric_operators: [...baseOperators.metric_operators, "semantic-label-pass"],
    });
    const semanticProfiles = structuredClone(bundledIndexerProfileContract(baseOperators));
    semanticProfiles.profiles[0]!.metrics.push({
      id: "p0-completeness",
      unit: "ratio",
      operator: "semantic-label-pass",
      threshold_policy: "explicit",
      direction: "minimum",
      recommended_min: 1,
      hard_min: 1,
    });
    const rebound = rehashProfiles(semanticProfiles, semanticOperators);
    expect(() => validateIndexerProfileContract(rebound, semanticOperators)).not.toThrow();
    expect(() => validateBundledIndexerHardRuleConformance({
      operator_contract: semanticOperators,
      profile_contract: rebound,
    })).toThrow(/metric operators does not match the standard CLI implementation registry/);

    const aliasedProfiles = structuredClone(bundledIndexerProfileContract(baseOperators));
    aliasedProfiles.profiles[0]!.metrics.push({
      id: "complex-service-completeness",
      unit: "ratio",
      operator: "disposition-ratio",
      threshold_policy: "explicit",
      direction: "minimum",
      recommended_min: 1,
      hard_min: 1,
    });
    const aliased = rehashProfiles(aliasedProfiles, baseOperators);
    expect(() => validateIndexerProfileContract(aliased, baseOperators)).not.toThrow();
    expect(() => validateBundledIndexerHardRuleConformance({
      operator_contract: baseOperators,
      profile_contract: aliased,
    })).toThrow(/has no standard CLI implementation/);
  });

  test("rejects a known metric rebound to another standard operator", () => {
    const operators = bundledIndexerOperatorContract();
    const profiles = structuredClone(bundledIndexerProfileContract(operators));
    profiles.profiles[0]!.metrics[0]!.operator = "duplicated-fact-ratio";
    const rebound = rehashProfiles(profiles, operators);
    expect(() => validateIndexerProfileContract(rebound, operators)).not.toThrow();
    expect(() => validateBundledIndexerHardRuleConformance({
      operator_contract: operators,
      profile_contract: rebound,
    })).toThrow(/is not bound to disposition-ratio/);
  });

  test("writes the conformance receipt before a bundled distribution can publish", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "context-hard-rule-conformance-"));
    await materializeBundledIndexerDistribution({
      packageRoot: resolve(import.meta.dir, "../.."),
      outputRoot,
    });
    const report = JSON.parse(await readFile(
      join(outputRoot, "contracts", "hard-rule-conformance.json"),
      "utf8",
    ));
    expect(report).toMatchObject({
      protocol: "context.indexer.hard-rule-conformance/v1",
      operator_contract_digest: bundledIndexerOperatorContract().contract_digest,
      profile_contract_digest: bundledIndexerProfileContract().contract_digest,
      report_digest: expect.stringMatching(/^sha256:/),
    });
  }, 15_000);
});
