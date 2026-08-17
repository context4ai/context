import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type BumpVersionContext = {
  projectRoot: string;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  waitForInput: (prompt: string, defaultValue?: string) => Promise<string>;
};

async function updateContextWorkflowProviderVersion(
  projectRoot: string,
  targetVersion: string,
): Promise<boolean> {
  const providerPath = join(
    projectRoot,
    "packages",
    "context-cli",
    "context-workflow",
    "provider.yaml",
  );
  try {
    const content = await readFile(providerPath, "utf-8");
    const versionLine = /^version:\s*[^\r\n]+$/mu;
    if (!versionLine.test(content)) {
      throw new Error(`Missing top-level version in ${providerPath}`);
    }
    const next = content.replace(versionLine, `version: ${targetVersion}`);
    if (next === content) return false;
    await writeFile(providerPath, next, "utf-8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readRootVersion(projectRoot: string): Promise<string> {
  try {
    const content = await readFile(join(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function cmdBumpVersion(args: string[], ctx: BumpVersionContext): Promise<void> {
  let targetVersion = args[0];
  if (!targetVersion) {
    const currentVersion = await readRootVersion(ctx.projectRoot);
    targetVersion = await ctx.waitForInput(
      "Target version: ",
      currentVersion !== "unknown" ? currentVersion : undefined,
    );
    if (!targetVersion) {
      ctx.error("No version provided, cancelled");
      return;
    }
  }

  if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
    ctx.error(`Invalid version: ${targetVersion} (expected SemVer format, e.g. 0.4.1)`);
    process.exit(1);
  }

  const updated: string[] = [];
  const skipped: string[] = [];

  // Update root package.json
  const rootPkgPath = join(ctx.projectRoot, "package.json");
  try {
    const content = await readFile(rootPkgPath, "utf-8");
    const pkg = JSON.parse(content) as { name?: string; version?: string };
    const oldVersion = pkg.version ?? "unknown";
    if (oldVersion === targetVersion) {
      skipped.push(`${pkg.name ?? "root"} (${oldVersion})`);
    } else {
      pkg.version = targetVersion;
      await writeFile(rootPkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
      updated.push(`${pkg.name ?? "root"}: ${oldVersion} -> ${targetVersion}`);
    }
  } catch {
    skipped.push("root (no package.json)");
  }

  // Update all workspace packages
  const packagesDir = resolve(ctx.projectRoot, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(packagesDir, entry.name, "package.json");
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content) as { name?: string; version?: string };
      const oldVersion = pkg.version ?? "unknown";
      if (oldVersion === targetVersion) {
        skipped.push(`${pkg.name ?? entry.name} (${oldVersion})`);
        continue;
      }
      pkg.version = targetVersion;
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
      updated.push(`${pkg.name ?? entry.name}: ${oldVersion} -> ${targetVersion}`);
    } catch {
      skipped.push(`${entry.name} (no package.json)`);
    }
  }

  if (await updateContextWorkflowProviderVersion(ctx.projectRoot, targetVersion)) {
    updated.push(`context workflow Provider -> ${targetVersion}`);
  }

  if (updated.length > 0) {
    ctx.success(`Updated ${updated.length} packages to ${targetVersion}:`);
    for (const item of updated) {
      ctx.info(`  ${item}`);
    }
  }
  if (skipped.length > 0) {
    ctx.warn(`Skipped ${skipped.length} packages:`);
    for (const item of skipped) {
      ctx.info(`  ${item}`);
    }
  }
}
