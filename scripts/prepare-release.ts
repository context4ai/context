import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_PACKAGES,
  prepareDistPackageJson,
  type PublishContext,
} from "../packages/dev-cli/src/commands/publish.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readPackageVersion(path: string): Promise<string> {
  const pkg = JSON.parse(await readFile(path, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`Missing package version: ${path}`);
  return pkg.version;
}

async function assertDirectory(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error(`Missing build output: ${path}`);
}

const version = await readPackageVersion(resolve(projectRoot, "package.json"));
const context: PublishContext = {
  projectRoot,
  info: (message) => console.log(message),
  success: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  waitForInput: async () => "",
};

for (const pkg of PUBLISH_PACKAGES) {
  const packageDir = resolve(projectRoot, "packages", pkg.dir);
  const packageVersion = await readPackageVersion(resolve(packageDir, "package.json"));
  if (packageVersion !== version) {
    throw new Error(`${pkg.name} is ${packageVersion}, expected release version ${version}`);
  }

  const distDir = resolve(packageDir, "dist");
  await assertDirectory(distDir);
  await prepareDistPackageJson(context, packageDir, distDir, version, pkg.dir);
}

console.log(JSON.stringify({
  state: "release-prepared",
  version,
  packages: PUBLISH_PACKAGES.map((pkg) => ({
    name: pkg.name,
    directory: `packages/${pkg.dir}/dist`,
  })),
}, null, 2));
