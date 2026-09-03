import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerMainWorksetSet,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  canonicalIndexerNodeRef,
  composeIndexerLayerInput,
  indexerRegistryDigests,
  indexerPartitionPlanCanonicalHash,
  indexerPartitionStrategySetDigest,
  indexerInventoryMembersDigest,
  type IndexerMainPartitionWorkset,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
  type IndexerRegistry,
} from "@c4a/context";
import YAML from "yaml";
import {
  INDEXER_MAIN_RUN_CURRENT_PATH,
  INDEXER_MAIN_RUN_STORE_ROOT,
  acceptIndexerMainRunStore,
  convergeIndexerMainPartitionRunStore,
  prepareIndexerMainRunStore,
  startIndexerMainRunStore,
} from "../project/indexerMainRunStore.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const MEMBER_REF = "member:sample";
const INVENTORY = [{ member_id: MEMBER_REF, member_kind: "project" as const }];
const TARGET_REF = "question-target:knowledge";
const STRATEGY: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "module-root",
  implementation_digest: digest("a"),
};
const SECOND_STRATEGY: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "capability-group",
  implementation_digest: digest("f"),
};
const FALLBACK_STRATEGY: IndexerPartitionStrategy = {
  kind: "cli-builtin",
  strategy_id: "catalog-fallback",
  implementation_digest: digest("d"),
};
const STRATEGIES = [{ strategy_ref: STRATEGY, strategy_digest: digest("b") }, {
  strategy_ref: SECOND_STRATEGY,
  strategy_digest: digest("c"),
}, {
  strategy_ref: FALLBACK_STRATEGY,
  strategy_digest: digest("e"),
}];

const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "sample",
  primary_registry_projection_digest: digest("1"),
  program_digest: null,
  instructions_digest: digest("e"),
  template_set_digest: digest("f"),
  config_digest: digest("0"),
  cli_contract_digest: digest("1"),
  profile_contract_digest: digest("4"),
  resources: [{
    layer_ref: "provider:sample#layer:primary",
    phase: "primary",
    kind: "instructions",
    ref: "bundle:sample/instructions/main.md",
    digest: digest("e"),
  }],
});

function workset(requirementSetDigest = digest("2")): IndexerMainPartitionWorkset {
  const value = buildIndexerMainWorkset({
    stage: "partition",
    indexer_id: "sample",
    requirement_ref: "requirement:knowledge",
    owner_cell_refs: ["owner-cell:knowledge#architecture"],
    source_ref: "repo:sample@revision",
    module_ref: "module:sample",
    primary_registry_projection_digest: digest("1"),
    requirement_set_digest: requirementSetDigest,
    primary_execution_fingerprint:
      PRIMARY_EXECUTION_PROJECTION.primary_execution_fingerprint,
    profile_contract_digest: digest("4"),
    subject_key_schema_digest: digest("5"),
    source_scope_digest: digest("6"),
    source_binding_digest: digest("7"),
    primary_resource_binding_digest:
      PRIMARY_EXECUTION_PROJECTION.primary_resource_binding_digest,
    question_target_inventory_digest: digest("9"),
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest(STRATEGIES),
    reader_question_refs: ["question:knowledge"],
    partition_input_digests: [digest("c")],
    partition_inventory_digest: indexerInventoryMembersDigest(INVENTORY),
    allowed_question_target_refs: [TARGET_REF],
  });
  if (value.stage !== "partition") throw new Error("expected partition workset");
  return value;
}

function plan(
  current: IndexerMainPartitionWorkset,
  input: {
    strategy?: IndexerPartitionStrategy;
    strategy_digest?: string;
    partition_axis?: string;
  } = {},
): IndexerPartitionPlan {
  const payload = {
    protocol: "context.indexer.partition-plan/v1" as const,
    status: "complete" as const,
    binding: {
      partition_workset_digest: current.workset_digest,
      indexer_id: current.indexer_id,
      indexer_fingerprint: current.primary_execution_fingerprint,
      requirement_digest: current.requirement_set_digest,
      subject_key_schema_digest: current.subject_key_schema_digest,
      source_scope_digest: current.source_scope_digest,
      source_refs: [current.source_ref],
      module_ref: current.module_ref,
      partition_subject_key: current.partition_subject_key,
      parent_scope_ref: current.module_ref!,
      inventory_digest: current.partition_inventory_digest,
      question_target_inventory_digest: current.question_target_inventory_digest,
    },
    strategy_ref: input.strategy ?? STRATEGY,
    strategy_digest: input.strategy_digest ?? digest("b"),
    unit_type: "module",
    partition_axis: input.partition_axis ?? "module-root",
    reader_question_refs: current.reader_question_refs,
    groups: [{
      group_key: "module:sample",
      subject_key: current.partition_subject_key,
      subject_intent: "primary" as const,
      logical_unit_ref: canonicalIndexerNodeRef(current.partition_subject_key),
      label: "Sample module",
      reader_question_refs: current.reader_question_refs,
      question_target_bindings: [{ target_ref: TARGET_REF, role: "primary-carrier" as const }],
      member_ids: [MEMBER_REF],
    }],
    member_dispositions: [{
      member_id: MEMBER_REF,
      member_kind: "project" as const,
      inventory_disposition: "owned" as const,
      group_key: "module:sample",
    }],
    failure: null,
  };
  return { ...payload, canonical_hash: indexerPartitionPlanCanonicalHash(payload) };
}

function fixture(requirementSetDigest = digest("2")) {
  const current = workset(requirementSetDigest);
  const request = buildIndexerMainRunRequest({
    workset: current,
    partition_strategy_attempt: {
      strategy_order: 0,
      strategy_ref: STRATEGY,
      strategy_digest: digest("b"),
      previous_attempt_digest: null,
    },
    composition_input: composeIndexerLayerInput({
      workset_digest: current.workset_digest,
      final_authority_layer_ref: "provider:sample#layer:primary",
      fragments: [],
    }),
    final_authority: {
      layer_ref: "provider:sample#layer:primary",
      integrity: digest("e"),
      bundle_digest: digest("f"),
      config_fingerprint: digest("0"),
      customization_fingerprint: null,
    },
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("1"),
      source_dependency_fingerprint: current.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("3"),
      metric_set_digest: digest("4"),
      dependency_view_digest: null,
      primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
    }),
  });
  const result = {
    protocol: "context.indexer.run-result/v1",
    operation: "main-index",
    consumed_input_view_digest: request.composition_input.view_digest,
    result: {
      protocol: "context.indexer.main-result/v1",
      stage: "partition",
      workset_digest: current.workset_digest,
      execution_request_digest: request.execution_request_digest,
      result: plan(current),
    },
  };
  const spec = {
    protocol: "context.indexer.main-run-spec/v1",
    request,
    validation: {
      stage: "partition",
      canonical_inventory_members: INVENTORY,
      authorized_source_refs: [current.source_ref],
      authorized_strategies: STRATEGIES,
      required_question_target_refs: [TARGET_REF],
    },
  };
  return { current, request, result, spec };
}

describe("project main Indexer runtime store", () => {
  test("atomically recovers accepted Result/receipt and never reruns a legal cached result", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-store-"));
    const current = fixture();
    const worksetSet = buildIndexerMainWorksetSet([current.current]);
    const prepared = await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    expect(prepared.status.pending_count).toBe(1);
    await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    let injected = false;
    await expect(acceptIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: current.result,
      inject_failure: (point) => {
        if (!injected && point.startsWith("after-target-rename:")) {
          injected = true;
          throw new Error("simulated accept crash");
        }
      },
    })).rejects.toThrow(/simulated accept crash/);

    const recovered = await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    expect(recovered.status).toMatchObject({
      accepted_count: 1,
      pending_count: 0,
      can_advance: true,
    });
    await expect(startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    })).rejects.toThrow(/pending or stale/);
    expect(existsSync(join(projectRoot, INDEXER_MAIN_RUN_CURRENT_PATH))).toBe(true);
    expect(await readdir(join(projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "accepted"))).toHaveLength(1);
    expect(existsSync(join(projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "ledgers"))).toBe(false);
    expect(existsSync(join(projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "results"))).toBe(false);
    expect(existsSync(join(projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "receipts"))).toBe(false);
  });

  test("does not report completion after the local accepted cache is removed", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-cache-clear-"));
    const current = fixture();
    const worksetSet = buildIndexerMainWorksetSet([current.current]);
    await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    await acceptIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: current.result,
    });
    await rm(join(projectRoot, INDEXER_MAIN_RUN_STORE_ROOT, "accepted"), {
      recursive: true,
      force: true,
    });
    const rebuilt = await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    expect(rebuilt.status).toMatchObject({
      accepted_count: 0,
      pending_count: 1,
      can_advance: false,
    });
  });

  test("durably retries the next partition strategy and accepts only the converged plan", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-converge-"));
    const current = fixture();
    const worksetSet = buildIndexerMainWorksetSet([current.current]);
    await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    const fixedCountResult = structuredClone(current.result);
    fixedCountResult.result.result = plan(current.current, {
      partition_axis: "fixed-count-1",
    });
    let injected = false;
    await expect(convergeIndexerMainPartitionRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: fixedCountResult,
      inject_failure: (point) => {
        if (!injected && point.startsWith("after-target-rename:")) {
          injected = true;
          throw new Error("simulated convergence crash");
        }
      },
    })).rejects.toThrow(/simulated convergence crash/);

    const recovered = await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: worksetSet,
      run_specs: [current.spec],
    });
    expect(recovered.status).toMatchObject({
      pending_count: 1,
      accepted_count: 0,
      failed_count: 0,
      stale_count: 0,
    });
    const next = await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    expect(next.request.partition_strategy_attempt).toMatchObject({
      strategy_order: 1,
      strategy_ref: SECOND_STRATEGY,
      strategy_digest: digest("c"),
    });
    expect(next.request.execution_request_digest).not.toBe(
      current.request.execution_request_digest,
    );
    const semanticResult = {
      ...current.result,
      result: {
        ...current.result.result,
        execution_request_digest: next.request.execution_request_digest,
        result: plan(current.current, {
          strategy: SECOND_STRATEGY,
          strategy_digest: digest("c"),
          partition_axis: "capability-group",
        }),
      },
    };
    const accepted = await convergeIndexerMainPartitionRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: semanticResult,
    });
    expect(accepted.convergence).toMatchObject({
      decision: "accepted",
      outcome: "completed",
      user_gate_required: false,
    });
    expect(accepted.convergence.attempts).toHaveLength(2);
    expect(accepted.status).toMatchObject({
      pending_count: 0,
      accepted_count: 1,
      can_advance: true,
    });
  });

  test("mechanically accepts catalog fallback after every semantic strategy is exhausted", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-fallback-"));
    const registry: IndexerRegistry = {
      protocol: "context.indexer.registry/v1",
      requirements: [{
        id: "knowledge",
        reader_goals: ["understand-system"],
        coverage_domains: { architecture: "required" },
        target_scope: {
          targets: [{ source_ref: "repo:sample", module_refs: ["module:sample"] }],
        },
        evidence_source_scope: {
          targets: [{ source_ref: "repo:sample", module_refs: ["module:sample"] }],
        },
      }],
      indexers: [],
    };
    const requirementSetDigest = indexerRegistryDigests(registry).requirementSetDigest;
    const current = fixture(requirementSetDigest);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
      name: "main-run-fallback-fixture",
      private: true,
      context: { project: true, entry: "src/index.ts" },
    }, null, 2)}\n`, "utf8");
    await writeFile(
      join(projectRoot, "src", "indexers.yaml"),
      YAML.stringify(registry),
      "utf8",
    );
    await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: buildIndexerMainWorksetSet([current.current]),
      run_specs: [current.spec],
    });
    await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    const firstResult = structuredClone(current.result);
    firstResult.result.result = plan(current.current, {
      partition_axis: "fixed-count-1",
    });
    const first = await convergeIndexerMainPartitionRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: firstResult,
    });
    expect(first.convergence.decision).toBe("retry-required");

    const secondStart = await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    const secondResult = {
      ...current.result,
      result: {
        ...current.result.result,
        execution_request_digest: secondStart.request.execution_request_digest,
        result: plan(current.current, {
          strategy: SECOND_STRATEGY,
          strategy_digest: digest("c"),
          partition_axis: "ordinal",
        }),
      },
    };
    const exhausted = await convergeIndexerMainPartitionRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: secondResult,
    });
    expect(exhausted).toMatchObject({
      convergence: {
        decision: "catalog-fallback-required",
        user_gate_required: false,
      },
      status: { pending_count: 1, accepted_count: 0 },
      next_request: {
        partition_strategy_attempt: {
          strategy_order: 2,
          strategy_ref: FALLBACK_STRATEGY,
          strategy_digest: digest("e"),
        },
      },
    });
    const fallbackStart = await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    const fallbackPath = join(projectRoot, "fallback.json");
    await writeFile(fallbackPath, `${JSON.stringify({
      protocol: "context.indexer.catalog-fallback-build-input/v1",
      requirement_set_digest: requirementSetDigest,
      request: fallbackStart.request,
      convergence: exhausted.convergence,
      validation: current.spec.validation,
    }, null, 2)}\n`, "utf8");
    const accepted = JSON.parse(await runCliInDir(projectRoot, [
      "indexer", "build-main-index-catalog-fallback", "--input", fallbackPath,
      "--format", "json",
    ]));
    expect(accepted).toMatchObject({
      protocol: "context.indexer.catalog-fallback-build/v1",
      outcome: "catalog-fallback-applied",
      graph_outcome: "completed",
      user_gate_required: false,
      fallback: {
        partition_plan: {
          partition_axis: "catalog-fallback",
          groups: [{
            group_key: "catalog-root",
            member_ids: [MEMBER_REF],
          }],
        },
      },
      status: { pending_count: 0, accepted_count: 1, can_advance: true },
    });
  });

  test("rejects a fallback request without a persisted exhausted convergence predecessor", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-forged-fallback-"));
    const current = fixture();
    const request = buildIndexerMainRunRequest({
      workset: current.current,
      composition_input: current.request.composition_input,
      final_authority: current.request.final_authority,
      run_environment: current.request.run_environment,
      partition_strategy_attempt: {
        strategy_order: 2,
        strategy_ref: FALLBACK_STRATEGY,
        strategy_digest: digest("e"),
        previous_attempt_digest: digest("9"),
      },
    });
    await prepareIndexerMainRunStore({
      projectRoot,
      workset_set: buildIndexerMainWorksetSet([current.current]),
      run_specs: [{
        protocol: "context.indexer.main-run-spec/v1",
        request,
        validation: current.spec.validation,
      }],
    });
    await startIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
    });
    const forgedResult = {
      ...current.result,
      result: {
        ...current.result.result,
        execution_request_digest: request.execution_request_digest,
        result: plan(current.current, {
          strategy: FALLBACK_STRATEGY,
          strategy_digest: digest("e"),
          partition_axis: "catalog-fallback",
        }),
      },
    };
    await expect(acceptIndexerMainRunStore({
      projectRoot,
      workset_digest: current.current.workset_digest,
      result: forgedResult,
    })).rejects.toThrow(/predecessor is missing/);
  });

  test("exposes prepare, start, and persisted observation through the CLI", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-main-run-cli-"));
    const registry: IndexerRegistry = {
      protocol: "context.indexer.registry/v1",
      requirements: [{
        id: "knowledge",
        reader_goals: ["understand-system"],
        coverage_domains: { architecture: "required" },
        target_scope: { targets: [{ source_ref: "repo:sample", module_refs: ["module:sample"] }] },
        evidence_source_scope: {
          targets: [{ source_ref: "repo:sample", module_refs: ["module:sample"] }],
        },
      }],
      indexers: [],
    };
    const requirementSetDigest = indexerRegistryDigests(registry).requirementSetDigest;
    const current = fixture(requirementSetDigest);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
      name: "main-run-cli-fixture",
      private: true,
      context: { project: true, entry: "src/index.ts" },
    }, null, 2)}\n`, "utf8");
    await writeFile(
      join(projectRoot, "src", "indexers.yaml"),
      YAML.stringify(registry),
      "utf8",
    );
    const preparePath = join(projectRoot, "prepare.json");
    await writeFile(preparePath, `${JSON.stringify({
      protocol: "context.indexer.main-run-ledger-prepare-input/v1",
      requirement_set_digest: requirementSetDigest,
      workset_set: buildIndexerMainWorksetSet([current.current]),
      run_specs: [current.spec],
    }, null, 2)}\n`, "utf8");
    const prepared = JSON.parse(await runCliInDir(projectRoot, [
      "indexer", "prepare-main-index-run-ledger", "--input", preparePath, "--format", "json",
    ]));
    expect(prepared.status.pending_count).toBe(1);

    const startPath = join(projectRoot, "start.json");
    await writeFile(startPath, `${JSON.stringify({
      protocol: "context.indexer.main-run-store-start-input/v1",
      requirement_set_digest: requirementSetDigest,
      workset_digest: current.current.workset_digest,
    }, null, 2)}\n`, "utf8");
    const started = JSON.parse(await runCliInDir(projectRoot, [
      "indexer", "start-main-index-run", "--input", startPath, "--format", "json",
    ]));
    expect(started.request.execution_request_digest).toBe(
      current.request.execution_request_digest,
    );

    const observePath = join(projectRoot, "observe.json");
    await writeFile(observePath, `${JSON.stringify({
      protocol: "context.indexer.main-run-ledger-observation-input/v1",
      requirement_set_digest: requirementSetDigest,
    }, null, 2)}\n`, "utf8");
    const observed = JSON.parse(await runCliInDir(projectRoot, [
      "indexer", "observe-main-index-run-ledger", "--input", observePath, "--format", "json",
    ]));
    expect(observed).toMatchObject({ pending_count: 1, accepted_count: 0 });

    const convergencePath = join(projectRoot, "converge.json");
    await writeFile(convergencePath, `${JSON.stringify({
      protocol: "context.indexer.main-run-partition-convergence-input/v1",
      requirement_set_digest: requirementSetDigest,
      workset_digest: current.current.workset_digest,
      result: current.result,
    }, null, 2)}\n`, "utf8");
    const converged = JSON.parse(await runCliInDir(projectRoot, [
      "indexer", "converge-main-index-partition-run", "--input", convergencePath,
      "--format", "json",
    ]));
    expect(converged).toMatchObject({
      outcome: "accepted",
      graph_outcome: "completed",
      status: { pending_count: 0, accepted_count: 1 },
      convergence: { user_gate_required: false },
    });
  });
});
