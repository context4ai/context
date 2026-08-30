import { describe, expect, test } from "bun:test";
import {
  buildIndexerProviderRouteInput,
  buildIndexerProviderRouteReport,
  canonicalOwnerCellRef,
  validateIndexerCapabilityGapProof,
  validateIndexerProviderRouteInput,
  validateIndexerProviderRouteReport,
  type IndexerRegistry,
  type IndexerRegistryEntry,
} from "../index.js";

const INTEGRITY_A = `sha256:${"a".repeat(64)}`;
const INTEGRITY_B = `sha256:${"b".repeat(64)}`;

function requirement() {
  return {
    id: "workspace-knowledge",
    reader_goals: ["understand-system"],
    coverage_domains: {
      architecture: "required" as const,
      public_contract: "required" as const,
    },
    target_scope: {
      targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
    },
    evidence_source_scope: {
      targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
    },
  };
}

function indexer(input: {
  id: string;
  domain: "architecture" | "public_contract";
  providerId: string;
  skill: string;
  integrity: string;
}): IndexerRegistryEntry {
  return {
    id: input.id,
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: [input.domain],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: {
      primary: { id: "domain-service", provider: input.providerId },
    },
    providers: [{
      id: input.providerId,
      role: "primary",
      skill: input.skill,
      version: "1.0.0",
      integrity: input.integrity,
      distribution: {
        kind: "workspace",
        locator: `workspace://skills/${input.skill}`,
      },
    }],
  };
}

function registry(indexers: IndexerRegistryEntry[]): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [requirement()],
    indexers,
  };
}

function routeInput(indexers: IndexerRegistryEntry[], fallback = false) {
  return buildIndexerProviderRouteInput({
    project_ref: "project:routing",
    registry: registry(indexers),
    visible_skills: [
      { skill: "context-code-indexer-internal", version: "1.0.0", source_type: "installed-plugin" },
      { skill: "context-code-indexer", version: "0.7.0", source_type: "cli-bundled" },
    ],
    community_fallback_attempted: fallback,
  });
}

describe("Indexer Provider composition Route", () => {
  test("accepts a closed multi-Skill composition and treats read overlap as informational", () => {
    const input = routeInput([
      indexer({
        id: "architecture-indexer",
        domain: "architecture",
        providerId: "community",
        skill: "context-code-indexer",
        integrity: INTEGRITY_A,
      }),
      indexer({
        id: "contract-indexer",
        domain: "public_contract",
        providerId: "internal",
        skill: "context-code-indexer-internal",
        integrity: INTEGRITY_B,
      }),
    ]);
    const report = buildIndexerProviderRouteReport(input);

    expect(report.route).toEqual({
      outcome: "selection-validation-required",
      graph_outcome: "completed",
      next_action: "validate-indexer-selection-proposal",
    });
    expect(report.composition_mode).toBe("multi-skill");
    expect(report.conflicting_owner_cells).toEqual([]);
    expect(report.capability_gaps).toEqual([]);
    expect(report.read_scope_overlaps).toEqual([{
      left_indexer_id: "architecture-indexer",
      right_indexer_id: "contract-indexer",
      scope_refs: ["requirement:workspace-knowledge#target_scope"],
    }]);
    expect(report.selection_proposal_input?.registry).toEqual(input.registry);
    expect(validateIndexerProviderRouteReport({ route_input: input, report })).toEqual(report);
  });

  test("routes an initial no-match through community fallback before declaring a gap", () => {
    const first = buildIndexerProviderRouteReport(routeInput([], false));
    expect(first.route).toEqual({
      outcome: "community-fallback-required",
      graph_outcome: "partial",
      next_action: "configure-community-indexer-fallback",
    });
    expect(first.capability_gaps.map((gap) => gap.capability)).toEqual([
      "coverage-domain:architecture",
      "coverage-domain:public_contract",
    ]);
    expect(first.capability_gap_proof).toBeNull();

    const exhausted = buildIndexerProviderRouteReport(routeInput([], true));
    expect(exhausted.route).toEqual({
      outcome: "indexer-customization-required",
      graph_outcome: "blocked",
      next_action: "propose-indexer-customization",
    });
    expect(exhausted.selection_proposal_input).toBeNull();
    expect(exhausted.capability_gap_proof).toMatchObject({
      protocol: "context.indexer.capability-gap-proof/v1",
      community_fallback_attempted: true,
      gaps: exhausted.capability_gaps,
    });
    expect(validateIndexerCapabilityGapProof({
      route_input: routeInput([], true),
      report: exhausted,
    }).gap_digest).toBe(exhausted.capability_gap_proof!.gap_digest);
  });

  test("routes duplicate primary ownership to explicit conflict resolution", () => {
    const architectureA = indexer({
      id: "architecture-a",
      domain: "architecture",
      providerId: "community",
      skill: "context-code-indexer",
      integrity: INTEGRITY_A,
    });
    const architectureB = indexer({
      id: "architecture-b",
      domain: "architecture",
      providerId: "internal",
      skill: "context-code-indexer-internal",
      integrity: INTEGRITY_B,
    });
    const contract = indexer({
      id: "contract-indexer",
      domain: "public_contract",
      providerId: "community",
      skill: "context-code-indexer",
      integrity: INTEGRITY_A,
    });
    const report = buildIndexerProviderRouteReport(
      routeInput([architectureA, architectureB, contract]),
    );
    expect(report.route.outcome).toBe("indexer-provider-conflict");
    expect(report.route.graph_outcome).toBe("waiting-user");
    expect(report.conflicting_owner_cells).toEqual([{
      owner_cell_ref: canonicalOwnerCellRef({
        requirementRef: "workspace-knowledge",
        coverageDomain: "architecture",
        sourceRef: "repo:sample",
        moduleRef: "module:app",
      }),
      indexer_ids: ["architecture-a", "architecture-b"],
      skill_ids: ["context-code-indexer", "context-code-indexer-internal"],
    }]);
  });

  test("rejects non-canonical discovery order and stale report content", () => {
    const input = routeInput([], false);
    const reordered = structuredClone(input);
    reordered.visible_skills.reverse();
    expect(() => validateIndexerProviderRouteInput(reordered)).toThrow(/non-canonical/);

    const report = buildIndexerProviderRouteReport(input);
    const forged = structuredClone(report);
    forged.community_fallback_attempted = true;
    expect(() => validateIndexerProviderRouteReport({
      route_input: input,
      report: forged,
    })).toThrow(/stale or invalid/);
  });
});
