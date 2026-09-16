import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { packageSiteOutputDir } from "./packageOutputPaths.js";
import { withProjectWriteLock } from "./writeLock.js";

export const SITE_MAP_FILE = "context-site-map.json";

/** The complete deployed root includes any subpath. No network requests. */
export function normalizeSiteUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Use an HTTP(S) site root without credentials, query or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url.href;
}

export async function readPackageSiteUrl(root: string, pkg: PackageDefinition): Promise<string | undefined> {
  if (pkg.kind !== "package.kb" || !pkg.site) return undefined;
  try {
    const map = JSON.parse(await readFile(join(root, packageSiteOutputDir(pkg), SITE_MAP_FILE), "utf8"));
    return typeof map.site_url === "string" ? normalizeSiteUrl(map.site_url) : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError) return undefined;
    throw error;
  }
}

/** Record delivery metadata in the existing map, including its distributed copy.
 * Repeating this command repairs an interrupted two-file update. */
export async function recordPackageSiteUrl(root: string, packageName: string, value: string) {
  const siteUrl = normalizeSiteUrl(value);
  return withProjectWriteLock(root, "record-site-url", async () => {
    const { loadContextProjectModule } = await import("./workspace.js");
    const loaded = await loadContextProjectModule(root);
    const pkg = loaded.project.packages.find(candidate => candidate.name === packageName);
    if (!pkg || pkg.kind !== "package.kb" || !pkg.site) {
      throw new TypeError("Select a declared knowledge package with a website");
    }
    const siteMap = join(root, packageSiteOutputDir(pkg), SITE_MAP_FILE);
    let map;
    try { map = JSON.parse(await readFile(siteMap, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TypeError("Build the configured website before recording its deployment URL");
      throw error;
    }
    if (map.protocol !== "context.site-output/v1" || !Array.isArray(map.pages)) {
      throw new TypeError("Rebuild the website to restore a valid context-site-map.json");
    }
    const content = JSON.stringify({ ...map, site_url: siteUrl }, null, 2) + "\n";
    for (const path of [siteMap, join(root, pkg.outDir, SITE_MAP_FILE)]) {
      await writeFile(`${path}.tmp`, content);
      await rename(`${path}.tmp`, path);
    }
    return { package: pkg.name, site_url: siteUrl, network_checked: false };
  });
}
