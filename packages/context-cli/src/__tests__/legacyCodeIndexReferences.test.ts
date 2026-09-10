import { expect, test } from "bun:test";
import { hasFormalLegacyCodeIndexReference } from "../project/legacyCodeIndexReferences.js";

test("historical codegraph paths in prose and captured evidence do not request workspace migration", () => {
  expect(hasFormalLegacyCodeIndexReference("guide.md", "# History\n`knowledge/codegraph/old.md`\n")).toBe(false);
  expect(hasFormalLegacyCodeIndexReference("structure.yaml", "views:\n - path: architecture/history.md\n   sections:\n    - markdown: 'knowledge/codegraph/old.md'\n")).toBe(false);
  expect(hasFormalLegacyCodeIndexReference("index.ts", 'const example = `extractTs({ collection: "codegraph" })`;')).toBe(false);
  expect(hasFormalLegacyCodeIndexReference("structure.yaml", "views:\n - path: codeindex/history.md\n   source: /another/workspace/knowledge/codegraph/original.md\n")).toBe(false);
});

test("actual collection and approved view identities still require migration", () => {
  expect(hasFormalLegacyCodeIndexReference("index.ts", 'extractTs({ collection: "codegraph" });')).toBe(true);
  expect(hasFormalLegacyCodeIndexReference("guide.md", "---\nview_ref: codegraph:sample/map\n---\n# Map\n")).toBe(true);
  expect(hasFormalLegacyCodeIndexReference("structure.yaml", "views:\n - path: codegraph/map.md\n")).toBe(true);
});
