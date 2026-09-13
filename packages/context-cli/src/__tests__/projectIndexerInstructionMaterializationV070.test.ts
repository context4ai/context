import {
hostActionInputDigest,
type HostActionResult,
} from "@c4a/agent-graph";
import {
buildIndexerCustomizationPlan,
loadIndexerProviderManifest,
type ExpectedProviderResolution,
type IndexerRegistryEntry
} from "@c4a/context";
import { afterAll,afterEach,beforeAll,describe,expect,test } from "bun:test";
import {
mkdir,
mkdtemp,
rm,
writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { resolveCliBundledIndexerProvider } from "../project/indexerCliBundledProvider.js";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import { materializeBundledIndexerDistribution } from "../project/indexerDistributionBuild.js";
import {
consumeIndexerInstructionHostResult,
indexerInstructionHostLocation,
materializeIndexerInstructionHostAction,
} from "../project/indexerInstructionHost.js";
import {
buildIndexerInstructionMaterializationRequest,
materializeIndexerInstructions,
validateMaterializedIndexerInstructions,
} from "../project/indexerInstructionMaterialization.js";
import { stageIndexerProviderBundle } from "../project/indexerProviderStage.js";
const NOW = new Date("2026-08-27T12:00:00.000Z");
const INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS = 120_000;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const temporaryRoots: string[] = [];
let distributionRoot: string | undefined;
let sharedDistribution: Awaited<ReturnType<typeof setupDistribution>> | undefined;

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function setupDistribution(root: string) {
  const assetsRoot = join(root, "assets");
  const release = await materializeBundledIndexerDistribution({
    packageRoot: resolve(import.meta.dir, "../.."),
    outputRoot: assetsRoot,
  });
  const selected = release.bundles.find((bundle) => bundle.skill === "context-code-indexer")!;
  const expected: ExpectedProviderResolution = {
    indexerId: "sample-code-indexer",
    providerId: "community",
    skill: selected.skill,
    version: selected.version,
    integrity: selected.integrity,
    distribution: selected.distribution,
  };
  return { assetsRoot, release, selected, expected };
}

beforeAll(async () => {
  distributionRoot = await mkdtemp(join(tmpdir(), "context-indexer-instruction-distribution-"));
  sharedDistribution = await setupDistribution(distributionRoot);
}, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

afterAll(async () => {
  if (distributionRoot !== undefined) {
    await rm(distributionRoot, { recursive: true, force: true });
  }
});

function distributionFixture(): Awaited<ReturnType<typeof setupDistribution>> {
  if (sharedDistribution === undefined) {
    throw new Error("bundled Indexer distribution fixture is not initialized");
  }
  return sharedDistribution;
}

function registryEntry(input: {
  expected: ExpectedProviderResolution;
  customization?: "extend";
}): IndexerRegistryEntry {
  return {
    id: input.expected.indexerId,
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: ["technical-structure"],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: {
      primary: { id: "component-library", provider: input.expected.providerId },
      additional: [],
      composers: [],
    },
    providers: [{
      id: input.expected.providerId,
      role: "primary",
      skill: input.expected.skill,
      version: input.expected.version,
      integrity: input.expected.integrity,
      distribution: input.expected.distribution,
    }],
    ...(input.customization === undefined
      ? {}
      : { customization: { mode: input.customization } }),
  };
}

async function resolveAndStage(input: {
  root: string;
  assetsRoot: string;
  releaseVersion: string;
  expected: ExpectedProviderResolution;
  now?: Date;
}) {
  const bundle = await resolveCliBundledIndexerProvider({
    assetsRoot: input.assetsRoot,
    expectedPackageVersion: input.releaseVersion,
    expected: input.expected,
    transportRoot: join(input.root, "transport"),
    now: input.now ?? NOW,
  });
  const staged = await stageIndexerProviderBundle({
    envelope: bundle,
    expected: input.expected,
    runtimeRoot: join(input.root, "runtime"),
    now: input.now ?? NOW,
  });
  return { bundle, staged };
}

async function buildRequest(input: {
  root: string;
  expected: ExpectedProviderResolution;
  bundle: Awaited<ReturnType<typeof resolveCliBundledIndexerProvider>>;
  staged: Awaited<ReturnType<typeof stageIndexerProviderBundle>>;
  customization?: "extend";
  composerId?: string;
}) {
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  const customization = await loadIndexerCustomization({
    workspaceRoot: input.root,
    projectRef: "project:sample",
    indexer: registryEntry({
      expected: input.expected,
      ...(input.customization === undefined ? {} : { customization: input.customization }),
    }),
    manifest,
    providerIntegrity: input.expected.integrity,
    ...(input.customization === undefined
      ? {}
      : {
          customizationPlan: buildIndexerCustomizationPlan({
            project_ref: "project:sample",
            indexer_id: input.expected.indexerId,
            provider_integrity: input.expected.integrity,
            capability_gap_digest: `sha256:${"c".repeat(64)}`,
            selected_step: "instructions-append",
            rejected_smaller_steps: ["provider-only", "config"].map((step, index) => ({
              step: step as "provider-only" | "config",
              disposition: "insufficient" as const,
              reason_code: `${step}-insufficient`,
              evidence_digest: `sha256:${String(index + 1).repeat(64)}`,
            })),
            affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
            introduces_external_dependencies: false,
          }),
        }),
  });
  const request = await buildIndexerInstructionMaterializationRequest({
    bundle: input.bundle,
    staged: input.staged,
    customization,
    indexerId: input.expected.indexerId,
    providerId: input.expected.providerId,
    stage: input.composerId === undefined ? "partition" : "post-author",
    profile: "component-library",
    ...(input.composerId === undefined ? {} : { composerId: input.composerId }),
  });
  return { request, customization };
}

function materializationAuthority(
  request: Awaited<ReturnType<typeof buildRequest>>["request"],
) {
  return {
    resource_id: request.resource_id,
    indexer_id: request.indexer_id,
    provider_id: request.provider_id,
    stage: request.stage,
    instruction_set_digest: request.instruction_set_digest,
  };
}

describe("resolved-indexer-instructions materialization", () => {
  test("adds only the selected composer instruction to a post-author request", async () => {
    const root = await temporaryRoot("context-indexer-composer-instructions-");
    const distribution = distributionFixture();
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({
      root,
      expected: distribution.expected,
      ...resolved,
      composerId: "public-contract",
    });
    const result = await materializeIndexerInstructions({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    });
    expect(input.request.composer_id).toBe("public-contract");
    expect(result.resources.filter((resource) => resource.kind === "composer")).toHaveLength(1);
    expect(result.resources.find((resource) => resource.kind === "composer")?.content).toContain("Public contract composer");
    expect(result.resources.find((resource) => resource.kind === "composer")?.content).toContain("fragments: []");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("keeps semantic request/payload stable across transports while receipts remain delivery-specific", async () => {
    const root = await temporaryRoot("context-indexer-instruction-stability-");
    const distribution = distributionFixture();
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    const first = await resolveAndStage({
      root: firstRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
      now: NOW,
    });
    const second = await resolveAndStage({
      root: secondRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
      now: new Date(NOW.getTime() + 1_000),
    });
    const firstInput = await buildRequest({ root: firstRoot, expected: distribution.expected, ...first });
    const secondInput = await buildRequest({ root: secondRoot, expected: distribution.expected, ...second });
    const firstResult = await materializeIndexerInstructions({
      request: firstInput.request,
      currentAuthority: materializationAuthority(firstInput.request),
      ...first,
      customization: firstInput.customization,
      workspaceRoot: firstRoot,
    });
    const secondResult = await materializeIndexerInstructions({
      request: secondInput.request,
      currentAuthority: materializationAuthority(secondInput.request),
      ...second,
      customization: secondInput.customization,
      workspaceRoot: secondRoot,
    });

    expect(secondInput.request.request_digest).toBe(firstInput.request.request_digest);
    expect(secondResult.payload_digest).toBe(firstResult.payload_digest);
    expect(secondResult.context_receipt.staged_receipt_digest)
      .not.toBe(firstResult.context_receipt.staged_receipt_digest);
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("appends only the declared local instructions and changes the resource-set identity", async () => {
    const root = await temporaryRoot("context-indexer-instruction-custom-");
    const distribution = distributionFixture();
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const before = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const localRoot = join(root, "src", "indexer", distribution.expected.indexerId);
    await mkdir(localRoot, { recursive: true });
    await writeFile(join(localRoot, "instructions.md"), [
      "<!-- @context-indexer-origin context-code-indexer@1.1.2 profile=component-library -->",
      "Require public examples to use stable source refs.",
      "",
    ].join("\n"));
    const after = await buildRequest({
      root,
      expected: distribution.expected,
      ...resolved,
      customization: "extend",
    });
    const result = await materializeIndexerInstructions({
      request: after.request,
      currentAuthority: materializationAuthority(after.request),
      ...resolved,
      customization: after.customization,
      workspaceRoot: root,
    });

    expect(after.request.instruction_set_digest).not.toBe(before.request.instruction_set_digest);
    expect(result.resources.filter((resource) => resource.kind === "customization-append")).toHaveLength(1);
    expect(result.resources.find((resource) => resource.kind === "customization-append")?.content).toContain("stable source refs");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("rejects stale request, changed stage bytes, and forged output payload", async () => {
    const root = await temporaryRoot("context-indexer-instruction-invalid-");
    const distribution = distributionFixture();
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const stale = { ...input.request, stage: "author" as const };
    await expect(materializeIndexerInstructions({
      request: stale,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    })).rejects.toThrow("request digest");

    const authority = materializationAuthority(input.request);
    const staleAuthorities: Array<typeof authority> = [{
      ...authority,
      provider_id: "other-provider",
    }, {
      ...authority,
      stage: "author" as const,
    }, {
      ...authority,
      instruction_set_digest: digest("c"),
    }];
    for (const currentAuthority of staleAuthorities) {
      await expect(materializeIndexerInstructions({
        request: input.request,
        currentAuthority,
        ...resolved,
        customization: input.customization,
        workspaceRoot: root,
      })).rejects.toThrow(/stale for current authority/);
    }

    await writeFile(join(resolved.staged.stage_path, "references", "indexer.md"), "tampered\n");
    await expect(materializeIndexerInstructions({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
    })).rejects.toThrow("staged Provider changed");

    const freshRoot = await temporaryRoot("context-indexer-instruction-forged-");
    const fresh = await resolveAndStage({
      root: freshRoot,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const freshInput = await buildRequest({ root: freshRoot, expected: distribution.expected, ...fresh });
    const result = await materializeIndexerInstructions({
      request: freshInput.request,
      currentAuthority: materializationAuthority(freshInput.request),
      ...fresh,
      customization: freshInput.customization,
      workspaceRoot: freshRoot,
    });
    const forged = structuredClone(result);
    forged.resources[0]!.content += "forged";
    expect(() => validateMaterializedIndexerInstructions(forged, freshInput.request))
      .toThrow("payload digest");
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

  test("round-trips inline and managed instruction output through the Host-action ABI", async () => {
    const root = await temporaryRoot("context-indexer-instruction-host-");
    const distribution = distributionFixture();
    const resolved = await resolveAndStage({
      root,
      assetsRoot: distribution.assetsRoot,
      releaseVersion: distribution.release.version,
      expected: distribution.expected,
    });
    const input = await buildRequest({ root, expected: distribution.expected, ...resolved });
    const location = indexerInstructionHostLocation(input.request);
    const inline = await materializeIndexerInstructionHostAction({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      ...resolved,
      customization: input.customization,
      workspaceRoot: root,
      adapter: "context-cli",
      adapterVersion: "0.7.0",
    });
    expect(inline.result.input_digest).toBe(hostActionInputDigest(location));
    expect((await consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: inline.result,
    })).materialized).toEqual(inline.materialized);

    const managedDigest = digest("e");
    const managedResult: HostActionResult = {
      ...inline.result,
      output: {
        schema: location.materialize.output_schema,
        resource: {
          ref: "host-resource://context/indexer/instructions",
          digest: managedDigest,
        },
      },
    };
    expect((await consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: managedResult,
      managed_output: {
        ref: "host-resource://context/indexer/instructions",
        digest: managedDigest,
        value: inline.materialized,
      },
    })).materialized).toEqual(inline.materialized);
    await expect(consumeIndexerInstructionHostResult({
      request: input.request,
      currentAuthority: materializationAuthority(input.request),
      result: { ...inline.result, input_digest: digest("0") },
    })).rejects.toThrow();
  }, INDEXER_DISTRIBUTION_TEST_TIMEOUT_MS);

});
