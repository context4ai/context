import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerParserCoordinateMapping,
  buildIndexerParserDependencyIntentSet,
  buildIndexerParserResolutionLock,
  authorizeIndexerDependencies,
  indexerParserExecutionEntryDigest,
  indexerProtocolDigest,
} from "@c4a/context";
import {
  bundledIndexerOperatorContract,
  bundledIndexerProfileContract,
} from "../project/indexerBaseContracts.js";
import { buildProjectIndexerParserExecutionPlan } from
  "../project/indexerParserExecutionPlanning.js";
import { executeProjectIndexerParserPlan } from
  "../project/indexerParserRuntimeExecution.js";

const digest = (label: string) => indexerProtocolDigest({ label });
const contentDigest = (content: string) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

function lockedDependencies(input: {
  requirement: Parameters<typeof buildIndexerParserDependencyIntentSet>[0]["requirements"][number];
  mapping: Parameters<typeof buildIndexerParserDependencyIntentSet>[0]["mappings"][number];
  lock: ReturnType<typeof buildIndexerParserResolutionLock>;
}) {
  const preview = buildIndexerParserDependencyIntentSet({
    requirements: [input.requirement],
    mappings: [input.mapping],
  });
  const authorized = authorizeIndexerDependencies({
    dependencies: preview,
    resolutions: [{
      package: input.lock.actual_coordinate.package,
      version: input.lock.actual_coordinate.version,
      lock_integrity: input.lock.lock_integrity,
      resolved_digest: input.lock.resolved_content_digest,
    }],
    authority_ref: "authority:fixture-dependency-installer",
    authority_scope_digest: digest("dependency-authority"),
  });
  return buildIndexerParserDependencyIntentSet({
    requirements: [input.requirement],
    mappings: [input.mapping],
    authorization_receipt: authorized.receipt,
  });
}

describe("0.7.4 parser runtime execution", () => {
  test("loads, executes, validates, and authority-merges the CLI-owned config adapter", async () => {
    const operators = bundledIndexerOperatorContract();
    const profiles = bundledIndexerProfileContract(operators);
    const requirement = profiles.profiles.find((profile) =>
      profile.id === "monorepo-container"
    )!.parser_requirements.find((candidate) => candidate.capability === "parser.json")!;
    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm",
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-Y29udGV4dC1jb25maWctYWRhcHRlcg==",
      resolved_content_digest: digest("extract-package"),
    });
    const content = JSON.stringify({ mode: "production", secret: "must-not-leak" });
    const plan = buildProjectIndexerParserExecutionPlan({
      profile_contract: profiles,
      profile_id: "monorepo-container",
      source_registry_digest: digest("source-registry"),
      authorized_files: [{
        source_ref: "source:fixture-repository",
        module_ref: "module:fixture-project",
        normalized_path: "config/app.json",
        content_digest: contentDigest(content),
      }],
      parser_locks: [lock],
    });
    const entry = plan.entries[0]!;
    const receipt = await executeProjectIndexerParserPlan({
      projectRoot: process.cwd(),
      profile_contract: profiles,
      profile_id: "monorepo-container",
      execution_plan: plan,
      dependencies: lockedDependencies({ requirement, mapping, lock }),
      mappings: [mapping],
      locks: [lock],
      entry_inputs: [{
        entry_digest: indexerParserExecutionEntryDigest(entry),
        files: { "config/app.json": content },
      }],
    });

    expect(receipt.import_receipts).toHaveLength(1);
    expect(receipt.adapter_results).toHaveLength(1);
    expect(receipt.merge.primary_owners).toEqual([expect.objectContaining({
      capability: "parser.json",
      authority_domain: "configuration-semantics",
      disposition: "analyzed",
    })]);
    expect(receipt.merge.facts.some((fact) => fact.kind === "config-value")).toBe(true);
    expect(receipt.source_bindings).toHaveLength(1);
    expect(receipt.source_bindings[0]).toEqual(expect.objectContaining({
      source_ref: "source:fixture-repository",
      module_ref: "module:fixture-project",
      source_merge_digest: expect.stringMatching(/^sha256:/),
      source_toolchain_digest: expect.stringMatching(/^sha256:/),
      binding_digest: expect.stringMatching(/^sha256:/),
    }));
    expect(
      receipt.source_bindings[0]!.source_identity_inventory.files[0]!.facts.length,
    ).toBeGreaterThan(0);
    expect(receipt.fact_views).toHaveLength(1);
    expect(receipt.fact_views[0]).toEqual(expect.objectContaining({
      protocol: "context.indexer.parser-fact-view/v1",
      inventory_digest:
        receipt.source_bindings[0]!.source_identity_inventory.inventory_digest,
    }));
    expect(JSON.stringify(receipt.fact_views)).toContain('"key_path":["mode"]');
    expect(JSON.stringify(receipt.fact_views)).not.toContain("production");
    expect(JSON.stringify(receipt)).not.toContain("must-not-leak");
  });

  test("rejects stale source content before importing the parser", async () => {
    const operators = bundledIndexerOperatorContract();
    const profiles = bundledIndexerProfileContract(operators);
    const requirement = profiles.profiles.find((profile) =>
      profile.id === "monorepo-container"
    )!.parser_requirements.find((candidate) => candidate.capability === "parser.json")!;
    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm",
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-Y29udGV4dC1jb25maWctYWRhcHRlcg==",
      resolved_content_digest: digest("extract-package"),
    });
    const plan = buildProjectIndexerParserExecutionPlan({
      profile_contract: profiles,
      profile_id: "monorepo-container",
      source_registry_digest: digest("source-registry"),
      authorized_files: [{
        source_ref: "source:fixture-repository",
        module_ref: "module:fixture-project",
        normalized_path: "config/app.json",
        content_digest: contentDigest("{}"),
      }],
      parser_locks: [lock],
    });
    const entry = plan.entries[0]!;

    await expect(executeProjectIndexerParserPlan({
      projectRoot: process.cwd(),
      profile_contract: profiles,
      profile_id: "monorepo-container",
      execution_plan: plan,
      dependencies: lockedDependencies({ requirement, mapping, lock }),
      mappings: [mapping],
      locks: [lock],
      entry_inputs: [{
        entry_digest: indexerParserExecutionEntryDigest(entry),
        files: { "config/app.json": "{\"changed\":true}" },
      }],
    })).rejects.toThrow(/source content is stale/);
  });

  test("changes only the affected source binding when another module stays current", async () => {
    const profiles = bundledIndexerProfileContract(bundledIndexerOperatorContract());
    const requirement = profiles.profiles.find((profile) =>
      profile.id === "monorepo-container"
    )!.parser_requirements.find((candidate) => candidate.capability === "parser.json")!;
    const mapping = buildIndexerParserCoordinateMapping({
      requirement,
      resolution: "direct",
      registry: "npm",
      actual_coordinate: requirement.community_coordinate,
      abi_digest: requirement.abi_digest,
    });
    const lock = buildIndexerParserResolutionLock({
      requirement,
      mapping,
      lock_integrity: "sha512-c291cmNlLWJpbmRpbmdz",
      resolved_content_digest: digest("extract-package"),
    });
    const sourceRegistryDigest = digest("source-registry");
    const run = async (moduleAContent: string) => {
      const moduleBContent = JSON.stringify({ module: "b" });
      const plan = buildProjectIndexerParserExecutionPlan({
        profile_contract: profiles,
        profile_id: "monorepo-container",
        source_registry_digest: sourceRegistryDigest,
        authorized_files: [{
          source_ref: "source:fixture-repository",
          module_ref: "module:web",
          normalized_path: "packages/a/config.json",
          content_digest: contentDigest(moduleAContent),
        }, {
          source_ref: "source:fixture-repository",
          module_ref: "module:web-sandbox",
          normalized_path: "packages/b/config.json",
          content_digest: contentDigest(moduleBContent),
        }],
        parser_locks: [lock],
      });
      return executeProjectIndexerParserPlan({
        projectRoot: process.cwd(),
        profile_contract: profiles,
        profile_id: "monorepo-container",
        execution_plan: plan,
        dependencies: lockedDependencies({ requirement, mapping, lock }),
        mappings: [mapping],
        locks: [lock],
        entry_inputs: plan.entries.map((entry) => ({
          entry_digest: indexerParserExecutionEntryDigest(entry),
          files: Object.fromEntries(entry.files.map((file) => [
            file.normalized_path,
            entry.module_ref === "module:web" ? moduleAContent : moduleBContent,
          ])),
        })),
      });
    };
    const before = await run(JSON.stringify({ module: "a", revision: 1 }));
    const after = await run(JSON.stringify({ module: "a", revision: 2 }));
    const beforeByModule = new Map(before.source_bindings.map((binding) => [
      binding.module_ref,
      binding.binding_digest,
    ]));
    const afterByModule = new Map(after.source_bindings.map((binding) => [
      binding.module_ref,
      binding.binding_digest,
    ]));

    expect(after.source_bindings.map((binding) => binding.module_ref)).toEqual([
      "module:web",
      "module:web-sandbox",
    ]);
    expect(afterByModule.get("module:web")).not.toBe(beforeByModule.get("module:web"));
    expect(afterByModule.get("module:web-sandbox")).toBe(
      beforeByModule.get("module:web-sandbox"),
    );
  });
});
