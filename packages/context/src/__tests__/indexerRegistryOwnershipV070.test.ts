import { describe, expect, test } from "bun:test";
import {
  canonicalOwnerCellRef,
  parseIndexerRegistry,
  validateFinalizedIndexerRegistry,
  type IndexerRegistry,
  type IndexerRegistryEntry,
} from "../index.js";

const PROVIDER_INTEGRITY = `sha256:${"a".repeat(64)}`;

function indexer(input: {
  id: string;
  requirementRef: string;
  coverageDomains: string[];
  role?: "primary" | "enricher";
  readScopeRefs?: string[];
  providerKind?: "code" | "markdown";
}): IndexerRegistryEntry {
  const role = input.role ?? "primary";
  const providerKind = input.providerKind ?? "code";
  return {
    id: input.id,
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: input.requirementRef,
      coverage_domains: input.coverageDomains,
      owned_scope: {
        ref: `requirement:${input.requirementRef}#target_scope`,
      },
      role,
    }],
    read_scope: {
      refs: input.readScopeRefs ?? [
        `requirement:${input.requirementRef}#target_scope`,
        `requirement:${input.requirementRef}#evidence_source_scope`,
      ],
    },
    profile: {
      primary: {
        id: providerKind === "markdown" ? "documentation-enrichment" : "domain-service",
        provider: `${input.id}-provider`,
      },
      additional: [],
      composers: [],
    },
    providers: [{
      id: `${input.id}-provider`,
      role: "primary",
      skill: providerKind === "markdown" ? "context-markdown-indexer" : "context-code-indexer",
      version: "0.7.0",
      integrity: PROVIDER_INTEGRITY,
      distribution: {
        kind: "cli-bundled",
        locator: providerKind === "markdown"
          ? "cli-bundled://context/context-markdown-indexer"
          : "cli-bundled://context/context-code-indexer",
      },
    }],
  };
}

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "product-knowledge",
      reader_goals: ["understand-and-operate"],
      coverage_domains: {
        public_contract: "required",
        operations: "required",
        examples: "optional",
      },
      target_scope: {
        targets: [{
          source_ref: "repo:application",
          module_refs: ["module:shared"],
        }, {
          source_ref: "repo:library",
          module_refs: ["module:shared"],
        }],
      },
      evidence_source_scope: {
        targets: [{
          source_ref: "repo:application",
          module_refs: ["module:shared"],
        }, {
          source_ref: "repo:library",
          module_refs: ["module:shared"],
        }, {
          source_ref: "docs:operations-guide",
          module_refs: [],
        }],
      },
      exclusions: [],
    }, {
      id: "migration-knowledge",
      reader_goals: ["migrate-safely"],
      coverage_domains: {
        migration: "required",
      },
      target_scope: {
        targets: [{
          source_ref: "repo:application",
          module_refs: ["module:shared"],
        }],
      },
      evidence_source_scope: {
        targets: [{
          source_ref: "repo:application",
          module_refs: ["module:shared"],
        }, {
          source_ref: "docs:migration-guide",
          module_refs: [],
        }],
      },
      exclusions: [],
    }],
    indexers: [
      indexer({
        id: "product-code",
        requirementRef: "product-knowledge",
        coverageDomains: ["public_contract"],
      }),
      indexer({
        id: "product-docs",
        requirementRef: "product-knowledge",
        coverageDomains: ["operations"],
        providerKind: "markdown",
      }),
      indexer({
        id: "migration-code",
        requirementRef: "migration-knowledge",
        coverageDomains: ["migration"],
      }),
      indexer({
        id: "product-enricher",
        requirementRef: "product-knowledge",
        coverageDomains: ["public_contract", "operations"],
        role: "enricher",
        providerKind: "markdown",
      }),
    ],
  };
}

function parse(value: IndexerRegistry): IndexerRegistry {
  return parseIndexerRegistry(JSON.stringify(value), "anonymous-owner-fixture");
}

describe("Indexer registry owner-cell composition", () => {
  test("keeps domain, requirement, source, and module identity independent", () => {
    const current = parse(registry());
    expect(() => validateFinalizedIndexerRegistry(current)).not.toThrow();

    const applicationCell = canonicalOwnerCellRef({
      requirementRef: "product-knowledge",
      coverageDomain: "public_contract",
      sourceRef: "repo:application",
      moduleRef: "module:shared",
    });
    expect(applicationCell).not.toBe(canonicalOwnerCellRef({
      requirementRef: "product-knowledge",
      coverageDomain: "public_contract",
      sourceRef: "repo:library",
      moduleRef: "module:shared",
    }));
    expect(applicationCell).not.toBe(canonicalOwnerCellRef({
      requirementRef: "migration-knowledge",
      coverageDomain: "migration",
      sourceRef: "repo:application",
      moduleRef: "module:shared",
    }));
    expect(current.indexers.find((item) => item.id === "product-enricher")?.read_scope.refs)
      .toEqual(current.indexers.find((item) => item.id === "product-code")?.read_scope.refs);
  });

  test("requires one primary for every required cell but no primary for optional cells", () => {
    const noOperationsOwner = registry();
    noOperationsOwner.indexers = noOperationsOwner.indexers.filter(
      (item) => item.id !== "product-docs",
    );
    expect(() => validateFinalizedIndexerRegistry(parse(noOperationsOwner))).toThrow(
      /Required owner cell has no primary Indexer/,
    );

    const optionalUnbound = registry();
    expect(optionalUnbound.indexers.some((item) =>
      item.requirement_bindings.some((binding) =>
        binding.coverage_domains.includes("examples")
      )
    )).toBe(false);
    expect(() => validateFinalizedIndexerRegistry(parse(optionalUnbound))).not.toThrow();
  });

  test("does not let an enricher complete a required cell and rejects duplicate primaries", () => {
    const enricherOnly = registry();
    enricherOnly.indexers = enricherOnly.indexers.filter(
      (item) => item.id !== "product-code",
    );
    expect(() => validateFinalizedIndexerRegistry(parse(enricherOnly))).toThrow(
      /Required owner cell has no primary Indexer/,
    );

    const duplicate = registry();
    duplicate.indexers.push(indexer({
      id: "duplicate-product-code",
      requirementRef: "product-knowledge",
      coverageDomains: ["public_contract"],
    }));
    expect(() => validateFinalizedIndexerRegistry(parse(duplicate))).toThrow(
      /primary ownership is ambiguous/,
    );
  });
});
