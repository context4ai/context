import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  buildIndexerDependencyIntentSet,
  buildIndexerProjectProposal,
  indexerProjectContentDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";
import { buildIndexerDependencyAuthorizationRoute } from
  "../project/indexerDependencyAuthorizationRoute.js";
import {
  loadStagedIndexerProjectProposal,
  stageIndexerProjectProposal,
} from "../project/indexerProjectApply.js";
import { CONTEXT_WORKFLOW_AUTHORITIES } from "../project/workflow/workflowTypes.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-dependency-authorization-"));
  const registry = parseIndexerRegistry(YAML.stringify({
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
        integrity: digest("a"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-indexer-sample",
        },
        config: {},
      }],
      customization: { mode: "extend" },
    }],
  }));
  const registryContent = YAML.stringify(registry);
  const registryDigests = indexerRegistryDigests(registry);
  const registrySnapshot = {
    document_digest: indexerProjectContentDigest(registryContent),
    requirement_set_digest: registryDigests.requirementSetDigest,
    indexer_selection_digest: registryDigests.indexerSelectionDigest,
    registry_digest: registryDigests.registryDigest,
  };
  const programContent = "export {};\n";
  const packageTarget = "{\"dependencies\":{\"example-parser\":\"1.0.0\"}}\n";
  const lockTarget = "lockfileVersion: 1\n";
  const targets = [{
    path: "bun.lock",
    operation: "write" as const,
    base_digest: null,
    target_digest: indexerProjectContentDigest(lockTarget),
    content: lockTarget,
  }, {
    path: "package.json",
    operation: "write" as const,
    base_digest: null,
    target_digest: indexerProjectContentDigest(packageTarget),
    content: packageTarget,
  }, {
    path: "src/indexer/sample-indexer/index.ts",
    operation: "write" as const,
    base_digest: null,
    target_digest: indexerProjectContentDigest(programContent),
    content: programContent,
  }, {
    path: "src/indexers.yaml",
    operation: "write" as const,
    base_digest: registrySnapshot.document_digest,
    target_digest: registrySnapshot.document_digest,
    content: registryContent,
  }];
  const proposal = buildIndexerProjectProposal({
    protocol: "context.indexer.project-proposal/v1",
    project_ref: "project/sample",
    mode: "customization",
    requirement_set_digest: registrySnapshot.requirement_set_digest,
    base_registry: registrySnapshot,
    target_registry: registrySnapshot,
    target_document: registry,
    targets,
    dependencies: buildIndexerDependencyIntentSet([{
      package: "example-parser",
      version: "1.0.0",
      kind: "runtime",
      importers: ["src/indexer/sample-indexer/index.ts"],
      state: "requires-authorization",
      install_scripts: false,
    }]),
    capability_gap_digest: digest("b"),
    finalized_validation_report_digests: [digest("c")],
    program_execution_policy_digest: digest("d"),
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "indexers.yaml"), registryContent, "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "dependency-authorization-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  })}\n`, "utf8");
  await stageIndexerProjectProposal({ projectRoot: root, proposal });
  const resolution = {
    protocol: "context.indexer.dependency-authorization-resolution/v1" as const,
    authority_ref: "host:dependency-install",
    authority_scope_digest: digest("e"),
    resolutions: [{
      package: "example-parser",
      version: "1.0.0",
      lock_integrity: "sha512-QUJD",
      resolved_digest: digest("f"),
    }],
  };
  const resolutionPath = join(root, "dependency-resolution.json");
  await writeFile(resolutionPath, `${JSON.stringify(resolution, null, 2)}\n`, "utf8");
  return { root, proposal, registryContent, resolution, resolutionPath };
}

describe("Indexer dependency authorization Gate", () => {
  test("requires its independent authority and returns exact locked receipts without source writes", async () => {
    const sample = await fixture();
    const ordinary = await buildIndexerDependencyAuthorizationRoute({
      projectRoot: sample.root,
      proposal_digest: sample.proposal.proposal_digest,
      resolution: sample.resolution,
      resolutionInputRef: sample.resolutionPath,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.evidenceMaintenance],
    });
    const managed = await buildIndexerDependencyAuthorizationRoute({
      projectRoot: sample.root,
      proposal_digest: sample.proposal.proposal_digest,
      resolution: sample.resolution,
      resolutionInputRef: sample.resolutionPath,
      authorities: [CONTEXT_WORKFLOW_AUTHORITIES.indexerDependencyInstall],
    });
    expect(ordinary.route.gate).toMatchObject({
      id: "authorize-indexer-dependencies",
      authority: CONTEXT_WORKFLOW_AUTHORITIES.indexerDependencyInstall,
      resolution: "user",
      resolution_action: { input: ordinary.gate_input },
    });
    expect(ordinary.route.commands[0]?.availability).toBe("after-human-confirmation");
    expect(managed.route.gate?.resolution).toBe("session-authority");
    expect(managed.route.commands[0]?.availability).toBe("immediate");
    expect(managed.route.revision).toBe(ordinary.route.revision);
    expect(managed.gate_input.install_scripts).toBe(false);

    const result = JSON.parse(await runCliInDir(sample.root, [
      "indexer", "authorize-indexer-dependencies",
      "--proposal", sample.proposal.proposal_digest,
      "--input", sample.resolutionPath,
      "--format", "json",
    ]));
    expect(result.receipt).toMatchObject({
      request_intent_set_digest: sample.proposal.dependencies.intent_set_digest,
      install_scripts: false,
    });
    expect(result.dependencies.intents[0]).toMatchObject({
      state: "locked",
      install_scripts: false,
      authorization_receipt_digest: result.receipt.receipt_digest,
    });
    expect(result.authorized_proposal_digest).not.toBe(sample.proposal.proposal_digest);
    expect(result.stage_receipt.proposal_digest).toBe(result.authorized_proposal_digest);
    const authorizedProposal = await loadStagedIndexerProjectProposal({
      projectRoot: sample.root,
      proposal_digest: result.authorized_proposal_digest,
    });
    expect(authorizedProposal.dependencies).toEqual(result.dependencies);
    expect(await readFile(join(sample.root, "src", "indexers.yaml"), "utf8"))
      .toBe(sample.registryContent);
  });
});
