import { describe, expect, test } from "bun:test";
import {
  buildIndexerCustomizationPlan,
  buildIndexerProviderCompositionPlan,
  buildIndexerSkillCapability,
  indexerProfileContractDigest,
  indexerProviderManifestSchema,
  validateIndexerProviderCompositionPlan,
  validateIndexerSkillCapability,
  type IndexerProfileContract,
  type IndexerProviderManifest,
  type IndexerRegistryEntry,
} from "../index.js";
import { artifactPolicyContractsFixture } from "./indexerArtifactPolicyV070.fixture.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function profileContract(): IndexerProfileContract {
  const contract = structuredClone(artifactPolicyContractsFixture().profiles);
  contract.profiles[0]!.variant_schema = {
    axes: [{
      id: "library_mode",
      type: "enum",
      values: ["source", "generated-facade"],
      required: false,
    }],
  };
  const { contract_digest: _digest, ...payload } = contract;
  void _digest;
  return {
    ...payload,
    contract_digest: indexerProfileContractDigest(payload),
  };
}

function manifest(input: {
  id: string;
  profile: string;
  extension?: boolean;
  logicalIdentity?: string;
  toolSource?: boolean;
}): IndexerProviderManifest {
  return indexerProviderManifestSchema.parse({
    protocol: "context.indexer.provider/v1",
    id: input.id,
    version: "1.2.3",
    domains: ["code"],
    activation: {
      target_kinds: ["package"],
      required_signals: [{ id: "package-manifest", description: "Package manifest" }],
      supporting_signals: [],
      negative_signals: [],
    },
    provides: {
      profiles: [input.profile],
      operations: [{
        id: "main-index",
        consumes: "context.indexer.main-workset/v2",
        produces: "context.indexer.main-result/v1",
        accepts_layer_fragments: ["fact-enrichment"],
      }],
      ...(input.extension
        ? {
            layer_fragments: [{
              kind: "fact-enrichment",
              phase: "pre-authority",
              produces: "context.indexer.layer-fragment/v1",
            }],
            composers: [{
              id: "navigation",
              supported_profiles: ["component-library"],
            }],
          }
        : {}),
      source_roles: ["implementation"],
      ...(input.toolSource
        ? {
            tool_sources: [{
              id: "service-catalog-read",
              handler: "host.example.service-catalog/v1",
              request: "example.service-catalog-request/v1",
              produces: "context.indexer.tool-snapshot/v1",
              operations: ["get-method", "list-methods"],
              optional: true,
            }],
          }
        : {}),
      logical_units: [{
        id: "component",
        identity: input.logicalIdentity ?? "subject-key",
        artifacts: {
          recommended: ["reference"],
          supported_policy_variants: ["reference-page"],
        },
      }],
    },
    provider: {
      instructions: [{
        path: "references/authoring.md",
        profiles: [input.profile],
      }],
      templates: [{
        id: "reference",
        profile: input.profile,
        path: "templates/reference.md",
      }],
      forbidden_fallbacks: ["one-page-per-symbol"],
      completion_checks: ["artifact-bundle"],
    },
    customization: {
      supports: [
        "config",
        "instructions-append",
        "template-override",
        "program-extend",
      ],
      guide: "references/customization.md",
    },
    ...(input.extension
      ? {
          composition: {
            extensions: [{
              profile: input.profile,
              extends: "component-library",
              variant_schema: {
                axes: [{
                  id: "transport",
                  type: "enum",
                  values: ["http", "rpc"],
                  required: true,
                }],
              },
              subject_key_schema: {
                version: 1,
                namespace: { operator: "canonical-source-module-namespace" },
                kinds: [{
                  id: "component",
                  local_key: { operator: "canonical-export-family" },
                }],
              },
            }],
          },
        }
      : {}),
  });
}

function indexer(mode?: "extend" | "replace"): IndexerRegistryEntry {
  return {
    id: "public-indexer",
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "public-knowledge",
      coverage_domains: ["technical-structure"],
      owned_scope: { ref: "requirement:public-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: {
      refs: ["requirement:public-knowledge#target_scope"],
    },
    profile: {
      primary: {
        id: "component-library",
        provider: "base",
        variants: { library_mode: "source" },
      },
      additional: [{
        id: "example/framework-components",
        provider: "extension",
        kind: "extension",
        variants: { transport: "rpc" },
      }],
      composers: [{ id: "navigation", provider: "extension" }],
    },
    providers: [
      {
        id: "base",
        role: "primary",
        skill: "community-provider",
        version: "1.2.3",
        integrity: digest("a"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://community/community-provider",
        },
        config: { mode: "public" },
      },
      {
        id: "extension",
        role: "extension",
        skill: "example/framework-provider",
        version: "1.2.3",
        integrity: digest("b"),
        distribution: {
          kind: "marketplace",
          locator: "marketplace://public/example/framework-provider",
        },
        config: { feature: "navigation" },
      },
    ],
    ...(mode === undefined ? {} : { customization: { mode } }),
  };
}

function layers(input: { logicalIdentity?: string } = {}) {
  return [
    {
      layer_id: "base",
      provider_integrity: digest("a"),
      manifest_digest: digest("c"),
      manifest: manifest({
        id: "community-provider",
        profile: "component-library",
        toolSource: true,
      }),
    },
    {
      layer_id: "extension",
      provider_integrity: digest("b"),
      manifest_digest: digest("d"),
      manifest: manifest({
        id: "example/framework-provider",
        profile: "example/framework-components",
        extension: true,
        ...(input.logicalIdentity === undefined
          ? {}
          : { logicalIdentity: input.logicalIdentity }),
      }),
    },
  ];
}

function rejectedSteps(steps: Array<
  "provider-only" | "config" | "instructions-append" | "template-override" |
  "program-extend"
>) {
  return steps.map((step, index) => ({
    step,
    disposition: "insufficient" as const,
    reason_code: `${step}-insufficient`,
    evidence_digest: digest(String(index + 1)),
  }));
}

function providerOnlyCustomization() {
  return {
    mode: "none" as const,
    fingerprint: digest("e"),
    files: [],
    plan: buildIndexerCustomizationPlan({
      project_ref: "project:sample",
      indexer_id: "public-indexer",
      provider_integrity: digest("a"),
      capability_gap_digest: null,
      selected_step: "provider-only",
      rejected_smaller_steps: [],
      affected_scope_refs: ["requirement:public-knowledge#target_scope"],
      introduces_external_dependencies: false,
    }),
  };
}

describe("Agent-visible Skill capability", () => {
  test("normalizes semantic and executable capabilities into one strict view", () => {
    const current = buildIndexerSkillCapability(layers()[0]!.manifest);
    expect(validateIndexerSkillCapability(current)).toEqual(current);
    expect(current).toMatchObject({
      skill: "community-provider",
      profiles: ["component-library"],
      source_roles: ["implementation"],
      tool_sources: [{
        id: "service-catalog-read",
        handler: "host.example.service-catalog/v1",
        request: "example.service-catalog-request/v1",
        produces: "context.indexer.tool-snapshot/v1",
        operations: ["get-method", "list-methods"],
        optional: true,
      }],
      logical_units: [{ id: "component", identity: "subject-key" }],
      customization_capabilities: [
        "config",
        "instructions-append",
        "program-extend",
        "template-override",
      ],
    });
    const forged = structuredClone(current);
    forged.capability_digest = digest("f");
    expect(() => validateIndexerSkillCapability(forged)).toThrow(/digest/);
  });
});

describe("owner-scoped Provider composition plan", () => {
  test("is order-independent and keeps one operation authority with isolated config", () => {
    const forward = buildIndexerProviderCompositionPlan({
      indexer: indexer(),
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    });
    const reversed = buildIndexerProviderCompositionPlan({
      indexer: {
        ...indexer(),
        providers: [...indexer().providers].reverse(),
      },
      resolved_layers: [...layers()].reverse(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    });
    expect(reversed).toEqual(forward);
    expect(validateIndexerProviderCompositionPlan(forward)).toEqual(forward);
    expect(forward.operation_authorities).toEqual([{
      operation: "main-index",
      final_authority_layer_id: "base",
      accepts_layer_fragments: ["fact-enrichment"],
    }]);
    expect(forward.isolated_configs).toEqual([
      { provider_layer_id: "base", config_digest: expect.any(String) },
      { provider_layer_id: "extension", config_digest: expect.any(String) },
    ]);
    expect(forward.source_roles[0]).toEqual({
      id: "implementation",
      provider_layer_ids: ["base", "extension"],
    });
    expect(forward.tool_sources).toEqual([{
      provider_layer_id: "base",
      declaration: {
        id: "service-catalog-read",
        handler: "host.example.service-catalog/v1",
        request: "example.service-catalog-request/v1",
        produces: "context.indexer.tool-snapshot/v1",
        operations: ["get-method", "list-methods"],
        optional: true,
      },
    }]);
    expect(forward.composers[0]).toMatchObject({
      composer_ref: "provider:extension#composer:navigation",
    });
    expect(forward.active_profiles).toEqual([{
      id: "component-library",
      kind: "primary",
      provider_layer_id: "base",
      variants: { library_mode: "source" },
    }, {
      id: "example/framework-components",
      kind: "extension",
      provider_layer_id: "extension",
      variants: { transport: "rpc" },
    }]);
  });

  test("rejects conflicting logical-unit semantics and incorrect profile authority", () => {
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: indexer(),
      resolved_layers: layers({ logicalIdentity: "different-identity" }),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/logical unit capability.*conflicts/);

    const wrong = indexer();
    wrong.profile.additional![0]!.provider = "base";
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: wrong,
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/not provided|extension profile/);
  });

  test("validates base and namespaced variants only against their owning authority", () => {
    const aliasedExtension = indexer();
    aliasedExtension.profile.additional![0]!.variants = { protocol: "rpc" };
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: aliasedExtension,
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/variant axis protocol is not registered by Provider layer extension/);

    const missingRequiredExtension = indexer();
    delete missingRequiredExtension.profile.additional![0]!.variants;
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: missingRequiredExtension,
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/missing required variant axis transport/);

    const invalidExtensionValue = indexer();
    invalidExtensionValue.profile.additional![0]!.variants = { transport: "grpc" };
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: invalidExtensionValue,
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/variant transport=grpc is not registered by Provider layer extension/);

    const providerOwnedBaseAlias = indexer();
    providerOwnedBaseAlias.profile.primary.variants = { transport: "rpc" };
    expect(() => buildIndexerProviderCompositionPlan({
      indexer: providerOwnedBaseAlias,
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: providerOnlyCustomization(),
    })).toThrow(/variant axis transport is not registered by CLI base profile contract/);
  });

  test("applies only an exact project template override", () => {
    const plan = buildIndexerCustomizationPlan({
      project_ref: "project:sample",
      indexer_id: "public-indexer",
      provider_integrity: digest("a"),
      capability_gap_digest: digest("f"),
      selected_step: "template-override",
      rejected_smaller_steps: rejectedSteps([
        "provider-only",
        "config",
        "instructions-append",
      ]),
      affected_scope_refs: ["requirement:public-knowledge#target_scope"],
      introduces_external_dependencies: false,
    });
    const composed = buildIndexerProviderCompositionPlan({
      indexer: indexer("extend"),
      resolved_layers: layers(),
      profile_contract: profileContract(),
      customization: {
        mode: "extend",
        fingerprint: digest("e"),
        plan,
        files: [{
          path: "templates/reference.md",
          digest: digest("9"),
          capability: "template-override",
          origin: {
            skill: "community-provider",
            version: "1.2.3",
            profile: "component-library",
          },
        }],
      },
    });
    expect(composed.templates.find((template) =>
      template.profile_id === "component-library"
    )).toMatchObject({
      source: "project-override",
      provider_path: "templates/reference.md",
      project_path: "templates/reference.md",
      project_digest: digest("9"),
    });
  });
});

describe("minimal customization ladder", () => {
  test("requires every smaller step and non-delegable replacement evidence", () => {
    expect(() => buildIndexerCustomizationPlan({
      project_ref: "project:sample",
      indexer_id: "public-indexer",
      provider_integrity: digest("a"),
      capability_gap_digest: digest("f"),
      selected_step: "template-override",
      rejected_smaller_steps: rejectedSteps(["provider-only", "config"]),
      affected_scope_refs: ["requirement:public-knowledge#target_scope"],
      introduces_external_dependencies: false,
    })).toThrow(/every smaller ladder step/);

    const replace = buildIndexerCustomizationPlan({
      project_ref: "project:sample",
      indexer_id: "public-indexer",
      provider_integrity: digest("a"),
      capability_gap_digest: digest("f"),
      selected_step: "replace",
      rejected_smaller_steps: rejectedSteps([
        "provider-only",
        "config",
        "instructions-append",
        "template-override",
        "program-extend",
      ]),
      extend_attempt_digests: [digest("6"), digest("7"), digest("8")],
      affected_scope_refs: ["requirement:public-knowledge#target_scope"],
      introduces_external_dependencies: false,
    });
    expect(replace).toMatchObject({
      workspace_mode: "replace",
      requires_human_confirmation: true,
    });
  });
});
