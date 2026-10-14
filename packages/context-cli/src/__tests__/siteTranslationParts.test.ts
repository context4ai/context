import { expect, test } from "bun:test";
import { translationDraft, translationPartsDiff, translationSourceParts } from "../project/siteTranslationParts.js";
const wrap = (id: string, text: string) => `<!-- context:section id="${id}" -->\n${text}\n<!-- /context:section -->\n`;
const source = `---\ntitle: Guide\ndescription: Description\n---\nIntro\n${wrap("a", "First") }Between\n${wrap("b", "Second")}Tail\n`;
const translated = source.replace("Guide", "指南").replace("Description", "介绍").replace("Intro", "开头").replace("First", "第一节").replace("Between", "中间").replace("Second", "第二节").replace("Tail", "结尾");

test("incremental draft preserves translations and all exterior positions", () => {
  const changed = source.replace("Second", "Second changed");
  const baseline = translationSourceParts(source);
  const draft = translationDraft(changed, translated, baseline);
  expect(draft).toContain("第一节");
  expect(draft).toContain("Second changed");
  expect(draft).toContain("开头");
  expect(draft).toContain("中间");
  expect(draft).toContain("结尾");
  expect(translationPartsDiff(translationSourceParts(changed), baseline)).toEqual({ title: false, description: false, preamble: false, order: false, added: [], deleted: [], modified: ["b"] });
});

test("metadata, tail, section order and unknown baselines are explicit", () => {
  const baseline = translationSourceParts(source);
  expect(translationPartsDiff(translationSourceParts(source.replace("Tail", "New tail")), baseline)).toMatchObject({ preamble: true, modified: [] });
  expect(translationPartsDiff(translationSourceParts(source.replace("Guide", "New title")), baseline)).toMatchObject({ title: true, description: false, modified: [] });
  const reordered = source.replace(wrap("a", "First"), "TEMP").replace(wrap("b", "Second"), wrap("a", "First")).replace("TEMP", wrap("b", "Second"));
  expect(translationPartsDiff(translationSourceParts(reordered), baseline)).toMatchObject({ order: true, modified: [] });
  expect(translationPartsDiff(baseline)).toBe("unknown");
  expect(translationDraft(source, translated)).toContain("First");
  const plain = "---\ntitle: Plain\n---\nAll outside\n";
  expect(translationDraft(plain, plain.replace("All outside", "全文"), translationSourceParts(plain))).toContain("全文");
});
