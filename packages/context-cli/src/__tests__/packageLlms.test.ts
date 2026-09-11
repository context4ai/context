import { expect, test } from "bun:test";
import { updateKnowledgeMap } from "@c4a/context";
import { buildLlmsDocuments, writeLlmsDocuments } from "../project/packageLlms.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const articles = [
  { identity: "a", path: "wikis/a.md", title: "Alpha", sections: ["detail"], content: "# Alpha\n\nAlpha body. [Beta](b.md) ![Image](../others/assets/x.png)" },
  { identity: "b", path: "wikis/b.md", title: "Beta", sections: [], content: "# Beta\n\nBeta body." },
];
const map = updateKnowledgeMap(undefined, { expected_revision: null, upsert: [
  { key: "guide", parent: null, title: "Guide", order: 0 },
  { key: "b", parent: "guide", title: "Start here", order: 0, target: { artifact_ref: "b" } },
  { key: "a", parent: "guide", title: "Details", order: 1, target: { artifact_ref: "a", section_key: "detail" } },
  { key: "again", parent: null, title: "Reference", order: 1, target: { artifact_ref: "b" } },
  { key: "pending", parent: null, title: "Not selected", order: 2, target: { artifact_ref: "excluded" } },
], remove: [] });

test("LLMS preserves map placement order and emits each approved article once", () => {
  const output = buildLlmsDocuments({ title: "Knowledge", articles, map });
  const index = output.files.get("llms.txt")!;
  const full = output.files.get("llms-full.txt")!;
  expect(index.indexOf("Start here")).toBeLessThan(index.indexOf("Details"));
  expect(index).toContain("Reference");
  expect(index).not.toContain("Not selected");
  expect(index).toContain("#section-detail");
  expect(full.indexOf("Beta body")).toBeLessThan(full.indexOf("Alpha body"));
  expect(full.match(/Beta body/gu)).toHaveLength(1);
  expect(output.articleCount).toBe(2);
  expect([...output.files.keys()].filter(path => path.startsWith("llms/pages/"))).toHaveLength(2);
  expect(full).toContain("others/assets/x.png");
});

test("website LLMS links honor deployment base and point to packaged text and resources", () => {
  const output = buildLlmsDocuments({ title: "Knowledge", articles, map, base: "/docs/", assetsPrefix: "resources/" });
  expect(output.files.get("llms.txt")).toContain("/docs/llms-full.txt");
  expect(output.navigationMarkdown).not.toContain("llms-full.txt");
  expect(output.navigationMarkdown).not.toContain("changelog.html");
  expect(output.navigationMarkdown).toContain("Start here");
  const raw = [...output.files].find(([path, text]) => path.startsWith("llms/pages/") && text.includes("Alpha body"))![1];
  expect(raw).toContain("/docs/llms/pages/");
  expect(raw).toContain("/docs/resources/others/assets/x.png");
  expect(raw).not.toContain("(b.md)");
});

test("website text identifies UTF-8 without HTTP charset; standalone text stays BOM-free", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-llms-encoding-"));
  try {
    const output = buildLlmsDocuments({ title: "组件使用手册", articles: [{
      identity: "example", path: "wikis/example.md", title: "开始使用", sections: [], content: "# 开始使用\n\n中文正文与 emoji 🌏。",
    }] });
    await writeLlmsDocuments(join(root, "site"), output, { utf8Bom: true });
    await writeLlmsDocuments(join(root, "standalone"), output);
    for (const [path, content] of output.files) {
      const bytes = await readFile(join(root, "site", path));
      expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
      expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(content);
      expect(await readFile(join(root, "standalone", path), "utf8")).toBe(content);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("empty knowledge produces valid LLMS entry files without inventing pages", () => {
  const output = buildLlmsDocuments({ title: "Empty", articles: [] });
  expect(output.articleCount).toBe(0);
  expect([...output.files.keys()]).toEqual(["llms.txt", "llms-full.txt"]);
});
