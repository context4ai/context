import { describe, expect, test } from "bun:test";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadIndexerProviderManifest } from "@c4a/context";
import {
  BUNDLED_CODE_PROFILE_IDS,
  BUNDLED_MARKDOWN_PROFILE_IDS,
} from "../project/indexerBaseContractCatalog.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { resolveCliBundledIndexerProvider } from "../project/indexerCliBundledProvider.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import { validateBundledIndexerAuthoringFixtures } from
  "../project/indexerDistributionFixtureValidation.js";
import { validateBundledIndexerMarkdownRoutingFixtures } from
  "../project/indexerDistributionMarkdownAuthoringValidation.js";
import { validateBundledIndexerProfileTemplates } from
  "../project/indexerDistributionProfileResources.js";
import {
  PACKAGE_ROOT,
  INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS,
  indexerDistributionFixtures,
} from "./projectIndexerCliBundledV070.fixture.js";

describe("CLI bundled Indexer release validation", () => {
  const { buildFixture, createTemporaryRoot } = indexerDistributionFixtures();

  test("fails closed for release-file drift and an unregistered exact identity", async () => {
    const fixture = await buildFixture();
    const selected = fixture.manifest.bundles[0]!;
    const expected = {
      indexerId: "workspace-code",
      providerId: "community",
      skill: selected.skill,
      version: selected.version,
      integrity: selected.integrity,
      distribution: selected.distribution,
    };
    await writeFile(
      join(fixture.assetsRoot, "bundles", selected.skill, "references", "indexer.md"),
      "tampered\n",
      "utf8",
    );
    await expect(resolveCliBundledIndexerProvider({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected,
      transportRoot: join(fixture.root, "transport"),
    })).rejects.toThrow(/release file ledger/);

    await expect(resolveCliBundledIndexerProvider({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected: { ...expected, version: "9.9.9" },
      transportRoot: join(fixture.root, "transport-other"),
    })).rejects.toThrow(/not present/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("reports an unavailable exact Bundle as an explicit reindex failure", async () => {
    const fixture = await buildFixture();
    const selected = fixture.manifest.bundles[0]!;
    const expected = {
      indexerId: "workspace-code",
      providerId: "community",
      skill: selected.skill,
      version: selected.version,
      integrity: selected.integrity,
      distribution: selected.distribution,
    };
    await rm(join(fixture.assetsRoot, "bundles", selected.skill), {
      recursive: true,
      force: true,
    });
    await expect(resolveCliBundledIndexerProvider({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected,
      transportRoot: join(fixture.root, "transport"),
    })).rejects.toThrow(/Bundle is unavailable for reindex/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects incomplete profile fixtures and aliased Code templates at build time", async () => {
    const root = await createTemporaryRoot("context-cli-indexers-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const fixturePath = join(
      sourceRoot,
      "context-code-indexer",
      "tests",
      "fixtures",
      "profiles.json",
    );
    const operatorContract = bundledIndexerOperatorContract();
    const profileContract = bundledIndexerProfileContract(operatorContract);
    const codeSource = join(sourceRoot, "context-code-indexer");
    const markdownSource = join(sourceRoot, "context-markdown-indexer");
    let codeManifest = await loadIndexerProviderManifest(codeSource);
    const markdownManifest = await loadIndexerProviderManifest(markdownSource);
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as unknown[];
    await writeFile(fixturePath, `${JSON.stringify(fixtures.slice(1), null, 2)}\n`, "utf8");
    await expect(validateBundledIndexerAuthoringFixtures({
      source: codeSource,
      bundleId: "context-code-indexer",
      fixtureFile: "profiles.json",
      coverage: "all-profiles",
      expectedProfiles: BUNDLED_CODE_PROFILE_IDS,
      manifest: codeManifest,
      profileContract,
      operatorContract,
    })).rejects.toThrow(/cover every provided profile exactly once/);

    await cp(
      resolve(PACKAGE_ROOT, "../..", "plugins/context/skills/context-code-indexer/tests/fixtures/profiles.json"),
      fixturePath,
      { force: true },
    );
    const markdownFixturePath = join(
      sourceRoot,
      "context-markdown-indexer",
      "tests",
      "fixtures",
      "profiles.json",
    );
    const markdownFixtures = JSON.parse(
      await readFile(markdownFixturePath, "utf8"),
    ) as unknown[];
    await writeFile(
      markdownFixturePath,
      `${JSON.stringify(markdownFixtures.slice(1), null, 2)}\n`,
      "utf8",
    );
    await expect(validateBundledIndexerAuthoringFixtures({
      source: markdownSource,
      bundleId: "context-markdown-indexer",
      fixtureFile: "profiles.json",
      coverage: "all-profiles",
      expectedProfiles: BUNDLED_MARKDOWN_PROFILE_IDS,
      manifest: markdownManifest,
      profileContract,
      operatorContract,
    })).rejects.toThrow(/cover every provided profile exactly once/);
    await cp(
      resolve(
        PACKAGE_ROOT,
        "../..",
        "plugins/context/skills/context-markdown-indexer/tests/fixtures/profiles.json",
      ),
      markdownFixturePath,
      { force: true },
    );
    const routingFixturePath = join(
      sourceRoot,
      "context-markdown-indexer",
      "tests",
      "fixtures",
      "routing.json",
    );
    const routingFixture = JSON.parse(
      await readFile(routingFixturePath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      routingFixturePath,
      `${JSON.stringify({ ...routingFixture, collection: "architecture" }, null, 2)}\n`,
      "utf8",
    );
    await expect(validateBundledIndexerMarkdownRoutingFixtures({
      source: markdownSource,
      expectedProfiles: BUNDLED_MARKDOWN_PROFILE_IDS,
      manifest: markdownManifest,
      profileContract,
      operatorContract,
    })).rejects.toThrow(/unknown or missing fields/);
    await cp(
      resolve(
        PACKAGE_ROOT,
        "../..",
        "plugins/context/skills/context-markdown-indexer/tests/fixtures/routing.json",
      ),
      routingFixturePath,
      { force: true },
    );
    const manifestPath = join(sourceRoot, "context-code-indexer", "context-indexer.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace(
        "path: templates/component-library.md",
        "path: templates/sdk-library.md",
      ),
      "utf8",
    );
    codeManifest = await loadIndexerProviderManifest(codeSource);
    expect(() => validateBundledIndexerProfileTemplates({
      bundleId: "context-code-indexer",
      expectedProfiles: BUNDLED_CODE_PROFILE_IDS,
      manifest: codeManifest,
    })).toThrow(/must use its own canonical template/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects Markdown editorial fixture drift before release materialization", async () => {
    const root = await createTemporaryRoot("context-cli-editorial-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const fixturePath = join(
      sourceRoot,
      "context-markdown-indexer",
      "tests",
      "fixtures",
      "editorial.json",
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      cases: Array<{ source_markdown: string }>;
    };
    fixture.cases[0]!.source_markdown = "This Section contains a complete supported answer.";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "invalid-editorial-output"),
    })).rejects.toThrow(/drifted from runtime signal/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects Markdown migration-equivalence authority drift before release", async () => {
    const root = await createTemporaryRoot("context-cli-markdown-migration-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const fixturePath = join(
      sourceRoot,
      "context-markdown-indexer",
      "tests",
      "fixtures",
      "migration-equivalence.json",
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      cases: Array<{ authority: string; source_shape: string }>;
    };
    fixture.cases[0]!.authority = "context-layout";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "invalid-markdown-migration-output"),
    })).rejects.toThrow(/wrong authority/);

    fixture.cases[0]!.authority = "community-instructions";
    fixture.cases[0]!.source_shape =
      "The answer is copied from https://private.example.internal/project/source.";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "private-markdown-migration-output"),
    })).rejects.toThrow(/not community-anonymous/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects incomplete chapter fixtures and private literals in runtime resources", async () => {
    const root = await createTemporaryRoot("context-cli-code-authoring-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const fixturePath = join(
      sourceRoot,
      "context-code-indexer",
      "tests",
      "fixtures",
      "chapters.json",
    );
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as unknown[];
    await writeFile(fixturePath, `${JSON.stringify(fixtures.slice(1), null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "missing-chapter-output"),
    })).rejects.toThrow(/cover every profile exactly once/);

    await cp(
      resolve(PACKAGE_ROOT, "../..", "plugins/context/skills/context-code-indexer/tests/fixtures/chapters.json"),
      fixturePath,
      { force: true },
    );
    const templatePath = join(
      sourceRoot,
      "context-code-indexer",
      "templates",
      "web-application.md",
    );
    const template = await readFile(templatePath, "utf8");
    await writeFile(templatePath, `${template}\n@context-private project-specific-name\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "private-literal-output"),
    })).rejects.toThrow(/non-portable private literal/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects unresolved Code template resources and legacy selection vocabulary", async () => {
    const root = await createTemporaryRoot("context-cli-template-reference-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const templatePath = join(
      sourceRoot,
      "context-code-indexer",
      "templates",
      "web-application.md",
    );
    const original = await readFile(templatePath, "utf8");
    const mutations = [
      {
        suffix: "\nAlso read `missing-resource.md`.\n",
        error: /unknown Markdown resource missing-resource\.md/,
      },
      {
        suffix: "\nThis target selects `missing-profile`.\n",
        error: /selects unregistered profile or composer missing-profile/,
      },
      {
        suffix: "\nMark this output as `material-required`.\n",
        error: /contains legacy template token `material-required`/,
      },
    ];
    for (const [index, mutation] of mutations.entries()) {
      await writeFile(templatePath, `${original}${mutation.suffix}`, "utf8");
      await expect(materializeBundledIndexerDistribution({
        packageRoot: PACKAGE_ROOT,
        sourceRoot,
        outputRoot: join(root, `invalid-template-output-${index}`),
      })).rejects.toThrow(mutation.error);
    }
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects missing composer fixtures and canonical composer contract drift", async () => {
    const root = await createTemporaryRoot("context-cli-composers-invalid-");
    const sourceRoot = join(root, "skills");
    await cp(resolve(PACKAGE_ROOT, "../..", "plugins/context/skills"), sourceRoot, {
      recursive: true,
    });
    const fixturePath = join(
      sourceRoot,
      "context-code-indexer",
      "tests",
      "fixtures",
      "composers.json",
    );
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as unknown[];
    await writeFile(fixturePath, `${JSON.stringify(fixtures.slice(0, -1), null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "missing-composer-fixture-output"),
    })).rejects.toThrow(/cover every composer exactly once/);

    await cp(
      resolve(PACKAGE_ROOT, "../..", "plugins/context/skills/context-code-indexer/tests/fixtures/composers.json"),
      fixturePath,
      { force: true },
    );
    const manifestPath = join(sourceRoot, "context-code-indexer", "context-indexer.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace("fact_kinds: [public-surface]", "fact_kinds: [public-surface-drift]"),
      "utf8",
    );
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "composer-contract-drift-output"),
    })).rejects.toThrow(/composer public-contract contract drifted/);
  });
});
