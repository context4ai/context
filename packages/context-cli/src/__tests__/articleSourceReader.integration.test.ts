import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { join } from "node:path";
import { registeredArticleSourceReader } from "../project/articleSourceReader.js";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";

test("code citations use captured tracked content while diagnostic reads may inspect local changes", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    const reader = await registeredArticleSourceReader(root);
    expect(await reader(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts", true)).toBe("export const answer = 42;\n");
    await writeFile(join(root, "fixture-source/src/untracked.ts"), "export const localOnly = true;\n");
    const fresh = await registeredArticleSourceReader(root);
    expect(await fresh(DOCUMENT_REVISION_SOURCE_REF, "src/untracked.ts")).toContain("localOnly");
    await expect(fresh(DOCUMENT_REVISION_SOURCE_REF, "src/untracked.ts", true)).rejects.toThrow("captured commit");
    await writeFile(join(root, "fixture-source/src/index.ts"), "export const answer = 99;\n");
    expect(await fresh(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts")).toContain("99");
    await expect(fresh(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts", true)).rejects.toThrow("Captured source changed");
    // A command continues using its fixed first read, not a later working copy.
    expect(await reader(DOCUMENT_REVISION_SOURCE_REF, "src/index.ts", true)).toContain("42");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("captured code paths are relative to a registered repository subdirectory", async () => {
  const root = await createDocumentRevisionWorkspace({ sourceCount: 1 });
  try {
    const path = join(root, "sources/repo/index.yaml");
    const registry = YAML.parse(await readFile(path, "utf8"));
    registry.sources[0].modules[0].materializedAt = "fixture-source/src";
    await writeFile(path, YAML.stringify(registry));
    const reader = await registeredArticleSourceReader(root);
    expect(await reader(DOCUMENT_REVISION_SOURCE_REF, "index.ts", true)).toBe("export const answer = 42;\n");
    await expect(reader(DOCUMENT_REVISION_SOURCE_REF, "../package.json", true)).rejects.toThrow("escapes");
  } finally { await rm(root, { recursive: true, force: true }); }
});
