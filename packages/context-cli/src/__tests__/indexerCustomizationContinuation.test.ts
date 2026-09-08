import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { buildIndexerProviderRouteInput, buildIndexerProviderRouteReport, parseIndexerRegistry } from "@c4a/context";
import { listCliBundledIndexers, loadCliIndexerBaseContracts } from "../project/indexerCliBundledProvider.js";
import { stageCurrentIndexerProviderResolution } from "../project/indexerCurrentProviderSetup.js";
import { validateAndStageProjectIndexerCustomizationDraft } from "../project/indexerCustomizationDraftStage.js";
import { prepareProjectIndexerCustomizationProposal } from "../project/indexerCustomizationProjectPreparation.js";
import { dispatchProjectIndexerProviderResolution } from "../project/indexerProviderProjectFlow.js";
import { validateProjectIndexerSelectionProposal } from "../project/indexerSelectionProposal.js";
import { applyProjectIndexerProposal, validateIndexerProjectCustomizationGap } from "../project/indexerProjectFlow.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("adding one Indexer customization preserves an existing customized Indexer through prepare and apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-customization-resume-"));
  roots.push(root);
  const bundle = (await listCliBundledIndexers()).bundles.find((item) => item.skill === "context-code-indexer")!;
  const registry = parseIndexerRegistry(YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: ["first", "second"].map((id) => ({ id,
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required", ...(id === "second" ? { public_contract: "required" } : {}) },
      target_scope: { targets: [{ source_ref: `repo:${id}`, module_refs: [] }] },
      evidence_source_scope: { targets: [{ source_ref: `repo:${id}`, module_refs: [] }] },
    })),
    indexers: ["first", "second"].map((id) => ({ id,
      operations: ["main-index"],
      requirement_bindings: [{ requirement_ref: id, coverage_domains: ["architecture"],
        owned_scope: { ref: `requirement:${id}#target_scope` }, role: "primary" }],
      read_scope: { refs: [`requirement:${id}#target_scope`] },
      profile: { primary: { id: "component-library", provider: "primary" } },
      providers: [{ id: "primary", role: "primary", skill: bundle.skill, version: bundle.version,
        integrity: bundle.integrity, distribution: bundle.distribution }],
      ...(id === "first" ? { customization: { mode: "extend" } } : {}),
    })),
  }));
  const origin = `<!-- @context-indexer-origin ${bundle.skill}@${bundle.version} profile=component-library -->\n`;
  const existing = `${origin}Use the existing domain vocabulary.\n`;
  const firstPath = join(root, "src/indexer/first/instructions.md");
  await mkdir(join(root, "src/indexer/first"), { recursive: true });
  await writeFile(firstPath, existing);
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify(registry));
  const routeInput = buildIndexerProviderRouteInput({ project_ref: "project:customization-resume", registry,
    visible_skills: [{ skill: bundle.skill, version: bundle.version, source_type: "cli-bundled" }],
    community_fallback_attempted: true });
  const routeReport = buildIndexerProviderRouteReport(routeInput);
  const validation = await validateAndStageProjectIndexerCustomizationDraft({ projectRoot: root, draft: {
    protocol: "context.indexer.customization-proposal-draft/v1",
    capability_gap: { route_input: routeInput, route_report: routeReport },
    capability_gap_digest: routeReport.capability_gap_proof!.gap_digest,
    indexer_id: "second", mode: "extend", selected_step: "instructions-append",
    rejected_smaller_steps: ["provider-only", "config"].map((step) => ({ step, disposition: "insufficient",
      reason_code: "terminology-required", evidence_digest: bundle.integrity })),
    gap_summary: "Explain the project terminology for public interfaces.",
    affected_scope_refs: ["requirement:second#target_scope"],
    files: [{ path: "src/indexer/second/instructions.md", content: `${origin}Explain the public interface terminology.\n` }],
    dependency_intents: [],
  } });
  const selection = await validateProjectIndexerSelectionProposal({
    projectRoot: root, value: validation.selection_proposal_input,
  });
  const resolved = [];
  for (const request of selection.resolution_requests) {
    const resolution = await dispatchProjectIndexerProviderResolution({ projectRoot: root, selection: selection.proposal, request });
    if (resolution.state !== "resolved") throw new Error("expected a bundled Provider");
    resolved.push((await stageCurrentIndexerProviderResolution({ projectRoot: root,
      projectRef: selection.proposal.project_ref, proposal: selection.proposal, request, resolution })).resolved);
  }
  const contracts = await loadCliIndexerBaseContracts();
  const prepared = await prepareProjectIndexerCustomizationProposal({ projectRoot: root, value: {
    protocol: "context.indexer.customization-project-preparation-input/v1",
    validation_digest: validation.validated.validation_digest, static_report: selection.static_report,
    resolved, operator_contract: contracts.operators, profile_contract: contracts.profiles,
  } });
  if (prepared.outcome !== "project-confirmation-required") throw new Error("expected text customization proposal");
  const oldView = prepared.staging_validation.customizations.find((item) => item.indexer_id === "first")!;
  expect(oldView.files).toHaveLength(1);
  expect(oldView.plan.capability_gap_digest).not.toBe(prepared.proposal.capability_gap_digest);
  expect(prepared.proposal.targets.map((item) => item.path)).toEqual(["src/indexer/second/instructions.md", "src/indexers.yaml"]);
  // A new customization still needs this proposal's proof; accepting an old
  // proof for the untouched Indexer must not weaken the changed one.
  expect(() => validateIndexerProjectCustomizationGap({ proposal: prepared.proposal,
    capability_gap: prepared.staging_validation.capability_gap,
    customizations: prepared.staging_validation.customizations.map((item) => item.indexer_id === "second"
      ? { ...item, plan: { ...item.plan, capability_gap_digest: oldView.plan.capability_gap_digest } } : item),
  })).toThrow(/current CLI capability gap/);
  await applyProjectIndexerProposal({ projectRoot: root,
    proposal_digest: prepared.proposal.proposal_digest, validation: prepared.staging_validation });
  expect(await readFile(firstPath, "utf8")).toBe(existing);
  expect(await readFile(join(root, "src/indexer/second/instructions.md"), "utf8")).toContain("public interface terminology");
  const applied = parseIndexerRegistry(await readFile(join(root, "src/indexers.yaml"), "utf8"));
  expect(applied.indexers.every((item) => item.customization?.mode === "extend")).toBe(true);
});
