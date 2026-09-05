import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { indexerRegistryDigests, type IndexerRegistry } from "@c4a/context";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";

export const SOURCE_REF = "repo:20260902/sample";
export const MODULE_REF = "module:app";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

export function registry(): IndexerRegistry {
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: {
        architecture: "required",
        operations: "required",
        examples: "optional",
      },
      target_scope: { targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }] },
      evidence_source_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }],
      },
    }],
    indexers: [{
      id: "component-library",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture", "operations"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "component-library", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: digest("f"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }],
  };
}

export async function bindCurrentCliBundle(
  current: IndexerRegistry,
  skill: "context-code-indexer" | "context-markdown-indexer",
): Promise<void> {
  const bundle = (await listCliBundledIndexers()).bundles.find((candidate) =>
    candidate.skill === skill
  );
  if (bundle === undefined) throw new Error(`missing CLI bundle ${skill}`);
  const provider = current.indexers[0]?.providers[0];
  if (provider === undefined) throw new Error("missing fixture Provider");
  provider.version = bundle.version;
  provider.integrity = bundle.integrity;
  provider.distribution = bundle.distribution;
}

export async function project(
  options: { rankedCodeInventory?: boolean } = {},
): Promise<{ root: string; requirementDigest: string }> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-main-lifecycle-"));
  const current = registry();
  await bindCurrentCliBundle(current, "context-code-indexer");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "main-lifecycle-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(current), "utf8");
  const sourceRoot = join(root, "sources", "repo", "20260902", "sample");
  if (options.rankedCodeInventory === true) {
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
      name: "ranked-code-inventory-fixture",
      private: true,
      exports: "./src/area-02/index.ts",
    }, null, 2)}\n`, "utf8");
    await mkdir(join(sourceRoot, "src", "area-00"), { recursive: true });
    await mkdir(join(sourceRoot, "src", "area-01"), { recursive: true });
    await mkdir(join(sourceRoot, "src", "area-02"), { recursive: true });
    await writeFile(join(sourceRoot, "src", "area-00", "notes.ts"),
      "// Intentionally contains no parsed capability facts.\n", "utf8");
    await writeFile(join(sourceRoot, "src", "area-01", "index.ts"),
      "export const one = 1;\n", "utf8");
    await writeFile(join(sourceRoot, "src", "area-02", "index.ts"), [
      "export const one = 1;",
      "export const two = 2;",
      "export const three = 3;",
      "",
    ].join("\n"), "utf8");
  } else {
    await mkdir(join(sourceRoot, "config"), { recursive: true });
    await writeFile(join(sourceRoot, "config", "app.json"), '{"mode":"test"}\n', "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "context-test@example.test"], {
    cwd: sourceRoot,
  });
  execFileSync("git", ["config", "user.name", "Context Test"], { cwd: sourceRoot });
  execFileSync("git", ["add", "."], { cwd: sourceRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: sourceRoot });
  const sourceRef = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  await writeFile(join(root, "sources", "repo", "index.yaml"), [
    "sources:",
    "  - name: '20260902'",
    "    modules:",
    "      - name: sample",
    `        materializedAt: sources/repo/20260902/sample`,
    "        git:",
    "          remote: https://example.test/sample.git",
    `          ref: ${sourceRef}`,
    "",
  ].join("\n"), "utf8");
  return {
    root,
    requirementDigest: indexerRegistryDigests(current).requirementSetDigest,
  };
}
