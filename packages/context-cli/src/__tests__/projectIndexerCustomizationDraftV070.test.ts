import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildIndexerProviderRouteInput,
  buildIndexerProviderRouteReport,
  indexerProviderBundleIntegrity,
  resolvedProviderReceiptDigest,
  type IndexerCustomizationDraft,
  type IndexerRegistry,
  type ResolvedProviderBundle,
} from "@c4a/context";
import {
  loadStagedProjectIndexerCustomizationDraft,
  validateAndStageProjectIndexerCustomizationDraft,
} from "../project/indexerCustomizationDraftStage.js";
import { prepareProjectIndexerCustomizationProposal } from
  "../project/indexerCustomizationProjectPreparation.js";
import { applyProjectIndexerProposal } from "../project/indexerProjectFlow.js";
import { buildIndexerProjectConfirmationRoute } from
  "../project/indexerProjectGateRoute.js";
import { observeProjectIndexerApply } from "../project/indexerProjectObservation.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { validateIndexerSelectionStatic } from
  "../project/indexerSelectionValidation.js";
import {
  authorizeProjectIndexerProgramExecution,
  buildIndexerProgramExecutionAuthorizationInput,
} from "../project/indexerProgramExecutionAuthorization.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;

function requirements(): IndexerRegistry["requirements"] {
  return [{
    id: "workspace-knowledge",
    reader_goals: ["understand-system"],
    coverage_domains: {
      architecture: "required",
      public_contract: "required",
    },
    target_scope: {
      targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
    },
    evidence_source_scope: {
      targets: [{ source_ref: "repo:sample", module_refs: ["module:app"] }],
    },
  }];
}

function currentRegistry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: requirements(),
    indexers: [],
  };
}

function fallbackRegistry(input: {
  integrity?: string;
  distribution?: IndexerRegistry["indexers"][number]["providers"][number]["distribution"];
} = {}): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: requirements(),
    indexers: [{
      id: "sample-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "domain-service", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: input.integrity ?? INTEGRITY,
        distribution: input.distribution ?? {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

function draft(registry = fallbackRegistry()): IndexerCustomizationDraft {
  const routeInput = buildIndexerProviderRouteInput({
    project_ref: "project:customization-draft",
    registry,
    visible_skills: [{
      skill: "context-code-indexer",
      version: "0.7.0",
      source_type: "cli-bundled",
    }],
    community_fallback_attempted: true,
  });
  const routeReport = buildIndexerProviderRouteReport(routeInput);
  return {
    protocol: "context.indexer.customization-proposal-draft/v1",
    capability_gap: { route_input: routeInput, route_report: routeReport },
    capability_gap_digest: routeReport.capability_gap_proof!.gap_digest,
    indexer_id: "sample-indexer",
    mode: "extend",
    selected_step: "instructions-append",
    rejected_smaller_steps: [
      {
        step: "provider-only",
        disposition: "insufficient",
        reason_code: "provider-only-insufficient",
        evidence_digest: `sha256:${"b".repeat(64)}`,
      },
      {
        step: "config",
        disposition: "unsupported",
        reason_code: "config-unsupported",
        evidence_digest: `sha256:${"c".repeat(64)}`,
      },
    ],
    gap_summary: "Project public-contract terminology requires one instruction extension.",
    affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
    files: [{
      path: "src/indexer/sample-indexer/instructions.md",
      content: [
        "<!-- @context-indexer-origin context-code-indexer@0.7.0 profile=domain-service -->",
        "Use the project public-contract terminology.",
        "",
      ].join("\n"),
    }],
    dependency_intents: [],
  };
}

function programDraft(registry: IndexerRegistry): IndexerCustomizationDraft {
  const value = draft(registry);
  return {
    ...value,
    selected_step: "program-extend",
    rejected_smaller_steps: [
      ...value.rejected_smaller_steps,
      {
        step: "instructions-append",
        disposition: "insufficient",
        reason_code: "instructions-insufficient",
        evidence_digest: `sha256:${"d".repeat(64)}`,
      },
      {
        step: "template-override",
        disposition: "unsupported",
        reason_code: "template-unsupported",
        evidence_digest: `sha256:${"e".repeat(64)}`,
      },
    ],
    files: [{
      path: "src/indexer/sample-indexer/index.ts",
      content: [
        "// @context-indexer-origin context-code-indexer@0.7.0 profile=domain-service",
        "export {};",
        "",
      ].join("\n"),
    }],
  };
}

async function resolvedCustomizationFixture(root: string, program = false) {
  const source = join(root, "provider");
  await mkdir(join(source, "references"), { recursive: true });
  await writeFile(join(source, "context-indexer.yaml"), [
    "protocol: context.indexer.provider/v1",
    "id: context-code-indexer",
    "version: 0.7.0",
    "domains: [code]",
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - { id: source-present, description: Source files are present. }",
    "  supporting_signals: []",
    "  negative_signals: []",
    "provides:",
    "  profiles: [domain-service]",
    "  operations:",
    "    - { id: main-index, consumes: context.indexer.main-workset/v1, produces: context.indexer.main-result/v1 }",
    "  source_roles: [authoritative-source]",
    "  logical_units:",
    "    - id: domain-capability",
    "      identity: canonical-domain-capability",
    "      artifacts:",
    "        recommended: [content]",
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
        "    - { path: references/guidance.md, profiles: [domain-service] }",
      ]),
    "customization:",
    `  supports: [${program ? "program-extend" : "instructions-append"}]`,
    "quality_guidance:",
    "  metric_ids: [discretionary-artifacts-per-logical-unit]",
    "",
  ].join("\n"), "utf8");
  if (program) {
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(join(source, "scripts", "index.mjs"), "export {};\n", "utf8");
  } else {
    await writeFile(join(source, "references", "guidance.md"), "# Guidance\n", "utf8");
  }
  const files = await collectIndexerBundleFiles(source);
  const integrity = indexerProviderBundleIntegrity(files);
  const distribution = {
    kind: "workspace" as const,
    locator: "workspace://skills/context-code-indexer",
  };
  const bundle: ResolvedProviderBundle = {
    protocol: "context.indexer.resolved-provider-bundle/v1",
    request: {
      indexer_id: "sample-indexer",
      provider_id: "community",
      skill: "context-code-indexer",
      version: "0.7.0",
      distribution,
    },
    resolved: {
      integrity,
      manifest_digest: files.find((file) => file.path === "context-indexer.yaml")!.digest,
      issuer: "test.example",
      trust: "verified",
    },
    transport: {
      kind: "directory",
      path: source,
      expires_at: "2026-08-29T00:00:00.000Z",
    },
    files,
    receipt: {
      resolver: "test-host/1.0.0",
      resolved_at: "2026-08-28T00:00:00.000Z",
      authority_ref: "test-authority:workspace",
      receipt_digest: integrity,
    },
  };
  bundle.receipt.receipt_digest = resolvedProviderReceiptDigest(bundle);
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected: {
      indexerId: "sample-indexer",
      providerId: "community",
      skill: "context-code-indexer",
      version: "0.7.0",
      integrity,
      distribution,
    },
    runtimeRoot: join(root, ".tmp", "provider-runtime"),
    now: new Date("2026-08-28T00:00:00.000Z"),
  });
  return { integrity, distribution, bundle, staged };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-custom-draft-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "customization-draft-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "src", "indexers.yaml"),
    YAML.stringify(currentRegistry()),
    "utf8",
  );
  return root;
}

describe("project Indexer customization draft validation stage", () => {
  test("stages one exact draft without writing the registry or customization source", async () => {
    const root = await project();
    const registryPath = join(root, "src", "indexers.yaml");
    const before = await readFile(registryPath, "utf8");
    const first = await validateAndStageProjectIndexerCustomizationDraft({
      projectRoot: root,
      draft: draft(),
    });
    const second = await validateAndStageProjectIndexerCustomizationDraft({
      projectRoot: root,
      draft: draft(),
    });
    expect(first.outcome).toBe("selection-validation-required");
    expect(first.stage_receipt.reused).toBe(false);
    expect(second.stage_receipt.reused).toBe(true);
    expect(second.result_digest).not.toBe(first.result_digest);
    expect(await readFile(registryPath, "utf8")).toBe(before);
    expect(existsSync(join(root, "src", "indexer"))).toBe(false);

    const loaded = await loadStagedProjectIndexerCustomizationDraft({
      projectRoot: root,
      validation_digest: first.validated.validation_digest,
    });
    expect(loaded).toEqual(first.validated);
    expect(loaded.target_registry.indexers[0]?.customization).toEqual({ mode: "extend" });
  });

  test("runs through the CLI and rejects source overwrite before staging", async () => {
    const root = await project();
    const inputPath = join(root, "customization-draft.json");
    await writeFile(inputPath, `${JSON.stringify(draft(), null, 2)}\n`, "utf8");
    const result = JSON.parse(await runCliInDir(root, [
      "indexer", "validate-indexer-customization",
      "--input", inputPath,
      "--format", "json",
    ]));
    expect(result.outcome).toBe("selection-validation-required");
    expect(result.validated.selection_proposal_input.registry.indexers[0]
      .requirement_bindings[0].coverage_domains).toEqual([
        "architecture",
        "public_contract",
      ]);

    const conflictRoot = await project();
    await mkdir(join(conflictRoot, "src", "indexer", "sample-indexer"), {
      recursive: true,
    });
    await writeFile(
      join(conflictRoot, "src", "indexer", "sample-indexer", "instructions.md"),
      "user content\n",
      "utf8",
    );
    await expect(validateAndStageProjectIndexerCustomizationDraft({
      projectRoot: conflictRoot,
      draft: draft(),
    })).rejects.toThrow(/cannot overwrite/);
  });

  test("finalizes the exact staged Provider and applies one safe customization proposal", async () => {
    const root = await project();
    const provider = await resolvedCustomizationFixture(root);
    const selected = fallbackRegistry({
      integrity: provider.integrity,
      distribution: provider.distribution,
    });
    const validation = await validateAndStageProjectIndexerCustomizationDraft({
      projectRoot: root,
      draft: draft(selected),
    });
    const operatorContract = bundledIndexerOperatorContract();
    const profileContract = bundledIndexerProfileContract(operatorContract);
    const staticReport = validateIndexerSelectionStatic(validation.validated.target_registry);
    const preparationInput = {
      protocol: "context.indexer.customization-project-preparation-input/v1" as const,
      validation_digest: validation.validated.validation_digest,
      static_report: staticReport,
      resolved: [{
        indexer_id: "sample-indexer",
        provider_id: "community",
        bundle: provider.bundle,
        staged: provider.staged,
        execution_policy_digest: null,
      }],
      operator_contract: operatorContract,
      profile_contract: profileContract,
    };
    const prepared = await prepareProjectIndexerCustomizationProposal({
      projectRoot: root,
      value: preparationInput,
    });
    expect(prepared.outcome).toBe("project-confirmation-required");
    if (prepared.outcome !== "project-confirmation-required") throw new Error("expected proposal");
    expect(prepared.proposal.targets.map((target) => target.path)).toEqual([
      "src/indexer/sample-indexer/instructions.md",
      "src/indexers.yaml",
    ]);
    expect(existsSync(join(root, "src", "indexer"))).toBe(false);
    const preparationPath = join(root, "customization-preparation.json");
    await writeFile(preparationPath, `${JSON.stringify(preparationInput, null, 2)}\n`, "utf8");
    const cliPrepared = JSON.parse(await runCliInDir(root, [
      "indexer", "prepare-indexer-customization-project",
      "--input", preparationPath,
      "--format", "json",
    ]));
    expect(cliPrepared.proposal.proposal_digest).toBe(prepared.proposal.proposal_digest);
    expect(cliPrepared.stage_receipt.reused).toBe(true);

    const confirmation = await buildIndexerProjectConfirmationRoute({
      projectRoot: root,
      proposal_digest: prepared.proposal.proposal_digest,
      validation: prepared.staging_validation,
      validationInputRef: preparationPath,
    });
    expect(confirmation.route.commands).toHaveLength(1);
    expect(confirmation.route.gate).toMatchObject({
      id: "confirm-indexer-project",
      resolution: "user",
      resolution_action: { input: confirmation.gate_input },
    });
    expect(confirmation.gate_input).toMatchObject({
      proposal_digest: prepared.proposal.proposal_digest,
      mode: "customization",
      target_paths: [
        "src/indexer/sample-indexer/instructions.md",
        "src/indexers.yaml",
      ],
      providers: [{
        indexer_id: "sample-indexer",
        provider_id: "community",
        role: "primary",
        version: "0.7.0",
      }],
      customizations: [{ indexer_id: "sample-indexer", mode: "extend" }],
      dependencies: [],
      validation_report_digests: prepared.proposal.finalized_validation_report_digests,
    });

    const applied = await applyProjectIndexerProposal({
      projectRoot: root,
      proposal_digest: prepared.proposal.proposal_digest,
      validation: prepared.staging_validation,
    });
    expect(applied.proposal_digest).toBe(prepared.proposal.proposal_digest);
    expect(await readFile(
      join(root, "src", "indexer", "sample-indexer", "instructions.md"),
      "utf8",
    )).toContain("project public-contract terminology");
    expect(YAML.parse(await readFile(join(root, "src", "indexers.yaml"), "utf8")))
      .toMatchObject({ indexers: [{ customization: { mode: "extend" } }] });
    const observed = await observeProjectIndexerApply({
      projectRoot: root,
      value: {
        protocol: "context.indexer.project-observation-input/v1",
        proposal_digest: prepared.proposal.proposal_digest,
        apply_receipt_digest: applied.receipt_digest,
        staging_validation: prepared.staging_validation,
      },
    });
    expect(observed).toMatchObject({
      state: "current",
      proposal_digest: prepared.proposal.proposal_digest,
      indexer_selection_digest: applied.indexer_selection_digest,
    });
    const observationPath = join(root, "customization-observation.json");
    await writeFile(observationPath, `${JSON.stringify({
      protocol: "context.indexer.project-observation-input/v1",
      proposal_digest: prepared.proposal.proposal_digest,
      apply_receipt_digest: applied.receipt_digest,
      staging_validation: prepared.staging_validation,
    }, null, 2)}\n`, "utf8");
    const cliObserved = JSON.parse(await runCliInDir(root, [
      "indexer", "observe-indexer-project",
      "--input", observationPath,
      "--format", "json",
    ]));
    expect(cliObserved.observation_digest).toBe(observed.observation_digest);
    await writeFile(
      join(root, "src", "indexer", "sample-indexer", "instructions.md"),
      "tampered\n",
      "utf8",
    );
    await expect(observeProjectIndexerApply({
      projectRoot: root,
      value: {
        protocol: "context.indexer.project-observation-input/v1",
        proposal_digest: prepared.proposal.proposal_digest,
        apply_receipt_digest: applied.receipt_digest,
        staging_validation: prepared.staging_validation,
      },
    })).rejects.toThrow(/target set is stale or incomplete/);
  });

  test("stops a project-local program at its independent authorization and resumes exactly", async () => {
    const root = await project();
    const provider = await resolvedCustomizationFixture(root, true);
    const selected = fallbackRegistry({
      integrity: provider.integrity,
      distribution: provider.distribution,
    });
    const validation = await validateAndStageProjectIndexerCustomizationDraft({
      projectRoot: root,
      draft: programDraft(selected),
    });
    const operatorContract = bundledIndexerOperatorContract();
    const profileContract = bundledIndexerProfileContract(operatorContract);
    const baseInput = {
      protocol: "context.indexer.customization-project-preparation-input/v1" as const,
      validation_digest: validation.validated.validation_digest,
      static_report: validateIndexerSelectionStatic(validation.validated.target_registry),
      resolved: [{
        indexer_id: "sample-indexer",
        provider_id: "community",
        bundle: provider.bundle,
        staged: provider.staged,
        execution_policy_digest: `sha256:${"f".repeat(64)}`,
      }],
      operator_contract: operatorContract,
      profile_contract: profileContract,
    };
    const pending = await prepareProjectIndexerCustomizationProposal({
      projectRoot: root,
      value: baseInput,
    });
    expect(pending.outcome).toBe("program-authorization-required");
    if (pending.outcome !== "program-authorization-required") throw new Error("expected authorization");
    expect(existsSync(join(root, "src", "indexer"))).toBe(false);
    const authorization = authorizeProjectIndexerProgramExecution(
      buildIndexerProgramExecutionAuthorizationInput({
        report: pending.authorization_report,
        authority_ref: "authority:indexer-program-execution",
        authority_scope_digest: `sha256:${"9".repeat(64)}`,
      }),
    );
    const prepared = await prepareProjectIndexerCustomizationProposal({
      projectRoot: root,
      value: { ...baseInput, program_authorization: authorization },
    });
    expect(prepared.outcome).toBe("project-confirmation-required");
    if (prepared.outcome !== "project-confirmation-required") throw new Error("expected proposal");
    expect(prepared.proposal.program_execution_policy_digest)
      .toBe(pending.authorization_report.execution_policy_digest);
    await applyProjectIndexerProposal({
      projectRoot: root,
      proposal_digest: prepared.proposal.proposal_digest,
      validation: prepared.staging_validation,
    });
    expect(await readFile(
      join(root, "src", "indexer", "sample-indexer", "index.ts"),
      "utf8",
    )).toContain("export {};");
  });
});
