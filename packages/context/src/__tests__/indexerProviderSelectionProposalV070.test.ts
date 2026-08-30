import { describe, expect, test } from "bun:test";
import {
  buildIndexerProviderSelectionProposal,
  validateIndexerProviderSelectionProposal,
  type IndexerRegistry,
} from "../index.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;

function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "service-understanding",
      reader_goals: ["understand"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:20260827/service", module_refs: [] }],
      },
    }],
    indexers: [{
      id: "service-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "service-understanding",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:service-understanding#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:service-understanding#target_scope"] },
      profile: {
        primary: { id: "service", provider: "community" },
      },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: INTEGRITY,
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

describe("0.7.0 Indexer Provider selection proposal", () => {
  test("binds a finalized owner selection to the exact requirement digest", () => {
    const proposal = buildIndexerProviderSelectionProposal({
      protocol: "context.indexer.selection-proposal-input/v1",
      project_ref: "project:sample",
      registry: registry(),
    });
    expect(proposal.requirement_set_digest).toStartWith("sha256:");
    expect(proposal.indexer_selection_digest).toStartWith("sha256:");
    expect(validateIndexerProviderSelectionProposal(proposal)).toEqual(proposal);
  });

  test("rejects missing owner closure and a tampered proposal", () => {
    const missingOwner = registry();
    missingOwner.indexers = [];
    expect(() => buildIndexerProviderSelectionProposal({
      protocol: "context.indexer.selection-proposal-input/v1",
      project_ref: "project:sample",
      registry: missingOwner,
    })).toThrow(/no primary Indexer/);

    const proposal = buildIndexerProviderSelectionProposal({
      protocol: "context.indexer.selection-proposal-input/v1",
      project_ref: "project:sample",
      registry: registry(),
    });
    expect(() => validateIndexerProviderSelectionProposal({
      ...proposal,
      project_ref: "project:other",
    })).toThrow(/stale or invalid/);
  });
});
