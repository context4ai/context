import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import { parseIndexerRegistry, type IndexerRegistry } from "@c4a/context";
import { auditIndexerWorkspacePersistence } from "../project/indexerWorkspacePersistence.js";

const INTEGRITY = `sha256:${"a".repeat(64)}`;

function registry(customization = false): IndexerRegistry {
  return parseIndexerRegistry(YAML.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-capabilities"],
      coverage_domains: { public_contract: "required" },
      questions: [],
      target_scope: { targets: [{ source_ref: "repo:sample", module_refs: [] }] },
      evidence_source_scope: { targets: [{ source_ref: "repo:sample", module_refs: [] }] },
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
      ...(customization ? { customization: { mode: "extend" } } : {}),
    }],
  }));
}

async function writeRegistry(root: string, value: IndexerRegistry): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(value), "utf8");
}

describe("Indexer workspace persistence budget", () => {
  test("keeps provider-only state to the registry surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-persistence-"));
    const selected = registry();
    await writeRegistry(root, selected);
    const report = await auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    });
    expect(report.provider_only).toBe(true);
    expect(report.persistent_paths).toEqual(["src/indexers.yaml"]);

    await mkdir(join(root, "src", "indexer"), { recursive: true });
    await expect(auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    })).rejects.toThrow("must not persist src/indexer");
  });

  test("rejects legacy package authority and absolute Skill locators", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-persistence-"));
    const selected = registry();
    await writeRegistry(root, selected);
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "sample",
      context: { codeIndex: { extensions: ["/tmp/context-indexer"] } },
    }));
    await expect(auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    })).rejects.toThrow(/context\.codeIndex\.extensions/);

    const absolute = structuredClone(selected) as unknown as Record<string, unknown>;
    const indexers = absolute.indexers as Array<Record<string, unknown>>;
    const providers = indexers[0]!.providers as Array<Record<string, unknown>>;
    providers[0]!.distribution = {
      kind: "workspace",
      locator: "workspace:///tmp/context-indexer",
    };
    expect(() => parseIndexerRegistry(YAML.stringify(absolute))).toThrow(/portable|locator/);
  });

  test("accepts only declared fixed customization resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-persistence-"));
    const selected = registry(true);
    await writeRegistry(root, selected);
    const custom = join(root, "src", "indexer", "sample-indexer");
    await mkdir(join(custom, "templates"), { recursive: true });
    await writeFile(join(custom, "instructions.md"), "guidance\n");
    await writeFile(join(custom, "templates", "guide.md"), "# Guide\n");
    const report = await auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    });
    expect(report.provider_only).toBe(false);
    expect(report.persistent_paths).toEqual([
      "src/indexer/sample-indexer/instructions.md",
      "src/indexer/sample-indexer/templates/guide.md",
      "src/indexers.yaml",
    ]);

    await writeFile(join(custom, "runtime-receipt.json"), "{}\n");
    await expect(auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    })).rejects.toThrow("unsupported persistent path");
  });

  test("rejects orphan customization directories and symlinked resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-persistence-"));
    const outside = await mkdtemp(join(tmpdir(), "context-indexer-persistence-outside-"));
    const selected = registry(true);
    await writeRegistry(root, selected);
    await mkdir(join(root, "src", "indexer", "orphan"), { recursive: true });
    await expect(auditIndexerWorkspacePersistence({
      workspaceRoot: root,
      registry: selected,
    })).rejects.toThrow("exactly match declared customizations");

    const clean = await mkdtemp(join(tmpdir(), "context-indexer-persistence-"));
    await writeRegistry(clean, selected);
    const custom = join(clean, "src", "indexer", "sample-indexer");
    await mkdir(custom, { recursive: true });
    await writeFile(join(outside, "instructions.md"), "outside\n");
    await symlink(join(outside, "instructions.md"), join(custom, "instructions.md"));
    await expect(auditIndexerWorkspacePersistence({
      workspaceRoot: clean,
      registry: selected,
    })).rejects.toThrow("must not contain symlinks");
  });
});
