import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildIndexerDependencyIntentSet,
  buildIndexerProjectProposal,
  buildIndexerProviderSelectionProposal,
  buildIndexerCustomizationPlan,
  buildIndexerFixedDependencySet,
  deriveIndexerProgramExecutionPolicy,
  indexerProtocolDigest,
  indexerProjectContentDigest,
  indexerRegistryDigests,
  indexerProviderBundleIntegrity,
  loadIndexerProviderManifest,
  parseIndexerRegistry,
  resolvedProviderReceiptDigest,
  type IndexerJson,
  type IndexerRegistry,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { buildIndexerProjectConfirmationRoute } from "../project/indexerProjectGateRoute.js";
import { buildIndexerProgramExecutionAuthorizationRoute } from
  "../project/indexerProgramExecutionAuthorizationRoute.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";
import {
  buildIndexerProgramExecutionAuthorizationInput,
  buildProjectIndexerProgramExecutionAuthorizationReport,
  buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace,
} from "../project/indexerProgramExecutionAuthorization.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import {
  validateIndexerSelectionFinal,
  validateIndexerSelectionStatic,
  type IndexerResolvedSelectionInput,
} from "../project/indexerSelectionValidation.js";
import { persistCurrentIndexerProviderSetup } from
  "../project/indexerCurrentProviderState.js";
import {
  buildCurrentIndexerProviderContinuationRoute,
  completeCurrentIndexerProviderProgramAuthorization,
} from "../project/indexerCurrentProviderContinuation.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const POLICY_DIGEST = `sha256:${"d".repeat(64)}`;
const OPERATOR_CONTRACT = bundledIndexerOperatorContract();
const PROFILE_CONTRACT = bundledIndexerProfileContract(OPERATOR_CONTRACT);
const BASE_CONTRACTS = {
  operator_contract: OPERATOR_CONTRACT,
  profile_contract: PROFILE_CONTRACT,
};

const CONFIG_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["safe", "thorough"] },
  },
  required: ["mode"],
  additionalProperties: false,
};

function manifest(program: boolean): string {
  return [
    "protocol: context.indexer.provider/v1",
    "id: context-indexer-sample",
    "version: 1.2.0",
    "domains: [code]",
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - { id: source-present, description: Source files are present. }",
    "  supporting_signals: []",
    "  negative_signals: []",
    "provides:",
    "  profiles: [component-library]",
    "  operations:",
    "    - { id: main-index, consumes: context.indexer.main-workset/v2, produces: context.indexer.main-result/v1 }",
    "  source_roles: [authoritative-source]",
    "  logical_units:",
    "    - id: component-family",
    "      identity: canonical-export-family",
    "      artifacts:",
    "        recommended: [content, examples]",
    "        supported_policy_variants: [standard]",
    "provider:",
    ...(program
      ? [
        "  program:",
        "    execution: { runtime: node, entry: scripts/index.mjs, args: [] }",
        "    protocol: context.indexer.program/v1",
        "    capabilities: [source.read, indexer-result.write]",
      ]
      : [
        "  instructions:",
        "    - { path: references/guidance.md, profiles: [component-library] }",
      ]),
    "  config_schema: references/config.schema.json",
    "quality_guidance:",
    "  metric_ids: [discretionary-artifacts-per-logical-unit]",
    "",
  ].join("\n");
}

function registry(
  integrity: string,
  config: Record<string, IndexerJson> = { mode: "safe" },
): IndexerRegistry {
  return parseIndexerRegistry(YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-capabilities"],
      coverage_domains: { public_contract: "required" },
      questions: [],
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
      },
      exclusions: [],
    }],
    indexers: [{
      id: "sample-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["public_contract"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: {
        primary: { id: "component-library", provider: "community", variants: {} },
        additional: [],
        composers: [],
      },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-indexer-sample",
        version: "1.2.0",
        integrity,
        distribution: {
          kind: "workspace",
          locator: "workspace://skills/context-indexer-sample",
        },
        config,
      }],
    }],
  }));
}

async function fixture(
  program = false,
  trust: ResolvedProviderBundle["resolved"]["trust"] = "verified",
) {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-selection-"));
  const source = join(root, "provider");
  const workspace = join(root, "workspace");
  await mkdir(join(source, "references"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(source, "context-indexer.yaml"), manifest(program), "utf8");
  await writeFile(
    join(source, "references", "config.schema.json"),
    `${JSON.stringify(CONFIG_SCHEMA)}\n`,
    "utf8",
  );
  if (program) {
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(join(source, "scripts", "index.mjs"), "export {};\n", "utf8");
  } else {
    await writeFile(join(source, "references", "guidance.md"), "# Guidance\n", "utf8");
  }
  const files = await collectIndexerBundleFiles(source);
  const integrity = indexerProviderBundleIntegrity(files);
  const manifestDigest = files.find((file) => file.path === "context-indexer.yaml")!.digest;
  const selectedRegistry = registry(integrity);
  const bundle: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: "sample-indexer",
      provider_id: "community",
      skill: "context-indexer-sample",
      version: "1.2.0",
      distribution: {
        kind: "workspace",
        locator: "workspace://skills/context-indexer-sample",
      },
    },
    resolved: {
      integrity,
      manifest_digest: manifestDigest,
      issuer: "community.example",
      trust,
    },
    transport: {
      kind: "directory",
      path: source,
      expires_at: "2026-08-28T12:00:00.000Z",
    },
    files,
    receipt: {
      resolver: "test-host/1.0.0",
      resolved_at: NOW.toISOString(),
      authority_ref: "test-authority:community",
      receipt_digest: integrity,
    },
  };
  bundle.receipt.receipt_digest = resolvedProviderReceiptDigest(bundle);
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected: {
      indexerId: "sample-indexer",
      providerId: "community",
      skill: "context-indexer-sample",
      version: "1.2.0",
      integrity,
      distribution: bundle.request.distribution,
    },
    runtimeRoot: join(root, "runtime"),
    now: NOW,
  });
  const providerManifest = await loadIndexerProviderManifest(staged.stage_path);
  const customization = await loadIndexerCustomization({
    workspaceRoot: workspace,
    projectRef: "project:sample",
    indexer: selectedRegistry.indexers[0]!,
    manifest: providerManifest,
    providerIntegrity: integrity,
    customizationPlan: buildIndexerCustomizationPlan({
      project_ref: "project:sample",
      indexer_id: "sample-indexer",
      provider_integrity: integrity,
      capability_gap_digest: `sha256:${"e".repeat(64)}`,
      selected_step: "config",
      rejected_smaller_steps: [{
        step: "provider-only",
        disposition: "insufficient",
        reason_code: "provider-only-insufficient",
        evidence_digest: `sha256:${"f".repeat(64)}`,
      }],
      affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
      introduces_external_dependencies: false,
    }),
  });
  const resolved: IndexerResolvedSelectionInput = {
    indexer_id: "sample-indexer",
    provider_id: "community",
    bundle,
    staged,
    execution_policy_digest: program ? POLICY_DIGEST : null,
  };
  return { root, source, workspace, registry: selectedRegistry, bundle, staged, customization, resolved };
}

describe("two-stage Indexer selection validation", () => {
  test("keeps non-allowlisted Provider program authorization on the current Route", async () => {
    const sample = await fixture(true, "project-authorized");
    await mkdir(join(sample.workspace, "src"), { recursive: true });
    await writeFile(join(sample.workspace, "src", "indexers.yaml"), YAML.stringify({
      ...sample.registry,
      indexers: [],
    }), "utf8");
    const proposal = buildIndexerProviderSelectionProposal({
      protocol: "context.indexer.selection-proposal-input/v1",
      project_ref: "project:sample",
      registry: sample.registry,
    });
    await persistCurrentIndexerProviderSetup({
      projectRoot: sample.workspace,
      proposal,
      resolved: [{ ...sample.resolved, execution_policy_digest: null }],
    });

    const route = await buildCurrentIndexerProviderContinuationRoute({
      projectRoot: sample.workspace,
      authorities: [],
      managed: false,
    });
    expect(route).toMatchObject({
      node: "authorize-indexer-provider-program",
      availability: "requires-user",
      gate: {
        id: "authorize-indexer-program-execution",
        authority: CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution,
        resolution: "user",
      },
      action: {
        input: { stage: "provider-program-authorization" },
      },
    });
    expect(route?.commands[0]?.command).toContain("action complete-current");

    expect(await completeCurrentIndexerProviderProgramAuthorization({
      projectRoot: sample.workspace,
      decision: "rejected",
    })).toBe("selection-rejected");
    expect(await buildCurrentIndexerProviderContinuationRoute({
      projectRoot: sample.workspace,
      authorities: [],
      managed: false,
    })).toBeUndefined();
  });

  test("keeps static validation pure and finalizes an exact staged Provider", async () => {
    const sample = await fixture();
    const staticReport = validateIndexerSelectionStatic(sample.registry);
    expect(staticReport.provider_requests).toEqual([{
      indexer_id: "sample-indexer",
      provider_id: "community",
      skill: "context-indexer-sample",
      version: "1.2.0",
      integrity: sample.bundle.resolved.integrity,
      distribution: sample.bundle.request.distribution,
      config_digest: staticReport.provider_requests[0]!.config_digest,
    }]);

    const finalReport = await validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    });
    expect(finalReport.static_report_digest).toBe(staticReport.report_digest);
    expect(finalReport.providers[0]?.bundle_integrity).toBe(sample.bundle.resolved.integrity);
    expect(finalReport.subject_key_schemas).toHaveLength(1);
    expect(finalReport.subject_key_schemas[0]).toMatchObject({
      indexer_id: "sample-indexer",
      profile: "component-library",
      authority: { kind: "community-base" },
    });
    expect(finalReport.subject_key_schema_set_digest).toMatch(/^sha256:/);
    expect(finalReport.composition_plans).toHaveLength(1);
    expect(finalReport.composition_plans[0]).toMatchObject({
      indexer_id: "sample-indexer",
      operation_authorities: [{
        operation: "main-index",
        final_authority_layer_id: "community",
      }],
      customization: {
        program_source: "provider",
        plan_digest: sample.customization.plan.plan_digest,
      },
    });
    expect(JSON.stringify(finalReport.providers)).not.toContain(sample.staged.stage_path);
  });

  test("separates stable selection identity from rematerialization receipts", async () => {
    const sample = await fixture();
    const staticReport = validateIndexerSelectionStatic(sample.registry);
    const first = await validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    });
    const rematerializedBundle = structuredClone(sample.bundle);
    rematerializedBundle.transport.expires_at = "2026-08-29T12:00:00.000Z";
    rematerializedBundle.receipt.resolved_at = "2026-08-28T12:00:00.000Z";
    rematerializedBundle.receipt.receipt_digest = resolvedProviderReceiptDigest(rematerializedBundle);
    const rematerializedStage = await stageIndexerProviderBundle({
      envelope: rematerializedBundle,
      expected: {
        indexerId: "sample-indexer",
        providerId: "community",
        skill: "context-indexer-sample",
        version: "1.2.0",
        integrity: sample.bundle.resolved.integrity,
        distribution: sample.bundle.request.distribution,
      },
      runtimeRoot: join(sample.root, "runtime-rematerialized"),
      now: new Date("2026-08-28T12:00:00.000Z"),
    });
    const second = await validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [{
        ...sample.resolved,
        bundle: rematerializedBundle,
        staged: rematerializedStage,
      }],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    });
    expect(second.report_digest).toBe(first.report_digest);
    expect(second.providers).toEqual(first.providers);
    expect(second.runtime_receipts).not.toEqual(first.runtime_receipts);
  });

  test("fails closed on stale static input, missing views, and staged byte drift", async () => {
    const sample = await fixture();
    const staticReport = validateIndexerSelectionStatic(sample.registry);
    const stale = { ...staticReport, registry_digest: `sha256:${"f".repeat(64)}` };
    await expect(validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: stale,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    })).rejects.toThrow("current static validation report");
    await expect(validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [],
      ...BASE_CONTRACTS,
    })).rejects.toThrow("one customization view");

    await writeFile(join(sample.staged.stage_path, "references", "guidance.md"), "changed\n");
    await expect(validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    })).rejects.toThrow("staged Provider changed");
  });

  test("validates Provider config and requires policy identity for executable resources", async () => {
    const sample = await fixture();
    const invalidRegistry = registry(sample.bundle.resolved.integrity, { mode: "unsafe" });
    await expect(validateIndexerSelectionFinal({
      registry: invalidRegistry,
      static_report: validateIndexerSelectionStatic(invalidRegistry),
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    })).rejects.toThrow("outside the config schema enum");

    const executable = await fixture(true);
    const staticReport = validateIndexerSelectionStatic(executable.registry);
    await expect(validateIndexerSelectionFinal({
      registry: executable.registry,
      static_report: staticReport,
      resolved: [{ ...executable.resolved, execution_policy_digest: null }],
      customizations: [executable.customization],
      ...BASE_CONTRACTS,
    })).rejects.toThrow("require one exact execution policy digest");
    await expect(validateIndexerSelectionFinal({
      registry: executable.registry,
      static_report: staticReport,
      resolved: [executable.resolved],
      customizations: [executable.customization],
      ...BASE_CONTRACTS,
    })).resolves.toMatchObject({ protocol: "context.indexer.selection-final-report/v1" });
  });

  test("stages and atomically applies a registry-only proposal through the CLI", async () => {
    const sample = await fixture();
    const staticReport = validateIndexerSelectionStatic(sample.registry);
    const finalReport = await validateIndexerSelectionFinal({
      registry: sample.registry,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    });
    const baseRegistry = parseIndexerRegistry(YAML.stringify({
      protocol: "context.indexer.registry/v1",
      requirements: sample.registry.requirements,
      indexers: [],
    }));
    const baseContent = YAML.stringify(baseRegistry);
    const targetContent = YAML.stringify(sample.registry);
    const baseDigests = indexerRegistryDigests(baseRegistry);
    const targetDigests = indexerRegistryDigests(sample.registry);
    const proposal = buildIndexerProjectProposal({
      protocol: "context.indexer.project-proposal/v1",
      project_ref: "project:sample",
      mode: "registry-only",
      requirement_set_digest: baseDigests.requirementSetDigest,
      base_registry: {
        document_digest: indexerProjectContentDigest(baseContent),
        requirement_set_digest: baseDigests.requirementSetDigest,
        indexer_selection_digest: baseDigests.indexerSelectionDigest,
        registry_digest: baseDigests.registryDigest,
      },
      target_registry: {
        document_digest: indexerProjectContentDigest(targetContent),
        requirement_set_digest: targetDigests.requirementSetDigest,
        indexer_selection_digest: targetDigests.indexerSelectionDigest,
        registry_digest: targetDigests.registryDigest,
      },
      target_document: sample.registry,
      targets: [{
        path: "src/indexers.yaml",
        operation: "write",
        base_digest: indexerProjectContentDigest(baseContent),
        target_digest: indexerProjectContentDigest(targetContent),
        content: targetContent,
      }],
      dependencies: buildIndexerDependencyIntentSet([]),
      capability_gap_digest: null,
      finalized_validation_report_digests: [finalReport.report_digest],
      program_execution_policy_digest: null,
    });
    await mkdir(join(sample.workspace, "src"), { recursive: true });
    await writeFile(join(sample.workspace, "src", "indexers.yaml"), baseContent, "utf8");
    await writeFile(join(sample.workspace, "package.json"), `${JSON.stringify({
      name: "indexer-project-proposal-fixture",
      private: true,
      context: { project: true, entry: "src/index.ts" },
    }, null, 2)}\n`, "utf8");
    const proposalPath = join(sample.workspace, "proposal.json");
    const validationPath = join(sample.workspace, "validation.json");
    const validationInput = {
      protocol: "context.indexer.project-staging-validation-input/v1" as const,
      static_report: staticReport,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      ...BASE_CONTRACTS,
    };
    await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
    await writeFile(validationPath, `${JSON.stringify(validationInput, null, 2)}\n`, "utf8");

    const staged = JSON.parse(await runCliInDir(sample.workspace, [
      "indexer", "stage-indexer-project-proposal",
      "--input", proposalPath,
      "--format", "json",
    ]));
    expect(staged.proposal_digest).toBe(proposal.proposal_digest);
    expect(await readFile(join(sample.workspace, "src", "indexers.yaml"), "utf8"))
      .toBe(baseContent);

    const ordinary = await buildIndexerProjectConfirmationRoute({
      projectRoot: sample.workspace,
      proposal_digest: proposal.proposal_digest,
      validation: validationInput,
      validationInputRef: validationPath,
    });
    const managed = await buildIndexerProjectConfirmationRoute({
      projectRoot: sample.workspace,
      proposal_digest: proposal.proposal_digest,
      validation: validationInput,
      validationInputRef: validationPath,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.indexerProjectConfirmation],
    });
    expect(ordinary.route.gate).toMatchObject({
      id: "confirm-indexer-project",
      resolution: "user",
      resolution_action: { input: ordinary.gate_input },
    });
    expect(ordinary.route.commands).toHaveLength(1);
    expect(ordinary.gate_input).toMatchObject({
      proposal_digest: proposal.proposal_digest,
      target_paths: ["src/indexers.yaml"],
      providers: [{
        indexer_id: "sample-indexer",
        provider_id: "community",
        role: "primary",
        version: "1.2.0",
      }],
      customizations: [],
      dependencies: [],
      validation_report_digests: [finalReport.report_digest],
    });
    expect(ordinary.gate_input.confirmation_batch_digest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(ordinary.route.commands[0]?.availability).toBe("after-human-confirmation");
    expect(managed.route.gate?.resolution).toBe("session-authority");
    expect(managed.route.commands[0]?.availability).toBe("immediate");
    expect(managed.route.revision).toBe(ordinary.route.revision);
    expect(managed.gate_input).toEqual(ordinary.gate_input);

    const applied = JSON.parse(await runCliInDir(sample.workspace, [
      "indexer", "apply-indexer-project",
      "--proposal", proposal.proposal_digest,
      "--validation-input", validationPath,
      "--format", "json",
    ]));
    expect(applied.proposal_digest).toBe(proposal.proposal_digest);
    expect(applied.validation_report_digests).toEqual([finalReport.report_digest]);
    expect(await readFile(join(sample.workspace, "src", "indexers.yaml"), "utf8"))
      .toBe(targetContent);
  });

  test("authorizes only one exact non-allowlisted program through its independent Gate", async () => {
    const sample = await fixture(true, "project-authorized");
    await writeFile(join(sample.workspace, "package.json"), `${JSON.stringify({
      name: "indexer-program-authorization-fixture",
      private: true,
      context: { project: true, entry: "src/index.ts" },
    })}\n`, "utf8");
    const report = await buildProjectIndexerProgramExecutionAuthorizationReport({
      project_ref: "project:sample",
      bundle: sample.bundle,
      staged: sample.staged,
      dependency_set_digest: buildIndexerFixedDependencySet([]).dependency_set_digest,
      scope_digest: indexerProtocolDigest({
        source_ref: "repo:sample",
        module_refs: ["module:app"],
      }),
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    });
    const authorizationInput = buildIndexerProgramExecutionAuthorizationInput({
      report,
      authority_ref: "context.indexer-program-execution",
      authority_scope_digest: `sha256:${"7".repeat(64)}`,
    });
    expect(() => buildIndexerProgramExecutionAuthorizationInput({
      report,
      authority_ref: "context.evidence-maintenance",
      authority_scope_digest: `sha256:${"7".repeat(64)}`,
    })).toThrow(/incomplete/);
    const inputPath = join(sample.workspace, "program-authorization.json");
    await writeFile(inputPath, `${JSON.stringify(authorizationInput, null, 2)}\n`, "utf8");

    const ordinary = await buildIndexerProgramExecutionAuthorizationRoute({
      projectRoot: sample.workspace,
      authorization_input: authorizationInput,
      authorizationInputRef: inputPath,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.evidenceMaintenance],
    });
    const managed = await buildIndexerProgramExecutionAuthorizationRoute({
      projectRoot: sample.workspace,
      authorization_input: authorizationInput,
      authorizationInputRef: inputPath,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution],
    });
    expect(ordinary.route.gate).toMatchObject({
      id: "authorize-indexer-program-execution",
      authority: CONTEXT_WORKFLOW_AUTHORITIES.indexerProgramExecution,
      resolution: "user",
      resolution_action: { input: ordinary.gate_input },
    });
    expect(ordinary.route.commands[0]?.availability).toBe("after-human-confirmation");
    expect(managed.route.gate?.resolution).toBe("session-authority");
    expect(managed.route.commands[0]?.availability).toBe("immediate");
    expect(managed.route.revision).toBe(ordinary.route.revision);
    expect(managed.gate_input.report.sandboxed_program).toBe(false);

    const result = JSON.parse(await runCliInDir(sample.workspace, [
      "indexer", "authorize-indexer-program-execution",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(result.authorization).toMatchObject({
      project_ref: "project:sample",
      provider_integrity: sample.bundle.resolved.integrity,
      provider_fingerprint: sample.staged.provider_fingerprint,
      manifest_digest: sample.bundle.resolved.manifest_digest,
      resource: "program",
      sandboxed_program: false,
    });
    const providerManifest = await loadIndexerProviderManifest(sample.staged.stage_path);
    expect(deriveIndexerProgramExecutionPolicy({
      manifest: providerManifest,
      bundle: sample.bundle,
      host: {
        protocol: "context.indexer.host-execution-capabilities/v1",
        adapter: "test-host",
        adapter_version: "1.0.0",
        sandboxed_program: false,
      },
      authorization: result.authorization,
      projectRef: "project:sample",
    })).toMatchObject({
      level: "trusted-program",
      executable: true,
      sandboxedProgram: false,
      reason: "project-authorized-exact-digest",
    });

    expect(() => buildIndexerProgramExecutionAuthorizationInput({
      report: { ...report, sandboxed_program: true } as never,
      authority_ref: "context.indexer-program-execution",
      authority_scope_digest: `sha256:${"7".repeat(64)}`,
    })).toThrow();
  });

  test("binds project-local authorization to the applied regular file bytes", async () => {
    const sample = await fixture(true, "first-party");
    const localDirectory = join(sample.workspace, "src", "indexer", "component-library");
    await mkdir(localDirectory, { recursive: true });
    const localPath = join(localDirectory, "index.ts");
    await writeFile(localPath, "export const localIndexer = 'v1';\n", "utf8");
    const providerManifest = await loadIndexerProviderManifest(sample.staged.stage_path);
    const shared = {
      projectRoot: sample.workspace,
      project_ref: "project:sample",
      indexer_id: "component-library",
      base_manifest: providerManifest,
      base_bundle: sample.bundle,
      execution: {
        runtime: "node" as const,
        entry: "src/indexer/component-library/index.ts",
        args: [],
      },
      capabilities: ["source.read", "indexer-result.write"] as const,
      dependency_set_digest: buildIndexerFixedDependencySet([]).dependency_set_digest,
      scope_digest: indexerProtocolDigest({
        source_ref: "repo:sample",
        module_refs: ["module:app"],
      }),
      limits: {
        timeout_ms: 10_000,
        max_stdin_bytes: 1024,
        max_stdout_bytes: 4096,
        max_stderr_bytes: 4096,
      },
    };
    const first = await buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace({
      ...shared,
      capabilities: [...shared.capabilities],
    });
    expect(first.program).toMatchObject({
      origin: "project-local",
      path: "src/indexer/component-library/index.ts",
    });

    await writeFile(localPath, "export const localIndexer = 'v2';\n", "utf8");
    const changed = await buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace({
      ...shared,
      capabilities: [...shared.capabilities],
    });
    expect(changed.program.content_digest).not.toBe(first.program.content_digest);
    expect(changed.program.program_digest).not.toBe(first.program.program_digest);
  });
});
