import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { loadProvider } from "@c4a/agent-graph";
import YAML from "yaml";

const ROOT = resolve(import.meta.dir, "../../../..");
const SKILLS = resolve(ROOT, "plugins/context/skills");

async function assertReadableReferences(root: string): Promise<Set<string>> {
  const pending = [resolve(root, "SKILL.md")];
  const visited = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    const local = relative(root, file);
    expect(isAbsolute(local) || local === ".." || local.startsWith("../")).toBe(false);
    const content = await readFile(file, "utf8");
    expect(content.trim().length).toBeGreaterThan(0);
    visited.add(file);
    for (const match of content.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)) {
      const target = match[1]!;
      if (!/^[a-z][a-z0-9+.-]*:/iu.test(target)) pending.push(resolve(dirname(file), target));
    }
  }
  return visited;
}

describe("production investigation and authoring resources", () => {
  test("selected skills expose portable readable guidance without version credentials", async () => {
    for (const name of ["code", "markdown", "note", "sessions"]) {
      const root = resolve(SKILLS, `context-${name}-indexer`);
      const content = await readFile(resolve(root, "SKILL.md"), "utf8");
      const header = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
      const metadata = YAML.parse(header![1]!);
      expect(metadata.name).toBe(`context-${name}-indexer`);
      expect(typeof metadata.description).toBe("string");
      expect(metadata.version).toBeUndefined();
      expect(metadata.metadata?.["context-provider-version"]).toBeUndefined();
      const references = await assertReadableReferences(root);
      expect(references.has(resolve(root, "references/indexer.md"))).toBe(true);
    }
  });

  test("creation guidance is reachable and agrees with the SDK manual", async () => {
    const root = resolve(SKILLS, "context-indexer-create");
    const guide = resolve(root, "references/guides/indexer-skill-creation.md");
    expect((await assertReadableReferences(root)).has(guide)).toBe(true);
    expect(await readFile(guide, "utf8")).toBe(await readFile(resolve(ROOT,
      "packages/context/docs/guides/indexer-skill-creation.md"), "utf8"));
  });

  test("the built workflow delivers the current file contract and mandatory report resources", async () => {
    const provider = await loadProvider(resolve(ROOT, "packages/context-cli/dist/providers/context/manifest.json"));
    const nodes = [...provider.graphs.values()].flatMap(graph => graph.definition.nodes);
    for (const id of ["plan-production-stage", "work-production-stage", "continue-production-investigation", "repair-production-articles"]) {
      const node = nodes.find(node => node.id === id);
      if (!node || node.kind !== "action") throw new Error(`Missing production action: ${id}`);
      const action = provider.actions.get(resolve(provider.root, node.action));
      expect(action?.definition.skill).toBe("skills/work-production-stage/SKILL.md");
      expect(provider.files.has(resolve(provider.root, action!.definition.skill!))).toBe(true);
      for (const location of node.resources?.required ?? []) {
        const resource = provider.resources.get(resolve(provider.root, location));
        expect(resource).toBeDefined();
        expect(provider.files.has(resource!.contentPath)).toBe(true);
        expect((await readFile(resource!.contentPath, "utf8")).trim().length).toBeGreaterThan(0);
      }
    }
    const writing = nodes.find(node => node.id === "work-production-stage")!;
    if (writing.kind !== "action") throw new Error("Writing requires an action node");
    expect(writing.resources?.required).toContain("resources/procedures/production-stage-files.md");
    const report = nodes.find(node => node.id === "confirm-production-report");
    if (!report || report.kind !== "gate") throw new Error("Missing report gate");
    expect(report.gate.delegatable).toBe(false);
    expect(report.resources?.required).toEqual(expect.arrayContaining([
      "resources/procedures/work-start-report.md", "resources/templates/work-start-report.md",
    ]));
  });
});
