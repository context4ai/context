import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cachedPackageKnowledgeMarkdown } from "../project/packageRenderCache.js";

test("an older reader projection is recomputed without changing approved content", async () => {
  const temp = join(import.meta.dir, "../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "render-upgrade-"));
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  const content = '---\ntitle: Guide\n---\n<!-- context:section id="intro" -->\n# Guide\n\nBody.';
  try {
    const cache = join(root, ".tmp/context-runtime/package-render");
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, `${digest("guide")}.json`), JSON.stringify({
      fingerprint: digest(`package-reader-markdown/v1\n${content}`), markdown: "outdated projection",
    }));
    const output = await cachedPackageKnowledgeMarkdown({ projectRoot: root, key: "guide", content });
    expect(output).not.toContain("outdated projection");
    expect(output.match(/^# Guide$/gmu)).toHaveLength(1);
    expect(output).toContain('<a id="section-intro"></a>');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("later batches render only changed page inputs and a failed render remains retryable", async () => {
  const temp = join(import.meta.dir, "../../../../.tmp");
  await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, "render-cache-test-"));
  let renders = 0;
  const render = (content: string) => { renders++; return `# ${content}`; };
  const page = (key: string, content: string) => cachedPackageKnowledgeMarkdown({ projectRoot: root, key, content, render });
  try {
    expect(await page("a", "first")).toBe("# first");
    expect(await page("a", "first")).toBe("# first");
    expect(await page("b", "second")).toBe("# second");
    expect(renders).toBe(2);
    await expect(cachedPackageKnowledgeMarkdown({ projectRoot: root, key: "a", content: "updated",
      render: () => { throw new Error("render failed"); } })).rejects.toThrow("render failed");
    expect(await page("a", "first")).toBe("# first");
    expect(await page("a", "updated")).toBe("# updated");
    expect(renders).toBe(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
