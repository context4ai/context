import { afterEach, describe, expect, test } from "bun:test";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadIndexerProviderManifest,
  resolvedProviderStableFingerprint,
} from "@c4a/context";
import {
  BUNDLED_CODE_PROFILE_IDS,
  BUNDLED_MARKDOWN_PROFILE_IDS,
} from "../project/indexerBaseContractCatalog.js";
import {
  BUNDLED_CODE_COMPOSER_IDS,
  BUNDLED_CODE_COMPOSER_SPECS,
} from "../project/indexerBaseComposerCatalog.js";
import {
  defaultCliIndexerAssetsRoot,
  listCliBundledIndexers,
  loadCliIndexerBaseContracts,
  resolveCliBundledIndexerProvider,
} from "../project/indexerCliBundledProvider.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), "context-cli-indexers-"));
  temporaryRoots.push(root);
  const assetsRoot = join(root, "assets");
  const manifest = await materializeBundledIndexerDistribution({
    packageRoot: PACKAGE_ROOT,
    outputRoot: assetsRoot,
  });
  return { root, assetsRoot, manifest };
}

describe("CLI bundled Indexer release", () => {
  test("resolves default release assets with Node-compatible module URL semantics", async () => {
    const assetsRoot = defaultCliIndexerAssetsRoot();
    expect(await readFile(join(assetsRoot, "release-manifest.json"), "utf8"))
      .toContain('"protocol": "context.indexer.cli-release-manifest/v1"');

    const runtimeSource = await readFile(
      join(PACKAGE_ROOT, "src", "project", "indexerCliBundledProvider.ts"),
      "utf8",
    );
    expect(runtimeSource).toContain("fileURLToPath(import.meta.url)");
    expect(runtimeSource).not.toContain("import.meta.dir");
  });

  test("materializes the complete community base contract and exact Provider catalog", async () => {
    const fixture = await buildFixture();
    const packageJson = JSON.parse(
      await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { version: string };
    expect(fixture.manifest.version).toBe(packageJson.version);
    expect(fixture.manifest.bundles.map((bundle) => bundle.skill)).toEqual([
      "context-code-indexer",
      "context-markdown-indexer",
    ]);

    const { operators, profiles } = await loadCliIndexerBaseContracts({
      assetsRoot: fixture.assetsRoot,
    });
    expect(operators.selector_fact_paths).toEqual([
      "target.eligible",
      "target.bundle_compact_eligible",
      "target.bundle_expanded_eligible",
      "evidence.current",
    ]);
    expect(profiles.coverage_domains).toEqual([
      "technical-structure",
      "public-contract",
      "business-semantics",
      "operations",
    ]);
    expect(profiles.profiles).toHaveLength(
      BUNDLED_CODE_PROFILE_IDS.length + BUNDLED_MARKDOWN_PROFILE_IDS.length,
    );
    expect(profiles.subject_key_schemas).toHaveLength(profiles.profiles.length);
    expect(profiles.subject_key_schemas.find((schema) =>
      schema.profile === "component-library"
    )).toMatchObject({
      namespace: { operator: "canonical-source-module-namespace" },
      kinds: [{
        id: "component",
        local_key: { operator: "canonical-export-family" },
      }],
    });
    expect(JSON.stringify(profiles.profiles)).not.toContain("subject_key_schema");
    expect(profiles.profiles.find((profile) => profile.id === "web-application")
      ?.variant_schema.axes[0]).toMatchObject({
        id: "application_mode",
        values: ["spa", "mpa", "hybrid"],
      });
    expect(profiles.profiles.find((profile) => profile.id === "component-library")
      ?.parser_requirements.map((requirement) => requirement.capability)).toEqual([
        "parser.typescript",
        "parser.javascript",
        "parser.mdx",
        "parser.css",
        "parser.scss",
        "parser.json",
        "parser.yaml",
        "parser.toml",
      ]);
    expect(profiles.profiles.find((profile) => profile.id === "documentation-site")
      ?.parser_requirements).toEqual([]);
    expect(profiles.profiles.find((profile) => profile.id === "public-api-reference")
      ?.metrics.find((metric) => metric.id === "narrative-enumeration-ratio"))
      .toMatchObject({ recommended_max: 0.6, hard_max: 0.75 });

    for (const bundle of fixture.manifest.bundles) {
      const provider = await loadIndexerProviderManifest(
        join(fixture.assetsRoot, "bundles", bundle.skill),
      );
      expect(provider.version).toBe(bundle.version);
      if (bundle.skill === "context-code-indexer") {
        expect(provider.provides.composers?.map((composer) => composer.id)).toEqual(
          BUNDLED_CODE_COMPOSER_IDS,
        );
        expect(provider.provides.composers?.map((composer) => composer.contract))
          .toEqual(BUNDLED_CODE_COMPOSER_SPECS.map((composer) => composer.contract));
        const templates = provider.provider.templates ?? [];
        expect(templates.map((template) => template.profile)).toEqual(
          BUNDLED_CODE_PROFILE_IDS,
        );
        expect(templates.map((template) => template.path)).toEqual(
          BUNDLED_CODE_PROFILE_IDS.map((profile) => `templates/${profile}.md`),
        );
        expect(new Set(templates.map((template) => template.path)).size).toBe(
          BUNDLED_CODE_PROFILE_IDS.length,
        );
        const fixtures = JSON.parse(await readFile(
          join(fixture.assetsRoot, "bundles", bundle.skill, "tests", "fixtures", "profiles.json"),
          "utf8",
        )) as Array<{ id: string; profile: string }>;
        expect(fixtures.map((entry) => entry.profile)).toEqual(BUNDLED_CODE_PROFILE_IDS);
        expect(new Set(fixtures.map((entry) => entry.id)).size).toBe(
          BUNDLED_CODE_PROFILE_IDS.length,
        );
        expect(provider.provides.logical_units?.[0]?.artifacts?.supported_policy_variants)
          .toEqual(["compact", "standard", "expanded"]);
        expect(provider.quality_guidance?.repair).toBe("references/metrics.md");
        const chapterFixtures = JSON.parse(await readFile(
          join(fixture.assetsRoot, "bundles", bundle.skill, "tests", "fixtures", "chapters.json"),
          "utf8",
        )) as Array<{ profile: string; artifact_policy_variant: string; anonymized: boolean }>;
        expect(chapterFixtures.map((entry) => entry.profile)).toEqual(BUNDLED_CODE_PROFILE_IDS);
        expect(new Set(chapterFixtures.map((entry) => entry.artifact_policy_variant))).toEqual(
          new Set(["compact", "standard", "expanded"]),
        );
        expect(chapterFixtures.every((entry) => entry.anonymized)).toBe(true);
        const composerFixtures = JSON.parse(await readFile(
          join(fixture.assetsRoot, "bundles", bundle.skill, "tests", "fixtures", "composers.json"),
          "utf8",
        )) as Array<{ composer: string; empty_result: { fragments: unknown[] } }>;
        expect(composerFixtures.map((entry) => entry.composer)).toEqual(
          BUNDLED_CODE_COMPOSER_IDS,
        );
        expect(composerFixtures.every((entry) => entry.empty_result.fragments.length === 0))
          .toBe(true);
      } else {
        expect(provider.provides.profiles).toEqual(BUNDLED_MARKDOWN_PROFILE_IDS);
        expect(new Set(provider.provides.profiles).size).toBe(
          BUNDLED_MARKDOWN_PROFILE_IDS.length,
        );
        expect(provider.activation?.target_kinds).toEqual([
          "document",
          "document-set",
          "documentation-site",
        ]);
        const markdownFixtures = JSON.parse(await readFile(
          join(
            fixture.assetsRoot,
            "bundles",
            bundle.skill,
            "tests",
            "fixtures",
            "profiles.json",
          ),
          "utf8",
        )) as Array<{
          id: string;
          profile: string;
          source_role: string;
          anonymized: boolean;
        }>;
        expect(markdownFixtures.map((entry) => entry.profile)).toEqual(
          BUNDLED_MARKDOWN_PROFILE_IDS,
        );
        expect(new Set(markdownFixtures.map((entry) => entry.id)).size).toBe(
          BUNDLED_MARKDOWN_PROFILE_IDS.length,
        );
        expect(markdownFixtures.every((entry) => entry.anonymized)).toBe(true);
        expect(profiles.subject_key_schemas.find((schema) =>
          schema.profile === "documentation-site"
        )?.kinds.map((kind) => kind.id)).toEqual(["document-set"]);
        expect(BUNDLED_MARKDOWN_PROFILE_IDS.filter((profile) =>
          profile !== "documentation-site"
        ).every((profile) =>
          profiles.subject_key_schemas.find((schema) => schema.profile === profile)
            ?.kinds.some((kind) => kind.id === "document-section")
        )).toBe(true);
        const markdownContracts = profiles.profiles.filter((profile) =>
          BUNDLED_MARKDOWN_PROFILE_IDS.includes(
            profile.id as typeof BUNDLED_MARKDOWN_PROFILE_IDS[number],
          )
        );
        expect(markdownContracts.map((profile) => profile.id)).toEqual(
          BUNDLED_MARKDOWN_PROFILE_IDS,
        );
        expect(markdownContracts.every((profile) =>
          new Set(profile.reader_question_contracts.map((question) =>
            question.coverage_domain
          )).size === 4 &&
          !profile.reader_question_contracts.some((question) =>
            question.ref === "question:source-authority"
          ) && profile.layout_mappings.length > 0
        )).toBe(true);
        expect(markdownContracts.flatMap((profile) => profile.layout_mappings).every((mapping) =>
          mapping.document_kind !== mapping.collection
          && mapping.reader_goal !== "understand-reader-task"
          && mapping.artifact_kinds.every((kind) => kind === "content")
        )).toBe(true);
        expect(markdownContracts.find((profile) =>
          profile.id === "user-and-developer-guide"
        )?.layout_mappings.map((mapping) => [
          mapping.document_kind,
          mapping.reader_goal,
          mapping.collection,
        ])).toEqual([
          ["product-requirements", "understand-product-intent", "product"],
          ["technical-guide", "understand-technical-design", "architecture"],
          ["task-guide", "complete-reader-task", "sop"],
        ]);
        const routingFixtures = JSON.parse(await readFile(
          join(
            fixture.assetsRoot,
            "bundles",
            bundle.skill,
            "tests",
            "fixtures",
            "routing.json",
          ),
          "utf8",
        )) as {
          anonymized: boolean;
          cases: Array<{
            density_mode: string;
            candidate_resolution: string;
            artifacts: Array<{ boundary_decision: string }>;
          }>;
        };
        expect(routingFixtures.anonymized).toBe(true);
        expect(new Set(routingFixtures.cases.map((entry) => entry.density_mode))).toEqual(
          new Set(["macro", "meso", "micro", "single-pass"]),
        );
        expect(new Set(routingFixtures.cases.map((entry) =>
          entry.candidate_resolution
        ))).toEqual(new Set([
          "accept-correction",
          "dismiss-with-rationale",
          "keep-unresolved",
        ]));
        expect(new Set(routingFixtures.cases.flatMap((entry) =>
          entry.artifacts.map((artifact) => artifact.boundary_decision)
        ))).toEqual(new Set(["promote-reader-artifact", "retain-section-group"]));
        const editorialFixtures = JSON.parse(await readFile(
          join(
            fixture.assetsRoot,
            "bundles",
            bundle.skill,
            "tests",
            "fixtures",
            "editorial.json",
          ),
          "utf8",
        )) as {
          anonymized: boolean;
          cases: Array<{
            expected_signal: null | { code: string };
            selected_outcome: string;
            assessment: string | null;
          }>;
        };
        expect(editorialFixtures.anonymized).toBe(true);
        expect(new Set(editorialFixtures.cases.flatMap((entry) =>
          entry.expected_signal === null ? [] : [entry.expected_signal.code]
        )).size).toBe(19);
        expect(new Set(editorialFixtures.cases.map((entry) => entry.selected_outcome)))
          .toEqual(new Set(["keep", "repair", "reshape", "omit", "request-input"]));
        expect(editorialFixtures.cases.filter((entry) => entry.assessment !== null))
          .toHaveLength(2);
        const migrationFixtures = JSON.parse(await readFile(
          join(
            fixture.assetsRoot,
            "bundles",
            bundle.skill,
            "tests",
            "fixtures",
            "migration-equivalence.json",
          ),
          "utf8",
        )) as {
          anonymized: boolean;
          cases: Array<{ rule_id: string; authority: string }>;
        };
        expect(migrationFixtures.anonymized).toBe(true);
        expect(migrationFixtures.cases).toHaveLength(20);
        expect(new Set(migrationFixtures.cases.map((entry) => entry.rule_id)).size).toBe(20);
        expect(new Set(migrationFixtures.cases.map((entry) => entry.authority))).toEqual(
          new Set(["community-instructions", "context-layout", "context-revision"]),
        );
      }
      const composerReferences = bundle.skill === "context-code-indexer"
        ? BUNDLED_CODE_COMPOSER_IDS.map((composer) =>
            `references/composers/${composer}.md`
          ).sort()
        : [];
      const templates = bundle.skill === "context-code-indexer"
        ? [
            "templates/adapter-integration.md",
            "templates/api-service.md",
            "templates/background-runtime.md",
            "templates/cli-tool.md",
            "templates/component-library.md",
            "templates/contract-source.md",
            "templates/data-sync-reconciliation.md",
            "templates/derived-generated-source.md",
            "templates/domain-service.md",
            "templates/event-consumer.md",
            "templates/gateway-facade.md",
            "templates/monorepo-container.md",
            "templates/plugin-extension.md",
            "templates/sdk-library.md",
            "templates/storage-repository.md",
            "templates/web-application.md",
          ]
        : [];
      const fixtureFiles = bundle.skill === "context-code-indexer"
        ? ["tests/fixtures/profiles.json", "tests/fixtures/scenarios.json"]
        : [
            "tests/fixtures/anonymous.json",
            "tests/fixtures/editorial.json",
            "tests/fixtures/migration-equivalence.json",
            "tests/fixtures/profiles.json",
            "tests/fixtures/routing.json",
          ];
      expect(bundle.files.map((file) => file.path)).toEqual([
        "SKILL.md",
        "context-indexer.yaml",
        ...composerReferences,
        ...(bundle.skill === "context-markdown-indexer"
          ? ["references/classification.md"]
          : []),
        ...(bundle.skill === "context-markdown-indexer"
          ? ["references/editorial-policy.md"]
          : []),
        "references/indexer.md",
        ...(bundle.skill === "context-code-indexer" ? ["references/metrics.md"] : []),
        ...(bundle.skill === "context-markdown-indexer"
          ? ["references/semantic-planning.md"]
          : []),
        ...(bundle.skill === "context-markdown-indexer"
          ? ["references/structure-and-artifacts.md"]
          : []),
        ...templates,
        ...(bundle.skill === "context-code-indexer"
          ? ["tests/fixtures/chapters.json", "tests/fixtures/composers.json"]
          : []),
        ...fixtureFiles,
      ]);
    }
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("re-resolves the same exact Bundle after moving release assets to a new machine root", async () => {
    const fixture = await buildFixture();
    const catalog = await listCliBundledIndexers({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
    });
    expect(JSON.stringify(catalog)).not.toContain(fixture.assetsRoot);
    const selected = fixture.manifest.bundles[0]!;
    const expected = {
      indexerId: "workspace-code",
      providerId: "community",
      skill: selected.skill,
      version: selected.version,
      integrity: selected.integrity,
      distribution: selected.distribution,
    };
    const now = new Date("2026-08-27T12:00:00.000Z");
    const first = await resolveCliBundledIndexerProvider({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected,
      transportRoot: join(fixture.root, "transport-a"),
      now,
    });
    const second = await resolveCliBundledIndexerProvider({
      assetsRoot: fixture.assetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected,
      transportRoot: join(fixture.root, "transport-b"),
      now,
    });
    const relocatedAssetsRoot = join(fixture.root, "new-machine", "assets");
    await cp(fixture.assetsRoot, relocatedAssetsRoot, { recursive: true });
    const relocated = await resolveCliBundledIndexerProvider({
      assetsRoot: relocatedAssetsRoot,
      expectedPackageVersion: fixture.manifest.version,
      expected,
      transportRoot: join(fixture.root, "new-machine", "transport"),
      now,
    });
    expect(first.transport.path).not.toBe(second.transport.path);
    expect(first.transport.path).not.toBe(relocated.transport.path);
    expect(first.receipt.receipt_digest).not.toBe(second.receipt.receipt_digest);
    expect(resolvedProviderStableFingerprint(first)).toBe(
      resolvedProviderStableFingerprint(second),
    );
    expect(resolvedProviderStableFingerprint(first)).toBe(
      resolvedProviderStableFingerprint(relocated),
    );
    expect(await readFile(join(first.transport.path, "context-indexer.yaml"), "utf8"))
      .toContain("protocol: context.indexer.provider/v1");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

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
    const root = await mkdtemp(join(tmpdir(), "context-cli-indexers-invalid-"));
    temporaryRoots.push(root);
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
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as unknown[];
    await writeFile(fixturePath, `${JSON.stringify(fixtures.slice(1), null, 2)}\n`, "utf8");
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "missing-fixture-output"),
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
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "missing-markdown-fixture-output"),
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
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "invalid-markdown-routing-output"),
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
    await expect(materializeBundledIndexerDistribution({
      packageRoot: PACKAGE_ROOT,
      sourceRoot,
      outputRoot: join(root, "aliased-template-output"),
    })).rejects.toThrow(/must use its own canonical template/);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects Markdown editorial fixture drift before release materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-cli-editorial-invalid-"));
    temporaryRoots.push(root);
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
    const root = await mkdtemp(join(tmpdir(), "context-cli-markdown-migration-invalid-"));
    temporaryRoots.push(root);
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
    const root = await mkdtemp(join(tmpdir(), "context-cli-code-authoring-invalid-"));
    temporaryRoots.push(root);
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
    const root = await mkdtemp(join(tmpdir(), "context-cli-template-reference-invalid-"));
    temporaryRoots.push(root);
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
    const root = await mkdtemp(join(tmpdir(), "context-cli-composers-invalid-"));
    temporaryRoots.push(root);
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
