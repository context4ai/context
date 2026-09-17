import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SITE_THEME, kbPackage } from "@c4a/context";
import { resolveSiteTheme, siteThemeVariables, SITE_THEME_FILE } from "../project/siteTheme.js";

test("missing or deleted optional theme falls back and build scaffolding preserves customizations", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-theme-"));
  try {
    expect(await resolveSiteTheme(root)).toEqual(DEFAULT_SITE_THEME);
    await expect(readFile(join(root, SITE_THEME_FILE))).rejects.toThrow();
    await resolveSiteTheme(root, undefined, true);
    const file = join(root, SITE_THEME_FILE);
    await writeFile(file, JSON.stringify({light:{brand:"#123456"}}));
    expect((await resolveSiteTheme(root, {light:{text:"#112233"}}, true)).light).toEqual({...DEFAULT_SITE_THEME.light,brand:"#123456",text:"#112233"});
    expect(JSON.parse(await readFile(file,"utf8"))).toEqual({light:{brand:"#123456"}});
    expect((await resolveSiteTheme(root,{light:{brand:"#abcdef"}})).light.brand).toBe("#abcdef");
    await rm(file);
    expect(await resolveSiteTheme(root)).toEqual(DEFAULT_SITE_THEME);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("theme schema rejects unsafe colors and reports malformed optional files", async () => {
  expect(() => kbPackage({name:"test",template:"templates",site:{theme:{light:{brand:"</style><script>"}}}})).toThrow();
  const root = await mkdtemp(join(tmpdir(), "context-theme-"));
  try {
    await mkdir(join(root,"src/site"),{recursive:true});
    await writeFile(join(root,SITE_THEME_FILE),"broken");
    await expect(resolveSiteTheme(root)).rejects.toThrow("Invalid src/site/theme.json");
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("both presentation adapters share resolved light and dark tokens", async () => {
  const css = siteThemeVariables(DEFAULT_SITE_THEME);
  expect(css).toContain(".dark{");
  expect(css).toContain("--vp-c-brand-1:var(--context-brand)");
  expect(css).toContain("--blue:var(--context-brand)");
  expect(css).not.toContain("--red:");
});
