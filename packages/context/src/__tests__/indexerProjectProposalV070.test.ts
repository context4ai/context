import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  authorizeIndexerDependencies,
  buildIndexerDependencyIntentSet,
  buildIndexerProjectProposal,
  indexerProjectContentDigest,
  indexerRegistryDigests,
  parseIndexerRegistry,
  validateIndexerProjectProposal,
  validateIndexerDependencyIntentSet,
  type IndexerProjectProposal,
  type IndexerRegistry,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function registry(customization = false): IndexerRegistry {
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
        integrity: digest("a"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-indexer-sample",
        },
        config: {},
      }],
      ...(customization ? { customization: { mode: "extend" } } : {}),
    }],
  }));
}

function registryContent(value: IndexerRegistry): string {
  return YAML.stringify(value);
}

function snapshot(value: IndexerRegistry, content: string) {
  return {
    document_digest: indexerProjectContentDigest(content),
    requirement_set_digest: indexerRegistryDigests(value).requirementSetDigest,
    indexer_selection_digest: indexerRegistryDigests(value).indexerSelectionDigest,
    registry_digest: indexerRegistryDigests(value).registryDigest,
  };
}

function baseProposal(customization = false): Omit<IndexerProjectProposal, "proposal_digest"> {
  const targetDocument = registry(customization);
  const content = registryContent(targetDocument);
  const current = snapshot(targetDocument, content);
  return {
    protocol: "context.indexer.project-proposal/v1",
    project_ref: "project/sample",
    mode: customization ? "customization" : "registry-only",
    requirement_set_digest: current.requirement_set_digest,
    base_registry: structuredClone(current),
    target_registry: structuredClone(current),
    target_document: targetDocument,
    targets: [{
      path: "src/indexers.yaml",
      operation: "write",
      base_digest: current.document_digest,
      target_digest: current.document_digest,
      content,
    }],
    dependencies: buildIndexerDependencyIntentSet([]),
    capability_gap_digest: customization ? digest("b") : null,
    finalized_validation_report_digests: [digest("c")],
    program_execution_policy_digest: null,
  };
}

describe("staged Indexer project proposal", () => {
  test("binds a registry-only target without changing requirement authority", () => {
    const proposal = buildIndexerProjectProposal(baseProposal());
    expect(validateIndexerProjectProposal(proposal, { apply_ready: true })).toEqual(proposal);
    expect(proposal.targets.map((target) => target.path)).toEqual(["src/indexers.yaml"]);
    expect(proposal.dependencies.intents).toEqual([]);
  });

  test("binds minimal customization, exact locked dependencies, package/lock, and policy", () => {
    const input = baseProposal(true);
    const localContent = [
      "// @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library",
      "export {};",
      "",
    ].join("\n");
    const packageContent = "{\"dependencies\":{\"example-parser\":\"1.0.0\"}}\n";
    const lockContent = "lockfileVersion: 1\n";
    input.targets = [
      {
        path: "package.json",
        operation: "write",
        base_digest: digest("1"),
        target_digest: indexerProjectContentDigest(packageContent),
        content: packageContent,
      },
      {
        path: "pnpm-lock.yaml",
        operation: "write",
        base_digest: digest("2"),
        target_digest: indexerProjectContentDigest(lockContent),
        content: lockContent,
      },
      {
        path: "src/indexer/sample-indexer/index.ts",
        operation: "write",
        base_digest: null,
        target_digest: indexerProjectContentDigest(localContent),
        content: localContent,
      },
      input.targets[0]!,
    ];
    const authorization = authorizeIndexerDependencies({
      dependencies: buildIndexerDependencyIntentSet([{
        package: "example-parser",
        version: "1.0.0",
        kind: "runtime",
        importers: ["src/indexer/sample-indexer/index.ts"],
        state: "requires-authorization",
        install_scripts: false,
      }]),
      resolutions: [{
        package: "example-parser",
        version: "1.0.0",
        lock_integrity: "sha512-QUJD",
        resolved_digest: digest("3"),
      }],
      authority_ref: "host:dependency-install",
      authority_scope_digest: digest("5"),
    });
    input.dependencies = authorization.dependencies;
    input.program_execution_policy_digest = digest("4");
    const proposal = buildIndexerProjectProposal(input);
    expect(validateIndexerProjectProposal(proposal, { apply_ready: true })).toEqual(proposal);
  });

  test("blocks unresolved dependencies at apply and rejects undeclared customization paths", () => {
    const input = baseProposal(true);
    const content = "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->\n";
    input.targets = [{
      path: "src/indexer/other-indexer/instructions.md",
      operation: "write" as const,
      base_digest: null,
      target_digest: indexerProjectContentDigest(content),
      content,
    }, input.targets[0]!].sort((left, right) => left.path < right.path ? -1 : 1);
    expect(() => buildIndexerProjectProposal(input)).toThrow(/fixed workspace surface/);

    const dependencyInput = baseProposal(true);
    dependencyInput.targets = [{
      path: "package.json",
      operation: "write",
      base_digest: digest("1"),
      target_digest: indexerProjectContentDigest("{}\n"),
      content: "{}\n",
    }, {
      path: "pnpm-lock.yaml",
      operation: "write",
      base_digest: digest("2"),
      target_digest: indexerProjectContentDigest("lockfileVersion: 1\n"),
      content: "lockfileVersion: 1\n",
    }, {
      path: "src/indexer/sample-indexer/index.ts",
      operation: "write",
      base_digest: null,
      target_digest: indexerProjectContentDigest("export {};\n"),
      content: "export {};\n",
    }, dependencyInput.targets[0]!];
    dependencyInput.targets.sort((left, right) => left.path < right.path ? -1 : 1);
    dependencyInput.dependencies = buildIndexerDependencyIntentSet([{
      package: "example-parser",
      version: "1.0.0",
      kind: "runtime",
      importers: ["src/indexer/sample-indexer/index.ts"],
      state: "requires-authorization",
      install_scripts: false,
    }]);
    dependencyInput.program_execution_policy_digest = digest("4");
    const proposal = buildIndexerProjectProposal(dependencyInput);
    expect(() => validateIndexerProjectProposal(proposal, { apply_ready: true })).toThrow(
      /unauthorized\/unlocked/,
    );
  });

  test("binds dependency authorization to the exact unresolved set and fails closed", () => {
    const unresolved = buildIndexerDependencyIntentSet([{
      package: "example-parser",
      version: "1.0.0",
      kind: "runtime",
      importers: ["src/indexer/sample-indexer/index.ts"],
      state: "requires-authorization",
      install_scripts: false,
    }]);
    const input = {
      dependencies: unresolved,
      resolutions: [{
        package: "example-parser",
        version: "1.0.0",
        lock_integrity: "sha512-QUJD",
        resolved_digest: digest("3"),
      }],
      authority_ref: "host:dependency-install",
      authority_scope_digest: digest("5"),
    };
    const authorized = authorizeIndexerDependencies(input);
    expect(authorized.receipt).toMatchObject({
      request_intent_set_digest: unresolved.intent_set_digest,
      install_scripts: false,
    });
    expect(authorized.dependencies.intents[0]).toMatchObject({
      state: "locked",
      install_scripts: false,
      authorization_receipt_digest: authorized.receipt.receipt_digest,
    });
    expect(validateIndexerDependencyIntentSet(authorized.dependencies))
      .toEqual(authorized.dependencies);

    expect(() => authorizeIndexerDependencies({
      ...input,
      resolutions: [{ ...input.resolutions[0]!, version: "1.0.1" }],
    })).toThrow(/do not close the exact intent set/);
    expect(() => buildIndexerDependencyIntentSet(
      authorized.dependencies.intents,
      [],
    )).toThrow(/no exact authorization receipt/);
    expect(() => authorizeIndexerDependencies({
      ...input,
      resolutions: [{ ...input.resolutions[0]!, install_scripts: true }],
    } as never)).toThrow();
  });

  test("rejects requirement changes, stale target bytes, and forged proposal digest", () => {
    const input = baseProposal();
    input.target_document.requirements[0]!.reader_goals = ["changed-goal"];
    const changedContent = registryContent(input.target_document);
    input.targets[0]!.content = changedContent;
    input.targets[0]!.target_digest = indexerProjectContentDigest(changedContent);
    input.target_registry.document_digest = input.targets[0]!.target_digest;
    input.target_registry.registry_digest = indexerRegistryDigests(
      input.target_document,
    ).registryDigest;
    expect(() => buildIndexerProjectProposal(input)).toThrow(/requirement\/registry authority/);

    const stale = baseProposal();
    stale.targets[0]!.content = `${stale.targets[0]!.content}# changed\n`;
    expect(() => buildIndexerProjectProposal(stale)).toThrow(/target digest/);

    const proposal = buildIndexerProjectProposal(baseProposal());
    const forged = structuredClone(proposal);
    forged.finalized_validation_report_digests[0] = digest("9");
    expect(() => validateIndexerProjectProposal(forged)).toThrow(/proposal digest/);
  });
});
