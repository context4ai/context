import { afterEach, describe, expect, test } from "bun:test";
import { buildIndexerBenchmarkManifest } from "@c4a/context";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportProjectIndexerBenchmark } from "../project/indexerBenchmarkActions.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

function manifest() {
  return buildIndexerBenchmarkManifest({
    protocol: "context.indexer.benchmark-manifest/v1",
    workload_id: "anonymous-forward-run",
    source_snapshots: [{
      source_ref: "repo:anonymous@revision",
      commit_or_tree_digest: digest("1"),
      scope_digest: digest("2"),
    }],
    requirement_digest: digest("3"),
    registry_digest: digest("4"),
    toolchain: {
      context_cli: "0.7.0",
      contract_digest: digest("5"),
      parser_set_digest: digest("6"),
    },
    capture_command_digest: digest("7"),
    oracle_ref: "oracle:anonymous-forward-v1",
  });
}

function currentAuthority() {
  const value = manifest();
  return {
    source_snapshots: value.source_snapshots,
    requirement_digest: value.requirement_digest,
    registry_digest: value.registry_digest,
    toolchain: value.toolchain,
    capture_command_digest: value.capture_command_digest,
    mounted_agent_resource_refs: [],
  };
}

function observation() {
  return {
    result_fingerprint: digest("8"),
    profile_composer_summary: [{
      module_ref: "module:anonymous",
      primary_profile_ref: "profile:application",
      additional_profile_refs: [],
      composer_refs: [],
    }],
    inventory_items: [{
      inventory_ref: "inventory:projects",
      item_ref: "project:anonymous",
      disposition: "owned" as const,
    }],
    artifacts: [{
      logical_unit_ref: "node:anonymous",
      bundle_digest: digest("9"),
      artifact_ref: "artifact:overview",
      purpose: "required" as const,
      split_of: null,
      readability_advisory: false,
    }],
    directory_differences: [],
    page_deviation: {
      expected_min: null,
      expected_max: null,
      actual_count: 1,
      reason_codes: [],
    },
    quality_negative_samples: [],
    review_decision: {
      report_ref: "review:anonymous",
      decision: "approved" as const,
    },
    material_gaps: [],
    provider_configuration: [{
      module_ref: "module:anonymous",
      indexer_ref: "indexer:anonymous",
      provider_identity: "provider:community",
      provider_version: "0.7.0",
      provider_integrity: digest("a"),
      config_fingerprint: digest("b"),
      customization_reason: null,
    }],
    local_customization_burden: {
      file_count: 0,
      covered_resource_refs: [],
      affected_artifact_refs: [],
      repeated_logic_candidate: false,
    },
    metrics: [{
      metric_id: "inventory-closure",
      numerator: 1,
      denominator: 1,
      status: "passed" as const,
      evidence_refs: ["inventory:projects"],
    }],
  };
}

async function workspaceFixture() {
  const container = await mkdtemp(join(tmpdir(), "context-benchmark-v070-"));
  roots.push(container);
  const projectRoot = join(container, "agent-workspace");
  const oraclePath = join(container, "evaluator", "oracle.json");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(join(container, "evaluator"), { recursive: true });
  await writeFile(oraclePath, "{}\n", "utf8");
  return { projectRoot, oraclePath };
}

const oracleEvaluation = {
  oracle_ref: "oracle:anonymous-forward-v1",
  differences: [],
};

const override = { state: "none" as const, approval_ref: null, reason: null };

describe("project Indexer benchmark report", () => {
  test("loads the post-run oracle outside the Agent workspace and emits a current report", async () => {
    const workspace = await workspaceFixture();
    const report = await reportProjectIndexerBenchmark({
      ...workspace,
      manifest: manifest(),
      currentAuthority: currentAuthority(),
      observation: observation(),
      oracleEvaluation,
      override,
    });
    expect(report).toMatchObject({
      protocol: "context.indexer.benchmark-report/v1",
      workload_id: "anonymous-forward-run",
      inventory_summary: { total_count: 1 },
      artifact_summary: { artifact_count: 1 },
      page_deviation: { state: "not-estimated" },
      conformance: "automatic-pass",
    });
  });

  test("rejects an oracle file physically mounted inside the Agent workspace", async () => {
    const workspace = await workspaceFixture();
    const inside = join(workspace.projectRoot, "oracle.json");
    await writeFile(inside, "{}\n", "utf8");
    expect(reportProjectIndexerBenchmark({
      projectRoot: workspace.projectRoot,
      oraclePath: inside,
      manifest: manifest(),
      currentAuthority: currentAuthority(),
      observation: observation(),
      oracleEvaluation,
      override,
    })).rejects.toThrow(/outside the execution Agent workspace/);
  });
});
