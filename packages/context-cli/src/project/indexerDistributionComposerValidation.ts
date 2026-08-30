import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  type IndexerProviderManifest,
} from "@c4a/context";
import type { BundledIndexerComposerSpec } from "./indexerBaseComposerCatalog.js";

interface ComposerFixture {
  protocol: "context.indexer.composer-fixture/v1";
  id: string;
  anonymized: true;
  composer: string;
  profile: string;
  primary_input: { fact_kinds: string[]; artifact_kinds: string[] };
  expected_proposal: { artifact_policy_variant: string; artifact_kind: string };
  empty_result: {
    protocol: "context.indexer.layer-fragment-result/v1";
    fragments: [];
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (!sameValues(Object.keys(value).sort(), [...keys].sort())) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) =>
    typeof item !== "string" || item.length === 0
  )) {
    throw new TypeError(`${label} must be a non-empty string array`);
  }
  return value as string[];
}

function parseComposerFixture(value: unknown): ComposerFixture {
  const fixture = record(value, "composer fixture");
  exactKeys(fixture, [
    "protocol",
    "id",
    "anonymized",
    "composer",
    "profile",
    "primary_input",
    "expected_proposal",
    "empty_result",
  ], "composer fixture");
  const primary = record(fixture.primary_input, "composer fixture primary_input");
  exactKeys(primary, ["fact_kinds", "artifact_kinds"], "composer fixture primary_input");
  const proposal = record(fixture.expected_proposal, "composer fixture expected_proposal");
  exactKeys(
    proposal,
    ["artifact_policy_variant", "artifact_kind"],
    "composer fixture expected_proposal",
  );
  const empty = record(fixture.empty_result, "composer fixture empty_result");
  exactKeys(empty, ["protocol", "fragments"], "composer fixture empty_result");
  if (
    fixture.protocol !== "context.indexer.composer-fixture/v1"
    || typeof fixture.id !== "string"
    || !/^anonymous-[a-z0-9][a-z0-9-]*$/u.test(fixture.id)
    || fixture.anonymized !== true
    || typeof fixture.composer !== "string"
    || fixture.composer.length === 0
    || typeof fixture.profile !== "string"
    || fixture.profile.length === 0
    || typeof proposal.artifact_policy_variant !== "string"
    || proposal.artifact_policy_variant.length === 0
    || typeof proposal.artifact_kind !== "string"
    || proposal.artifact_kind.length === 0
    || empty.protocol !== "context.indexer.layer-fragment-result/v1"
    || !Array.isArray(empty.fragments)
    || empty.fragments.length !== 0
  ) {
    throw new TypeError("composer fixture field values are invalid");
  }
  return {
    protocol: fixture.protocol,
    id: fixture.id,
    anonymized: true,
    composer: fixture.composer,
    profile: fixture.profile,
    primary_input: {
      fact_kinds: strings(primary.fact_kinds, "composer fixture fact_kinds"),
      artifact_kinds: strings(primary.artifact_kinds, "composer fixture artifact_kinds"),
    },
    expected_proposal: {
      artifact_policy_variant: proposal.artifact_policy_variant,
      artifact_kind: proposal.artifact_kind,
    },
    empty_result: {
      protocol: empty.protocol,
      fragments: [],
    },
  };
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function validateBundledIndexerComposers(input: {
  source: string;
  bundleId: string;
  manifest: IndexerProviderManifest;
  expected: readonly BundledIndexerComposerSpec[];
}): Promise<void> {
  const declarations = input.manifest.provides.composers ?? [];
  if (!sameValues(
    declarations.map((composer) => composer.id),
    input.expected.map((composer) => composer.id),
  )) {
    throw new TypeError(`${input.bundleId} composer catalog is incomplete or non-canonical`);
  }
  input.expected.forEach((expected, index) => {
    const declaration = declarations[index]!;
    if (
      !sameValues(declaration.supported_profiles, expected.supportedProfiles)
      || declaration.contract === undefined
      || canonicalIndexerJson(declaration.contract) !== canonicalIndexerJson(expected.contract)
    ) {
      throw new TypeError(`${input.bundleId} composer ${expected.id} contract drifted`);
    }
  });
  if (input.expected.length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(
      join(input.source, "tests", "fixtures", "composers.json"),
      "utf8",
    )) as unknown;
  } catch {
    throw new TypeError(`${input.bundleId} composer fixture catalog is invalid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${input.bundleId} composer fixture catalog must be an array`);
  }
  const fixtures = parsed.map(parseComposerFixture);
  const fixtureComposerIds = fixtures.map((fixture) => fixture.composer);
  if (!sameValues(fixtureComposerIds, input.expected.map((composer) => composer.id))) {
    throw new TypeError(`${input.bundleId} composer fixtures must cover every composer exactly once`);
  }
  const fixtureIds = fixtures.map((fixture) => fixture.id)
    .sort(compareIndexerCanonicalText);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new TypeError(`${input.bundleId} composer fixture ids must be unique`);
  }
  fixtures.forEach((fixture, index) => {
    const expected = input.expected[index]!;
    const contract = expected.contract;
    if (
      !expected.supportedProfiles.includes(fixture.profile)
      || !sameValues(
        fixture.primary_input.fact_kinds,
        contract.primary_requirements.fact_kinds,
      )
      || !sameValues(
        fixture.primary_input.artifact_kinds,
        contract.primary_requirements.artifact_kinds,
      )
      || fixture.expected_proposal.artifact_policy_variant !==
        contract.derived_artifact_policy.artifact_policy_variant
      || !contract.derived_artifact_policy.artifact_kinds.includes(
        fixture.expected_proposal.artifact_kind,
      )
      || contract.empty_result.behavior !== "empty-fragment-set"
      || fixture.empty_result.fragments.length !== 0
    ) {
      throw new TypeError(`${input.bundleId} composer fixture ${fixture.id} violates its contract`);
    }
  });
}
