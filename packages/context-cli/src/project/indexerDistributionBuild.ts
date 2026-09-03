import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  compareIndexerCanonicalText,
  indexerCliReleaseManifestSchema,
  indexerProviderBundleIntegrity,
  loadIndexerProviderManifest,
  validateIndexerProviderContractReferences,
  type IndexerCliReleaseManifest,
} from "@c4a/context";
import {
  BUNDLED_CODE_PROFILE_IDS,
  BUNDLED_MARKDOWN_PROFILE_IDS,
} from "./indexerBaseContractCatalog.js";
import { BUNDLED_CODE_COMPOSER_SPECS } from "./indexerBaseComposerCatalog.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
  BUNDLED_INDEXER_METRIC_IDS,
} from "./indexerBaseContracts.js";
import { validateBundledIndexerAuthoringFixtures } from "./indexerDistributionFixtureValidation.js";
import { validateBundledIndexerProfileTemplates } from "./indexerDistributionProfileResources.js";
import { validateBundledIndexerComposers } from "./indexerDistributionComposerValidation.js";
import {
  validateBundledIndexerCodeChapterFixtures,
  validateBundledIndexerCodeTemplateReferences,
  validateBundledIndexerPortableVocabulary,
} from "./indexerDistributionCodeAuthoringValidation.js";
import { validateBundledIndexerCommunityScenarioFixtures } from
  "./indexerDistributionCommunityScenarioValidation.js";
import { validateBundledIndexerMarkdownRoutingFixtures } from
  "./indexerDistributionMarkdownAuthoringValidation.js";
import { validateBundledIndexerMarkdownEditorialFixtures } from
  "./indexerDistributionMarkdownEditorialValidation.js";
import { validateBundledIndexerMarkdownMigrationFixtures } from
  "./indexerDistributionMarkdownMigrationValidation.js";
import { validateBundledIndexerMetricGuidance } from
  "./indexerDistributionMetricGuidanceValidation.js";
import { inspectCanonicalQuestionPayloadsInBundle } from
  "./canonicalQuestionOwnership.js";

const EXPECTED_BUNDLES = [
  {
    id: "context-code-indexer",
    profiles: BUNDLED_CODE_PROFILE_IDS,
    fixtureFile: "profiles.json",
    fixtureCoverage: "all-profiles",
    templateCoverage: "all-profiles",
    composers: BUNDLED_CODE_COMPOSER_SPECS,
    codeAuthoring: true,
    markdownAuthoring: false,
  },
  {
    id: "context-markdown-indexer",
    profiles: BUNDLED_MARKDOWN_PROFILE_IDS,
    fixtureFile: "profiles.json",
    fixtureCoverage: "all-profiles",
    templateCoverage: "provider-defined",
    composers: [],
    codeAuthoring: false,
    markdownAuthoring: true,
  },
] as const;

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function collectIndexerBundleFiles(
  root: string,
  path = root,
): Promise<Array<{ path: string; digest: string }>> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: Array<{ path: string; digest: string }> = [];
  for (const entry of entries.sort((left, right) =>
    compareIndexerCanonicalText(left.name, right.name)
  )) {
    const absolute = join(path, entry.name);
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) {
      throw new TypeError(`bundled Indexer assets must not contain symlinks: ${absolute}`);
    }
    if (status.isDirectory()) {
      files.push(...await collectIndexerBundleFiles(root, absolute));
      continue;
    }
    if (!status.isFile()) {
      throw new TypeError(`bundled Indexer asset must be a regular file: ${absolute}`);
    }
    files.push({
      path: relative(root, absolute).split(sep).join("/"),
      digest: sha256(await readFile(absolute)),
    });
  }
  return files.sort((left, right) => compareIndexerCanonicalText(left.path, right.path));
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
  const left = [...actual].sort(compareIndexerCanonicalText);
  const right = [...expected].sort(compareIndexerCanonicalText);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new TypeError(`${label} does not match the CLI base contract`);
  }
}

export async function materializeBundledIndexerDistribution(input: {
  packageRoot: string;
  outputRoot: string;
  sourceRoot?: string;
}): Promise<IndexerCliReleaseManifest> {
  const packageJson = JSON.parse(
    await readFile(join(input.packageRoot, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  if (packageJson.name !== "@c4a/context-cli" || typeof packageJson.version !== "string") {
    throw new TypeError("bundled Indexer build requires the @c4a/context-cli package manifest");
  }
  const sourceRoot = input.sourceRoot ?? resolve(
    input.packageRoot,
    "../..",
    "plugins/context/skills",
  );
  const sourceEntries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const communityEntries = ["context", ...EXPECTED_BUNDLES.map((bundle) => bundle.id)];
  const missingCommunityEntries = communityEntries.filter((entry) => !sourceEntries.includes(entry));
  if (missingCommunityEntries.length > 0) {
    throw new TypeError(
      `root plugin Skill directory set is missing CLI base contract entries: ${missingCommunityEntries.join(", ")}`,
    );
  }
  for (const entry of sourceEntries.filter((name) => !communityEntries.includes(
    name as typeof communityEntries[number],
  ))) {
    const provider = await loadIndexerProviderManifest(join(sourceRoot, entry));
    if (provider.id !== entry) {
      throw new TypeError(`additional lifecycle Provider directory does not match its manifest id: ${entry}`);
    }
  }

  const operators = bundledIndexerOperatorContract();
  const profiles = bundledIndexerProfileContract(operators);
  const bundles: IndexerCliReleaseManifest["bundles"] = [];

  await rm(input.outputRoot, { recursive: true, force: true });
  await mkdir(join(input.outputRoot, "contracts"), { recursive: true });
  await writeFile(
    join(input.outputRoot, "contracts", "operator-contract.json"),
    `${JSON.stringify(operators, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(input.outputRoot, "contracts", "profile-contract.json"),
    `${JSON.stringify(profiles, null, 2)}\n`,
    "utf8",
  );
  for (const expected of EXPECTED_BUNDLES) {
    const source = join(sourceRoot, expected.id);
    const copiedQuestionContracts = await inspectCanonicalQuestionPayloadsInBundle({
      repositoryRoot: sourceRoot,
      bundlePath: expected.id,
    });
    if (copiedQuestionContracts.length > 0) {
      throw new TypeError(
        `${expected.id} duplicates canonical question contract payload: ` +
        copiedQuestionContracts.map((finding) => finding.path).join(", "),
      );
    }
    const manifest = await loadIndexerProviderManifest(source);
    if (manifest.id !== expected.id) {
      throw new TypeError(`bundled Indexer ${expected.id} manifest id does not match its directory`);
    }
    assertExactSet(manifest.provides.profiles, expected.profiles, `${expected.id} profiles`);
    validateIndexerProviderContractReferences({
      manifest,
      selected_profiles: expected.profiles,
      profile_contract: profiles,
      operator_contract: operators,
    });
    if (expected.templateCoverage === "all-profiles") {
      validateBundledIndexerProfileTemplates({
        bundleId: expected.id,
        expectedProfiles: expected.profiles,
        manifest,
      });
    }
    await validateBundledIndexerComposers({
      source,
      bundleId: expected.id,
      manifest,
      expected: expected.composers,
    });
    await validateBundledIndexerAuthoringFixtures({
      source,
      bundleId: expected.id,
      fixtureFile: expected.fixtureFile,
      coverage: expected.fixtureCoverage,
      expectedProfiles: expected.profiles,
      manifest,
      profileContract: profiles,
      operatorContract: operators,
    });
    if (expected.codeAuthoring) {
      await validateBundledIndexerCodeChapterFixtures({
        source,
        expectedProfiles: expected.profiles,
        manifest,
        profileContract: profiles,
        operatorContract: operators,
      });
      await validateBundledIndexerCodeTemplateReferences({
        source,
        manifest,
      });
      await validateBundledIndexerCommunityScenarioFixtures({
        source,
        manifest,
        profileContract: profiles,
        operatorContract: operators,
      });
      await validateBundledIndexerMetricGuidance({
        source,
        manifest,
        expectedMetricIds: BUNDLED_INDEXER_METRIC_IDS,
      });
    }
    if (expected.markdownAuthoring) {
      await validateBundledIndexerMarkdownRoutingFixtures({
        source,
        expectedProfiles: expected.profiles,
        manifest,
        profileContract: profiles,
        operatorContract: operators,
      });
      await validateBundledIndexerMarkdownEditorialFixtures({
        source,
        expectedProfiles: expected.profiles,
        manifest,
      });
      await validateBundledIndexerMarkdownMigrationFixtures({
        source,
        expectedProfiles: expected.profiles,
        manifest,
      });
    }
    const files = await collectIndexerBundleFiles(source);
    if (expected.codeAuthoring) {
      await validateBundledIndexerPortableVocabulary({
        source,
        paths: files.map((file) => file.path),
      });
    }
    const manifestFile = files.find((file) => file.path === "context-indexer.yaml");
    if (manifestFile === undefined) throw new TypeError(`${expected.id} has no Provider manifest`);
    const destination = join(input.outputRoot, "bundles", expected.id);
    await mkdir(destination, { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
    bundles.push({
      skill: manifest.id,
      version: manifest.version,
      distribution: {
        kind: "cli-bundled",
        locator: `cli-bundled://context/${manifest.id}`,
      },
      integrity: indexerProviderBundleIntegrity(files),
      manifest_digest: manifestFile.digest,
      files,
    });
  }

  const releaseManifest = indexerCliReleaseManifestSchema.parse({
    protocol: "context.indexer.cli-release-manifest/v1",
    package: "@c4a/context-cli",
    version: packageJson.version,
    issuer: "context4ai/context",
    bundles: bundles.sort((left, right) =>
      compareIndexerCanonicalText(left.skill, right.skill)
    ),
  });
  await writeFile(
    join(input.outputRoot, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    "utf8",
  );
  return releaseManifest;
}
