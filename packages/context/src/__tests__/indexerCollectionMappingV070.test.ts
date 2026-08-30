import { describe, expect, test } from "bun:test";
import {
  indexerProfileContractDigest,
  resolveIndexerSectionCollection,
  validateIndexerSectionCollection,
} from "../index.js";
import { artifactPolicyContractsFixture } from "./indexerArtifactPolicyV070.fixture.js";

const PROJECTION = {
  section_key: "summary",
  owner_indexer_id: "component-indexer",
  document_kind: "reference",
  reader_goal: "understand-capability",
  artifact_kind: "overview",
};

describe("CLI-owned Section collection mapping", () => {
  test("derives one collection from profile, source role, and projection intent", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    const resolved = resolveIndexerSectionCollection({
      profile: "component-library",
      source_role: "authoritative-source",
      projection: PROJECTION,
      profile_contract: profiles,
      operator_contract: operators,
    });
    expect(resolved.collection).toBe("codeindex");
    expect(validateIndexerSectionCollection({
      value: resolved,
      profile_contract: profiles,
      operator_contract: operators,
    })).toEqual(resolved);
    expect(resolved).not.toHaveProperty("path");
  });

  test("fails closed for unknown roles, semantic intent, and ambiguous mappings", () => {
    const { operators, profiles } = artifactPolicyContractsFixture();
    expect(() => resolveIndexerSectionCollection({
      profile: "component-library",
      source_role: "private-source",
      projection: PROJECTION,
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/exactly one/);
    expect(() => resolveIndexerSectionCollection({
      profile: "component-library",
      source_role: "authoritative-source",
      projection: { ...PROJECTION, reader_goal: "invented-goal" },
      profile_contract: profiles,
      operator_contract: operators,
    })).toThrow(/exactly one/);

    const ambiguous = structuredClone(profiles);
    ambiguous.profiles[0]!.layout_mappings.push(
      structuredClone(ambiguous.profiles[0]!.layout_mappings[0]!),
    );
    const { contract_digest: _digest, ...payload } = ambiguous;
    void _digest;
    ambiguous.contract_digest = indexerProfileContractDigest(payload);
    expect(() => resolveIndexerSectionCollection({
      profile: "component-library",
      source_role: "authoritative-source",
      projection: PROJECTION,
      profile_contract: ambiguous,
      operator_contract: operators,
    })).toThrow(/duplicate|layout_mappings/);
  });
});
