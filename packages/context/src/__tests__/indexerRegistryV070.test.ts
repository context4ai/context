import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  canonicalOwnerCellRef,
  indexerRegistryDigests,
  loadIndexerRegistry,
  parseIndexerRegistry,
  validateFinalizedIndexerRegistry,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function requirementBlock(): string[] {
  return [
    "requirements:",
    "  - id: workspace-knowledge",
    "    reader_goals: [understand-capabilities, integrate-safely]",
    "    coverage_domains:",
    "      public_contract: required",
    "      operations: optional",
    "      historical_notes: out-of-scope",
    "    questions:",
    "      - ref: question:failure-recovery",
    "        authority:",
    "          kind: cli-base-contract",
    "          ref: profile:service/operations",
    `          digest: ${DIGEST_A}`,
    "        contract_version: 1",
    `        contract_digest: ${DIGEST_B}`,
    "    target_scope:",
    "      targets:",
    "        - source_ref: repo:sample-app",
    "          module_refs: [module:application]",
    "    evidence_source_scope:",
    "      targets:",
    "        - source_ref: repo:sample-app",
    "          module_refs: [module:application]",
    "        - source_ref: docs:operations-guide",
    "          module_refs: []",
    "    exclusions: []",
  ];
}

function indexerBlock(options: { role?: "primary" | "enricher"; id?: string } = {}): string[] {
  const role = options.role ?? "primary";
  const id = options.id ?? "application-indexer";
  return [
    `  - id: ${id}`,
    "    operations: [main-index]",
    "    requirement_bindings:",
    "      - requirement_ref: workspace-knowledge",
    "        coverage_domains: [public_contract, operations]",
    "        owned_scope:",
    "          ref: requirement:workspace-knowledge#target_scope",
    `        role: ${role}`,
    "    read_scope:",
    "      refs:",
    "        - requirement:workspace-knowledge#target_scope",
    "        - requirement:workspace-knowledge#evidence_source_scope",
    "    profile:",
    "      primary:",
    "        id: web-application",
    "        provider: community",
    "        variants:",
    "          application_mode: spa",
    "      additional: []",
    "      composers: []",
    "    providers:",
    "      - id: community",
    "        role: primary",
    "        skill: context-indexer-sample",
    "        version: 1.2.0",
    `        integrity: ${DIGEST_A}`,
    "        distribution:",
    "          kind: cli-bundled",
    "          locator: cli-bundled://context/context-indexer-sample",
    "        config:",
    "          public_entries: [src/index.ts]",
  ];
}

function registryYaml(indexers = indexerBlock()): string {
  return [
    "protocol: context.indexer.registry/v1",
    ...requirementBlock(),
    ...(indexers.length === 0 ? ["indexers: []"] : ["indexers:", ...indexers]),
    "",
  ].join("\n");
}

describe("context.indexer.registry/v1", () => {
  test("parses static requirements and a finalized primary owner registry", () => {
    const registry = parseIndexerRegistry(registryYaml());
    expect(() => validateFinalizedIndexerRegistry(registry)).not.toThrow();
    expect(registry.requirements[0]?.questions?.[0]).toEqual({
      ref: "question:failure-recovery",
      authority: {
        kind: "cli-base-contract",
        ref: "profile:service/operations",
        digest: DIGEST_A,
      },
      contract_version: 1,
      contract_digest: DIGEST_B,
    });
    expect(registry.indexers[0]?.read_scope.refs).toContain(
      "requirement:workspace-knowledge#evidence_source_scope",
    );
  });

  test("expands the single compact authoring form with deterministic defaults", () => {
    const compact = registryYaml().replace(
      [
        "          module_refs: []",
        "    exclusions: []",
        "  - id: application-indexer",
        "    operations: [main-index]",
      ].join("\n"),
      [
        "    exclusions: []",
        "  - id: application-indexer",
      ].join("\n"),
    ).replace(
      [
        "        owned_scope:",
        "          ref: requirement:workspace-knowledge#target_scope",
        "        role: primary",
        "    read_scope:",
        "      refs:",
        "        - requirement:workspace-knowledge#target_scope",
        "        - requirement:workspace-knowledge#evidence_source_scope",
      ].join("\n"),
      "        role: primary",
    ).replace(
      [
        "        role: primary",
        "        skill: context-indexer-sample",
      ].join("\n"),
      "        skill: context-indexer-sample",
    ).replace(
      [
        "        distribution:",
        "          kind: cli-bundled",
        "          locator: cli-bundled://context/context-indexer-sample",
      ].join("\n"),
      "",
    );
    const registry = parseIndexerRegistry(compact);
    const indexer = registry.indexers[0]!;
    expect(registry.requirements[0]!.evidence_source_scope.targets[1]).toEqual({
      source_ref: "docs:operations-guide",
      module_refs: [],
    });
    expect(indexer.operations).toEqual(["main-index"]);
    expect(indexer.requirement_bindings[0]!.owned_scope).toEqual({
      ref: "requirement:workspace-knowledge#target_scope",
    });
    expect(indexer.read_scope.refs).toEqual([
      "requirement:workspace-knowledge#target_scope",
      "requirement:workspace-knowledge#evidence_source_scope",
    ]);
    expect(indexer.providers[0]).toMatchObject({
      role: "primary",
      distribution: {
        kind: "cli-bundled",
        locator: "cli-bundled://context/context-indexer-sample",
      },
    });
  });

  test("derives independent requirement, selection, and full registry digests", () => {
    const before = parseIndexerRegistry(registryYaml());
    const afterProviderUpgrade = parseIndexerRegistry(
      registryYaml().replace("version: 1.2.0", "version: 1.3.0"),
    );
    const afterRequirementChange = parseIndexerRegistry(
      registryYaml().replace("integrate-safely", "operate-reliably"),
    );

    expect(indexerRegistryDigests(afterProviderUpgrade).requirementSetDigest).toBe(
      indexerRegistryDigests(before).requirementSetDigest,
    );
    expect(indexerRegistryDigests(afterProviderUpgrade).indexerSelectionDigest).not.toBe(
      indexerRegistryDigests(before).indexerSelectionDigest,
    );
    expect(indexerRegistryDigests(afterRequirementChange).requirementSetDigest).not.toBe(
      indexerRegistryDigests(before).requirementSetDigest,
    );
  });

  test("loads only src/indexers.yaml without executing src/index.ts", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-registry-"));
    const marker = join(root, "executed.txt");
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "index.ts"), [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      ].join("\n"));
      await writeFile(join(root, DEFAULT_INDEXER_REGISTRY_PATH), registryYaml());

      const loaded = await loadIndexerRegistry(root);
      expect(loaded.path).toBe("src/indexers.yaml");
      expect(loaded.registry.indexers).toHaveLength(1);
      await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a registry symlink that escapes the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-registry-"));
    const outside = await mkdtemp(join(tmpdir(), "context-indexer-registry-outside-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      const externalRegistry = join(outside, "indexers.yaml");
      await writeFile(externalRegistry, registryYaml());
      await symlink(externalRegistry, join(root, DEFAULT_INDEXER_REGISTRY_PATH));
      await expect(loadIndexerRegistry(root)).rejects.toThrow(
        /must stay inside the Context workspace/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("allows requirement confirmation before Provider selection but not finalization", () => {
    const registry = parseIndexerRegistry(registryYaml([]));
    expect(registry.indexers).toEqual([]);
    expect(() => validateFinalizedIndexerRegistry(registry)).toThrow(
      /Required owner cell has no primary Indexer/,
    );
  });

  test("does not let an enricher satisfy required owner coverage", () => {
    const registry = parseIndexerRegistry(registryYaml(indexerBlock({ role: "enricher" })));
    expect(() => validateFinalizedIndexerRegistry(registry)).toThrow(
      /Required owner cell has no primary Indexer/,
    );
  });

  test("rejects duplicate primary ownership while allowing overlapping read scope", () => {
    const registry = parseIndexerRegistry(registryYaml([
      ...indexerBlock(),
      ...indexerBlock({ id: "secondary-indexer" }),
    ]));
    expect(() => validateFinalizedIndexerRegistry(registry)).toThrow(
      /primary ownership is ambiguous/,
    );
    expect(registry.indexers[0]?.read_scope.refs).toEqual(
      registry.indexers[1]?.read_scope.refs,
    );
  });

  test("keeps evidence-only sources out of owner cells", () => {
    const registry = parseIndexerRegistry(registryYaml());
    expect(() => validateFinalizedIndexerRegistry(registry)).not.toThrow();
    const ownerRef = canonicalOwnerCellRef({
      requirementRef: "workspace-knowledge",
      coverageDomain: "public_contract",
      sourceRef: "repo:sample-app",
      moduleRef: "module:application",
    });
    expect(ownerRef).toStartWith("owner-cell:");
    expect(ownerRef).not.toContain("%");
    expect(ownerRef).not.toBe(canonicalOwnerCellRef({
      requirementRef: "workspace-knowledge",
      coverageDomain: "public_contract",
      sourceRef: "repo~3Asample-app",
      moduleRef: "module:application",
    }));
    expect(registry.indexers[0]?.requirement_bindings[0]?.owned_scope).toEqual({
      ref: "requirement:workspace-knowledge#target_scope",
    });
  });

  test("rejects ownership and read targets outside confirmed requirement authority", () => {
    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "ref: requirement:workspace-knowledge#target_scope",
        "targets:\n            - source_ref: repo:other\n              module_refs: []",
      ),
    )).toThrow(/must stay within its confirmed requirement scope/);

    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "      refs:\n        - requirement:workspace-knowledge#target_scope",
        "      refs:\n        - requirement:unknown#target_scope",
      ),
    )).toThrow(/must use one of its bound requirements/);
  });

  test("uses stable refs instead of persisting duplicate complete scopes", () => {
    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "ref: requirement:workspace-knowledge#target_scope",
        "targets:\n            - source_ref: repo:sample-app\n              module_refs: [module:application]",
      ),
    )).toThrow(/instead of repeating its complete target scope/);

    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "    profile:",
        "      extra_targets:\n        - source_ref: repo:sample-app\n          module_refs: [module:application]\n    profile:",
      ),
    )).toThrow(/repeats a scope already included by ref/);
  });

  test("rejects persistence-budget violations and floating Provider coordinates", () => {
    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "public_entries: [src/index.ts]",
        "inventory: [src/index.ts]",
      ),
    )).toThrow(/non-persistent runtime field inventory/);

    expect(() => parseIndexerRegistry(
      registryYaml().replace("version: 1.2.0", "version: latest"),
    )).toThrow(/version/);

    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "locator: cli-bundled://context/context-indexer-sample",
        "locator: marketplace://context/context-indexer-sample",
      ),
    )).toThrow(/cli-bundled locator/);
  });

  test("accepts every portable distribution kind and enforces its locator grammar", () => {
    const cases = [
      ["bundled", "plugin://context/context-indexer-sample"],
      ["workspace", "workspace://skills/context-indexer-sample"],
      ["package", "package://npm/%40scope%2Findexers#bundles/context-indexer-sample"],
      ["marketplace", "marketplace://community/context/indexer-sample"],
    ] as const;
    for (const [kind, locator] of cases) {
      expect(parseIndexerRegistry(
        registryYaml()
          .replace("kind: cli-bundled", `kind: ${kind}`)
          .replace(
            "locator: cli-bundled://context/context-indexer-sample",
            `locator: ${locator}`,
          ),
      ).indexers[0]?.providers[0]?.distribution).toEqual({ kind, locator });
    }

    expect(() => parseIndexerRegistry(
      registryYaml()
        .replace("kind: cli-bundled", "kind: bundled")
        .replace(
          "locator: cli-bundled://context/context-indexer-sample",
          "locator: bundled://context-indexer-sample",
        ),
    )).toThrow(/plugin/);

    for (const [kind, locator] of [
      ["workspace", "workspace://skills/../outside"],
      ["package", "package://npm/%40scope%2Findexers#bundles/../outside"],
    ] as const) {
      expect(() => parseIndexerRegistry(
        registryYaml()
          .replace("kind: cli-bundled", `kind: ${kind}`)
          .replace(
            "locator: cli-bundled://context/context-indexer-sample",
            `locator: ${locator}`,
          ),
      )).toThrow(/portable|escape/);
    }

    expect(() => parseIndexerRegistry(
      registryYaml().replace("  - id: application-indexer", "  - id: safe/../../outside"),
    )).toThrow(/parent-directory/);
  });

  test("rejects duplicate YAML keys and legacy registry shapes", () => {
    expect(() => parseIndexerRegistry([
      registryYaml(),
      "indexers: []",
    ].join("\n"))).toThrow(/Map keys must be unique/);

    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "requirements:",
        "requirements:\n  provider: {}",
      ),
    )).toThrow();

    expect(() => parseIndexerRegistry(
      registryYaml().replace(
        "    profile:",
        "    output_path: knowledge/generated\n    profile:",
      ),
    )).toThrow(/Unrecognized key/);
  });
});
