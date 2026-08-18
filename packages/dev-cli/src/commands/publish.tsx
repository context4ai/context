import { spawn } from "node:child_process";
import { chmod, cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { readRootVersion, cmdBumpVersion } from "./bumpVersion.js";
import { runWithStatus } from "./cliUtils.js";

export type PublishContext = {
  projectRoot: string;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  waitForInput: (prompt: string, defaultValue?: string) => Promise<string>;
};

type PackageEntry = { name: string; dir: string };

// Workspace packages whose runtime files must remain independently installed.
// Most workspace dependencies are bundled into their consumer's JavaScript and
// can be omitted from published metadata. context-cli is different: it loads
// the @c4a/context package identity at runtime and copies SDK-owned docs and
// package templates that cannot be embedded in cli.js.
const PUBLISHED_WORKSPACE_DEPENDENCIES: Readonly<Record<string, ReadonlySet<string>>> = {
  "context-cli": new Set(["@c4a/context"]),
};

export const PUBLISH_PACKAGES: PackageEntry[] = [
  { name: "@c4a/core", dir: "core" },
  { name: "@c4a/context", dir: "context" },
  { name: "@c4a/extract", dir: "extract" },
  { name: "@c4a/extract-ts", dir: "extract-ts" },
  { name: "@c4a/extract-go", dir: "extract-go" },
  { name: "@c4a/extract-rush", dir: "extract-rush" },
  { name: "@c4a/context-cli", dir: "context-cli" },
];

export async function cmdPublish(args: string[], ctx: PublishContext): Promise<void> {
  console.log("\n" + "=".repeat(50));
  console.log("  C4A - One-click Publish");
  console.log("=".repeat(50) + "\n");

  // 1. Select which packages to publish
  const packages = await selectPackages();
  if (packages.length === 0) {
    ctx.warn("No packages selected, cancelled");
    return;
  }

  // 2. Determine version
  let targetVersion = args[0];
  if (!targetVersion) {
    const currentVersion = await readRootVersion(ctx.projectRoot);
    targetVersion = await ctx.waitForInput(
      "Publish version: ",
      currentVersion !== "unknown" ? currentVersion : undefined,
    );
    if (!targetVersion) {
      ctx.error("No version provided, cancelled");
      return;
    }
  }

  if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
    ctx.error(`Invalid version: ${targetVersion} (expected SemVer format, e.g. 0.4.1)`);
    return;
  }

  ctx.info(`Will publish: ${packages.map((p) => p.name).join(", ")} @ ${targetVersion}`);
  ctx.warn("Make sure you are logged in to npm (npm login)");

  // 3. Bump version
  ctx.info(`Bumping version to ${targetVersion}...`);
  await cmdBumpVersion([targetVersion], {
    projectRoot: ctx.projectRoot,
    info: ctx.info,
    success: ctx.success,
    warn: ctx.warn,
    error: ctx.error,
    waitForInput: ctx.waitForInput,
  });

  // 4. Build all packages
  ctx.info("Building all packages...");
  await runBuildAll(ctx.projectRoot);
  ctx.success("All packages built");

  // 5. Prepare dist and publish each selected package
  for (const pkg of packages) {
    const pkgDir = resolve(ctx.projectRoot, "packages", pkg.dir);
    const distDir = resolve(pkgDir, "dist");

    if (!(await isDirectory(distDir))) {
      ctx.error(`${pkg.name}: dist/ does not exist, skipping`);
      continue;
    }

    await prepareDistPackageJson(ctx, pkgDir, distDir, targetVersion, pkg.dir);

    ctx.info(`Publishing ${pkg.name}@${targetVersion}...`);
    const exitCode = await runWithStatus(
      "bunx",
      ["npm", "publish", distDir, "--access", "public"],
      { cwd: ctx.projectRoot },
    );

    if (exitCode === 0) {
      ctx.success(`${pkg.name}@${targetVersion} published`);
    } else {
      ctx.error(`${pkg.name} publish failed (exit code: ${exitCode})`);
      return;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("  All packages published successfully");
  console.log("=".repeat(50));
  for (const pkg of packages) {
    console.log(`  ${pkg.name}@${targetVersion}`);
  }
  console.log("");
}

// ── Ink-based package selector ──────────────────────────────────────

type SelectOption = { label: string; packages: PackageEntry[] };

const SELECT_OPTIONS: SelectOption[] = [
  { label: "all", packages: [...PUBLISH_PACKAGES] },
  ...PUBLISH_PACKAGES.map((p) => ({ label: p.name, packages: [p] })),
];

function PackageSelector({ onSelect }: { onSelect: (pkgs: PackageEntry[]) => void }) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((i) => (i > 0 ? i - 1 : SELECT_OPTIONS.length - 1));
    } else if (key.downArrow) {
      setCursor((i) => (i < SELECT_OPTIONS.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      exit();
      onSelect(SELECT_OPTIONS[cursor]!.packages);
    } else if (key.escape) {
      exit();
      onSelect([]);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>  Select packages to publish:</Text>
      <Text dimColor>  ↑↓ move  ↵ confirm  esc cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {SELECT_OPTIONS.map((opt, i) => {
          const active = i === cursor;
          return (
            <Box key={opt.label}>
              <Text {...(active ? { color: "cyan" as const } : {})} bold={active}>
                {active ? "  ▶ " : "    "}{opt.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Clean up stdin after an Ink render unmounts.
 *
 * Ink leaves stdin in raw mode with various listeners attached. Without
 * cleanup, subsequent readline.createInterface calls hang because raw mode
 * swallows the Return key and readline's "line" event never fires.
 */
function resetStdinAfterInk(): void {
  const { stdin } = process;
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore
    }
  }
  stdin.removeAllListeners("readable");
  stdin.removeAllListeners("data");
  stdin.removeAllListeners("keypress");
  stdin.removeAllListeners("end");
  if (!stdin.isPaused()) {
    stdin.pause();
  }
  if (typeof stdin.ref === "function") {
    stdin.ref();
  }
}

async function selectPackages(): Promise<PackageEntry[]> {
  return new Promise((resolve) => {
    let selected: PackageEntry[] = [];
    const instance = render(
      <PackageSelector onSelect={(pkgs) => { selected = pkgs; }} />,
    );
    instance.waitUntilExit().then(() => {
      resetStdinAfterInk();
      resolve(selected);
    });
  });
}

export async function prepareDistPackageJson(
  ctx: PublishContext,
  pkgDir: string,
  distDir: string,
  version: string,
  dir: string,
): Promise<void> {
  const srcPkg = JSON.parse(await readFile(resolve(pkgDir, "package.json"), "utf-8")) as {
    name?: string;
    description?: string;
    license?: string;
    repository?: string | Record<string, unknown>;
    keywords?: string[];
    homepage?: string;
    author?: string | Record<string, unknown>;
    engines?: Record<string, string>;
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
  };

  // Bundled workspace dependencies are omitted from published metadata. Keep
  // runtime package/resource dependencies and replace workspace:* with the
  // release version so registry and pack installs resolve the same package set.
  const publishedWorkspaceDependencies = PUBLISHED_WORKSPACE_DEPENDENCIES[dir] ?? new Set<string>();
  const dependencies = Object.fromEntries(
    Object.entries(srcPkg.dependencies ?? {}).flatMap(([name, dependencyVersion]) => {
      if (!dependencyVersion.startsWith("workspace:")) return [[name, dependencyVersion]];
      return publishedWorkspaceDependencies.has(name) ? [[name, version]] : [];
    }),
  );

  const bin: Record<string, string> = {};
  if (srcPkg.bin) {
    for (const [k, v] of Object.entries(srcPkg.bin)) {
      bin[k] = v
        .replace(/^(?:\.\/)?(?:dist|src)\//, "")
        .replace(/^\.\/+/, "")
        .replace(/\.[cm]?tsx?$/, ".js");
    }
  }

  const distPkg: Record<string, unknown> = {
    name: srcPkg.name,
    version,
    type: "module",
  };

  for (const field of ["description", "license", "repository", "keywords", "homepage", "author", "engines"] as const) {
    if (srcPkg[field] !== undefined) {
      distPkg[field] = srcPkg[field];
    }
  }

  if (Object.keys(bin).length > 0) {
    distPkg.bin = bin;
  }

  if (Object.keys(dependencies).length > 0) {
    distPkg.dependencies = dependencies;
  }

  // For library packages, set main entry so consumers and createRequire.resolve
  // use the bundled dist entry explicitly instead of Node's index.js fallback.
  if (dir === "core" || dir === "context" || dir === "extract" || dir === "extract-ts" || dir === "extract-go" || dir === "extract-rush") {
    distPkg.main = "./index.js";
    if (dir === "core" || dir === "context") {
      distPkg.types = "./index.d.ts";
    }
  }

  // context-cli ships generated cross-client plugins, templates, and the
  // postinstall hook alongside the bundled CLI. Raw plugin authoring sources
  // and build-only scripts are not runtime inputs and must not be republished.
  if (dir === "context-cli") {
    distPkg.main = "./cli.js";
    distPkg.scripts = { postinstall: "node scripts/postinstall.mjs" };
    await rm(resolve(distDir, "plugin"), { recursive: true, force: true });

    const templatesSource = resolve(pkgDir, "templates");
    const templatesTarget = resolve(distDir, "templates");
    await rm(templatesTarget, { recursive: true, force: true });
    if (await isDirectory(templatesSource)) {
      await cp(templatesSource, templatesTarget, { recursive: true });
    }

    const scriptsTarget = resolve(distDir, "scripts");
    await rm(scriptsTarget, { recursive: true, force: true });
    const postinstallSource = resolve(pkgDir, "scripts", "postinstall.mjs");
    if (await isFile(postinstallSource)) {
      await mkdir(scriptsTarget, { recursive: true });
      await copyFile(postinstallSource, resolve(scriptsTarget, "postinstall.mjs"));
    }
    // Wipe-only sweep for stale nested build outputs. Older bun-build runs
    // produced `dist/dist/{cli.js,wasm}` (~4 MB). Source has no such
    // subdir, so this is purely a "remove leftover" pass — never copy onto
    // itself, which would happen if we put "dist" in the loop above
    // (srcPath would be the publish target itself).
    await rm(resolve(distDir, "dist"), { recursive: true, force: true });
  }

  const distPkgPath = resolve(distDir, "package.json");
  await writeFile(distPkgPath, `${JSON.stringify(distPkg, null, 2)}\n`);

  // Ensure bin entry files have shebang and executable permission
  for (const binPath of Object.values(bin)) {
    const fullPath = resolve(distDir, binPath);
    if (await isFile(fullPath)) {
      await ensureShebang(fullPath);
      await chmod(fullPath, 0o755);
    }
  }

  // Sweep every stale top-level *.md from dist/ first, then copy the explicit
  // public README whitelist. Removing first also prevents a deleted localized
  // README from lingering in a later tarball. CLAUDE.md / AGENTS.md /
  // DEVELOPMENT.md remain project-internal developer guidance.
  const publicReadmes = new Set(["readme.md", "readme.zh-cn.md"]);
  const distEntries = await readdir(distDir, { withFileTypes: true });
  for (const entry of distEntries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      await rm(resolve(distDir, entry.name), { force: true });
    }
  }
  const entries = await readdir(pkgDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && publicReadmes.has(entry.name.toLowerCase())) {
      await copyFile(resolve(pkgDir, entry.name), resolve(distDir, entry.name));
    }
  }

  // npm packages inherit the repository license. Copy it into every prepared
  // dist so registry tarballs remain self-contained.
  const distLicense = resolve(distDir, "LICENSE");
  await rm(distLicense, { force: true });
  const rootLicense = resolve(ctx.projectRoot, "LICENSE");
  if (await isFile(rootLicense)) {
    await copyFile(rootLicense, distLicense);
  }

  ctx.success(`${srcPkg.name} dist/package.json generated`);
}

async function runBuildAll(projectRoot: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("bun", ["run", "build"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });
  });
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

const NODE_SHEBANG = "#!/usr/bin/env node\n";

async function ensureShebang(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  if (content.startsWith(NODE_SHEBANG)) return;
  // Strip existing shebang (e.g. #!/usr/bin/env bun from link-mode build) and replace with node
  const body = content.startsWith("#!") ? content.slice(content.indexOf("\n") + 1) : content;
  await writeFile(filePath, `${NODE_SHEBANG}${body}`);
}
