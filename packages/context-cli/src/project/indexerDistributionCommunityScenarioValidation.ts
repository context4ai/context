import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateIndexerAuthoringFixture,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProviderManifest,
} from "@c4a/context";

interface ScenarioExpectation {
  scenario_id: string;
  authoring_fixture_ref: string;
  profile: string;
  member_kind: string;
  expected_inventory_disposition: string;
  expected_projection_disposition: string;
  expected_artifact_behavior: string;
  expected_bundle_artifact_ids: readonly string[];
}

interface NegativeScenarioExpectation {
  scenario_id: string;
  authoring_fixture_ref: string;
  profile: string;
  observed_condition: string;
  expected_outcome: string;
}

const POSITIVE_SCENARIOS: readonly ScenarioExpectation[] = [
  { scenario_id: "rpc-query-catalog", authoring_fixture_ref: "anonymous-api-service", profile: "api-service", member_kind: "protocol-method", expected_inventory_disposition: "owned", expected_projection_disposition: "catalog-only", expected_artifact_behavior: "no-standalone-artifact", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "http-handler-flow", authoring_fixture_ref: "anonymous-api-service", profile: "api-service", member_kind: "handler", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "gateway-handoff", authoring_fixture_ref: "anonymous-gateway-facade", profile: "gateway-facade", member_kind: "downstream-callsite", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "event-flow", authoring_fixture_ref: "anonymous-event-consumer", profile: "event-consumer", member_kind: "event-branch", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "function-runtime", authoring_fixture_ref: "anonymous-background-runtime", profile: "background-runtime", member_kind: "event-branch", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "scheduled-worker", authoring_fixture_ref: "anonymous-background-runtime", profile: "background-runtime", member_kind: "timer-branch", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "reconciliation-flow", authoring_fixture_ref: "anonymous-data-sync-reconciliation", profile: "data-sync-reconciliation", member_kind: "state-transition", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "stateful-service", authoring_fixture_ref: "anonymous-domain-service", profile: "domain-service", member_kind: "state-transition", expected_inventory_disposition: "owned", expected_projection_disposition: "detailed", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "repository-boundary", authoring_fixture_ref: "anonymous-storage-repository", profile: "storage-repository", member_kind: "store", expected_inventory_disposition: "owned", expected_projection_disposition: "boundary-only", expected_artifact_behavior: "evidence-backed-content", expected_bundle_artifact_ids: ["content"] },
  { scenario_id: "library-capability", authoring_fixture_ref: "anonymous-sdk-library", profile: "sdk-library", member_kind: "method", expected_inventory_disposition: "owned", expected_projection_disposition: "capability-group", expected_artifact_behavior: "capability-family-artifact", expected_bundle_artifact_ids: ["content"] },
];

const NEGATIVE_SCENARIOS: readonly NegativeScenarioExpectation[] = [
  { scenario_id: "complete-page-stale-source", authoring_fixture_ref: "anonymous-api-service", profile: "api-service", observed_condition: "source-revision-or-locator-drift", expected_outcome: "reject-stale-evidence" },
  { scenario_id: "one-method-one-page-inflation", authoring_fixture_ref: "anonymous-api-service", profile: "api-service", observed_condition: "method-count-equals-artifact-count", expected_outcome: "reject-artifact-inflation" },
  { scenario_id: "unresolved-authoring-placeholder", authoring_fixture_ref: "anonymous-background-runtime", profile: "background-runtime", observed_condition: "generated-placeholder-remains", expected_outcome: "block-generated-placeholder" },
  { scenario_id: "missing-runtime-platform-fact", authoring_fixture_ref: "anonymous-gateway-facade", profile: "gateway-facade", observed_condition: "required-runtime-fact-absent", expected_outcome: "request-material" },
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function assertExpectedCase(
  value: unknown,
  expected: ScenarioExpectation | NegativeScenarioExpectation,
  fields: readonly string[],
  label: string,
): void {
  const parsed = record(value, label);
  exactKeys(parsed, fields, label);
  for (const field of fields) {
    if (
      JSON.stringify(parsed[field])
      !== JSON.stringify(expected[field as keyof typeof expected])
    ) {
      throw new TypeError(`${label} ${String(expected.scenario_id)} drifted at ${field}`);
    }
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new TypeError(`${label} is invalid JSON`);
  }
}

export async function validateBundledIndexerCommunityScenarioFixtures(input: {
  source: string;
  manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
}): Promise<void> {
  const root = record(await readJson(
    join(input.source, "tests", "fixtures", "scenarios.json"),
    "community scenario fixture set",
  ), "community scenario fixture set");
  exactKeys(root, ["protocol", "anonymized", "positive_cases", "negative_cases"], "community scenario fixture set");
  if (root.protocol !== "context.indexer.community-scenario-fixture-set/v1" || root.anonymized !== true) {
    throw new TypeError("community scenario fixture protocol or anonymity is invalid");
  }
  if (!Array.isArray(root.positive_cases) || !Array.isArray(root.negative_cases)) {
    throw new TypeError("community scenario fixture cases must be arrays");
  }
  const positiveCases = root.positive_cases;
  const negativeCases = root.negative_cases;
  if (positiveCases.length !== POSITIVE_SCENARIOS.length || negativeCases.length !== NEGATIVE_SCENARIOS.length) {
    throw new TypeError("community scenario fixture coverage is incomplete");
  }

  const authoringCatalog = await readJson(
    join(input.source, "tests", "fixtures", "profiles.json"),
    "community authoring fixture catalog",
  );
  if (!Array.isArray(authoringCatalog)) {
    throw new TypeError("community authoring fixture catalog must be an array");
  }
  const fixtures = new Map(authoringCatalog.map((fixture) => {
    const validated = validateIndexerAuthoringFixture({
      fixture,
      manifest: input.manifest,
      profile_contract: input.profileContract,
      operator_contract: input.operatorContract,
    });
    return [validated.fixture.id, validated] as const;
  }));

  POSITIVE_SCENARIOS.forEach((expected, index) => {
    assertExpectedCase(positiveCases[index], expected, [
      "scenario_id",
      "authoring_fixture_ref",
      "member_kind",
      "expected_inventory_disposition",
      "expected_projection_disposition",
      "expected_artifact_behavior",
      "expected_bundle_artifact_ids",
    ], "positive community scenario");
    const fixture = fixtures.get(expected.authoring_fixture_ref);
    if (fixture?.fixture.profile !== expected.profile) {
      throw new TypeError(`positive community scenario ${expected.scenario_id} has no matching anonymous authoring fixture`);
    }
    const artifactIds = fixture.bundle.artifacts.map((artifact) => artifact.artifact_id);
    if (JSON.stringify(artifactIds) !== JSON.stringify(expected.expected_bundle_artifact_ids)) {
      throw new TypeError(`positive community scenario ${expected.scenario_id} has a stale Artifact Bundle`);
    }
  });
  NEGATIVE_SCENARIOS.forEach((expected, index) => {
    assertExpectedCase(negativeCases[index], expected, [
      "scenario_id",
      "authoring_fixture_ref",
      "observed_condition",
      "expected_outcome",
    ], "negative community scenario");
    if (fixtures.get(expected.authoring_fixture_ref)?.fixture.profile !== expected.profile) {
      throw new TypeError(`negative community scenario ${expected.scenario_id} has no matching anonymous authoring fixture`);
    }
  });
}
