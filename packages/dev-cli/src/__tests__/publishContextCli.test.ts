import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdBumpVersion } from "../commands/bumpVersion.js";
import { prepareDistPackageJson, PUBLISH_PACKAGES, type PublishContext } from "../commands/publish.js";
import {
  releasePackageDirectories,
  renderPublishedPackages,
  upsertPublishedPackages,
} from "../commands/releasePackages.js";

async function mkTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `c4a-dev-cli-${prefix}-`));
}

/**
 * Minimal PublishContext stub — prepareDistPackageJson only calls .success
 * to announce "generated". The other methods are unused in this code path
 * but must satisfy the type.
 */
function stubCtx(projectRoot: string): PublishContext {
  return {
    projectRoot,
    info: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
    waitForInput: async () => "",
  };
}

async function setupContextCliPkg(root: string): Promise<{ pkgDir: string; distDir: string }> {
  const pkgDir = join(root, "packages", "context-cli");
  const distDir = join(pkgDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(root, "LICENSE"), "MIT License\n");
  // Minimal package.json — mirrors real shape enough for the helper.
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@c4a/context-cli",
        version: "0.0.0-test",
        type: "module",
        description: "Context CLI test package",
        license: "MIT",
        repository: { type: "git", url: "https://example.test/repo.git" },
        keywords: ["context", "knowledge"],
        // Match the real source manifest: release preparation publishes the
        // contents of dist/ as the package root, so this must become cli.js.
        bin: { context: "dist/cli.js" },
        dependencies: {
          "@c4a/context": "workspace:*",
          jiti: "^2.7.0",
          "web-tree-sitter": "^0.20.8",
          yaml: "^2.5.1",
        },
      },
      null,
      2,
    ),
  );
  // Realistic source layout: plugin/, templates/, scripts/ under pkgDir.
  await mkdir(join(pkgDir, "plugin", "commands"), { recursive: true });
  await writeFile(join(pkgDir, "plugin", "commands", "init.md"), "---\ndescription: 'init'\nallowed-tools: Bash\n---\n");
  await mkdir(join(pkgDir, "templates", "aspects", "code"), { recursive: true });
  await writeFile(join(pkgDir, "templates", "aspects", "code", "prompt.md"), "# code aspect\n");
  await mkdir(join(pkgDir, "scripts"), { recursive: true });
  await writeFile(join(pkgDir, "scripts", "postinstall.mjs"), "// postinstall\n");
  await writeFile(join(pkgDir, "scripts", "build-plugin.ts"), "// build only\n");
  // Dummy bundled CLI output (prepareDistPackageJson does not touch it).
  await writeFile(join(distDir, "cli.js"), "#!/usr/bin/env node\nconsole.log('v');\n");
  // Generated runtime plugins are build outputs and must survive preparation.
  await mkdir(join(distDir, "plugins", "codex"), { recursive: true });
  await writeFile(join(distDir, "plugins", "codex", ".generated"), "generated\n");
  return { pkgDir, distDir };
}

async function setupExtractTsPkg(root: string): Promise<{ pkgDir: string; distDir: string }> {
  const pkgDir = join(root, "packages", "extract-ts");
  const distDir = join(pkgDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(root, "LICENSE"), "MIT License\n");
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@c4a/extract-ts",
        version: "0.0.0-test",
        type: "module",
        description: "Extract TypeScript test package",
        license: "MIT",
        repository: "https://example.test/repo",
        dependencies: {
          "@c4a/extract": "workspace:*",
          "web-tree-sitter": "^0.20.8",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(distDir, "index.js"), "export const TypeScriptPlugin = class {};\n");
  return { pkgDir, distDir };
}

describe("publish package list", () => {
  test("includes context SDK and extract packages required by context-cli", () => {
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/context", dir: "context" });
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/extract", dir: "extract" });
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/extract-ts", dir: "extract-ts" });
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/extract-go", dir: "extract-go" });
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/extract-rush", dir: "extract-rush" });
    expect(PUBLISH_PACKAGES).toContainEqual({ name: "@c4a/context-cli", dir: "context-cli" });
  });

  test("renders package directories and release notes from the same manifest", () => {
    expect(releasePackageDirectories()).toEqual(
      PUBLISH_PACKAGES.map((pkg) => `packages/${pkg.dir}/dist`),
    );
    expect(renderPublishedPackages("1.2.3")).toContain("`@c4a/context-cli@1.2.3`");
    expect(renderPublishedPackages("1.2.3").match(/^- `/gm)).toHaveLength(
      PUBLISH_PACKAGES.length,
    );
  });

  test("appends or replaces the published package section idempotently", () => {
    const initial = "## Highlights\n\n- Stable release.\n\n## Verification\n\n- Passed.\n";
    const appended = upsertPublishedPackages(initial, "1.2.3");
    const replaced = upsertPublishedPackages(appended, "1.2.4");

    expect(appended).toContain("## Published packages\n\n- `@c4a/core@1.2.3`");
    expect(replaced).not.toContain("@1.2.3");
    expect(replaced.match(/^## Published packages$/gm)).toHaveLength(1);
    expect(replaced).toContain("`@c4a/context-cli@1.2.4`");
  });
});

describe("release version synchronization", () => {
  test("bump updates workspace packages and the Context workflow Provider", async () => {
    const root = await mkTmp("version-sync");
    const contextCliDir = join(root, "packages", "context-cli");
    const workflowDir = join(contextCliDir, "context-workflow");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "context", version: "1.0.0" }, null, 2),
    );
    await writeFile(
      join(contextCliDir, "package.json"),
      JSON.stringify({ name: "@c4a/context-cli", version: "1.0.0" }, null, 2),
    );
    await writeFile(
      join(workflowDir, "provider.yaml"),
      "schema: agent-graph.provider.v1\nid: c4a/context\nversion: 1.0.0\n",
    );

    await cmdBumpVersion(["1.0.1-beta.1"], stubCtx(root));

    const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    const cliPackage = JSON.parse(await readFile(join(contextCliDir, "package.json"), "utf-8"));
    expect(rootPackage.version).toBe("1.0.1-beta.1");
    expect(cliPackage.version).toBe("1.0.1-beta.1");
    expect(await readFile(join(workflowDir, "provider.yaml"), "utf-8")).toContain(
      "version: 1.0.1-beta.1",
    );
  });
});

describe("prepareDistPackageJson — extract-ts publish packaging", () => {
  test("generates importable package metadata and strips workspace dependencies", async () => {
    const root = await mkTmp("extract-ts");
    const { pkgDir, distDir } = await setupExtractTsPkg(root);

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "extract-ts");

    const distPkg = JSON.parse(await readFile(join(distDir, "package.json"), "utf-8")) as {
      name?: string;
      version?: string;
      main?: string;
      description?: string;
      license?: string;
      repository?: string;
      dependencies?: Record<string, string>;
    };
    expect(distPkg.name).toBe("@c4a/extract-ts");
    expect(distPkg.version).toBe("1.2.3");
    expect(distPkg.main).toBe("./index.js");
    expect(distPkg.description).toBe("Extract TypeScript test package");
    expect(distPkg.license).toBe("MIT");
    expect(distPkg.repository).toBe("https://example.test/repo");
    expect(distPkg.dependencies?.["@c4a/extract"]).toBeUndefined();
    expect(distPkg.dependencies?.["web-tree-sitter"]).toBe("^0.20.8");
    expect(await readFile(join(distDir, "LICENSE"), "utf8")).toBe("MIT License\n");
  });
});

describe("prepareDistPackageJson — context-cli publish packaging", () => {
  test("ships generated plugins, templates, postinstall, metadata, and normalized bin paths", async () => {
    const root = await mkTmp("copy");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    expect(existsSync(join(distDir, "plugin"))).toBe(false);
    expect(existsSync(join(distDir, "plugins", "codex", ".generated"))).toBe(true);
    expect(existsSync(join(distDir, "templates", "aspects", "code", "prompt.md"))).toBe(true);
    expect(existsSync(join(distDir, "scripts", "postinstall.mjs"))).toBe(true);
    expect(existsSync(join(distDir, "scripts", "build-plugin.ts"))).toBe(false);
    expect(await readFile(join(distDir, "LICENSE"), "utf8")).toBe("MIT License\n");

    const distPkg = JSON.parse(await readFile(join(distDir, "package.json"), "utf-8")) as {
      name?: string;
      version?: string;
      main?: string;
      description?: string;
      license?: string;
      repository?: { type?: string; url?: string };
      keywords?: string[];
      bin?: Record<string, string>;
      scripts?: { postinstall?: string };
      dependencies?: Record<string, string>;
      contextRuntimeEventSink?: unknown;
    };
    expect(distPkg.name).toBe("@c4a/context-cli");
    expect(distPkg.version).toBe("1.2.3");
    expect(distPkg.main).toBe("./cli.js");
    expect(distPkg.description).toBe("Context CLI test package");
    expect(distPkg.license).toBe("MIT");
    expect(distPkg.repository?.url).toBe("https://example.test/repo.git");
    expect(distPkg.keywords).toEqual(["context", "knowledge"]);
    expect(distPkg.bin?.context).toBe("cli.js");
    expect(distPkg.scripts?.postinstall).toBe("node scripts/postinstall.mjs");
    // SDK package identity and static templates are required at runtime, so
    // workspace:* must become the matching published version.
    expect(distPkg.dependencies?.["@c4a/context"]).toBe("1.2.3");
    // external deps must survive.
    expect(distPkg.dependencies?.jiti).toBe("^2.7.0");
    expect(distPkg.dependencies?.["web-tree-sitter"]).toBe("^0.20.8");
    expect(distPkg.dependencies?.yaml).toBe("^2.5.1");
    expect(distPkg.contextRuntimeEventSink).toBeUndefined();
  });

  test("preserves optional runtime event sink metadata in the published CLI manifest", async () => {
    const root = await mkTmp("runtime-event-sink");
    const { pkgDir, distDir } = await setupContextCliPkg(root);
    const packagePath = join(pkgDir, "package.json");
    const sourcePackage = JSON.parse(await readFile(packagePath, "utf-8"));
    sourcePackage.contextRuntimeEventSink = {
      schema: "context.runtime-event-sink.v1",
      transport: "command",
      command: "example-sink",
      args: ["emit"],
    };
    await writeFile(packagePath, `${JSON.stringify(sourcePackage, null, 2)}\n`);

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    const distPackage = JSON.parse(await readFile(join(distDir, "package.json"), "utf-8"));
    expect(distPackage.contextRuntimeEventSink).toEqual(sourcePackage.contextRuntimeEventSink);
  });

  test("wipes stale files left over in dist/plugin, dist/templates, dist/scripts before copying", async () => {
    // Regression for review finding 中: publish.tsx previously used `cp
    // --recursive` without clearing the target. A file removed between
    // versions (say, `plugin/commands/old-verb.md`) would linger in the
    // dist/ from the prior build and get republished.
    const root = await mkTmp("stale");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    // Seed dist/ with stale artifacts that no longer exist in the source.
    await mkdir(join(distDir, "plugin", "commands"), { recursive: true });
    await writeFile(
      join(distDir, "plugin", "commands", "old-verb.md"),
      "stale command removed in this release",
    );
    await mkdir(join(distDir, "plugin", "skills", "ghost-manager"), { recursive: true });
    await writeFile(
      join(distDir, "plugin", "skills", "ghost-manager", "SKILL.md"),
      "stale skill removed in this release",
    );
    await mkdir(join(distDir, "templates", "aspects", "legacy"), { recursive: true });
    await writeFile(
      join(distDir, "templates", "aspects", "legacy", "prompt.md"),
      "stale template",
    );
    await mkdir(join(distDir, "scripts"), { recursive: true });
    await writeFile(
      join(distDir, "scripts", "dropped-hook.mjs"),
      "// hook removed in this release",
    );

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    // Every stale artifact must be gone after the prepare step.
    expect(existsSync(join(distDir, "plugin", "commands", "old-verb.md"))).toBe(false);
    expect(existsSync(join(distDir, "plugin", "skills", "ghost-manager"))).toBe(false);
    expect(existsSync(join(distDir, "templates", "aspects", "legacy"))).toBe(false);
    expect(existsSync(join(distDir, "scripts", "dropped-hook.mjs"))).toBe(false);

    // Raw authoring sources stay out of the tarball; runtime artifacts remain.
    expect(existsSync(join(distDir, "plugin"))).toBe(false);
    expect(existsSync(join(distDir, "plugins", "codex", ".generated"))).toBe(true);
    expect(existsSync(join(distDir, "templates", "aspects", "code", "prompt.md"))).toBe(true);
    expect(existsSync(join(distDir, "scripts", "postinstall.mjs"))).toBe(true);

    // Sibling dist artifacts (bundled cli.js, potential wasm assets) are
    // *not* inside plugin/templates/scripts and must survive the sweep.
    expect(existsSync(join(distDir, "cli.js"))).toBe(true);
  });

  test("wipes stale nested dist/dist/ left over from older build pipelines", async () => {
    // Older bun-build outputs leaked a nested dist/dist/ subtree (cli.js +
    // wasm) that survived rebuilds because the publish helper only wiped
    // plugin/templates/scripts. Without an explicit sweep, ~4 MB of stale
    // 0.5.20-era artifacts kept getting republished in newer tarballs.
    const root = await mkTmp("nested-dist");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    await mkdir(join(distDir, "dist", "wasm"), { recursive: true });
    await writeFile(join(distDir, "dist", "cli.js"), "// stale 0.5.20 cli");
    await writeFile(join(distDir, "dist", "package.json"), '{"version":"0.5.20-beta.6"}');
    await writeFile(join(distDir, "dist", "wasm", "tree-sitter.wasm"), "stale wasm");

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    // The whole nested subtree must be gone.
    expect(existsSync(join(distDir, "dist"))).toBe(false);
    // Sibling outputs (current cli.js etc.) must survive — the sweep is
    // scoped strictly to the nested `dist/` path, not the outer dist root.
    expect(existsSync(join(distDir, "cli.js"))).toBe(true);
  });

  test("copies public English and Chinese READMEs but skips internal Markdown", async () => {
    // CLAUDE.md / AGENTS.md are project-internal developer guidance and
    // must not ship to the npm registry. The previous copy loop took every
    // *.md, so 26 KB of "禁止使用 TTAstra" rules were being shipped.
    const root = await mkTmp("md-whitelist");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    await writeFile(join(pkgDir, "README.md"), "# @c4a/context-cli\n");
    await writeFile(join(pkgDir, "README.zh-CN.md"), "# Context CLI 中文\n");
    await writeFile(join(pkgDir, "CLAUDE.md"), "# Internal dev rules\n");
    await writeFile(join(pkgDir, "AGENTS.md"), "# Internal agent rules\n");
    await writeFile(join(pkgDir, "DEVELOPMENT.md"), "# Internal development guide\n");

    // Also seed a stale CLAUDE.md already inside dist/ — left over from
    // a prior build that ran the old "copy every *.md" loop. The new
    // sweep must remove it before copying README.md.
    await writeFile(join(distDir, "CLAUDE.md"), "# stale internal doc from prior build\n");

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    expect(existsSync(join(distDir, "README.md"))).toBe(true);
    expect(existsSync(join(distDir, "README.zh-CN.md"))).toBe(true);
    expect(existsSync(join(distDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(distDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(distDir, "DEVELOPMENT.md"))).toBe(false);
  });

  test("removes a stale localized README when the source package no longer has one", async () => {
    const root = await mkTmp("stale-localized-readme");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    await writeFile(join(pkgDir, "README.md"), "# @c4a/context-cli\n");
    await writeFile(join(distDir, "README.zh-CN.md"), "# stale localized README\n");

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    expect(existsSync(join(distDir, "README.md"))).toBe(true);
    expect(existsSync(join(distDir, "README.zh-CN.md"))).toBe(false);
  });

  test("wipes dist/<subdir> even when the source subdir is entirely deleted", async () => {
    // Regression: the `if (await isDirectory(srcPath)) { rm; cp; }` form
    // only wiped dist/<subdir> when the source existed. If a version
    // retires a whole subtree (say `templates/` is replaced by a YAML
    // manifest and the directory is removed), the prior version's
    // dist/templates/ would linger and get republished.
    const root = await mkTmp("wipe-deleted");
    const { pkgDir, distDir } = await setupContextCliPkg(root);

    // Seed dist with artifacts from a prior version.
    await mkdir(join(distDir, "plugin", "commands"), { recursive: true });
    await writeFile(
      join(distDir, "plugin", "commands", "legacy.md"),
      "legacy command from a retired version",
    );
    await mkdir(join(distDir, "templates", "aspects", "legacy"), { recursive: true });
    await writeFile(
      join(distDir, "templates", "aspects", "legacy", "prompt.md"),
      "retired template",
    );
    await mkdir(join(distDir, "scripts"), { recursive: true });
    await writeFile(join(distDir, "scripts", "retired.mjs"), "// retired");

    // Retire two source subdirs entirely in this version: no `templates/`
    // and no `scripts/` in pkgDir. `plugin/` stays but with different
    // contents from the dist (which we'll assert is also swept).
    await rm(join(pkgDir, "templates"), { recursive: true, force: true });
    await rm(join(pkgDir, "scripts"), { recursive: true, force: true });

    await prepareDistPackageJson(stubCtx(root), pkgDir, distDir, "1.2.3", "context-cli");

    // The retired source subdirs must NOT exist in dist (entire tree
    // wiped, not just individual files).
    expect(existsSync(join(distDir, "templates"))).toBe(false);
    expect(existsSync(join(distDir, "scripts"))).toBe(false);

    // Raw plugin source is never published; generated plugins remain.
    expect(existsSync(join(distDir, "plugin"))).toBe(false);
    expect(existsSync(join(distDir, "plugins", "codex", ".generated"))).toBe(true);

    // cli.js and package.json must survive (sibling artifacts).
    expect(existsSync(join(distDir, "cli.js"))).toBe(true);
    expect(existsSync(join(distDir, "package.json"))).toBe(true);
  });
});
