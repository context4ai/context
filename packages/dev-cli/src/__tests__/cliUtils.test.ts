import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inferPackageNameFromGlobalNpmPath } from "../commands/cliUtils.js";

describe("inferPackageNameFromGlobalNpmPath", () => {
  const npmRoot = join(process.cwd(), ".tmp", "npm-root");

  test("infers scoped package owners for global bin targets", () => {
    const filePath = join(npmRoot, "@example", "context-cli", "dist", "cli.js");

    expect(inferPackageNameFromGlobalNpmPath(npmRoot, filePath)).toBe("@example/context-cli");
  });

  test("infers unscoped package owners for global bin targets", () => {
    const filePath = join(npmRoot, "typescript", "bin", "tsc");

    expect(inferPackageNameFromGlobalNpmPath(npmRoot, filePath)).toBe("typescript");
  });

  test("ignores paths outside the global npm root", () => {
    const filePath = join(process.cwd(), ".tmp", "other-root", "context-cli", "dist", "cli.js");

    expect(inferPackageNameFromGlobalNpmPath(npmRoot, filePath)).toBeUndefined();
  });
});
