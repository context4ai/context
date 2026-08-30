import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildIndexerDependencyIntentSet,
  buildIndexerCustomizationPlan,
  buildIndexerProjectProposal,
  buildIndexerProviderRouteInput,
  buildIndexerProviderRouteReport,
  indexerProjectContentDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  type IndexerProjectProposal,
  type IndexerRegistry,
} from "@c4a/context";
import {
  applyIndexerProjectProposal,
  loadStagedIndexerProjectProposal,
  stageIndexerProjectProposal,
} from "../project/indexerProjectApply.js";
import { indexerProjectManagedConfirmation } from
  "../project/indexerProjectGateRoute.js";
import { validateIndexerProjectCustomizationGap } from
  "../project/indexerProjectFlow.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const REPORT = digest("e");

function registry(version: string): IndexerRegistry {
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
        version,
        integrity: version === "1.2.0" ? digest("a") : digest("b"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-indexer-sample",
        },
        config: {},
      }],
    }],
  }));
}

function snapshot(value: IndexerRegistry, content: string) {
  return {
    document_digest: indexerProjectContentDigest(content),
    requirement_set_digest: indexerRegistryDigests(value).requirementSetDigest,
    indexer_selection_digest: indexerRegistryDigests(value).indexerSelectionDigest,
    registry_digest: indexerRegistryDigests(value).registryDigest,
  };
}

function proposal(): { proposal: IndexerProjectProposal; base: string; target: string } {
  const baseDocument = registry("1.2.0");
  const targetDocument = registry("1.3.0");
  const base = YAML.stringify(baseDocument);
  const target = YAML.stringify(targetDocument);
  const baseSnapshot = snapshot(baseDocument, base);
  const targetSnapshot = snapshot(targetDocument, target);
  const value = buildIndexerProjectProposal({
    protocol: "context.indexer.project-proposal/v1",
    project_ref: "project/sample",
    mode: "registry-only",
    requirement_set_digest: baseSnapshot.requirement_set_digest,
    base_registry: baseSnapshot,
    target_registry: targetSnapshot,
    target_document: targetDocument,
    targets: [{
      path: "src/indexers.yaml",
      operation: "write",
      base_digest: baseSnapshot.document_digest,
      target_digest: targetSnapshot.document_digest,
      content: target,
    }],
    dependencies: buildIndexerDependencyIntentSet([]),
    capability_gap_digest: null,
    finalized_validation_report_digests: [REPORT],
    program_execution_policy_digest: null,
  });
  return { proposal: value, base, target };
}

async function workspace(): Promise<{
  root: string;
  proposal: IndexerProjectProposal;
  base: string;
  target: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-project-apply-"));
  const fixture = proposal();
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "indexers.yaml"), fixture.base, "utf8");
  return { root, ...fixture };
}

describe("staged Indexer project apply", () => {
  test("accepts customization only from the exact final CLI capability-gap proof", () => {
    const customized = structuredClone(proposal().proposal);
    const gapRouteInput = buildIndexerProviderRouteInput({
      project_ref: customized.project_ref,
      registry: { ...customized.target_document, indexers: [] },
      visible_skills: [],
      community_fallback_attempted: true,
    });
    const gapRouteReport = buildIndexerProviderRouteReport(gapRouteInput);
    const gapDigest = gapRouteReport.capability_gap_proof!.gap_digest;
    customized.mode = "customization";
    customized.capability_gap_digest = gapDigest;
    customized.target_document.indexers[0]!.customization = { mode: "extend" };
    const primary = customized.target_document.indexers[0]!.providers[0]!;
    const plan = buildIndexerCustomizationPlan({
      project_ref: customized.project_ref,
      indexer_id: "sample-indexer",
      provider_integrity: primary.integrity,
      capability_gap_digest: gapDigest,
      selected_step: "instructions-append",
      rejected_smaller_steps: [
        {
          step: "provider-only",
          disposition: "insufficient",
          reason_code: "provider-only-insufficient",
          evidence_digest: digest("1"),
        },
        {
          step: "config",
          disposition: "unsupported",
          reason_code: "config-unsupported",
          evidence_digest: digest("2"),
        },
      ],
      affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
      introduces_external_dependencies: false,
    });
    const customization = {
      protocol: "context.indexer.customization-view/v1" as const,
      indexer_id: "sample-indexer",
      mode: "extend" as const,
      provider: {
        skill: primary.skill,
        version: primary.version,
        integrity: primary.integrity,
      },
      files: [],
      plan,
      upstream_review_required: false,
      fingerprint: digest("3"),
    };
    const gap = { route_input: gapRouteInput, route_report: gapRouteReport };
    expect(() => validateIndexerProjectCustomizationGap({
      proposal: customized,
      capability_gap: gap,
      customizations: [customization],
    })).not.toThrow();
    expect(() => validateIndexerProjectCustomizationGap({
      proposal: customized,
      capability_gap: undefined,
      customizations: [customization],
    })).toThrow(/requires a CLI capability-gap proof/);

    const forgedReport = structuredClone(gapRouteReport);
    forgedReport.capability_gap_proof!.gaps[0]!.capability = "invented-gap";
    expect(() => validateIndexerProjectCustomizationGap({
      proposal: customized,
      capability_gap: { route_input: gapRouteInput, route_report: forgedReport },
      customizations: [customization],
    })).toThrow(/stale or invalid/);
  });

  test("delegates only registry-only or dependency-free extend project confirmation", () => {
    const safe = proposal().proposal;
    expect(indexerProjectManagedConfirmation({ proposal: safe })).toEqual({
      eligible: true,
      blockers: [],
    });

    const extend = structuredClone(safe);
    extend.mode = "customization";
    extend.target_document.indexers[0]!.customization = { mode: "extend" };
    expect(indexerProjectManagedConfirmation({ proposal: extend })).toEqual({
      eligible: true,
      blockers: [],
    });

    const replace = structuredClone(extend);
    replace.target_document.indexers[0]!.customization = { mode: "replace" };
    expect(indexerProjectManagedConfirmation({ proposal: replace })).toEqual({
      eligible: false,
      blockers: ["replace-customization"],
    });

    const dependency = structuredClone(extend);
    dependency.dependencies.intents.push({
      package: "example-package",
      version: "1.0.0",
      kind: "runtime",
      importers: ["src/indexer/sample-indexer/index.ts"],
      state: "requires-authorization",
      install_scripts: false,
    });
    expect(indexerProjectManagedConfirmation({ proposal: dependency })).toEqual({
      eligible: false,
      blockers: ["external-dependencies"],
    });
  });

  test("stages content-addressed proposal without src writes and applies after exact validation", async () => {
    const fixture = await workspace();
    const first = await stageIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal: fixture.proposal,
    });
    const second = await stageIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal: fixture.proposal,
    });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await readFile(join(fixture.root, "src", "indexers.yaml"), "utf8")).toBe(
      fixture.base,
    );
    expect((await loadStagedIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal_digest: fixture.proposal.proposal_digest,
    })).proposal_digest).toBe(fixture.proposal.proposal_digest);

    const receipt = await applyIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal_digest: fixture.proposal.proposal_digest,
      validate_staging: async () => [REPORT],
    });
    expect(receipt.recovered).toBe(false);
    expect(receipt.registry_document_digest).toBe(fixture.proposal.target_registry.document_digest);
    expect(await readFile(join(fixture.root, "src", "indexers.yaml"), "utf8")).toBe(
      fixture.target,
    );
  });

  test("rejects stale validation reports and base CAS without changing source", async () => {
    const validationFixture = await workspace();
    await stageIndexerProjectProposal({
      projectRoot: validationFixture.root,
      proposal: validationFixture.proposal,
    });
    await expect(applyIndexerProjectProposal({
      projectRoot: validationFixture.root,
      proposal_digest: validationFixture.proposal.proposal_digest,
      validate_staging: async () => [digest("f")],
    })).rejects.toThrow(/validation reports are stale/);
    expect(await readFile(join(validationFixture.root, "src", "indexers.yaml"), "utf8"))
      .toBe(validationFixture.base);

    const casFixture = await workspace();
    await stageIndexerProjectProposal({
      projectRoot: casFixture.root,
      proposal: casFixture.proposal,
    });
    await writeFile(join(casFixture.root, "src", "indexers.yaml"), "external change\n", "utf8");
    await expect(applyIndexerProjectProposal({
      projectRoot: casFixture.root,
      proposal_digest: casFixture.proposal.proposal_digest,
      validate_staging: async () => [REPORT],
    })).rejects.toThrow(/mixed or stale CAS state/);
    expect(await readFile(join(casFixture.root, "src", "indexers.yaml"), "utf8"))
      .toBe("external change\n");
  });

  test("finishes an interrupted apply on retry only after rerunning staging validation", async () => {
    const fixture = await workspace();
    await stageIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal: fixture.proposal,
    });
    await expect(applyIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal_digest: fixture.proposal.proposal_digest,
      validate_staging: async () => [REPORT],
      inject_failure: (point) => {
        if (point === "after-target-rename:src/indexers.yaml") throw new Error("crash");
      },
    })).rejects.toThrow("crash");

    let validations = 0;
    const receipt = await applyIndexerProjectProposal({
      projectRoot: fixture.root,
      proposal_digest: fixture.proposal.proposal_digest,
      validate_staging: async () => {
        validations += 1;
        return [REPORT];
      },
    });
    expect(receipt.recovered).toBe(true);
    expect(validations).toBe(1);
    expect(await readFile(join(fixture.root, "src", "indexers.yaml"), "utf8")).toBe(
      fixture.target,
    );
  });
});
