import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import type { ProductionRequirements } from "../project/productionRequirements.js";
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
  options: { debug?: boolean; sourceCount?: number; purpose?: string;
    sourceFiles?: Record<string, string>; packageJson?: Record<string, unknown>;
    profile?: string; readerGoals?: string[] } = {},
): Promise<string> {
  const parent = resolve(import.meta.dir, "../../../../.tmp/revision-fixtures");
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(join(parent, "case-")));
  const registry: ProductionRequirements = {
    requirements: [{
      id: "workspace-knowledge",
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
      reader_goals: options.readerGoals ?? ["understand-system"],
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
  await writeFile(join(root, "knowledge", "structure.yaml"), YAML.stringify({ articles: [] }));
  const sourceRoot = join(root, "fixture-source");
  await mkdir(join(sourceRoot, "src"), { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
    name: "revision-fixture-source",
    private: true,
    exports: {
      ".": "./src/index.ts",
      ...((options.sourceCount ?? 2) >= 2 ? { "./secondary": "./src/secondary.ts" } : {}),
      ...Object.fromEntries(Array.from({ length: Math.max(0, (options.sourceCount ?? 2) - 2) }, (_, index) =>
        [`./extra${index}`, `./src/extra${index}.ts`])),
    },
    ...options.packageJson,
  }, null, 2)}\n`);
  if (options.sourceFiles !== undefined) {
    for (const [path, content] of Object.entries(options.sourceFiles)) {
      await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
      await writeFile(join(sourceRoot, path), content);
    }
  } else {
    await writeFile(join(sourceRoot, "src", "index.ts"), "export const answer = 42;\n");
    if ((options.sourceCount ?? 2) >= 2) await writeFile(
      join(sourceRoot, "src", "secondary.ts"),
      "export const secondaryAnswer = 84;\n",
    );
    for (let index = 0; index < (options.sourceCount ?? 2) - 2; index++) {
      await writeFile(join(sourceRoot, "src", `extra${index}.ts`), `export const extra${index} = ${index};\n`);
    }
  }
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot });
  execFileSync("git", ["config", "user.email", "context-test@example.test"], {
    cwd: sourceRoot,
  });
  execFileSync("git", ["config", "user.name", "Context Test"], { cwd: sourceRoot });
  execFileSync("git", ["add", "package.json", ...(options.sourceFiles === undefined ? ["src"] : Object.keys(options.sourceFiles))], {
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
