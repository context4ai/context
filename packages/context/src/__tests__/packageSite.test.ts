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
