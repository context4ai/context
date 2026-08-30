import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareIndexerCanonicalText,
  validateIndexerAuthoringFixture,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProviderManifest,
} from "@c4a/context";

export type BundledIndexerFixtureCoverage = "all-profiles" | "representative";

function exactSortedUnique(values: readonly string[], label: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (sorted.some((value, index) => index > 0 && value === sorted[index - 1])) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return sorted;
}

export async function validateBundledIndexerAuthoringFixtures(input: {
  source: string;
  bundleId: string;
  fixtureFile: string;
  coverage: BundledIndexerFixtureCoverage;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
  profileContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
}): Promise<void> {
  const fixturePath = join(input.source, "tests", "fixtures", input.fixtureFile);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  } catch {
    throw new TypeError(`${input.bundleId} authoring fixture catalog is invalid JSON`);
  }
  const fixtures = Array.isArray(parsed) ? parsed : [parsed];
  if (fixtures.length === 0) {
    throw new TypeError(`${input.bundleId} authoring fixture catalog must not be empty`);
  }
  const validated = fixtures.map((fixture) => validateIndexerAuthoringFixture({
    fixture,
    manifest: input.manifest,
    profile_contract: input.profileContract,
    operator_contract: input.operatorContract,
  }).fixture);
  const fixtureIds = exactSortedUnique(
    validated.map((fixture) => fixture.id),
    `${input.bundleId} authoring fixture ids`,
  );
  if (fixtureIds.length !== validated.length) {
    throw new TypeError(`${input.bundleId} authoring fixture ids must be unique`);
  }
  const profileIds = exactSortedUnique(
    validated.map((fixture) => fixture.profile),
    `${input.bundleId} authoring fixture profiles`,
  );
  const expectedProfiles = [...input.expectedProfiles].sort(compareIndexerCanonicalText);
  if (profileIds.some((profile) => !expectedProfiles.includes(profile))) {
    throw new TypeError(`${input.bundleId} authoring fixture profile is outside its catalog`);
  }
  if (
    input.coverage === "all-profiles"
    && (
      profileIds.length !== expectedProfiles.length
      || profileIds.some((profile, index) => profile !== expectedProfiles[index])
    )
  ) {
    throw new TypeError(
      `${input.bundleId} authoring fixtures must cover every provided profile exactly once`,
    );
  }
}
