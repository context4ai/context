import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cachedPackageKnowledgeMarkdown } from "../project/packageRenderCache.js";

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
