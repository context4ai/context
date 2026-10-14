import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as yaml } from "yaml";
import type { PackageDefinition } from "@c4a/context";
import { approvedArticleDigest, prepareSiteTranslation, submitSiteTranslation } from "../project/siteTranslation.js";
const source = '---\ntitle: Guide\n---\n# Guide\n<!-- context:section id="a" -->\nFirst\n<!-- /context:section -->\n';
const translated = source.replaceAll("Guide", "指南").replace("First", "第一节");
const pkg = { kind: "package.kb", name: "kb", outDir: "dist/kb", reads: [], writes: [], template: { path: "src/templates", vars: {} }, site: { locales: { "zh-CN": {} } } } as unknown as PackageDefinition;

test("legacy migration and retained drafts never silently adopt a newer source", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-incremental-"));
  try {
    await mkdir(join(root, "knowledge/codeindex"), { recursive: true });
    await mkdir(join(root, "translations/zh-CN/codeindex"), { recursive: true });
    const original = join(root, "knowledge/codeindex/a.md");
    const destination = join(root, "translations/zh-CN/codeindex/a.md");
    await writeFile(original, source);
    await writeFile(destination, translated.replace("title: 指南", `title: 指南\ntranslation:\n  source_digest: ${approvedArticleDigest(source)}`));
    expect((await prepareSiteTranslation(root, [pkg])).items).toEqual([]);
    expect(await readFile(destination, "utf8")).toContain("source_parts:");
    await writeFile(original, source.replace("First", "Changed"));
    const first = await prepareSiteTranslation(root, [pkg]);
    const item = first.items.find(item => item.kind === "article")!;
    if (item.kind !== "article") throw new Error("Missing article");
    expect(item.diff).toMatchObject({ modified: ["a"] });
    await writeFile(join(root, item.file), translated.replace("第一节", "已修改的译文"));
    const kept = await prepareSiteTranslation(root, [pkg]);
    expect(kept.items[0]).toMatchObject({ draft: "kept" });
    await writeFile(original, source.replace("First", "Changed again"));
    const newer = await prepareSiteTranslation(root, [pkg]);
    expect(newer.items[0]).toMatchObject({ draft: "rebase-required" });
    expect(yaml(await readFile(join(root, newer.submission_path), "utf8")).articles).toEqual([]);
    const input = { expected_digest: newer.expected_digest!, articles: [{ locale: "zh-CN", approved_path: item.approved_path, file: item.file }], map_entries: [] };
    await expect(submitSiteTranslation(root, [pkg], input, file => join(root, file))).rejects.toThrow("nothing was saved");
    // Explicitly reconciling the source version is a new author decision.
    await submitSiteTranslation(root, [pkg], { ...input, articles: [{ ...input.articles[0]!, source_digest: approvedArticleDigest(source.replace("First", "Changed again")) }] }, file => join(root, file));
    expect(await readFile(destination, "utf8")).toContain("已修改的译文");
    await writeFile(destination, translated.replace("title: 指南", "title: 指南\ntranslation:\n  source_digest: old"));
    const unknown = await prepareSiteTranslation(root, [pkg]);
    expect(unknown.items[0]).toMatchObject({ diff: "unknown" });
    expect(await readFile(join(root, `${item.file}.previous.md`), "utf8")).toContain("第一节");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a draft without a generation record is set aside and regenerated", async () => {
  const root = await mkdtemp(join(tmpdir(), "translation-unrecorded-"));
  try {
    await mkdir(join(root, "knowledge/codeindex"), { recursive: true });
    await writeFile(join(root, "knowledge/codeindex/a.md"), source);
    const file = ".tmp/agent-payloads/translations/zh-CN/codeindex/a.md";
    await mkdir(join(root, ".tmp/agent-payloads/translations/zh-CN/codeindex"), { recursive: true });
    await writeFile(join(root, file), "Leftover draft\n");
    const prepared = await prepareSiteTranslation(root, [pkg]);
    expect(prepared.items[0]).toMatchObject({ draft: "generated", unrecorded_draft: `${file}.unrecorded.md` });
    expect(await readFile(join(root, `${file}.unrecorded.md`), "utf8")).toBe("Leftover draft\n");
    expect(await readFile(join(root, file), "utf8")).toContain("First");
    expect(yaml(await readFile(join(root, prepared.submission_path), "utf8")).articles).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
