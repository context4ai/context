import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_SITE_THEME, siteThemeSchema, type SiteTheme, type SiteThemeColors } from "@c4a/context";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export const SITE_THEME_FILE = "src/site/theme.json";
/** Optional presentation input. Missing files never prevent build or Review. */
export async function resolveSiteTheme(root: string, overrides?: SiteTheme, scaffold = false) {
  const path = join(root, SITE_THEME_FILE);
  let file: SiteTheme = {};
  try {
    file = siteThemeSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ContextError(ExitCode.UserError, `Invalid ${SITE_THEME_FILE}: ${error instanceof Error ? error.message : String(error)}. Fix the theme or remove the optional file to use defaults.`, { reason_code: "invalid-site-theme" });
    }
    if (scaffold) {
      await mkdir(dirname(path), { recursive: true });
      try { await writeFile(path, JSON.stringify(DEFAULT_SITE_THEME, null, 2) + "\n", { flag: "wx" }); }
      catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError; }
      // Read a concurrently created file rather than silently ignoring it.
      return resolveSiteTheme(root, overrides);
    }
  }
  const inline = siteThemeSchema.parse(overrides ?? {});
  return { light: { ...DEFAULT_SITE_THEME.light, ...file.light, ...inline.light }, dark: { ...DEFAULT_SITE_THEME.dark, ...file.dark, ...inline.dark } };
}

/** Scaffolding the built-in defaults is not a knowledge content change. */
export function isDefaultSiteTheme(content: string): boolean {
  try {
    const theme = siteThemeSchema.parse(JSON.parse(content));
    return (["light", "dark"] as const).every(mode =>
      Object.entries(theme[mode] ?? {}).every(([key, value]) =>
        DEFAULT_SITE_THEME[mode][key as keyof SiteThemeColors] === value));
  } catch { return false; }
}

export function siteThemeVariables(theme: { light: SiteThemeColors; dark: SiteThemeColors }) {
  const rules = (c: SiteThemeColors) => Object.entries(c).map(([key,value]) => `--context-${key.replace(/[A-Z]/gu, x => '-'+x.toLowerCase())}:${value};`).join("") + `
--vp-c-brand-1:var(--context-brand);--vp-c-brand-2:var(--context-accent);--vp-c-brand-3:var(--context-brand);
--vp-c-brand-soft:color-mix(in srgb,var(--context-brand) 8%,transparent);
--vp-c-bg:var(--context-background);--vp-c-bg-alt:var(--context-surface);--vp-c-bg-soft:var(--context-surface);--vp-c-bg-elv:var(--context-background);
--vp-sidebar-bg-color:var(--context-surface);--vp-nav-bg-color:var(--context-background);--vp-local-search-bg:var(--context-background);
--vp-c-text-1:var(--context-text);--vp-c-text-2:var(--context-muted-text);--vp-c-text-3:var(--context-muted-text);--vp-c-divider:var(--context-border);--vp-c-border:var(--context-border);
--bg:var(--context-background);--side:var(--context-surface);--text:var(--context-text);--muted:var(--context-muted-text);--line:var(--context-border);--blue:var(--context-brand);`;
  return `:root{${rules(theme.light)}}.dark{${rules(theme.dark)}}
.node.selected,blockquote{background:color-mix(in srgb,var(--context-brand) 8%,transparent)}blockquote{border-left-color:var(--context-accent)}
`;
}
