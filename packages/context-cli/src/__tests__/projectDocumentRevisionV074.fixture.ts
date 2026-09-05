import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import type { IndexerRegistry } from "@c4a/context";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
import type { ContextResolvedWorkflowRoute } from
  "../project/workflow/workflowTypes.js";

export const DOCUMENT_REVISION_SOURCE_REF = "repo:20260903/revision-fixture";

export function documentRevisionOuterIndexerRoute(): ContextResolvedWorkflowRoute {
  return {
    protocol: "context.workflow.route.v1",
    id: "run-indexer-lifecycle",
    revision: `sha256:${"f".repeat(64)}`,
    node: "run-indexer-lifecycle",
    reason_code: "route.indexer.lifecycle-required",
    availability: "immediate",
    commands: [],
    resources: { required: [], recommended: [] },
    after_action: { evaluate: true },
  };
}

export async function createDocumentRevisionWorkspace(
  options: { debug?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-indexer-revise-"));
  const bundle = (await listCliBundledIndexers()).bundles.find((item) =>
    item.skill === "context-code-indexer"
  );
  if (bundle === undefined) throw new Error("missing bundled Code Indexer");
  const registry: IndexerRegistry = {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: "workspace-knowledge",
      reader_goals: ["understand-system"],
      coverage_domains: { architecture: "required" },
      target_scope: {
        targets: [{
          source_ref: DOCUMENT_REVISION_SOURCE_REF,
          module_refs: ["module:app"],
        }],
      },
      evidence_source_scope: {
        targets: [{
          source_ref: DOCUMENT_REVISION_SOURCE_REF,
          module_refs: ["module:app"],
        }],
      },
    }],
    indexers: [{
      id: "revision-fixture",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: "workspace-knowledge",
        coverage_domains: ["architecture"],
        owned_scope: { ref: "requirement:workspace-knowledge#target_scope" },
        role: "primary",
      }],
      read_scope: { refs: ["requirement:workspace-knowledge#target_scope"] },
      profile: { primary: { id: "component-library", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: bundle.skill,
        version: bundle.version,
        integrity: bundle.integrity,
        distribution: bundle.distribution,
      }],
    }],
  };
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "knowledge"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "revision-fixture",
    private: true,
    context: {
      project: true,
      entry: "src/index.ts",
      ...(options.debug === true ? { debug: true } : {}),
    },
  }, null, 2)}\n`);
  await writeFile(join(root, "src", "indexers.yaml"), YAML.stringify(registry));
  await writeFile(join(root, "src", "index.ts"), [
    'import { defineProject, source } from "@c4a/context";',
    'const fixture = source("20260903", "revision-fixture");',
    "export default defineProject({ sources: [fixture], phases: [], packages: [] });",
    "",
  ].join("\n"));
  await writeFile(join(root, "knowledge", "structure.yaml"), YAML.stringify({
    schema_version: "context.approved-structure.v1",
    nodes: [{
      node_ref: "node:revision-fixture",
      title: "Revision fixture",
      node_type: "entity",
    }],
    views: [{
      view_ref: "architecture:revision-fixture",
      node_ref: "node:revision-fixture",
      title: "Revision fixture",
      path: "architecture/revision-fixture.md",
      sources: [DOCUMENT_REVISION_SOURCE_REF],
      sections: [],
    }],
    edges: [],
  }));
  const sourceRoot = join(root, "fixture-source");
  await mkdir(join(sourceRoot, "src"), { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
    name: "revision-fixture-source",
    private: true,
    exports: {
      ".": "./src/index.ts",
      "./secondary": "./src/secondary.ts",
    },
  }, null, 2)}\n`);
  await writeFile(join(sourceRoot, "src", "index.ts"), "export const answer = 42;\n");
  await writeFile(
    join(sourceRoot, "src", "secondary.ts"),
    "export const secondaryAnswer = 84;\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "context-test@example.test"], {
    cwd: sourceRoot,
  });
  execFileSync("git", ["config", "user.name", "Context Test"], { cwd: sourceRoot });
  execFileSync("git", ["add", "package.json", "src/index.ts", "src/secondary.ts"], {
    cwd: sourceRoot,
  });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: sourceRoot });
  const ref = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  const materializedRoot = join(
    root,
    "sources",
    "repo",
    "20260903",
    "revision-fixture",
  );
  await mkdir(join(materializedRoot, ".."), { recursive: true });
  await symlink(sourceRoot, materializedRoot);
  await writeFile(join(root, "sources", "repo", "index.yaml"), [
    "sources:",
    "  - name: '20260903'",
    "    modules:",
    "      - name: revision-fixture",
    "        local: fixture-source",
    "        materializedAt: sources/repo/20260903/revision-fixture",
    "        git:",
    "          remote: https://example.test/revision-fixture.git",
    `          ref: ${ref}`,
    "",
  ].join("\n"));
  return root;
}
