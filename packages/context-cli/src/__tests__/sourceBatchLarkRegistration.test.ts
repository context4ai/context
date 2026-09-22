import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourcesRegistry } from "@c4a/context";
import YAML from "yaml";
import { addLarkSourceUnlocked } from "../project/documentSourceRegistration.js";
import { createLarkBatchRegistration } from "../project/sourceBatchLarkRegistration.js";

const namespace = "20260922";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function workspace(sources: unknown[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-source-batch-"));
  roots.push(root);
  await mkdir(join(root, "sources/lark"), { recursive: true });
  await writeFile(join(root, "sources/lark/index.yaml"), YAML.stringify({ sources }));
  return root;
}

async function saved(root: string): Promise<unknown> {
  return YAML.parse(await readFile(join(root, "sources/lark/index.yaml"), "utf8")) as unknown;
}

test("buffered registration preserves sequential results, module ordering, aliases and snapshot metadata", async () => {
  const sources = [
    { name: "guide", url: "https://example.test/docx/legacy", title: "Legacy" },
    { name: namespace, modules: [
      { name: "first", id: "first-alias", url: "https://example.test/docx/first", title: "Existing",
        materializedAt: `sources/lark/${namespace}/custom`, snapshot: { manifest: `sources/lark/${namespace}/snapshots/first.json` } },
      { name: "second", wikiToken: "second-token" },
      { name: "third", docToken: "third-token" },
    ] },
    { name: "20260921", modules: [{ name: "other", docToken: "other-token" }] },
  ];
  const sequentialRoot = await workspace(sources);
  const batchRoot = await workspace(sources);
  const inputs = [
    { module: "second", url: "https://example.test/wiki/second" },
    { module: "new", docToken: "new-token", title: "New" },
    { module: "first-alias", wikiToken: "changed-token" },
  ];
  const batch = await createLarkBatchRegistration(batchRoot, namespace);
  for (const item of inputs) {
    const expected = await addLarkSourceUnlocked({ projectRoot: sequentialRoot, namespace,
      name: `${namespace}/${item.module}`, ...item });
    expect(await batch.add(item)).toEqual(expected);
  }
  expect(await saved(batchRoot)).toEqual({ sources });
  await batch.flush();
  expect(await saved(batchRoot)).toEqual(await saved(sequentialRoot));
  expect((await loadSourcesRegistry({ rootDir: batchRoot })).larks).toEqual(
    (await loadSourcesRegistry({ rootDir: sequentialRoot })).larks,
  );
});

test("flush creates a missing registry and supports subsequent chunks", async () => {
  const root = await workspace();
  await rm(join(root, "sources/lark/index.yaml"));
  const batch = await createLarkBatchRegistration(root, namespace);
  await batch.flush();
  await batch.add({ module: "first", docToken: "first" });
  await batch.flush();
  await batch.add({ module: "second", docToken: "second" });
  await batch.flush();
  expect((await loadSourcesRegistry({ rootDir: root })).larks.map(entry => entry.name)).toEqual([
    `${namespace}/first`, `${namespace}/second`,
  ]);
});

test("replaying an unchanged batch preserves the original YAML bytes and modification time", async () => {
  const root = await workspace([{ name: namespace, modules: [
    { name: "first", title: "First", docToken: "first" },
    { name: "second", wikiToken: "second" },
  ] }]);
  const path = join(root, "sources/lark/index.yaml");
  await writeFile(path, `# A retained registry comment\n${await readFile(path, "utf8")}`);
  const oldTime = new Date("2020-01-01T00:00:00.000Z");
  await utimes(path, oldTime, oldTime);
  const before = await readFile(path, "utf8");
  const beforeStat = await stat(path);
  const batch = await createLarkBatchRegistration(root, namespace);
  await batch.add({ module: "first", docToken: "first" });
  await batch.add({ module: "second", wikiToken: "second" });
  await batch.flush();
  expect(await readFile(path, "utf8")).toBe(before);
  expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);
});

test.each([
  { module: "missing" },
  { module: "both", docToken: "doc", wikiToken: "wiki" },
  { module: "../unsafe", docToken: "doc" },
  { module: "empty", docToken: "" },
  { module: "empty-title", docToken: "doc", title: "" },
])("invalid item $module leaves a valid prefix available to flush", async invalid => {
  const root = await workspace();
  const batch = await createLarkBatchRegistration(root, namespace);
  await batch.add({ module: "valid", docToken: "valid" });
  await expect(batch.add(invalid)).rejects.toThrow();
  await batch.flush();
  expect((await loadSourcesRegistry({ rootDir: root })).larks.map(entry => entry.name)).toEqual([`${namespace}/valid`]);
});

test("cross-type identifiers fail before mutating the staged prefix", async () => {
  const root = await workspace();
  await mkdir(join(root, "sources/file"), { recursive: true });
  await writeFile(join(root, "sources/file/index.yaml"), YAML.stringify({ sources: [
    { name: namespace, modules: [{ name: "manual", id: "manual-alias", local: "docs" }] },
  ] }));
  const batch = await createLarkBatchRegistration(root, namespace);
  await batch.add({ module: "valid", docToken: "valid" });
  for (const module of ["manual", "manual-alias"]) {
    await expect(batch.add({ module, docToken: "doc" })).rejects.toThrow("outside lark registry");
  }
  await batch.flush();
  expect((await loadSourcesRegistry({ rootDir: root })).larks).toHaveLength(1);
});

test("flat date entries and collisions in a later same-date batch are rejected without a write", async () => {
  const flatRoot = await workspace([{ name: namespace, docToken: "flat" }]);
  const flatBefore = await saved(flatRoot);
  const flat = await createLarkBatchRegistration(flatRoot, namespace);
  await expect(flat.add({ module: "new", docToken: "new" })).rejects.toThrow("flat registry entry");
  await flat.flush();
  expect(await saved(flatRoot)).toEqual(flatBefore);

  const splitRoot = await workspace([
    { name: namespace, modules: [{ name: "first", docToken: "first" }] },
    { name: namespace, modules: [{ name: "second", docToken: "second" }] },
  ]);
  const before = await saved(splitRoot);
  const batch = await createLarkBatchRegistration(splitRoot, namespace);
  await expect(batch.add({ module: "second", docToken: "changed" })).rejects.toThrow("Duplicate lark source identifier");
  await batch.flush();
  expect(await saved(splitRoot)).toEqual(before);
});

test("an invalid existing registry is never overwritten", async () => {
  const root = await workspace([{ name: namespace, modules: [{ name: "bad", docToken: "doc",
    materializedAt: "../outside" }] }]);
  const before = await saved(root);
  await expect(createLarkBatchRegistration(root, namespace)).rejects.toThrow("invalid materializedAt");
  expect(await saved(root)).toEqual(before);
});

test("a failed atomic replacement keeps the old registry intact and can be retried or replayed", async () => {
  const root = await workspace([{ name: namespace, modules: [{ name: "existing", docToken: "existing" }] }]);
  const registryPath = join(root, "sources/lark/index.yaml");
  const backupPath = join(root, "sources/lark/index.saved.yaml");
  const before = await readFile(registryPath, "utf8");
  const item = { module: "new", docToken: "new" };
  const batch = await createLarkBatchRegistration(root, namespace);
  await batch.add(item);

  // A directory at the destination makes rename fail even under a root user.
  // The saved prior file lets the test restore the exact pre-failure state.
  await rename(registryPath, backupPath);
  await mkdir(registryPath);
  await expect(batch.flush()).rejects.toThrow();
  expect(await readFile(backupPath, "utf8")).toBe(before);
  expect((await readdir(join(root, "sources/lark"))).some(name => name.includes(".tmp-"))).toBe(false);

  await rm(registryPath, { recursive: true });
  await rename(backupPath, registryPath);
  expect((await loadSourcesRegistry({ rootDir: root })).larks.map(entry => entry.name)).toEqual([`${namespace}/existing`]);
  await batch.flush();
  expect((await loadSourcesRegistry({ rootDir: root })).larks.map(entry => entry.name)).toEqual([
    `${namespace}/existing`, `${namespace}/new`,
  ]);

  const committed = await readFile(registryPath, "utf8");
  const replay = await createLarkBatchRegistration(root, namespace);
  await replay.add(item);
  await replay.flush();
  expect(await readFile(registryPath, "utf8")).toBe(committed);
});
