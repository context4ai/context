import { describe, expect, test } from "bun:test";
import {
  buildIndexerBenchmarkManifest,
  buildIndexerBenchmarkReport,
  validateCurrentIndexerBenchmarkManifest,
  validateCurrentIndexerBenchmarkReport,
  validateIndexerBenchmarkManifest,
  validateIndexerBenchmarkReport,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function manifest() {
  return buildIndexerBenchmarkManifest({
    protocol: "context.indexer.benchmark-manifest/v1",
    workload_id: "anonymous-web-workload",
    source_snapshots: [{
      source_ref: "repo:anonymous-web@revision",
      commit_or_tree_digest: digest("1"),
      scope_digest: digest("2"),
    }, {
      source_ref: "repo:anonymous-service@revision",
      commit_or_tree_digest: digest("3"),
      scope_digest: digest("4"),
    }].reverse(),
    requirement_digest: digest("5"),
    registry_digest: digest("6"),
    toolchain: {
      context_cli: "0.7.0",
      contract_digest: digest("7"),
      parser_set_digest: digest("8"),
    },
    capture_command_digest: digest("9"),
    oracle_ref: "oracle:anonymous-web-v1",
  });
}

function currentAuthority(mounted: string[] = []) {
  const current = manifest();
  return {
    source_snapshots: [...current.source_snapshots].reverse(),
    requirement_digest: current.requirement_digest,
    registry_digest: current.registry_digest,
    toolchain: current.toolchain,
    capture_command_digest: current.capture_command_digest,
    mounted_agent_resource_refs: mounted,
  };
}

function observation() {
  return {
    result_fingerprint: digest("a"),
    profile_composer_summary: [{
      module_ref: "module:anonymous-web",
      primary_profile_ref: "profile:web-application",
      additional_profile_refs: ["profile:gateway", "profile:api-client"].reverse(),
      composer_refs: ["composer:cross-module-chain"],
    }],
    inventory_items: [{
      inventory_ref: "inventory:projects",
      item_ref: "project:web",
      disposition: "owned" as const,
    }, {
      inventory_ref: "inventory:projects",
      item_ref: "project:service",
      disposition: "request-material" as const,
    }].reverse(),
    artifacts: [{
      logical_unit_ref: "node:web-application",
      bundle_digest: digest("b"),
      artifact_ref: "artifact:web-overview",
      purpose: "required" as const,
      split_of: null,
      readability_advisory: false,
    }, {
      logical_unit_ref: "node:web-application",
      bundle_digest: digest("b"),
      artifact_ref: "artifact:web-overview-continuation",
      purpose: "semantic-split" as const,
      split_of: "artifact:web-overview",
      readability_advisory: true,
    }, {
      logical_unit_ref: "node:service",
      bundle_digest: digest("c"),
      artifact_ref: "artifact:service-overview",
      purpose: "required" as const,
      split_of: null,
      readability_advisory: false,
    }].reverse(),
    directory_differences: [{
      difference_ref: "difference:relocated-service",
      kind: "relocated" as const,
      expected_path: "knowledge/codeindex/service.md",
      actual_path: "knowledge/codeindex/service/overview.md",
      reason_code: "semantic-bundle-layout",
    }],
    page_deviation: {
      expected_min: 1,
      expected_max: 2,
      actual_count: 3,
      reason_codes: ["source-inventory-growth"],
    },
    quality_negative_samples: [{
      category: "placeholder" as const,
      sample_ref: "sample:placeholder-cleared",
      disposition: "cleared" as const,
    }],
    review_decision: {
      report_ref: "review:anonymous-web",
      decision: "approved" as const,
    },
    material_gaps: [{
      category: "runtime-platform",
      required_evidence_kinds: ["runbook"],
      resolved_count: 1,
      unresolved_question_refs: [],
    }],
    provider_configuration: [{
      module_ref: "module:anonymous-web",
      indexer_ref: "indexer:web",
      provider_identity: "provider:community",
      provider_version: "0.7.0",
      provider_integrity: digest("d"),
      config_fingerprint: digest("e"),
      customization_reason: null,
    }],
    local_customization_burden: {
      file_count: 0,
      covered_resource_refs: [],
      affected_artifact_refs: [],
      repeated_logic_candidate: false,
    },
    metrics: [{
      metric_id: "inventory-disposition-coverage",
      numerator: 2,
      denominator: 2,
      status: "passed" as const,
      evidence_refs: ["inventory:projects"],
    }],
  };
}

function oracle() {
  return {
    oracle_ref: "oracle:anonymous-web-v1",
    differences: [],
  };
}

const noOverride = {
  state: "none" as const,
  approval_ref: null,
  reason: null,
};

describe("Indexer benchmark manifest and report", () => {
  test("canonicalizes the manifest and rejects stale or Agent-mounted oracle authority", () => {
    const value = manifest();
    expect(validateIndexerBenchmarkManifest(value)).toEqual(value);
    expect(validateCurrentIndexerBenchmarkManifest({
      value,
      current_authority: currentAuthority(),
    })).toEqual(value);

    expect(() => validateCurrentIndexerBenchmarkManifest({
      value,
      current_authority: {
        ...currentAuthority(),
        registry_digest: digest("f"),
      },
    })).toThrow(/authority is stale/);
    expect(() => validateCurrentIndexerBenchmarkManifest({
      value,
      current_authority: currentAuthority([value.oracle_ref]),
    })).toThrow(/must not be mounted/);
  });

  test("closes all ten forward-report fields without treating page estimates as a hard gate", () => {
    const value = buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: observation(),
      oracle_evaluation: oracle(),
      override: noOverride,
    });
    expect(validateIndexerBenchmarkReport(value)).toEqual(value);
    expect(validateCurrentIndexerBenchmarkReport({
      value,
      manifest: manifest(),
      observation: observation(),
      oracle_evaluation: oracle(),
      override: noOverride,
    })).toEqual(value);
    expect(value).toMatchObject({
      profile_composer_summary: [{
        primary_profile_ref: "profile:web-application",
        additional_profile_refs: ["profile:api-client", "profile:gateway"],
      }],
      inventory_summary: {
        total_count: 2,
        inventories: [{
          total_count: 2,
          dispositions: { owned: 1, request_material: 1 },
        }],
      },
      artifact_summary: {
        logical_unit_count: 2,
        bundle_count: 2,
        artifact_count: 3,
        semantic_split_count: 1,
        readability_advisory_count: 1,
      },
      directory_differences: [{ reason_code: "semantic-bundle-layout" }],
      page_deviation: { state: "above", reason_codes: ["source-inventory-growth"] },
      quality_negative_samples: [{ disposition: "cleared" }],
      review_decision: { decision: "approved" },
      material_gaps: [{ resolved_count: 1, unresolved_question_refs: [] }],
      provider_configuration: [{ customization_reason: null }],
      local_customization_burden: { file_count: 0, repeated_logic_candidate: false },
      metric_results: [{ observed_value: 1, status: "passed" }],
      override_state: "none",
      conformance: "automatic-pass",
    });
  });

  test("marks quality blockers nonconformant and never turns a human override into auto-pass", () => {
    const current = observation();
    const blocked = {
      ...current,
      quality_negative_samples: [{
        ...current.quality_negative_samples[0]!,
        disposition: "blocking" as const,
      }],
    };
    expect(buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: blocked,
      oracle_evaluation: oracle(),
      override: noOverride,
    }).conformance).toBe("nonconformant");

    const exempt = buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: blocked,
      oracle_evaluation: oracle(),
      override: {
        state: "human-approved",
        approval_ref: "approval:benchmark-exception",
        reason: "The forward run is retained for explicit diagnostic comparison.",
      },
    });
    expect(exempt).toMatchObject({
      override_state: "human-approved",
      conformance: "human-exempt",
    });
    expect(() => buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: blocked,
      oracle_evaluation: oracle(),
      override: { state: "human-approved", approval_ref: null, reason: null },
    })).toThrow(/fully authorized/);
  });

  test("rejects wrong-oracle, tampered digest, and non-recomputable report state", () => {
    expect(() => buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: observation(),
      oracle_evaluation: { ...oracle(), oracle_ref: "oracle:another" },
      override: noOverride,
    })).toThrow(/another manifest/);

    const value = buildIndexerBenchmarkReport({
      manifest: manifest(),
      observation: observation(),
      oracle_evaluation: oracle(),
      override: noOverride,
    });
    expect(() => validateIndexerBenchmarkReport({
      ...value,
      report_digest: digest("0"),
    })).toThrow(/digest is invalid/);

    const changed = observation();
    changed.inventory_items.pop();
    expect(() => validateCurrentIndexerBenchmarkReport({
      value,
      manifest: manifest(),
      observation: changed,
      oracle_evaluation: oracle(),
      override: noOverride,
    })).toThrow(/stale or cannot be recomputed/);
  });
});
