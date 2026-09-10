import { test, expect } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { prepareRevisionProgramBlocks } from "../project/approvedRevisionPrograms.js";

test("regeneration parses whole-source scopes with empty or omitted module selections", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8"));
    for (const requirement of registry.requirements) {
      requirement.target_scope.targets[0].module_refs = [];
      requirement.evidence_source_scope.targets[0].module_refs = [];
    }
    await writeFile(path, YAML.stringify(registry));
    const scope = { source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge", processed_version: "fixture" };
    const explicit = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{ ...scope, module_refs: [] }]);
    expect(explicit.length).toBeGreaterThan(0);
    expect(explicit.some(block => block.markdown.includes("answer"))).toBe(true);
    const implicit = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [scope]);
    expect(implicit).toEqual(explicit);
    expect(await prepareRevisionProgramBlocks(root, ["repo:other/source"], [scope])).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);

test("approved-page regeneration carries supporting component defaults and refreshes changed sources", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const repo = join(root, "fixture-source");
    const packagePath = join(repo, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    pkg.exports["."] = "./src/panel.tsx";
    await writeFile(packagePath, JSON.stringify(pkg));
    const writeVersion = async (enabled: boolean) => {
      await writeFile(join(repo, "src/panel.tsx"), `export interface Props {
/** @default false */
enabled?: boolean; label?: string;
}
export const Panel = ({ enabled = ${enabled}, label = 'ready' }: Props) => null;`);
      execFileSync("git", ["add", "package.json", "src/panel.tsx"], { cwd: repo });
      execFileSync("git", ["commit", "-qm", "update contract fixture"], { cwd: repo });
      const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
      const registryPath = join(root, "sources/repo/index.yaml");
      const registry = YAML.parse(await readFile(registryPath, "utf8"));
      registry.sources[0].modules[0].git.ref = version;
      await writeFile(registryPath, YAML.stringify(registry));
      return version;
    };
    for (const enabled of [true, false]) {
      const version = await writeVersion(enabled);
      const blocks = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{
        source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge",
        module_refs: ["module:app"], processed_version: version,
      }]);
      const props = blocks.filter(block => block.markdown.includes("| Props | enabled |"));
      expect(props).toHaveLength(1);
      expect(props[0]!.markdown).toContain(`| Props | enabled | boolean | optional | ${enabled} |`);
      expect(props[0]!.markdown).toContain("| Props | label | string | optional | 'ready' |");
      expect(props[0]!.markdown).not.toContain("| Panel | enabled |");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
