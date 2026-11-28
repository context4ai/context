import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registeredArticleSourceReader } from "../project/articleSourceReader.js";

const bases: string[] = [];
afterEach(async () => { for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true }); });
async function workspace() {
  const base = await mkdtemp(join(tmpdir(), "source-boundary-"));
  bases.push(base);
  await mkdir(join(base, "outside"), { recursive: true });
  return { root: join(base, "workspace"), outside: join(base, "outside") };
}

test("a captured document linked outside the workspace stays unreadable", async () => {
  const { root, outside } = await workspace();
  await mkdir(join(root, "sources/lark"), { recursive: true });
  await writeFile(join(root, "sources/lark/index.yaml"),
    'sources:\n  - name: "20261024"\n    modules:\n      - name: doc\n        url: https://example.com/docx/abc\n');
  await writeFile(join(outside, "doc.md"), "# Doc\nOutside text\n");
  await writeFile(join(outside, "manifest.json"), "{}");
  await symlink(outside, join(root, "sources/lark/20261024"));
  const read = await registeredArticleSourceReader(root);
  await expect(read("lark:20261024/doc", "doc.md")).rejects.toMatchObject({ detail: { reason_code: "source-path-outside-scope" } });
});

test("a note linked from outside the workspace is not registered", async () => {
  const { root, outside } = await workspace();
  await mkdir(join(root, "sources/note/20260912"), { recursive: true });
  await writeFile(join(outside, "source.md"), "# Note\nOutside text\n");
  await symlink(join(outside, "source.md"), join(root, "sources/note/20260912/source.md"));
  const read = await registeredArticleSourceReader(root);
  await expect(read("note:20260912/source.md", "source.md")).rejects.toMatchObject({ detail: { reason_code: "source-unregistered" } });
});
