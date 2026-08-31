import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  buildIndexerBaseQuestionAmendment,
  buildIndexerOverlayQuestionAmendment,
  buildIndexerOverlayQuestionRegistryApplyProposal,
  confirmIndexerBaseQuestionAmendment,
  indexerContractOverlayDigest,
  indexerOverlayValidationReceiptDigest,
  indexerProviderBundleIntegrity,
  loadIndexerProviderManifest,
  parseIndexerRegistry,
  resolvedProviderReceiptDigest,
  validateIndexerContractOverlay,
  validateIndexerResolvedMaterialQuestion,
  type IndexerContractOverlay,
  type IndexerRegistry,
  type ResolvedProviderBundle,
} from "@c4a/context";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { applyIndexerBaseQuestionAmendment } from
  "../project/indexerBaseQuestionApply.js";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import {
  applyIndexerOverlayQuestionRegistryProposal,
  stageIndexerOverlayQuestionRegistryApplyProposal,
} from "../project/indexerOverlayQuestionApply.js";
import {
  buildIndexerContractOverlayValidationInput,
  validateProjectIndexerContractOverlay,
} from "../project/indexerContractOverlayValidation.js";
import {
  buildIndexerOverlayQuestionProposalInput,
  buildIndexerOverlayQuestionRebindInput,
  confirmProjectIndexerOverlayQuestionAmendment,
  proposeProjectIndexerOverlayQuestionAmendment,
  rebindProjectIndexerSelectionToOverlayRequirement,
} from "../project/indexerOverlayQuestionLifecycle.js";
import {
  applyProjectIndexerProposal,
  stageProjectIndexerProposal,
} from "../project/indexerProjectFlow.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";
import {
  validateIndexerSelectionFinal,
  validateIndexerSelectionStatic,
  type IndexerResolvedSelectionInput,
} from "../project/indexerSelectionValidation.js";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const PROJECT_REF = "project:overlay-example";
const INDEXER_OVERLAY_TEST_TIMEOUT_MS = 60_000;
const temporaryRoots: string[] = [];
const OPERATORS = bundledIndexerOperatorContract();
const PROFILES = bundledIndexerProfileContract(OPERATORS);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

function providerManifest(): string {
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
    "    - { id: main-index, consumes: context.indexer.main-workset/v1, produces: context.indexer.main-result/v1 }",
    "provider:",
    "  instructions:",
    "    - { path: references/indexer.md, profiles: [component-library] }",
    "",
  ].join("\n");
}

function registry(integrity: string): IndexerRegistry {
  return parseIndexerRegistry(YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["operate-reliably"],
      coverage_domains: { operations: "required" },
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
        coverage_domains: ["operations"],
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
      }],
    }],
  }));
}

function overlay(): IndexerContractOverlay {
  const payload: Omit<IndexerContractOverlay, "overlay_digest"> = {
    protocol: "context.indexer.contract-overlay/v1",
    id: "example-reliability",
    version: "1.0.0",
    extends: {
      profile: "component-library",
      version: PROFILES.version,
      contract_digest: PROFILES.contract_digest,
    },
    operator_contract_version: OPERATORS.version,
    operator_contract_digest: OPERATORS.contract_digest,
    additions: {
      question_target_domains: [{
        id: "example/component-operation",
        selector: { operator: "all-inventory" },
        grouping_operator: "by-subject-key",
        subject_key_kind: "component",
        granularity: "identity",
      }],
      reader_question_contracts: [{
        ref: "question:example/failure-recovery",
        semantic: "How does this component fail and recover?",
        version: 1,
        coverage_domain: "operations",
        target_domain_ref: "example/component-operation",
        target_selector: {
          protocol: "context.indexer.selector/v1",
          expression: { op: "equals", fact: "target.eligible", value: true },
        },
        evidence_contract: {
          accepted_kinds: ["documentation", "runbook"],
          minimum_items: 1,
          minimum_distinct_sources: 1,
        },
      }],
    },
  };
  return { ...payload, overlay_digest: indexerContractOverlayDigest(payload) };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-overlay-question-"));
  temporaryRoots.push(root);
  const projectRoot = join(root, "project");
  const providerRoot = join(root, "provider");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await mkdir(join(providerRoot, "references"), { recursive: true });
  await writeFile(join(providerRoot, "context-indexer.yaml"), providerManifest(), "utf8");
  await writeFile(join(providerRoot, "references", "indexer.md"), "# Indexer\n", "utf8");
  await writeFile(join(projectRoot, "package.json"), `${JSON.stringify({
    name: "overlay-question-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  const files = await collectIndexerBundleFiles(providerRoot);
  const integrity = indexerProviderBundleIntegrity(files);
  const manifestDigest = files.find((file) => file.path === "context-indexer.yaml")!.digest;
  const baseRegistry = registry(integrity);
  const baseContent = YAML.stringify(baseRegistry);
  await writeFile(join(projectRoot, "src", "indexers.yaml"), baseContent, "utf8");
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
      trust: "verified",
    },
    transport: {
      kind: "directory",
      path: providerRoot,
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
  const manifest = await loadIndexerProviderManifest(staged.stage_path);
  const customization = await loadIndexerCustomization({
    workspaceRoot: projectRoot,
    projectRef: PROJECT_REF,
    indexer: baseRegistry.indexers[0]!,
    manifest,
    providerIntegrity: integrity,
  });
  const resolved: IndexerResolvedSelectionInput = {
    indexer_id: "sample-indexer",
    provider_id: "community",
    bundle,
    staged,
    execution_policy_digest: null,
  };
  const baseStatic = validateIndexerSelectionStatic(baseRegistry);
  const baseFinal = await validateIndexerSelectionFinal({
    registry: baseRegistry,
    static_report: baseStatic,
    resolved: [resolved],
    customizations: [customization],
    operator_contract: OPERATORS,
    profile_contract: PROFILES,
  });
  const overlayValidation = validateIndexerContractOverlay({
    overlay: overlay(),
    baseContract: PROFILES,
    operatorContract: OPERATORS,
  });
  const validationInput = buildIndexerContractOverlayValidationInput({
    project_ref: PROJECT_REF,
    overlay: overlayValidation.overlay,
    base_contract: PROFILES,
    operator_contract: OPERATORS,
    provider_integrity: integrity,
  });
  const validationResult = validateProjectIndexerContractOverlay(
    validationInput,
  );
  const validationReceipt = validationResult.validation_receipt;
  return {
    root,
    projectRoot,
    baseRegistry,
    baseContent,
    integrity,
    resolved,
    customization,
    baseStatic,
    baseFinal,
    overlayValidation,
    validationReceipt,
    validationInput,
    validationResult,
  };
}

async function prepareCoupledProposal(sample: Awaited<ReturnType<typeof fixture>>) {
  const proposalInput = buildIndexerOverlayQuestionProposalInput({
    validation_input: sample.validationInput,
    validation_result: sample.validationResult,
    registry: sample.baseRegistry,
    requirement_id: "workspace-knowledge",
  });
  const amendment = proposeProjectIndexerOverlayQuestionAmendment(proposalInput);
  const confirmation = confirmProjectIndexerOverlayQuestionAmendment({
    amendment,
    authority: "managed",
    confirmed_by: "authority:managed-project",
    confirmed_at: NOW.toISOString(),
  });
  const rebindInput = buildIndexerOverlayQuestionRebindInput({
    validation_input: sample.validationInput,
    validation_result: sample.validationResult,
    base_registry: sample.baseRegistry,
    amendment,
    confirmation,
    base_static_report: sample.baseStatic,
    base_final_report: sample.baseFinal,
    resolved: [sample.resolved],
    customizations: [sample.customization],
  });
  const rebound = await rebindProjectIndexerSelectionToOverlayRequirement({
    projectRoot: sample.projectRoot,
    value: rebindInput,
  });
  if (!("rebind_receipt" in rebound)) {
    throw new Error("expected overlay question selection rebind");
  }
  const rebind = rebound.rebind_receipt;
  const proposal = rebound.proposal;
  const targetContent = proposal.target_document_content;
  return {
    amendment,
    confirmation,
    rebindInput,
    rebind,
    proposal,
    targetContent,
  };
}

describe("validated overlay question amendment back-edge", () => {
  test("confirms and applies a CLI base question before resolving any Provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-base-question-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    const base = registry(`sha256:${"a".repeat(64)}`);
    const baseContent = YAML.stringify(base);
    await writeFile(join(root, "src", "indexers.yaml"), baseContent, "utf8");
    const amendment = buildIndexerBaseQuestionAmendment({
      project_ref: PROJECT_REF,
      registry: base,
      requirement_id: "workspace-knowledge",
      profile: "component-library",
      question_refs: ["question:failure-recovery"],
      profile_contract: PROFILES,
      operator_contract: OPERATORS,
    });
    const confirmation = confirmIndexerBaseQuestionAmendment({
      amendment,
      authority: "managed",
      confirmed_by: "authority:managed-project",
      confirmed_at: NOW.toISOString(),
    });
    const receipt = await applyIndexerBaseQuestionAmendment({
      projectRoot: root,
      amendment,
      confirmation,
      target_document_content: YAML.stringify(amendment.target_registry),
    });
    expect(receipt.requirement_set_digest).toBe(amendment.target_requirement_set_digest);
    const applied = parseIndexerRegistry(
      await readFile(join(root, "src", "indexers.yaml"), "utf8"),
    );
    expect(applied.requirements[0]!.questions?.[0]?.authority).toMatchObject({
      kind: "cli-base-contract",
      digest: PROFILES.contract_digest,
    });
    expect(() => buildIndexerBaseQuestionAmendment({
      project_ref: PROJECT_REF,
      registry: base,
      requirement_id: "workspace-knowledge",
      profile: "component-library",
      question_refs: ["question:example/failure-recovery"],
      profile_contract: PROFILES,
      operator_contract: OPERATORS,
    })).toThrow(/no canonical question/);
  });

  test("keeps the confirmed amendment staged until rebound validation and atomic apply", async () => {
    const sample = await fixture();
    const prepared = await prepareCoupledProposal(sample);
    const before = await readFile(join(sample.projectRoot, "src", "indexers.yaml"), "utf8");
    expect(before).toBe(sample.baseContent);
    expect(prepared.amendment.comparison.relation).toBe("strengthening");
    const addedQuestion = prepared.amendment.added_questions[0]!;
    expect(validateIndexerResolvedMaterialQuestion({
      binding: addedQuestion.binding,
      resolved_question: {
        ref: addedQuestion.contract.ref,
        authority: addedQuestion.binding.authority,
        contract_version: addedQuestion.contract.version,
        contract_digest: addedQuestion.contract_digest,
        semantic: addedQuestion.contract.semantic,
        coverage_domain: addedQuestion.contract.coverage_domain,
        target_domain_ref: addedQuestion.contract.target_domain_ref,
        target_selector: addedQuestion.contract.target_selector,
        evidence_contract: addedQuestion.contract.evidence_contract,
      },
      allowed_selector_fact_paths: new Set(["target.eligible"]),
      coverage_domain_state: "required",
    })).toBeTruthy();
    expect(prepared.confirmation.non_delegable).toBe(false);
    expect(prepared.rebind.target_static_report.provider_requests).toEqual(
      sample.baseStatic.provider_requests,
    );
    expect(prepared.rebind.target_final_report.providers).toEqual(
      sample.baseFinal.providers,
    );
    expect(prepared.rebind.target_final_report.subject_key_schema_set_digest).toBe(
      sample.baseFinal.subject_key_schema_set_digest,
    );
    await expect(validateIndexerSelectionFinal({
      registry: prepared.amendment.target_registry,
      static_report: sample.baseStatic,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      operator_contract: OPERATORS,
      profile_contract: PROFILES,
    })).rejects.toThrow(/static|stale|registry/i);

    await stageProjectIndexerProposal({
      projectRoot: sample.projectRoot,
      proposal: prepared.proposal,
    });
    expect(await readFile(join(sample.projectRoot, "src", "indexers.yaml"), "utf8"))
      .toBe(sample.baseContent);
    const applied = await applyProjectIndexerProposal({
      projectRoot: sample.projectRoot,
      proposal_digest: prepared.proposal.proposal_digest,
      validation: {
        protocol: "context.indexer.overlay-question-project-apply-input/v1",
        rebind_receipt: prepared.rebind,
      },
    });
    expect(applied.recovered).toBe(false);
    const target = parseIndexerRegistry(
      await readFile(join(sample.projectRoot, "src", "indexers.yaml"), "utf8"),
    );
    expect(target.requirements[0]!.questions).toEqual([
      prepared.amendment.added_questions[0]!.binding,
    ]);
    expect(target.indexers).toEqual(sample.baseRegistry.indexers);
  }, INDEXER_OVERLAY_TEST_TIMEOUT_MS);

  test("rejects a forged validation receipt and any non-question drift", async () => {
    const sample = await fixture();
    expect(() => buildIndexerOverlayQuestionAmendment({
      project_ref: PROJECT_REF,
      registry: sample.baseRegistry,
      requirement_id: "workspace-knowledge",
      overlay_validation: sample.overlayValidation,
      base_contract: PROFILES,
      operator_contract: OPERATORS,
      provider_integrity: sample.integrity,
      validation_receipt: { ...sample.validationReceipt, receipt_digest: `sha256:${"f".repeat(64)}` },
    })).toThrow(/receipt digest/);

    const prepared = await prepareCoupledProposal(sample);
    await expect(validateIndexerSelectionFinal({
      registry: prepared.amendment.target_registry,
      static_report: prepared.rebind.target_static_report,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      operator_contract: OPERATORS,
      profile_contract: PROFILES,
    })).rejects.toThrow(/authority proof/);
    const { receipt_digest: _receiptDigest, ...staleReceiptPayload } =
      sample.validationReceipt;
    void _receiptDigest;
    const staleProviderIntegrity = `sha256:${"f".repeat(64)}`;
    const staleValidationReceiptPayload = {
      ...staleReceiptPayload,
      provider_integrity: staleProviderIntegrity,
    };
    await expect(validateIndexerSelectionFinal({
      registry: prepared.amendment.target_registry,
      static_report: prepared.rebind.target_static_report,
      resolved: [sample.resolved],
      customizations: [sample.customization],
      operator_contract: OPERATORS,
      profile_contract: PROFILES,
      overlay_question_authorities: [{
        project_ref: PROJECT_REF,
        requirement_id: "workspace-knowledge",
        provider_integrity: staleProviderIntegrity,
        overlay_validation: sample.overlayValidation,
        validation_receipt: {
          ...staleValidationReceiptPayload,
          receipt_digest: indexerOverlayValidationReceiptDigest(staleValidationReceiptPayload),
        },
      }],
    })).rejects.toThrow(/current primary Provider/);
    const drifted = structuredClone(prepared.amendment);
    drifted.target_registry.requirements[0]!.reader_goals.push("unexpected-goal");
    expect(() => buildIndexerOverlayQuestionRegistryApplyProposal({
      project_ref: PROJECT_REF,
      base_registry: sample.baseRegistry,
      base_document_content: sample.baseContent,
      target_document_content: YAML.stringify(drifted.target_registry),
      amendment: drifted,
      confirmation: prepared.confirmation,
      rebind_receipt_digest: prepared.rebind.receipt_digest,
      rebound_selection_digest: prepared.rebind.target_final_report.report_digest,
      subject_key_schema_set_digest:
        prepared.rebind.target_final_report.subject_key_schema_set_digest,
      finalized_validation_report_digests: [
        prepared.amendment.conformance_report_digest,
        prepared.rebind.target_final_report.report_digest,
        prepared.rebind.receipt_digest,
      ],
    })).toThrow();
  }, INDEXER_OVERLAY_TEST_TIMEOUT_MS);

  test("routes profile or requirement-scope drift back to the Provider Gate", async () => {
    const sample = await fixture();
    const prepared = await prepareCoupledProposal(sample);
    const driftedRegistries = [
      (() => {
        const value = structuredClone(sample.baseRegistry);
        value.indexers[0]!.profile.primary.id = "technical-guide";
        return value;
      })(),
      (() => {
        const value = structuredClone(sample.baseRegistry);
        value.requirements[0]!.target_scope.targets[0]!.module_refs.push(
          "module:worker",
        );
        return value;
      })(),
    ];
    for (const current of driftedRegistries) {
      await writeFile(
        join(sample.projectRoot, "src", "indexers.yaml"),
        YAML.stringify(current),
        "utf8",
      );
      await expect(rebindProjectIndexerSelectionToOverlayRequirement({
        projectRoot: sample.projectRoot,
        value: prepared.rebindInput,
      })).resolves.toMatchObject({
        protocol: "context.indexer.overlay-question-provider-required/v1",
        outcome: "indexer-provider-required",
        reason: "base-registry-authority-changed",
      });
    }
  }, INDEXER_OVERLAY_TEST_TIMEOUT_MS);

  test("runs propose, confirm, rebind, stage, and the shared apply Action through CLI", async () => {
    const sample = await fixture();
    const proposalInput = buildIndexerOverlayQuestionProposalInput({
      validation_input: sample.validationInput,
      validation_result: sample.validationResult,
      registry: sample.baseRegistry,
      requirement_id: "workspace-knowledge",
    });
    const proposalInputPath = join(sample.projectRoot, "overlay-question-proposal-input.json");
    await writeFile(proposalInputPath, `${JSON.stringify(proposalInput, null, 2)}\n`, "utf8");
    const amendment = JSON.parse(await runCliInDir(sample.projectRoot, [
      "indexer", "propose-overlay-question-amendment",
      "--input", proposalInputPath,
      "--format", "json",
    ]));
    const amendmentPath = join(sample.projectRoot, "overlay-question-amendment.json");
    await writeFile(amendmentPath, `${JSON.stringify(amendment, null, 2)}\n`, "utf8");
    const confirmation = JSON.parse(await runCliInDir(sample.projectRoot, [
      "indexer", "confirm-overlay-question-amendment",
      "--input", amendmentPath,
      "--authority", "managed",
      "--confirmed-by", "authority:managed-project",
      "--confirmed-at", NOW.toISOString(),
      "--format", "json",
    ]));
    const rebindInput = buildIndexerOverlayQuestionRebindInput({
      validation_input: sample.validationInput,
      validation_result: sample.validationResult,
      base_registry: sample.baseRegistry,
      amendment,
      confirmation,
      base_static_report: sample.baseStatic,
      base_final_report: sample.baseFinal,
      resolved: [sample.resolved],
      customizations: [sample.customization],
    });
    const rebindInputPath = join(sample.projectRoot, "overlay-question-rebind-input.json");
    await writeFile(rebindInputPath, `${JSON.stringify(rebindInput, null, 2)}\n`, "utf8");
    const rebound = JSON.parse(await runCliInDir(sample.projectRoot, [
      "indexer", "rebind-indexer-selection-to-requirement",
      "--input", rebindInputPath,
      "--format", "json",
    ]));
    const coupledProposalPath = join(sample.projectRoot, "overlay-question-project-proposal.json");
    await writeFile(
      coupledProposalPath,
      `${JSON.stringify(rebound.proposal, null, 2)}\n`,
      "utf8",
    );
    expect(JSON.parse(await runCliInDir(sample.projectRoot, [
      "indexer", "stage-indexer-project-proposal",
      "--input", coupledProposalPath,
      "--format", "json",
    ]))).toMatchObject({ proposal_digest: rebound.proposal.proposal_digest });
    const applyInputPath = join(sample.projectRoot, "overlay-question-apply-input.json");
    await writeFile(applyInputPath, `${JSON.stringify({
      protocol: "context.indexer.overlay-question-project-apply-input/v1",
      rebind_receipt: rebound.rebind_receipt,
    }, null, 2)}\n`, "utf8");
    const applied = JSON.parse(await runCliInDir(sample.projectRoot, [
      "indexer", "apply-indexer-project",
      "--proposal", rebound.proposal.proposal_digest,
      "--validation-input", applyInputPath,
      "--format", "json",
    ]));
    expect(applied).toMatchObject({
      proposal_digest: rebound.proposal.proposal_digest,
      requirement_set_digest: amendment.target_requirement_set_digest,
      indexer_selection_digest: sample.baseFinal.indexer_selection_digest,
    });
  }, INDEXER_OVERLAY_TEST_TIMEOUT_MS);

  test("recovers every apply boundary and leaves a tracked-only checkout wholly old or new", async () => {
    const failurePoints = [
      "after-initial-journal-write",
      "after-initial-journal-fsync",
      "after-initial-journal-rename",
      "after-initial-journal-dir-fsync",
      "after-target-write:src/indexers.yaml",
      "after-target-fsync:src/indexers.yaml",
      "after-target-rename:src/indexers.yaml",
      "after-target-dir-fsync:src/indexers.yaml",
      "after-progress-journal-write",
      "after-progress-journal-fsync",
      "after-progress-journal-rename",
      "after-progress-journal-dir-fsync",
      "after-transaction-remove",
      "after-transaction-remove-dir-fsync",
    ];
    for (const failurePoint of failurePoints) {
      const sample = await fixture();
      const prepared = await prepareCoupledProposal(sample);
      await stageIndexerOverlayQuestionRegistryApplyProposal({
        projectRoot: sample.projectRoot,
        proposal: prepared.proposal,
      });
      await expect(applyIndexerOverlayQuestionRegistryProposal({
        projectRoot: sample.projectRoot,
        proposal_digest: prepared.proposal.proposal_digest,
        rebind_receipt: prepared.rebind,
        inject_failure: (point) => {
          if (point === failurePoint) throw new Error(`crash:${failurePoint}`);
        },
      })).rejects.toThrow(`crash:${failurePoint}`);
      const afterCrash = await readFile(
        join(sample.projectRoot, "src", "indexers.yaml"),
        "utf8",
      );
      expect([sample.baseContent, prepared.targetContent]).toContain(afterCrash);

      const copiedRoot = await mkdtemp(join(tmpdir(), "context-overlay-tracked-copy-"));
      temporaryRoots.push(copiedRoot);
      await mkdir(join(copiedRoot, "src"), { recursive: true });
      await copyFile(
        join(sample.projectRoot, "package.json"),
        join(copiedRoot, "package.json"),
      );
      await copyFile(
        join(sample.projectRoot, "src", "indexers.yaml"),
        join(copiedRoot, "src", "indexers.yaml"),
      );
      const copied = parseIndexerRegistry(
        await readFile(join(copiedRoot, "src", "indexers.yaml"), "utf8"),
      );
      expect(copied.indexers).toEqual(sample.baseRegistry.indexers);
      expect([0, 1]).toContain(copied.requirements[0]!.questions?.length ?? 0);

      await applyIndexerOverlayQuestionRegistryProposal({
        projectRoot: sample.projectRoot,
        proposal_digest: prepared.proposal.proposal_digest,
        rebind_receipt: prepared.rebind,
      });
      expect(await readFile(join(sample.projectRoot, "src", "indexers.yaml"), "utf8"))
        .toBe(prepared.targetContent);
    }
  }, 240_000);
});
