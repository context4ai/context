import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the installed Context CLI package version from its package.json.
 * This works from both src/* in development and dist/* in packaged builds.
 */
export function readPackageVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      const packagePath = join(dir, "package.json");
      if (existsSync(packagePath)) {
        const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
          version?: unknown;
        };
        if (typeof parsed.version === "string" && parsed.version.length > 0) {
          return parsed.version;
        }
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (error) {
    throw new TypeError("Context CLI package version cannot be read", {
      cause: error,
    });
  }
  throw new TypeError("Context CLI package version is missing from package.json");
}
