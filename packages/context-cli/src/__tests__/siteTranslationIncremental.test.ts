import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PackageDefinition } from "@c4a/context";
import { approvedArticleDigest, prepareSiteTranslation, submitSiteTranslation } from "../project/siteTranslation.js";
const source = '---\ntitle: Guide\n---\n# Guide\n<!-- context:section id="a" -->\nFirst\n<!-- /context:section -->\n<!-- context:section id="b" -->\nSecond\n<!-- /context:section -->\n';
const translated = source.replaceAll("Guide", "指南").replace("First", "第一节").replace("Second", "第二节");
const pkg = { kind: "package.kb", name: "kb", outDir: "dist/kb", reads: [], writes: [], template: { path: "src/templates", vars: {} }, site: { locales: { "zh-CN": {} } } } as unknown as PackageDefinition;
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { stdio: "pipe" });

async function workspace(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "knowledge/codeindex"), { recursive: true });
  await mkdir(join(root, "translations/zh-CN/codeindex"), { recursive: true });
  return { root, original: join(root, "knowledge/codeindex/a.md"), destination: join(root, "translations/zh-CN/codeindex/a.md") };
}
const stored = (digest: string) => translated.replace("title: 指南", `title: 指南\ntranslation:\n  source_digest: ${digest}`);

test("a stale translation becomes the draft beside the source diff since it was translated", async () => {
  const { root, original, destination } = await workspace("translation-diff-");
  try {
    await writeFile(original, source);
    await writeFile(destination, stored(approvedArticleDigest(source)));
    git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "translated");
    await writeFile(original, source.replace("Second", "Changed"));
    const first = await prepareSiteTranslation(root, [pkg]);
    const item = first.items[0]!;
    if (item.kind !== "article") throw new Error("Missing article");
    expect(item).toMatchObject({ draft: "generated", source_diff: `${item.file}.diff` });
    expect(await readFile(join(root, item.file), "utf8")).toContain("第二节");
    const diff = await readFile(join(root, item.source_diff!), "utf8");
    expect(diff).toContain("-Second");
    expect(diff).toContain("+Changed");
    expect(diff).not.toContain("-First");
    await writeFile(join(root, item.file), stored("ignored").replace("第二节", "已修改"));
    // The draft's edit is withdrawn upstream while another section changes; the
    // stored translation's diff no longer describes the kept draft.
    await writeFile(original, source.replace("First", "Other"));
    const again = await prepareSiteTranslation(root, [pkg]);
    expect(again.items[0]).toMatchObject({ draft: "kept", source_diff: null });
    expect(existsSync(join(root, item.source_diff!))).toBe(false);
    expect(await readFile(join(root, item.file), "utf8")).toContain("已修改");
    await submitSiteTranslation(root, [pkg], { expected_digest: again.expected_digest!, map_entries: [],
      articles: [{ locale: "zh-CN", approved_path: item.approved_path, file: item.file }] }, file => join(root, file));
    const saved = await readFile(destination, "utf8");
    expect(saved).toContain("已修改");
    expect(saved).not.toContain("source_parts");
    expect(existsSync(join(root, item.file))).toBe(false);
    expect(existsSync(join(root, item.source_diff!))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unedited leftover draft is reseeded with the source diff instead of kept", async () => {
  const { root, original, destination } = await workspace("translation-leftover-");
  try {
    await writeFile(original, source);
    await writeFile(destination, stored(approvedArticleDigest(source)));
    git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "translated");
    await writeFile(original, source.replace("Second", "Changed"));
    const first = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    if (first.kind !== "article") throw new Error("Missing article");
    await rm(join(root, first.source_diff!));
    await writeFile(join(root, first.file), stored("left-by-older-cli"));
    const again = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    expect(again).toMatchObject({ draft: "generated", source_diff: `${first.file}.diff` });
    expect(await readFile(join(root, first.source_diff!), "utf8")).toContain("+Changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("without history the previous translation is still the draft; missing pages start from the source", async () => {
  const { root, original, destination } = await workspace("translation-nohistory-");
  try {
    await writeFile(original, source.replace("Second", "Changed"));
    await writeFile(destination, stored(approvedArticleDigest(source)));
    const stale = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    if (stale.kind !== "article") throw new Error("Missing article");
    expect(stale).toMatchObject({ state: "stale", draft: "generated", source_diff: null });
    expect(await readFile(join(root, stale.file), "utf8")).toContain("第二节");
    await rm(destination);
    await rm(join(root, stale.file));
    const missing = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    if (missing.kind !== "article") throw new Error("Missing article");
    expect(missing).toMatchObject({ state: "missing", source_diff: null });
    expect(await readFile(join(root, missing.file), "utf8")).toContain("Changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
