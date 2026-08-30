import {
  lstat,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerCustomizationPlan,
  type IndexerCustomizationLadderStep,
  type IndexerProviderManifest,
  type IndexerRegistryEntry,
} from "@c4a/context";
import {
  loadIndexerCustomization,
  type IndexerCustomizationCapabilityGap,
} from "../project/indexerCustomization.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;
const GAP_DIGEST = `sha256:${"b".repeat(64)}`;

function manifest(
  supports: NonNullable<IndexerProviderManifest["customization"]>["supports"] = [
    "config",
    "instructions-append",
    "template-override",
    "program-extend",
  ],
): IndexerProviderManifest {
  return {
    protocol: "context.indexer.provider/v1",
    id: "context-indexer-sample",
    version: "1.2.0",
    domains: ["code"],
    activation: {
      target_kinds: ["package"],
      required_signals: [{ id: "source", description: "Contains source files." }],
      supporting_signals: [],
      negative_signals: [],
    },
    provides: {
      profiles: ["component-library", "sdk-library"],
      operations: [{
        id: "main-index",
        consumes: "context.indexer.main-workset/v1",
        produces: "context.indexer.main-result/v1",
      }],
    },
    provider: {
      program: {
        execution: { runtime: "node", entry: "scripts/index.mjs", args: [] },
        protocol: "context.indexer.program/v1",
        capabilities: ["source.read", "indexer-result.write"],
      },
      instructions: [{ path: "references/guidance.md", profiles: ["component-library"] }],
      templates: [{ id: "guide", profile: "component-library", path: "templates/guide.md" }],
    },
    customization: { supports },
  };
}

function indexer(mode?: "extend" | "replace"): IndexerRegistryEntry {
  return {
    id: "component-indexer",
    operations: ["main-index"],
    requirement_bindings: [{
      requirement_ref: "workspace-knowledge",
      coverage_domains: ["public-contract"],
      owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
      role: "primary",
    }],
    read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
    profile: {
      primary: { id: "component-library", provider: "community" },
      additional: [],
      composers: [],
    },
    providers: [{
      id: "community",
      role: "primary",
      skill: "context-indexer-sample",
      version: "1.2.0",
      integrity: INTEGRITY,
      distribution: {
        kind: "cli-bundled",
        locator: "cli-bundled://context/context-indexer-sample",
      },
    }],
    ...(mode === undefined ? {} : { customization: { mode } }),
  };
}

function gap(overrides: Partial<IndexerCustomizationCapabilityGap> = {}): IndexerCustomizationCapabilityGap {
  return {
    protocol: "context.indexer.customization-capability-gap/v1",
    project_ref: "project:sample",
    indexer_id: "component-indexer",
    provider_integrity: INTEGRITY,
    gap_digest: GAP_DIGEST,
    extend_insufficient: true,
    ...overrides,
  };
}

function customizationPlan(step: IndexerCustomizationLadderStep) {
  const steps: IndexerCustomizationLadderStep[] = [
    "provider-only",
    "config",
    "instructions-append",
    "template-override",
    "program-extend",
    "replace",
  ];
  return buildIndexerCustomizationPlan({
    project_ref: "project:sample",
    indexer_id: "component-indexer",
    provider_integrity: INTEGRITY,
    capability_gap_digest: GAP_DIGEST,
    selected_step: step,
    rejected_smaller_steps: steps.slice(0, steps.indexOf(step)).map((candidate, index) => ({
      step: candidate,
      disposition: "insufficient" as const,
      reason_code: `${candidate}-insufficient`,
      evidence_digest: `sha256:${String(index + 1).repeat(64)}`,
    })),
    ...(step === "replace"
      ? { extend_attempt_digests: [
          `sha256:${"c".repeat(64)}`,
          `sha256:${"d".repeat(64)}`,
          `sha256:${"e".repeat(64)}`,
        ] }
      : {}),
    affected_scope_refs: ["requirement:workspace-knowledge#target_scope"],
    introduces_external_dependencies: false,
  });
}

function loadInput(
  root: string,
  mode?: "extend" | "replace",
  step: IndexerCustomizationLadderStep = "instructions-append",
) {
  return {
    workspaceRoot: root,
    projectRef: "project:sample",
    indexer: indexer(mode),
    manifest: manifest(),
    providerIntegrity: INTEGRITY,
    ...(mode === undefined ? {} : { customizationPlan: customizationPlan(
      mode === "replace" ? "replace" : step,
    ) }),
  };
}

async function customizationRoot(root: string): Promise<string> {
  const path = join(root, "src", "indexer", "component-indexer");
  await mkdir(path, { recursive: true });
  return path;
}

describe("fixed project-local Indexer customization", () => {
  test("keeps a provider-only workspace registry-only and rejects undeclared local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-provider-only-"));
    const view = await loadIndexerCustomization(loadInput(root));
    expect(view.mode).toBe("none");
    expect(view.files).toEqual([]);
    expect(await lstat(join(root, "src", "indexer")).catch(() => undefined)).toBeUndefined();

    await customizationRoot(root);
    await expect(loadIndexerCustomization(loadInput(root))).rejects.toThrow(
      "undeclared Indexer customization directory",
    );
  });

  test("loads only changed instructions and an exact Provider template override", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "context-indexer-custom-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "context-indexer-custom-b-"));
    for (const root of [rootA, rootB]) {
      const path = await customizationRoot(root);
      await mkdir(join(path, "templates"), { recursive: true });
      await writeFile(
        join(path, "instructions.md"),
        "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->\nProject constraint.\n",
      );
      await writeFile(
        join(path, "templates", "guide.md"),
        "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->\n# Guide\n",
      );
    }

    const first = await loadIndexerCustomization(loadInput(rootA, "extend", "template-override"));
    const second = await loadIndexerCustomization(loadInput(rootB, "extend", "template-override"));
    expect(first.files.map((file) => file.path)).toEqual([
      "instructions.md",
      "templates/guide.md",
    ]);
    expect(first.files.map((file) => file.capability)).toEqual([
      "instructions-append",
      "template-override",
    ]);
    expect(first.upstream_review_required).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(JSON.stringify(first)).not.toContain(rootA);
  });

  test("preserves an older origin and reports an upstream review instead of rewriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-custom-origin-"));
    const path = await customizationRoot(root);
    await writeFile(
      join(path, "instructions.md"),
      "<!-- @context-indexer-origin context-indexer-sample@1.1.0 profile=component-library -->\nConstraint.\n",
    );
    const view = await loadIndexerCustomization(loadInput(root, "extend"));
    expect(view.files[0]?.origin.version).toBe("1.1.0");
    expect(view.files[0]?.upstream_state).toBe("origin-version-differs");
    expect(view.upstream_review_required).toBe(true);
  });

  test("requires exact capability-gap proof for replace and never executes local code while loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-custom-replace-"));
    const path = await customizationRoot(root);
    const marker = join(root, "executed.txt");
    await writeFile(join(path, "index.ts"), [
      "// @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      "export default {};",
      "",
    ].join("\n"));

    await expect(loadIndexerCustomization(loadInput(root, "replace"))).rejects.toThrow(
      "exact current capability-gap proof",
    );
    const view = await loadIndexerCustomization({
      ...loadInput(root, "replace"),
      replaceCapabilityGap: gap(),
    });
    expect(view.files[0]?.capability).toBe("program-extend");
    expect(await lstat(marker).catch(() => undefined)).toBeUndefined();
    await expect(loadIndexerCustomization({
      ...loadInput(root, "replace"),
      replaceCapabilityGap: gap({ provider_integrity: `sha256:${"c".repeat(64)}` }),
    })).rejects.toThrow("exact current capability-gap proof");
  });

  test("rejects undeclared resources, missing origins, unsupported capabilities, and escaping symlinks", async () => {
    const invalidCases: Array<{
      name: string;
      prepare: (path: string, root: string) => Promise<void>;
      expected: string;
      provider?: IndexerProviderManifest;
    }> = [
      {
        name: "unsupported path",
        prepare: async (path) => writeFile(join(path, "settings.json"), "{}\n"),
        expected: "unsupported path",
      },
      {
        name: "missing origin",
        prepare: async (path) => writeFile(join(path, "instructions.md"), "Constraint.\n"),
        expected: "must start with one @context-indexer-origin",
      },
      {
        name: "unsupported capability",
        prepare: async (path) => writeFile(
          join(path, "instructions.md"),
          "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->\nConstraint.\n",
        ),
        expected: "does not support customization capability",
        provider: manifest(["template-override"]),
      },
      {
        name: "canonical question payload",
        prepare: async (path) => writeFile(
          join(path, "instructions.md"),
          [
            "<!-- @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library -->",
            "```yaml",
            "semantic: Who owns the source?",
            "version: 1",
            "selector: { kind: source }",
            "evidence_contract: { minimum: 1 }",
            "```",
            "",
          ].join("\n"),
        ),
        expected: "duplicates canonical question contract payload fields",
      },
      {
        name: "escaping symlink",
        prepare: async (path, root) => {
          const outside = join(root, "outside.md");
          await writeFile(outside, "outside\n");
          await symlink(outside, join(path, "instructions.md"));
        },
        expected: "must not contain symlinks",
      },
    ];
    for (const item of invalidCases) {
      const root = await mkdtemp(join(tmpdir(), `context-indexer-${item.name.replace(/ /gu, "-")}-`));
      const path = await customizationRoot(root);
      await item.prepare(path, root);
      await expect(loadIndexerCustomization({
        ...loadInput(root, "extend"),
        manifest: item.provider ?? manifest(),
      })).rejects.toThrow(item.expected);
    }
  });

  test("requires helper modules to be rooted at the fixed index.ts entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-custom-helper-"));
    const path = await customizationRoot(root);
    await writeFile(
      join(path, "helpers.ts"),
      "// @context-indexer-origin context-indexer-sample@1.2.0 profile=component-library\nexport {};\n",
    );
    await expect(loadIndexerCustomization(loadInput(root, "extend"))).rejects.toThrow(
      "requires the fixed index.ts entry",
    );
  });
});
