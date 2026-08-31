import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareDistPackageJson,
  type PublishContext,
} from "../packages/dev-cli/src/commands/publish.js";
import { releasePackagesForVersion } from
  "../packages/dev-cli/src/commands/releasePackages.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readPackageVersion(path: string): Promise<string> {
  const pkg = JSON.parse(await readFile(path, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`Missing package version: ${path}`);
  return pkg.version;
}

async function assertDirectory(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error(`Missing build output: ${path}`);
}

async function assertPluginManifestVersions(expectedVersion: string): Promise<void> {
  for (const host of ["claude", "codex", "cursor"]) {
    const manifestPath = resolve(
      projectRoot,
      "plugins",
      "context",
      "repo-install",
      host,
      `.${host}-plugin`,
      "plugin.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    if (manifest.name !== "c4a" || manifest.version !== expectedVersion) {
      throw new Error(
        `${host} plugin manifest is ${String(manifest.version)}, expected ${expectedVersion}`,
      );
    }
  }
}

async function assertWorkspacePublicationBoundary(
  releasePackages: ReadonlyArray<{ name: string; dir: string }>,
): Promise<void> {
  const allowed = new Map(releasePackages.map((pkg) => [pkg.dir, pkg.name]));
  const packageDirs = await readdir(resolve(projectRoot, "packages"), { withFileTypes: true });

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue;
    const manifestPath = resolve(projectRoot, "packages", entry.name, "package.json");
    let manifest: { name?: string; private?: boolean };
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    const expectedName = allowed.get(entry.name);
    if (expectedName !== undefined) {
      if (manifest.name !== expectedName || manifest.private === true) {
        throw new Error(
          `Release package ${entry.name} must be public and named ${expectedName}`,
        );
      }
      continue;
    }

    if (manifest.private !== true) {
      throw new Error(
        `Workspace package ${String(manifest.name ?? entry.name)} is outside the release allowlist and must be private`,
      );
    }
  }
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

const releasePackages = releasePackagesForVersion(version);
await assertWorkspacePublicationBoundary(releasePackages);
for (const pkg of releasePackages) {
  const packageDir = resolve(projectRoot, "packages", pkg.dir);
  const packageVersion = await readPackageVersion(resolve(packageDir, "package.json"));
  if (packageVersion !== version) {
    throw new Error(`${pkg.name} is ${packageVersion}, expected release version ${version}`);
  }

  const distDir = resolve(packageDir, "dist");
  await assertDirectory(distDir);
  await prepareDistPackageJson(context, packageDir, distDir, version, pkg.dir);
}

await assertPluginManifestVersions(version);

console.log(JSON.stringify({
  state: "release-prepared",
  version,
  packages: releasePackages.map((pkg) => ({
    name: pkg.name,
    directory: `packages/${pkg.dir}/dist`,
  })),
}, null, 2));
