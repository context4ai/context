import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDEXER_PROVIDER_MANIFEST_NAME,
  loadIndexerProviderManifest,
  parseIndexerProviderManifest,
} from "../index.js";

function providerManifest(domain = "code"): string {
  return [
    "protocol: context.indexer.provider/v1",
    "id: context-indexer-sample",
    "version: 1.2.0",
    `domains: [${domain}]`,
    "activation:",
    "  target_kinds: [package]",
    "  required_signals:",
    "    - id: supported-source",
    "      description: Contains supported source files.",
    "  supporting_signals: []",
    "  negative_signals: []",
    "  detector:",
    "    execution: { runtime: node, entry: scripts/detect.mjs, args: [] }",
    "    protocol: context.indexer.activation/v1",
    "    capabilities: [parser-facts.read]",
    "    optional: true",
    "provides:",
    "  profiles: [component-library]",
    "  partition_strategies:",
    "    - { id: canonical-export-family, profiles: [component-library], priority: 100 }",
    "    - { id: semantic-subject, profiles: [component-library], priority: 200 }",
    "  operations:",
    "    - id: main-index",
    "      consumes: context.indexer.main-workset/v2",
    "      produces: context.indexer.main-result/v1",
    "      accepts_layer_fragments: [fact-enrichment, template-variables]",
    "  layer_fragments:",
    "    - { kind: fact-enrichment, phase: pre-authority, produces: context.indexer.layer-fragment/v1 }",
    "    - { kind: template-variables, phase: pre-authority, produces: context.indexer.layer-fragment/v1 }",
    "    - { kind: derived-artifact-proposal, phase: post-author, produces: context.indexer.layer-fragment/v1 }",
    "  composers:",
    "    - id: examples",
    "      supported_profiles: [component-library]",
    "  source_roles: [public-api-source]",
    "  tool_sources:",
    "    - id: service-catalog-read",
    "      handler: host.example.service-catalog/v1",
    "      request: example.service-catalog-request/v1",
    "      produces: context.indexer.tool-snapshot/v1",
    "      operations: [get-method, list-methods]",
    "      optional: true",
    "  logical_units:",
    "    - id: component-family",
    "      identity: canonical-export-family",
    "      artifacts:",
    "        recommended: [content, examples]",
    "        supported_policy_variants: [standard]",
    "provider:",
    "  program:",
    "    execution: { runtime: node, entry: scripts/index.mjs, args: [--format=json] }",
    "    protocol: context.indexer.program/v1",
    "    capabilities: [source.read, parser-facts.read, indexer-result.write]",
    "  instructions:",
    "    - path: references/guidance.md",
    "      profiles: [component-library]",
    "  templates:",
    "    - { id: guide, profile: component-library, path: templates/guide.md }",
    "  config_schema: references/config.schema.json",
    "  forbidden_fallbacks: [one-reader-page-per-symbol]",
    "  completion_checks: [logical-unit-owner]",
    "customization:",
    "  supports: [config, instructions-append, template-override, program-extend]",
    "  guide: references/customization.md",
    "quality_guidance:",
    "  metric_ids: [logical-unit-coverage]",
    "  repair: references/repair.md",
    "",
  ].join("\n");
}

async function writeProviderBundle(root: string): Promise<void> {
  const files = [
    "scripts/detect.mjs",
    "scripts/index.mjs",
    "references/guidance.md",
    "references/config.schema.json",
    "references/customization.md",
    "references/repair.md",
    "templates/guide.md",
  ];
  await Promise.all(files.map(async (path) => {
    const absolute = join(root, path);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, path.endsWith(".json") ? "{}\n" : "content\n");
  }));
  await writeFile(join(root, INDEXER_PROVIDER_MANIFEST_NAME), providerManifest());
}

describe("context.indexer.provider/v1", () => {
  test("uses one manifest field tree for Code and Markdown providers", () => {
    const code = parseIndexerProviderManifest(providerManifest("code"));
    const markdown = parseIndexerProviderManifest(providerManifest("markdown"));

    expect(code.protocol).toBe("context.indexer.provider/v1");
    expect(code.provides.operations.map((operation) => operation.id)).toEqual(["main-index"]);
    expect(code.provides.partition_strategies).toEqual([{
      id: "canonical-export-family",
      profiles: ["component-library"],
      priority: 100,
    }, {
      id: "semantic-subject",
      profiles: ["component-library"],
      priority: 200,
    }]);
    expect(markdown.domains).toEqual(["markdown"]);
    expect(code.provides.tool_sources).toEqual([{
      id: "service-catalog-read",
      handler: "host.example.service-catalog/v1",
      request: "example.service-catalog-request/v1",
      produces: "context.indexer.tool-snapshot/v1",
      operations: ["get-method", "list-methods"],
      optional: true,
    }]);
    expect(markdown.provider.instructions?.[0]).toEqual({
      path: "references/guidance.md",
      profiles: ["component-library"],
    });
  });

  test("loads only context-indexer.yaml and verifies every referenced Bundle file", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-provider-"));
    try {
      await writeProviderBundle(root);
      await expect(loadIndexerProviderManifest(root)).resolves.toMatchObject({
        id: "context-indexer-sample",
        version: "1.2.0",
      });

      await rm(join(root, INDEXER_PROVIDER_MANIFEST_NAME));
      await writeFile(join(root, "manifest.yaml"), providerManifest());
      await expect(loadIndexerProviderManifest(root)).rejects.toThrow(
        /context-indexer\.yaml/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects Bundle resources that are missing or escape through a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-provider-"));
    const outside = await mkdtemp(join(tmpdir(), "context-indexer-outside-"));
    try {
      await writeProviderBundle(root);
      await rm(join(root, "templates", "guide.md"));
      await expect(loadIndexerProviderManifest(root)).rejects.toThrow(
        "Provider Bundle resource is unavailable: templates/guide.md",
      );

      await writeFile(join(outside, "guide.md"), "outside\n");
      await symlink(join(outside, "guide.md"), join(root, "templates", "guide.md"));
      await expect(loadIndexerProviderManifest(root)).rejects.toThrow(
        "escapes the Bundle root",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("rejects duplicate YAML keys and legacy nested manifest fields", () => {
    expect(() => parseIndexerProviderManifest([
      providerManifest(),
      "provider:",
      "  instructions: []",
    ].join("\n"))).toThrow(/Map keys must be unique/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "  profiles: [component-library]",
        "  profiles: [component-library]\n  provider: {}\n  customization: {}",
      ),
    )).toThrow(/Unrecognized key/);
  });

  test("keeps operation and layer-fragment entries mutually exclusive", () => {
    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "{ kind: fact-enrichment, phase: pre-authority, produces: context.indexer.layer-fragment/v1 }",
        "{ kind: fact-enrichment, produces: context.indexer.layer-fragment/v1 }",
      ),
    )).toThrow(/phase/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "      produces: context.indexer.main-result/v1",
        "      produces: context.indexer.main-result/v1\n      phase: pre-authority",
      ),
    )).toThrow(/Unrecognized key/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "      produces: context.indexer.main-result/v1",
        "      produces: context.indexer.main-result/v1\n      supported_evidence_kinds: [documentation]",
      ),
    )).toThrow(/supported_evidence_kinds/);
  });

  test("keeps Host tool sources optional, structured, and data-only", () => {
    expect(() => parseIndexerProviderManifest(providerManifest().replace(
      "      operations: [get-method, list-methods]\n      optional: true",
      "      operations: [get-method, list-methods]\n      optional: false",
    ))).toThrow(/optional/);
    expect(() => parseIndexerProviderManifest(providerManifest().replace(
      "      operations: [get-method, list-methods]",
      "      operations: [get-method, get-method]",
    ))).toThrow(/duplicate/);
    expect(() => parseIndexerProviderManifest(providerManifest().replace(
      "      produces: context.indexer.tool-snapshot/v1",
      "      produces: example.opaque-result/v1\n      command: tool --write",
    ))).toThrow(/produces|Unrecognized key/);
  });

  test("accepts a bounded composer contract and rejects authority or resource drift", () => {
    const withContract = providerManifest().replace(
      "      supported_profiles: [component-library]",
      [
        "      supported_profiles: [component-library]",
        "      contract:",
        "        instruction: references/composers/examples.md",
        "        primary_requirements: { fact_kinds: [example-candidate], artifact_kinds: [content] }",
        "        derived_artifact_policy:",
        "          fragment_protocol: context.indexer.layer-fragment/v1",
        "          fragment_kind: derived-artifact-proposal",
        "          artifact_policy_variant: standard",
        "          artifact_kinds: [examples]",
        "        empty_result: { result_protocol: context.indexer.layer-fragment-result/v1, behavior: empty-fragment-set }",
      ].join("\n"),
    );
    const parsed = parseIndexerProviderManifest(withContract);
    expect(parsed.provides.composers?.[0]?.contract).toMatchObject({
      instruction: "references/composers/examples.md",
      primary_requirements: { fact_kinds: ["example-candidate"] },
      derived_artifact_policy: { artifact_kinds: ["examples"] },
      empty_result: { behavior: "empty-fragment-set" },
    });
    expect(() => parseIndexerProviderManifest(withContract.replace(
      "    - { kind: derived-artifact-proposal, phase: post-author, produces: context.indexer.layer-fragment/v1 }\n",
      "",
    ))).toThrow(/requires a post-author derived-artifact-proposal capability/);
    expect(() => parseIndexerProviderManifest(withContract.replace(
      "instruction: references/composers/examples.md",
      "instruction: ../examples.md",
    ))).toThrow(/portable path/);
  });

  test("requires structured non-interpolated execution and profile-bound resources", () => {
    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "execution: { runtime: node, entry: scripts/index.mjs, args: [--format=json] }",
        "execution: { runtime: node, entry: ../index.mjs, args: [] }",
      ),
    )).toThrow(/portable path/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace("args: [--format=json]", "args: [$FORMAT]"),
    )).toThrow(/literal argument/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace("args: [--format=json]", "args: ['--format=json;touch', output]"),
    )).toThrow(/literal argument/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace("runtime: node", "runtime: python"),
    )).toThrow();

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace("profiles: [component-library]", "profiles: [unknown-profile]"),
    )).toThrow(/undeclared profile/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "profiles: [component-library], priority: 200",
        "profiles: [unknown-profile], priority: 200",
      ),
    )).toThrow(/partition strategy references undeclared profile/);

    expect(() => parseIndexerProviderManifest(
      providerManifest().replace("priority: 200", "priority: 100"),
    )).toThrow(/priorities must be unique/);
  });

  test("requires namespaced profiles to declare their extension authority", () => {
    expect(() => parseIndexerProviderManifest(
      providerManifest().replace(
        "profiles: [component-library]",
        "profiles: [component-library, example/framework-application]",
      ),
    )).toThrow(/requires one composition extension/);

    const missingSubjectAuthority = providerManifest().replace(
      "quality_guidance:\n",
      [
        "composition:",
        "  extensions:",
        "    - profile: example/framework-application",
        "      extends: component-library",
        "quality_guidance:",
      ].join("\n") + "\n",
    ).replace(
      "profiles: [component-library]",
      "profiles: [component-library, example/framework-application]",
    );
    expect(() => parseIndexerProviderManifest(missingSubjectAuthority)).toThrow(
      /subject_key_schema/,
    );

    const extended = providerManifest().replace(
      "quality_guidance:\n",
      [
        "composition:",
        "  extensions:",
        "    - profile: example/framework-application",
        "      extends: component-library",
        "      variant_schema:",
        "        axes:",
        "          - { id: runtime_mode, type: enum, values: [spa, ssr], required: false }",
        "      subject_key_schema:",
        "        version: 1",
        "        namespace: { operator: canonical-source-module-namespace }",
        "        kinds:",
        "          - id: application",
        "            local_key: { operator: canonical-module-identity }",
        "        normalization: [trim, unicode-nfc, preserve-case]",
        "quality_guidance:",
      ].join("\n") + "\n",
    ).replace(
      "profiles: [component-library]",
      "profiles: [component-library, example/framework-application]",
    );
    expect(parseIndexerProviderManifest(extended).composition?.extensions[0]?.profile).toBe(
      "example/framework-application",
    );
  });
});
