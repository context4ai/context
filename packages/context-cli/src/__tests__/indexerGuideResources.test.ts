import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProvider } from "@c4a/agent-graph";

const packageRoot = resolve(import.meta.dir, "../..");
const guideResource = "resources/contracts/indexer-provider-guide.yaml";
const guidePath = "skills/configure-indexer-providers/references/guides/indexer-provider-and-customization.md";

test("the installed workflow carries the current guide and its linked manuals", async () => {
  const provider = await loadProvider(resolve(packageRoot, "dist/providers/context/manifest.json"));
  const pending = [resolve(provider.root, guidePath)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    expect(provider.files.has(file)).toBe(true);
    const markdown = await readFile(file, "utf8");
    const relative = file.split("/references/")[1]!;
    expect(markdown).toBe(await readFile(resolve(packageRoot, "../context/docs", relative), "utf8"));
    for (const match of markdown.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)) {
      if (/^https?:/u.test(match[1]!)) continue;
      pending.push(resolve(dirname(file), match[1]!));
    }
  }
  expect(visited.size).toBeGreaterThan(1);
});

test("every selection and customization action carries its guide in required Route resources", async () => {
  const provider = await loadProvider(resolve(packageRoot, "dist/providers/context/manifest.json"));
  const skills = new Set([
    "skills/run-indexer-lifecycle/SKILL.md",
    "skills/configure-indexer-providers/SKILL.md",
    "skills/propose-indexer-customization/SKILL.md",
    "skills/prepare-indexer-customization-project/SKILL.md",
  ]);
  const found = new Set<string>();
  for (const graph of provider.graphs.values()) {
    for (const node of graph.definition.nodes) {
      if (node.kind !== "action") continue;
      const action = provider.actions.get(resolve(provider.root, node.action));
      if (!action?.definition.skill || !skills.has(action.definition.skill)) continue;
      found.add(action.definition.skill);
      expect(node.resources?.required).toContain(guideResource);
    }
  }
  expect(found).toEqual(skills);
});

test("Route SDK manuals and their local links ship with the current SDK content", async () => {
  const provider = await loadProvider(resolve(packageRoot, "dist/providers/context/manifest.json"));
  const pending = [...provider.resources.values()]
    .map((resource) => resource.contentPath)
    .filter((path) => path.includes("/resources/manuals/"));
  expect(pending.length).toBeGreaterThan(0);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    expect(provider.files.has(path)).toBe(true);
    const content = await readFile(path, "utf8");
    const markdown = content.replace(/^---\n[\s\S]*?\n---\n\n/u, "");
    const manual = path.split("/resources/manuals/")[1]!;
    expect(markdown).toBe(await readFile(resolve(packageRoot, "../context/docs", manual), "utf8"));
    for (const match of markdown.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gu)) {
      if (/^https?:/u.test(match[1]!)) continue;
      pending.push(resolve(dirname(path), match[1]!));
    }
  }
});
