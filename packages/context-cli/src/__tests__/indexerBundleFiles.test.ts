import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "indexer-bundle-files-"));
  roots.push(root);
  await mkdir(join(root, "nested"));
  await Promise.all(Array.from({ length: 40 }, (_, index) => writeFile(join(root, "nested", `${index}.md`), `Resource ${index}`)));
  return root;
}
test("bounded bundle reads preserve every sorted digest and detect later byte changes", async () => {
  const root = await fixture();
  const expected = Array.from({ length: 40 }, (_, index) => ({
    path: `nested/${index}.md`, digest: `sha256:${createHash("sha256").update(`Resource ${index}`).digest("hex")}`,
  })).sort((left, right) => left.path < right.path ? -1 : 1);
  expect(await collectIndexerBundleFiles(root)).toEqual(expected);
  await writeFile(join(root, "nested/20.md"), "Changed");
  const changed = await collectIndexerBundleFiles(root);
  expect(changed.filter((file, index) => file.digest !== expected[index]!.digest).map(file => file.path)).toEqual(["nested/20.md"]);
});
test("nested symlinks remain forbidden even when other file reads succeed", async () => {
  const root = await fixture();
  await symlink(join(root, "nested/0.md"), join(root, "nested/link.md"));
  await expect(collectIndexerBundleFiles(root)).rejects.toThrow("must not contain symlinks");
});
