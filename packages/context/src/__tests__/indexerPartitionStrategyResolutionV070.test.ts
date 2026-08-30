import { describe, expect, test } from "bun:test";
import {
  indexerPartitionStrategySetDigest,
  indexerAuthorizedPartitionStrategies,
  indexerProtocolDigest,
  indexerProviderManifestSchema,
  resolveIndexerPartitionStrategies,
  validateIndexerPartitionStrategyResolution,
  type IndexerPartitionStrategyResolution,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function manifest() {
  return indexerProviderManifestSchema.parse({
    protocol: "context.indexer.provider/v1",
    id: "context-indexer-sample",
    version: "1.2.0",
    domains: ["code"],
    activation: {
      target_kinds: ["package"],
      required_signals: [{
        id: "supported-source",
        description: "The target has supported source.",
      }],
      supporting_signals: [],
      negative_signals: [],
    },
    provides: {
      profiles: ["component-library", "sdk-library"],
      partition_strategies: [{
        id: "public-target-family",
        profiles: ["component-library", "sdk-library"],
        priority: 100,
      }, {
        id: "semantic-subject",
        profiles: ["component-library", "sdk-library"],
        priority: 200,
      }],
      operations: [{
        id: "main-index",
        consumes: "context.indexer.main-workset/v1",
        produces: "context.indexer.main-result/v1",
      }],
    },
    provider: {
      instructions: [{
        path: "references/indexer.md",
        profiles: ["component-library", "sdk-library"],
      }],
    },
  });
}

function resolutionInput() {
  return {
    indexer_id: "sample-indexer",
    indexer_fingerprint: digest("a"),
    registry_projection_digest: digest("b"),
    selected_profile_ids: ["component-library"],
    provider: {
      layer_ref: "provider-layer:community",
      id: "context-indexer-sample",
      version: "1.2.0",
      integrity: digest("c"),
      bundle_digest: digest("d"),
      manifest_digest: digest("e"),
      manifest: manifest(),
    },
    local_customization: {
      fingerprint: digest("f"),
      strategies: [{
        strategy_id: "public-target-family",
        profiles: ["component-library"],
        priority: 50,
        implementation_digest: digest("1"),
      }, {
        strategy_id: "local-conventions",
        profiles: ["component-library"],
        priority: 75,
        implementation_digest: digest("2"),
      }],
    },
    cli_release_digest: digest("3"),
    cli_builtins: [{
      strategy_id: "single-semantic-catalog",
      priority: 0,
      implementation_digest: digest("4"),
    }],
  };
}

function rehash(value: IndexerPartitionStrategyResolution): void {
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "resolution_digest"),
  );
  value.resolution_digest = indexerProtocolDigest(payload);
}

describe("partition strategy authority and project-first priority", () => {
  test("resolves local overrides and Provider strategies before CLI builtins", () => {
    const resolution = resolveIndexerPartitionStrategies(resolutionInput());
    expect(resolution.strategies.map((strategy) => ({
      source: strategy.source,
      id: strategy.strategy_ref.strategy_id,
      order: strategy.order,
    }))).toEqual([{
      source: "local-customization",
      id: "public-target-family",
      order: 0,
    }, {
      source: "local-customization",
      id: "local-conventions",
      order: 1,
    }, {
      source: "provider",
      id: "semantic-subject",
      order: 2,
    }, {
      source: "cli-builtin",
      id: "single-semantic-catalog",
      order: 3,
    }, {
      source: "cli-builtin",
      id: "catalog-fallback",
      order: 4,
    }]);
    expect(resolution.strategies.filter((strategy) =>
      strategy.strategy_ref.strategy_id === "public-target-family"
    )).toHaveLength(1);
    expect(validateIndexerPartitionStrategyResolution(resolution)).toEqual(resolution);
  });

  test("binds strategy order into the workset-facing strategy set digest", () => {
    const resolution = resolveIndexerPartitionStrategies(resolutionInput());
    const ordered = resolution.strategies.map((strategy) => ({
      strategy_ref: strategy.strategy_ref,
      strategy_digest: strategy.strategy_digest,
    }));
    expect(indexerPartitionStrategySetDigest(ordered)).toBe(
      resolution.strategy_set_digest,
    );
    expect(indexerAuthorizedPartitionStrategies(resolution)).toEqual(ordered);
    expect(indexerPartitionStrategySetDigest([...ordered].reverse())).not.toBe(
      resolution.strategy_set_digest,
    );
  });

  test("rejects unselected local profiles and CLI shadowing", () => {
    const unselected = resolutionInput();
    unselected.local_customization.strategies[0]!.profiles = ["sdk-library"];
    expect(() => resolveIndexerPartitionStrategies(unselected)).toThrow(
      /unselected profile/,
    );

    const shadow = resolutionInput();
    shadow.cli_builtins[0]!.strategy_id = "semantic-subject";
    expect(() => resolveIndexerPartitionStrategies(shadow)).toThrow(
      /cannot shadow project strategies/,
    );

    const reserved = resolutionInput();
    reserved.cli_builtins[0]!.strategy_id = "catalog-fallback";
    expect(() => resolveIndexerPartitionStrategies(reserved)).toThrow(
      /reserved CLI partition strategy/,
    );
  });

  test("rejects stale Provider identity and selected profiles outside its authority", () => {
    const stale = resolutionInput();
    stale.provider.version = "1.2.1";
    expect(() => resolveIndexerPartitionStrategies(stale)).toThrow(
      /does not match its manifest/,
    );

    const unknownProfile = resolutionInput();
    unknownProfile.selected_profile_ids = ["api-service"];
    unknownProfile.local_customization.strategies = [];
    expect(() => resolveIndexerPartitionStrategies(unknownProfile)).toThrow(
      /absent from Provider authority/,
    );
  });

  test("recomputes entry, order, set, and resolution digests", () => {
    const resolution = resolveIndexerPartitionStrategies(resolutionInput());
    const forgedEntry = structuredClone(resolution);
    forgedEntry.strategies[0]!.strategy_digest = digest("9");
    rehash(forgedEntry);
    expect(() => validateIndexerPartitionStrategyResolution(forgedEntry)).toThrow(
      /strategy digest is invalid/,
    );

    const forgedOrder = structuredClone(resolution);
    forgedOrder.strategies.reverse();
    forgedOrder.strategies.forEach((strategy, order) => {
      strategy.order = order;
    });
    forgedOrder.strategy_set_digest = indexerPartitionStrategySetDigest(
      forgedOrder.strategies.map((strategy) => ({
        strategy_ref: strategy.strategy_ref,
        strategy_digest: strategy.strategy_digest,
      })),
    );
    rehash(forgedOrder);
    expect(() => validateIndexerPartitionStrategyResolution(forgedOrder)).toThrow(
      /project-first priority/,
    );

    const forgedAuthority = structuredClone(resolution);
    const provider = forgedAuthority.strategies.find((strategy) =>
      strategy.source === "provider"
    )!;
    if (provider.source !== "provider") throw new Error("invalid fixture");
    provider.authority.provider_integrity = digest("8");
    provider.strategy_digest = indexerProtocolDigest({
      strategy_ref: provider.strategy_ref,
      authority: provider.authority,
    });
    forgedAuthority.strategy_set_digest = indexerPartitionStrategySetDigest(
      forgedAuthority.strategies.map((strategy) => ({
        strategy_ref: strategy.strategy_ref,
        strategy_digest: strategy.strategy_digest,
      })),
    );
    rehash(forgedAuthority);
    expect(() => validateIndexerPartitionStrategyResolution(forgedAuthority)).toThrow(
      /inconsistent authority/,
    );
  });
});
