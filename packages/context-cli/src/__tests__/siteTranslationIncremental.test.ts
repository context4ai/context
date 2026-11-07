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

test("a translation of an uncommitted intermediate source still gets its diff from the submitted snapshot", async () => {
  const { root, original, destination } = await workspace("translation-snapshot-");
  try {
    await writeFile(original, source);
    git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "base");
    // Round one changes the source and translates it without committing.
    const roundOne = source.replace("Second", "Round one");
    await writeFile(original, roundOne);
    const first = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    if (first.kind !== "article") throw new Error("Missing article");
    await writeFile(join(root, first.file), translated.replace("第二节", "第一轮"));
    const prepared = await prepareSiteTranslation(root, [pkg]);
    await submitSiteTranslation(root, [pkg], { expected_digest: prepared.expected_digest!, map_entries: [],
      articles: [{ locale: "zh-CN", approved_path: first.approved_path, file: first.file }] }, file => join(root, file));
    expect(await readFile(destination, "utf8")).toContain(approvedArticleDigest(roundOne));
    // Round two changes it again; Git has no commit holding round one.
    await writeFile(original, roundOne.replace("First", "Round two"));
    const second = (await prepareSiteTranslation(root, [pkg])).items[0]!;
    if (second.kind !== "article") throw new Error("Missing article");
    expect(second).toMatchObject({ draft: "generated", source_diff: `${second.file}.diff` });
    const diff = await readFile(join(root, second.source_diff!), "utf8");
    expect(diff).toContain("-First");
    expect(diff).toContain("+Round two");
    expect(diff).not.toContain("Second");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("orphaned translations alone keep the translation step open until submit removes them", async () => {
  const { root, original, destination } = await workspace("translation-orphan-");
  try {
    const { inspectSiteTranslations } = await import("../project/siteTranslation.js");
    await writeFile(original, source);
    await writeFile(destination, stored(approvedArticleDigest(source)));
    const orphan = join(root, "translations/zh-CN/codeindex/retired.md");
    await writeFile(orphan, stored("retired"));
    const inspection = await inspectSiteTranslations(root, [pkg]);
    expect(inspection).toMatchObject({ pending: 0, orphans: ["translations/zh-CN/codeindex/retired.md"], route_satisfied: false });
    const task = await prepareSiteTranslation(root, [pkg]);
    expect(task.items).toEqual([]);
    await submitSiteTranslation(root, [pkg], { expected_digest: task.expected_digest!, articles: [], map_entries: [] }, file => join(root, file));
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(destination)).toBe(true);
    expect((await inspectSiteTranslations(root, [pkg])).route_satisfied).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a receipt for an earlier translation set does not hide translations orphaned later; skip still resolves them", async () => {
  const { root, original, destination } = await workspace("translation-orphan-receipt-");
  try {
    const { inspectSiteTranslations, skipSiteTranslation } = await import("../project/siteTranslation.js");
    await writeFile(original, source.replace("Second", "Changed"));
    await writeFile(destination, stored(approvedArticleDigest(source)));
    const task = await prepareSiteTranslation(root, [pkg]);
    const item = task.items[0]!;
    if (item.kind !== "article") throw new Error("Missing article");
    await submitSiteTranslation(root, [pkg], { expected_digest: task.expected_digest!, map_entries: [],
      articles: [{ locale: "zh-CN", approved_path: item.approved_path, file: item.file }] }, file => join(root, file));
    expect((await inspectSiteTranslations(root, [pkg])).route_satisfied).toBe(true);
    await writeFile(join(root, "translations/zh-CN/codeindex/retired.md"), stored("retired"));
    const orphaned = await inspectSiteTranslations(root, [pkg]);
    expect(orphaned).toMatchObject({ pending: 0, route_satisfied: false });
    await skipSiteTranslation(root, [pkg], orphaned.source_set_digest!);
    expect((await inspectSiteTranslations(root, [pkg])).route_satisfied).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
