import { test, expect } from "bun:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { prepareRevisionProgramBlocks } from "../project/approvedRevisionPrograms.js";
import { currentScopeSourceVersion } from "../project/processedScopeStorage.js";

test("contract regeneration follows captured external references and excludes dependency declarations", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const repo = join(root, "fixture-source");
    await writeFile(join(repo, "src/api.json"), JSON.stringify({ openapi: "3.0.3", info: { title: "Example", version: "1" },
      paths: { "/users": { get: { parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } } },
      components: { schemas: { User: { $ref: "types.json#/components/schemas/DependencyOnly" } } },
    }));
    await writeFile(join(repo, "src/types.json"), JSON.stringify({ components: { schemas: { DependencyOnly: {
      type: "object", properties: { secret: { type: "string" } },
    } } } }));
    execFileSync("git", ["add", "src/api.json", "src/types.json"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "add external contract fixture"], { cwd: repo });
    const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const registryPath = join(root, "sources/repo/index.yaml");
    const registry = YAML.parse(await readFile(registryPath, "utf8"));
    registry.sources[0].modules[0].git.ref = version;
    await writeFile(registryPath, YAML.stringify(registry));
    const blocks = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{
      source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge",
      module_refs: ["module:app"], processed_version: version,
    }], [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/api.json" } }]);
    expect(blocks.some(block => block.markdown.includes("limit"))).toBe(true);
    expect(blocks.some(block => block.markdown.includes("| DependencyOnly |"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);

test.each([
  { extension: "proto", content: 'syntax = "proto3"; message Request { string name = 1; } service Search { rpc Find(Request) returns (Request); }', expected: ["Request", "name", "Search.Find", "request", "response"] },
  { extension: "thrift", content: 'struct Request { 1: required string name } exception Failure { 1: string reason } service Search { Request Find(1: Request request) throws (1: Failure failure) }', expected: ["Request", "name", "Search.Find", "Failure", "throws"] },
])("$extension regeneration supports protocol and code references in one article", async ({ extension, content, expected }) => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const repo = join(root, "fixture-source");
    const path = `src/api.${extension}`;
    const dependency = `src/shared.${extension}`;
    const importedContent = extension === "proto"
      ? 'syntax = "proto3"; message DependencyOnly { string value = 1; }'
      : 'struct DependencyOnly { 1: string value }';
    const withImport = extension === "proto"
      ? content.replace('syntax = "proto3";', `syntax = "proto3"; import "${dependency}";`)
      : `include "shared.thrift"\n${content}`;
    await writeFile(join(repo, path), withImport);
    await writeFile(join(repo, dependency), importedContent);
    execFileSync("git", ["add", path, dependency], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "add protocol contract fixture"], { cwd: repo });
    const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const registryPath = join(root, "sources/repo/index.yaml");
    const registry = YAML.parse(await readFile(registryPath, "utf8"));
    registry.sources[0].modules[0].git.ref = version;
    await writeFile(registryPath, YAML.stringify(registry));
    const blocks = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{
      source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge",
      module_refs: ["module:app"], processed_version: version,
    }], [path, "src/index.ts"].map(file => ({ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: file } })));
    const markdown = blocks.map(block => block.markdown).join("\n");
    for (const value of expected) expect(markdown).toContain(value);
    expect(markdown).toContain("answer");
    expect(markdown).not.toContain("DependencyOnly");
    expect(new Set(blocks.map(block => block.token)).size).toBe(blocks.length);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);

test("Go regeneration renders only cited declarations and rejects modified captured sources", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const repo = join(root, "fixture-source");
    await writeFile(join(repo, "go.mod"), "module example.org/service\n\ngo 1.22\n");
    await writeFile(join(repo, "src/service.go"), `package service
type Request struct {
  Name string
  Limit int
}
func Lookup(name string, limit int) (string, error) { return name, nil }
`);
    await writeFile(join(repo, "src/unrelated.go"), "package service\ntype Unrelated struct { Secret string }\n");
    execFileSync("git", ["add", "go.mod", "src/service.go", "src/unrelated.go"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "add Go contract fixture"], { cwd: repo });
    const version = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    const registryPath = join(root, "sources/repo/index.yaml");
    const registry = YAML.parse(await readFile(registryPath, "utf8"));
    registry.sources[0].modules[0].git.ref = version;
    await writeFile(registryPath, YAML.stringify(registry));
    const blocks = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{
      source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge", module_refs: ["module:app"], processed_version: version,
    }], [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/service.go" } }]);
    const markdown = blocks.map(block => block.markdown).join("\n");
    expect(markdown).toContain("Request");
    expect(markdown).toContain("Name");
    expect(markdown).toContain("Lookup");
    expect(markdown).toContain("string");
    expect(markdown).not.toContain("Unrelated");
    expect(markdown).not.toContain("Secret");
    await writeFile(join(repo, "src/service.go"), "package service\ntype Changed struct {}\n");
    await expect(prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{
      source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge", module_refs: ["module:app"], processed_version: version,
    }], [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/service.go" } }])).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);

test("regeneration reads cited files with empty or omitted module selections and no Provider registry", async () => {
  const root = await createDocumentRevisionWorkspace();
  try {
    const path = join(root, "src/indexers.yaml");
    const registry = YAML.parse(await readFile(path, "utf8"));
    for (const requirement of registry.requirements) {
      requirement.target_scope.targets[0].module_refs = [];
      requirement.evidence_source_scope.targets[0].module_refs = [];
    }
    await writeFile(path, YAML.stringify(registry));
    const refs = [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/index.ts" } }];
    const scope = { source_ref: DOCUMENT_REVISION_SOURCE_REF, requirement_ref: "workspace-knowledge",
      processed_version: await currentScopeSourceVersion(root, DOCUMENT_REVISION_SOURCE_REF) };
    const explicit = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{ ...scope, module_refs: [] }], refs);
    expect(explicit.length).toBeGreaterThan(0);
    expect(explicit.some(block => block.markdown.includes("answer"))).toBe(true);
    const implicit = await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [scope], refs);
    expect(implicit).toEqual(explicit);
    expect(await prepareRevisionProgramBlocks(root, ["repo:other/source"], [scope], refs)).toEqual([]);
    expect(await prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [scope], [])).toEqual([]);
    await expect(prepareRevisionProgramBlocks(root, [DOCUMENT_REVISION_SOURCE_REF], [{ ...scope, processed_version: "changed" }], refs)).rejects.toThrow("version");
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
      }], [{ source_ref: DOCUMENT_REVISION_SOURCE_REF, locator: { path: "src/panel.tsx" } }]);
      const props = blocks.filter(block => block.markdown.includes("| Props | enabled |"));
      expect(props).toHaveLength(1);
      expect(props[0]!.markdown).toContain(`| Props | enabled | boolean | optional | ${enabled} |`);
      expect(props[0]!.markdown).toContain("| Props | label | string | optional | 'ready' |");
      expect(props[0]!.markdown).not.toContain("| Panel | enabled |");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
