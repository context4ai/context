import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndexerWorkspaceConfiguration } from "../project/indexerWorkspaceConfiguration.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function fixture(): Promise<{ root: string; marker: string }> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-load-boundary-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "load-boundary-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  return { root, marker: join(root, "project-config-loaded.txt") };
}

function registry(): string {
  return `${JSON.stringify({
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand"],
      coverage_domains: { public_contract: "required" },
      target_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: [] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "repo:sample", module_refs: [] }],
      },
      exclusions: [],
    }],
    indexers: [],
  }, null, 2)}\n`;
}

function projectEntry(marker: string, extra = ""): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { defineProject } from '@c4a/context';",
    `writeFileSync(${JSON.stringify(marker)}, 'trusted-project-config');`,
    "export default defineProject({",
    "  sources: [],",
    "  phases: [],",
    "  packages: [],",
    extra,
    "});",
    "",
  ].join("\n");
}

describe("Indexer workspace loading boundary", () => {
  test("validates the static registry before executing trusted ProjectConfig", async () => {
    const sample = await fixture();
    await writeFile(join(sample.root, "src", "index.ts"), projectEntry(sample.marker));
    await writeFile(join(sample.root, "src", "indexers.yaml"), "protocol: invalid\n");

    await expect(loadIndexerWorkspaceConfiguration(sample.root)).rejects.toThrow(
      /context\.indexer\.registry\/v1/,
    );
    await expect(stat(sample.marker)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(join(sample.root, "src", "indexers.yaml"), registry());
    const loaded = await loadIndexerWorkspaceConfiguration(sample.root);
    expect(loaded.registry.requirementSet.requirements).toHaveLength(1);
    expect(loaded.project.project).toEqual({ sources: [], phases: [], packages: [] });
    expect(await readFile(sample.marker, "utf8")).toBe("trusted-project-config");
  });

  test("does not allow the trusted ProjectConfig exception to define requirements", async () => {
    const sample = await fixture();
    await writeFile(join(sample.root, "src", "indexers.yaml"), registry());
    await writeFile(
      join(sample.root, "src", "index.ts"),
      projectEntry(sample.marker, "  requirements: [{ id: 'forged' }],"),
    );

    await expect(loadIndexerWorkspaceConfiguration(sample.root)).rejects.toThrow(
      /only declares sources, phases, and packages.*requirements/,
    );
    expect(await readFile(sample.marker, "utf8")).toBe("trusted-project-config");
  });
});
