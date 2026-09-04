import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPackageVersion } from "../lib/packageVersion.js";

describe("Context CLI package version", () => {
  test("uses the package version accepted by Host Action receipts", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };

    expect(readPackageVersion()).toBe(packageJson.version);
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  });
});
