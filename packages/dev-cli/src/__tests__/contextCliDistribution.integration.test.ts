import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BUILD_SCRIPT = join(WORKSPACE_ROOT, "packages", "build.ts");
const CONTEXT_CLI_PACKAGE_JSON = join(WORKSPACE_ROOT, "packages", "context-cli", "package.json");

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  }).trim();
}

async function linkJiti(nodeModulesDir: string): Promise<void> {
  const require = createRequire(CONTEXT_CLI_PACKAGE_JSON);
  const jitiPackageDir = dirname(require.resolve("jiti/package.json"));
  await mkdir(nodeModulesDir, { recursive: true });
  await symlink(jitiPackageDir, join(nodeModulesDir, "jiti"), "dir");
}

describe("context-cli distribution modes", () => {
  test("loads TypeScript entries in dev, link, and flattened npm layouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-cli-distribution-"));
    const fixturePackage = join(root, "context-cli");
    const projectEntry = join(root, "project.ts");

    try {
      await mkdir(join(fixturePackage, "src"), { recursive: true });
      await writeFile(join(fixturePackage, "package.json"), `${JSON.stringify({
        name: "@c4a/context-cli-distribution-fixture",
        version: "0.0.0",
        type: "module",
        bin: { context: "./dist/cli.js" },
        dependencies: { jiti: "^2.7.0" },
      }, null, 2)}\n`);
      await writeFile(join(fixturePackage, "src", "cli.ts"), [
        'import { createJiti } from "jiti";',
        "",
        "const entry = process.argv[2]!;",
        "await createJiti(entry).import(entry);",
        'process.stdout.write("loaded\\n");',
        "",
      ].join("\n"));
      await writeFile(projectEntry, "export default { loaded: true };\n");
      await linkJiti(join(fixturePackage, "node_modules"));

      expect(run("bun", ["run", join(fixturePackage, "src", "cli.ts"), projectEntry], root)).toBe("loaded");

      run("bun", ["run", BUILD_SCRIPT, "src/cli.ts", "--shebang=node"], fixturePackage);
      const bundledCli = join(fixturePackage, "dist", "cli.js");
      const bundle = readFileSync(bundledCli, "utf8");
      expect(bundle).toContain('from "jiti"');
      expect(bundle).not.toContain("../dist/babel.cjs");
      expect(existsSync(join(fixturePackage, "dist", "babel.cjs"))).toBe(false);
      expect(run("node", [bundledCli, projectEntry], root)).toBe("loaded");

      const installRoot = join(root, "installed");
      const installedPackage = join(installRoot, "node_modules", "@c4a", "context-cli");
      await mkdir(dirname(installedPackage), { recursive: true });
      await cp(join(fixturePackage, "dist"), installedPackage, { recursive: true });
      await linkJiti(join(installRoot, "node_modules"));
      expect(run("node", [join(installedPackage, "cli.js"), projectEntry], root)).toBe("loaded");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
