import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customPageLinkProblems } from "../project/siteCustomPageLinks.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const page = (body: string, ids: string[] = []) =>
  `<html><body><nav><a href="/missing-nav.html">nav</a></nav><main>${ids.map(id => `<h3 id="${id}">x</h3>`).join("")}${body}</main></body></html>`;

test("custom page links and anchors are checked against the built site", async () => {
  const output = await mkdtemp(join(tmpdir(), "custom-links-"));
  roots.push(output);
  await mkdir(join(output, "custom"), { recursive: true });
  await mkdir(join(output, "pages"), { recursive: true });
  await writeFile(join(output, "custom/glossary.html"), page("", ["_3v架构", "arena-idc-switch"]));
  await writeFile(join(output, "pages/a.html"), page(""));
  await writeFile(join(output, "custom/guide.html"), page([
    `<a href="/docs/custom/glossary.html#_3v%E6%9E%B6%E6%9E%84">ok</a>`,
    `<a href="/docs/custom/glossary.html#3v架构">broken anchor</a>`,
    `<a href="/docs/custom/glossary.html#arena_idc_switch">broken anchor</a>`,
    `<a href="glossary.html#arena-idc-switch">relative ok</a>`,
    `<a href="../pages/a.html">article ok</a>`,
    `<a href="/docs/custom/nope.html">missing page</a>`,
    `<a href="https://example.com/x">external</a>`,
    `<a href="/other-app/x.html">another app</a>`,
    `<a href="#top">same page missing</a>`,
  ].join("")));
  const problems = await customPageLinkProblems(output, "/docs/", ["guide", "glossary"]);
  expect(problems).toEqual([
    "custom/guide.html: link /docs/custom/glossary.html#3v架构 points to a missing anchor in custom/glossary.html",
    "custom/guide.html: link /docs/custom/glossary.html#arena_idc_switch points to a missing anchor in custom/glossary.html",
    "custom/guide.html: link /docs/custom/nope.html has no target",
    "custom/guide.html: link #top points to a missing anchor in custom/guide.html",
  ]);
});
