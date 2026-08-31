import {
  mkdir,
  mkdtemp,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  hostActionInputDigest,
  hostActionResourceReadReceipt,
  type HostActionResult,
} from "@c4a/agent-graph";
import {
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerCustomizationPlan,
  composeIndexerLayerInput,
  indexerPartitionStrategySetDigest,
  loadIndexerProviderManifest,
  type ExpectedProviderResolution,
  type IndexerRegistryEntry,
} from "@c4a/context";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import { resolveCliBundledIndexerProvider } from "../project/indexerCliBundledProvider.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import {
  buildIndexerInstructionMaterializationRequest,
  consumeIndexerInstructionHostResult,
  indexerInstructionHostLocation,
  materializeIndexerInstructionHostAction,
  materializeIndexerInstructions,
  validateMaterializedIndexerInstructions,
} from "../project/indexerInstructionMaterialization.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";
import { buildIndexerAgentStepRoute } from "../project/indexerAgentStepRoute.js";

const REQUIREMENT_DIGEST = `sha256:${"a".repeat(64)}`;
const WORKSET_DIGEST = `sha256:${"b".repeat(64)}`;
const NOW = new Date("2026-08-27T12:00:00.000Z");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const digest = (character: string) => `sha256:${character.repeat(64)}`;

async function setupDistribution(root: string) {
  const assetsRoot = join(root, "assets");
  const release = await materializeBundledIndexerDistribution({
    packageRoot: resolve(import.meta.dir, "../.."),
    outputRoot: assetsRoot,
  });
  const selected = release.bundles.find((bundle) => bundle.skill === "context-code-indexer")!;
  const expected: ExpectedProviderResolution = {
    indexerId: "sample-code-indexer",
    providerId: "community",
    skill: selected.skill,
    version: selected.version,
    integrity: selected.integrity,
    distribution: selected.distribution,
  };
  return { assetsRoot, release, selected, expected };
}

function registryEntry(input: {
  expected: ExpectedProviderResolution;
  customization?: "extend";
}): IndexerRegistryEntry {
  return {
    id: input.expected.indexerId,
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: ["technical-structure"],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: {
      primary: { id: "component-library", provider: input.expected.providerId },
      additional: [],
      composers: [],
    },
    providers: [{
      id: input.expected.providerId,
      role: "primary",
      skill: input.expected.skill,
      version: input.expected.version,
      integrity: input.expected.integrity,
      distribution: input.expected.distribution,
    }],
    ...(input.customization === undefined
      ? {}
      : { customization: { mode: input.customization } }),
  };
}

async function resolveAndStage(input: {
  root: string;
  assetsRoot: string;
  releaseVersion: string;
  expected: ExpectedProviderResolution;
  now?: Date;
}) {
  const bundle = await resolveCliBundledIndexerProvider({
    assetsRoot: input.assetsRoot,
    expectedPackageVersion: input.releaseVersion,
    expected: input.expected,
    transportRoot: join(input.root, "transport"),
    now: input.now ?? NOW,
  });
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected: input.expected,
    runtimeRoot: join(input.root, "runtime"),
    now: input.now ?? NOW,
  });
  return { bundle, staged };
}

async function buildRequest(input: {
  root: string;
  expected: ExpectedProviderResolution;
  bundle: Awaited<ReturnType<typeof resolveCliBundledIndexerProvider>>;
  staged: Awaited<ReturnType<typeof stageIndexerProviderBundle>>;
  customization?: "extend";
  requirementSetDigest?: string;
  worksetDigest?: string;
  composerId?: string;
}) {
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  const customization = await loadIndexerCustomization({
    workspaceRoot: input.root,
    projectRef: "project:sample",
    indexer: registryEntry({
      expected: input.expected,
      ...(input.customization === undefined ? {} : { customization: input.customization }),
    }),
    manifest,
    providerIntegrity: input.expected.integrity,
    ...(input.customization === undefined
      ? {}
      : {
          customizationPlan: buildIndexerCustomizationPlan({
            project_ref: "project:sample",
            indexer_id: input.expected.indexerId,
            provider_integrity: input.expected.integrity,
            capability_gap_digest: `sha256:${"c".repeat(64)}`,
            selected_step: "instructions-append",
            rejected_smaller_steps: ["provider-only", "config"].map((step, index) => ({
              step: step as "provider-only" | "config",
              disposition: "insufficient" as const,
              reason_code: `${step}-insufficient`,
              evidence_digest: `sha256:${String(index + 1).repeat(64)}`,
            })),
            affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
            introduces_external_dependencies: false,
          }),
        }),
  });
  const request = await buildIndexerInstructionMaterializationRequest({
    bundle: input.bundle,
    staged: input.staged,
    customization,
    indexerId: input.expected.indexerId,
    providerId: input.expected.providerId,
    requirementSetDigest: input.requirementSetDigest ?? REQUIREMENT_DIGEST,
    worksetRef: "main-workset:sample",
    worksetDigest: input.worksetDigest ?? WORKSET_DIGEST,
    profile: "component-library",
    ...(input.composerId === undefined ? {} : { composerId: input.composerId }),
  });
  return { request, customization };
}

function materializationAuthority(
  request: Awaited<ReturnType<typeof buildRequest>>["request"],
) {
  return {
    resource_id: request.resource_id,
    indexer_id: request.indexer_id,
    provider_id: request.provider_id,
    requirement_set_digest: request.requirement_set_digest,
    workset_ref: request.workset_ref,
    workset_digest: request.workset_digest,
    instruction_set_digest: request.instruction_set_digest,
  };
}

function mainRunRequest(providerIntegrity: string) {
  const strategy = {
    strategy_ref: {
      kind: "project-indexer" as const,
      indexer_id: "sample-code-indexer",
      strategy_id: "module",
      implementation_digest: digest("1"),
    },
    strategy_digest: digest("2"),
  };
  const primaryExecutionProjection = buildIndexerPrimaryExecutionProjection({
    indexer_id: "sample-code-indexer",
    primary_registry_projection_digest: digest("3"),
    program_digest: null,
    instructions_digest: providerIntegrity,
    template_set_digest: digest("4"),
    config_digest: digest("d"),
    cli_contract_digest: digest("e"),
    profile_contract_digest: digest("5"),
    resources: [{
      layer_ref: "provider:community#layer:primary",
      phase: "primary",
      kind: "instructions",
      ref: "bundle:community/instructions/main.md",
      digest: providerIntegrity,
    }],
  });
  const workset = buildIndexerMainWorkset({
    indexer_id: "sample-code-indexer",
    requirement_ref: "requirement:workspace-knowledge",
    owner_cell_refs: ["owner-cell:workspace-knowledge#technical-structure"],
    source_ref: "repo:sample@revision",
    module_ref: "module:packages/sample",
    primary_registry_projection_digest: digest("3"),
    requirement_set_digest: REQUIREMENT_DIGEST,
    primary_execution_fingerprint:
      primaryExecutionProjection.primary_execution_fingerprint,
    profile_contract_digest: digest("5"),
    subject_key_schema_digest: digest("6"),
    source_scope_digest: digest("7"),
    parser_contract_digest: digest("8"),
    primary_resource_binding_digest:
      primaryExecutionProjection.primary_resource_binding_digest,
    question_target_inventory_digest: digest("0"),
    stage: "partition",
    partition_subject_key: {
      protocol: "context.subject-key/v1",
      namespace: "sample",
      kind: "module",
      local_key: "root",
    },
    strategy_set_digest: indexerPartitionStrategySetDigest([strategy]),
    reader_question_refs: [],
    partition_input_digests: [digest("a")],
    partition_inventory_digest: digest("b"),
    allowed_question_target_refs: [],
  });
  return buildIndexerMainRunRequest({
    workset,
    partition_strategy_attempt: {
      strategy_order: 0,
      strategy_ref: strategy.strategy_ref,
      strategy_digest: strategy.strategy_digest,
      previous_attempt_digest: null,
    },
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: "provider:community#layer:primary",
      fragments: [],
    }),
    final_authority: {
      layer_ref: "provider:community#layer:primary",
      integrity: providerIntegrity,
      bundle_digest: digest("c"),
      config_fingerprint: digest("d"),
      customization_fingerprint: null,
    },
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("1"),
      parser_dependency_fingerprint: digest("2"),
      source_role: "authoritative-source",
      source_precedence_digest: digest("3"),
      metric_set_digest: digest("4"),
      dependency_view_digest: null,
      primary_execution_projection: primaryExecutionProjection,
    }),
  });
}

describe("resolved-indexer-instructions materialization", () => {
  test("binds exact Provider, requirement, workset, resource set, payload, and Context receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-instructions-"));
    const distribution = await setupDistribution(root);
    const { bundle, staged } = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const { request, customization } = await buildRequest({
      root,
      expected: distribution.expected,
      bundle,
      staged,
    });
    const result = await materializeIndexerInstructions({
      request,
      currentAuthority: materializationAuthority(request),
      bundle,
      staged,
      customization,
      workspaceRoot: root,
    });

    expect(request.handler).toBe("context.materialize-indexer-instructions/v1");
    expect(request.resource_id).toBe("resolved-indexer-instructions");
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.kind).toBe("provider");
    expect(result.resources[0]?.content).toContain("For partition work");
    expect(JSON.stringify(result)).not.toContain(staged.stage_path);
    expect(JSON.stringify(result)).not.toContain(bundle.transport.path);
    validateMaterializedIndexerInstructions(result, request);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("adds only the selected composer instruction to a post-author request", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-composer-instructions-"));
    const distribution = await setupDistribution(root);
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({
      root,
      expected: distribution.expected,
      ...resolved,
      composerId: "public-contract",
    });
    const result = await materializeIndexerInstructions({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    });
    expect(input.request.composer_id).toBe("public-contract");
    expect(result.resources.map((resource) => resource.kind)).toEqual([
      "provider",
      "composer",
    ]);
    expect(result.resources[1]?.content).toContain("Public contract composer");
    expect(result.resources[1]?.content).toContain("fragments: []");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("keeps semantic request/payload stable across transports while receipts remain delivery-specific", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-instruction-stability-"));
    const distribution = await setupDistribution(root);
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const first = await resolveAndStage({
      root: firstRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
      now: NOW,
    });
    const second = await resolveAndStage({
      root: secondRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
      now: new Date(NOW.getTime() + 1_000),
    });
    const firstInput = await buildRequest({ root: firstRoot, expected: distribution.expected, ...first });
    const secondInput = await buildRequest({ root: secondRoot, expected: distribution.expected, ...second });
    const firstResult = await materializeIndexerInstructions({
      request: firstInput.request,
      currentAuthority: materializationAuthority(firstInput.request),
      ...first,
      customization: firstInput.customization,
      workspaceRoot: firstRoot,
    });
    const secondResult = await materializeIndexerInstructions({
      request: secondInput.request,
      currentAuthority: materializationAuthority(secondInput.request),
      ...second,
      customization: secondInput.customization,
      workspaceRoot: secondRoot,
    });

    expect(secondInput.request.request_digest).toBe(firstInput.request.request_digest);
    expect(secondResult.payload_digest).toBe(firstResult.payload_digest);
    expect(secondResult.context_receipt.staged_receipt_digest)
      .not.toBe(firstResult.context_receipt.staged_receipt_digest);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("appends only the declared local instructions and changes the resource-set identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-instruction-custom-"));
    const distribution = await setupDistribution(root);
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const before = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const localRoot = join(root, "src", "indexer", distribution.expected.indexerId);
    await mkdir(localRoot, { recursive: true });
    await writeFile(join(localRoot, "instructions.md"), [
      "<!-- @context-indexer-origin context-code-indexer@1.0.0 profile=component-library -->",
      "Require public examples to use stable source refs.",
      "",
    ].join("\n"));
    const after = await buildRequest({
      root,
      expected: distribution.expected,
      ...resolved,
      customization: "extend",
    });
    const result = await materializeIndexerInstructions({
      request: after.request,
      currentAuthority: materializationAuthority(after.request),
      ...resolved,
      customization: after.customization,
      workspaceRoot: root,
    });

    expect(after.request.instruction_set_digest).not.toBe(before.request.instruction_set_digest);
    expect(result.resources.map((resource) => resource.kind)).toEqual([
      "provider",
      "customization-append",
    ]);
    expect(result.resources[1]?.content).toContain("stable source refs");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects stale request, changed stage bytes, and forged output payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-instruction-invalid-"));
    const distribution = await setupDistribution(root);
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const stale = { ...input.request, workset_digest: `sha256:${"c".repeat(64)}` };
    await expect(materializeIndexerInstructions({
      request: stale,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    })).rejects.toThrow("request digest");

    const authority = materializationAuthority(input.request);
    const staleAuthorities: Array<typeof authority> = [{
      ...authority,
      provider_id: "other-provider",
    }, {
      ...authority,
      requirement_set_digest: digest("c"),
    }, {
      ...authority,
      workset_digest: digest("c"),
    }, {
      ...authority,
      instruction_set_digest: digest("c"),
    }];
    for (const currentAuthority of staleAuthorities) {
      await expect(materializeIndexerInstructions({
        request: input.request,
        currentAuthority,
        ...resolved,
        customization: input.customization,
        workspaceRoot: root,
      })).rejects.toThrow(/stale for current authority/);
    }

    await writeFile(join(resolved.staged.stage_path, "references", "indexer.md"), "tampered\n");
    await expect(materializeIndexerInstructions({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    })).rejects.toThrow("staged Provider changed");

    const freshRoot = await mkdtemp(join(tmpdir(), "context-indexer-instruction-forged-"));
    const fresh = await resolveAndStage({
      root: freshRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const freshInput = await buildRequest({ root: freshRoot, expected: distribution.expected, ...fresh });
    const result = await materializeIndexerInstructions({
      request: freshInput.request,
      currentAuthority: materializationAuthority(freshInput.request),
      ...fresh,
      customization: freshInput.customization,
      workspaceRoot: freshRoot,
    });
    const forged = structuredClone(result);
    forged.resources[0]!.content += "forged";
    expect(() => validateMaterializedIndexerInstructions(forged, freshInput.request))
      .toThrow("payload digest");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("round-trips inline and managed instruction output through the Host-action ABI", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-instruction-host-"));
    const distribution = await setupDistribution(root);
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const location = indexerInstructionHostLocation(input.request);
    const inline = await materializeIndexerInstructionHostAction({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
      adapter: "context-cli",
      adapterVersion: "0.7.0",
    });
    expect(inline.result.input_digest).toBe(hostActionInputDigest(location));
    expect((await consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: inline.result,
    })).materialized).toEqual(inline.materialized);

    const managedDigest = digest("e");
    const managedResult: HostActionResult = {
      ...inline.result,
      output: {
        schema: location.materialize.output_schema,
        resource: {
          ref: "host-resource://context/indexer/instructions",
          digest: managedDigest,
        },
      },
    };
    expect((await consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: managedResult,
      managed_output: {
        ref: "host-resource://context/indexer/instructions",
        digest: managedDigest,
        value: inline.materialized,
      },
    })).materialized).toEqual(inline.materialized);
    await expect(consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: { ...inline.result, input_digest: digest("0") },
    })).rejects.toThrow();
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("projects the static thin Agent Action with a runtime-bound instruction Resource", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-agent-route-"));
    const distribution = await setupDistribution(root);
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const runRequest = mainRunRequest(distribution.expected.integrity);
    const input = await buildRequest({
      root,
      expected: distribution.expected,
      ...resolved,
      requirementSetDigest: runRequest.workset.requirement_set_digest,
      worksetDigest: runRequest.workset.workset_digest,
    });
    const host = await materializeIndexerInstructionHostAction({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
      adapter: "context-cli",
      adapterVersion: "0.7.0",
    });
    const initial = await buildIndexerAgentStepRoute({
      run_request: runRequest,
      instruction_request: input.request,
      workspaceRoot: root,
    });
    expect(initial.route.action).toMatchObject({
      id: "run-indexer-agent-step",
      runner: "agent",
      input: initial.step_input,
    });
    expect(initial.route.action?.skill?.path).toContain(
      "context-workflow/skills/run-indexer-agent-step/SKILL.md",
    );
    const instructions = initial.route.resources.required.find((resource) =>
      resource.id === "resolved-indexer-instructions"
    );
    expect(instructions).toMatchObject({
      read_state: "read-required",
      materialize: {
        handler: "context.materialize-indexer-instructions/v1",
        input: { value: input.request },
        output_schema: "context.indexer.materialized-resource/v1",
      },
    });
    expect(JSON.stringify(initial.route)).not.toContain("__runtime__");
    expect(JSON.stringify(initial.route)).not.toContain(resolved.staged.stage_path);

    const receipt = await hostActionResourceReadReceipt(
      initial.instruction_location,
      host.result,
    );
    const resumed = await buildIndexerAgentStepRoute({
      run_request: runRequest,
      instruction_request: input.request,
      workspaceRoot: root,
      resource_receipts: {
        schema: "agent-graph.resource-read-receipts.v1",
        provider: "c4a/context",
        receipts: [receipt],
      },
    });
    expect(resumed.stable_fingerprint).toBe(initial.stable_fingerprint);
    expect(resumed.route.resources.required.find((resource) =>
      resource.id === "resolved-indexer-instructions"
    )?.read_state).toBe("current");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);
});
