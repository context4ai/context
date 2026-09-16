import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Isolate module replacement so other website tests always use real assets.
function rendererVersion(change: string) {
  const theme = new URL("../project/packageSiteTheme.ts", import.meta.url).pathname;
  const site = new URL("../project/packageSite.ts", import.meta.url).pathname;
  const result = spawnSync(process.execPath, ["-e", `
    import { mock } from "bun:test";
    const theme = await import(${JSON.stringify(theme)});
    mock.module(${JSON.stringify(theme)}, () => ({ ...theme, ${change} }));
    const site = await import(${JSON.stringify(site)});
    console.log(site.PACKAGE_SITE_VERSION);
  `], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

test("shipped theme changes invalidate the site renderer receipt without a manual version bump", () => {
  const original = rendererVersion("");
  expect(rendererVersion("")).toBe(original);
  expect(original).not.toBe("vitepress-site-v42-section-anchor-blocks");
  for (const field of ["siteThemeCss", "siteThemeScript", "siteMarkdownConfig"]) {
    expect(rendererVersion(`${field}: theme.${field} + '\\n/* updated asset */'`)).not.toBe(original);
  }
});
