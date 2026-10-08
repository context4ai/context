import { expect, test } from "bun:test";
import { kbPackage } from "../index.js";

test("website is opt-in and deployment paths are constrained", () => {
  const base = { name: "sample", template: "src/templates" };
  expect(kbPackage(base).site).toBeUndefined();
  expect(kbPackage({ ...base, site: {} }).site).toEqual({ base: "/", lang: "en-US" });
  expect(kbPackage({ ...base, site: { base: "/docs/" } }).site?.base).toBe("/docs/");
  expect(kbPackage({ ...base, site: { home: {
    title: "Team knowledge", slogan: "Find the next answer", actions: [{ text: "Browse", link: "/guide/" }],
    resources: [{ title: "Workspace", href: "https://example.com/workspace", command: "context status" }],
  } } }).site?.home?.resources).toHaveLength(1);
  expect(() => kbPackage({ ...base, site: { base: "../out" } })).toThrow();
  expect(() => kbPackage({ ...base, site: { home: { resources: [{ title: "Missing destination" }] } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { home: { actions: [{ text: "Unsafe", link: "javascript:alert(1)" }] } } })).toThrow();
});

test("site extension configuration retains defaults and rejects unsafe roots and route keys", () => {
  const base = { name: "sample", template: "src/templates" };
  expect(kbPackage({ ...base, site: { extensions: {
    slots: { banner: "Banner.vue", floating: "Chat.vue", footer: false }, pages: { help: "help.md" },
  } } }).site?.extensions).toEqual({ root: "src/site", slots: { banner: "Banner.vue", floating: "Chat.vue", footer: false }, pages: { help: "help.md" } });
  expect(() => kbPackage({ ...base, site: { extensions: { root: "../outside" } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { extensions: { pages: { "../index": "help.md" } } } })).toThrow();
});

test("site locales, navigation, More menu and social links are validated", () => {
  const base = { name: "sample", template: "src/templates" };
  const site = kbPackage({ ...base, site: {
    lang: "en-US",
    locales: { "zh-CN": { path: "zh", title: "示例文档" } },
    nav: [{ text: "Home", link: "/", locales: { "zh-CN": "首页" } }, { text: "Search", link: "https://example.com/search/" }],
    more: [{ text: "Release Notes", target: { artifact_ref: "release-notes" } }, { text: "Status", link: "https://example.com/status" }],
    socialLinks: [{ icon: "github", link: "https://github.com/example" }],
    localePreferenceKey: "example-locale",
  } }).site;
  expect(site?.locales?.["zh-CN"]?.path).toBe("zh");
  expect(site?.more).toHaveLength(2);
  expect(() => kbPackage({ ...base, site: { locales: { "en-US": { path: "en" } } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { locales: { "zh-CN": { path: "zh" }, "zh-TW": { path: "zh" } } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { locales: { "zh-CN": { path: "pages" } } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { locales: { "zh-CN": { path: "zh/cn" } } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { locales: { chinese_simplified: { path: "zh" } } } })).toThrow();
  expect(() => kbPackage({ ...base, site: { more: [{ text: "Both", link: "/a", target: { artifact_ref: "a" } }] } })).toThrow();
  expect(() => kbPackage({ ...base, site: { more: [{ text: "Neither" }] } })).toThrow();
  expect(() => kbPackage({ ...base, site: { nav: [{ text: "Unsafe", link: "javascript:alert(1)" }] } })).toThrow();
  expect(() => kbPackage({ ...base, site: { socialLinks: [{ icon: "github", link: "http://github.com/example" }] } })).toThrow();
});
