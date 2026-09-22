import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const PACKAGE_ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const SOURCE_ROOT = join(REPOSITORY_ROOT, "plugins", "context");
const REPO_INSTALL_ROOT = join(SOURCE_ROOT, "repo-install");

function repoInstallHostRoot(host: "claude" | "codex" | "cursor"): string {
  return join(REPO_INSTALL_ROOT, host);
}

function bodyAfterFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n?/u);
  if (match === null) throw new TypeError("expected YAML frontmatter");
  return markdown.slice(match[0].length).trim();
}

function frontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (match?.[1] === undefined) throw new TypeError("expected YAML frontmatter");
  return parse(match[1]) as Record<string, unknown>;
}

async function fileBodies(root: string, prefix = ""): Promise<Array<[string, string]>> {
  const files: Array<[string, string]> = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await fileBodies(root, path));
    } else if (entry.isFile()) {
      files.push([path, await readFile(join(root, path), "utf8")]);
    }
  }
  return files;
}

describe("0.7.0 root plugin source", () => {
  test("keeps one maintained Context entry body", async () => {
    const canonical = await readFile(
      join(SOURCE_ROOT, "skills", "context", "SKILL.md"),
      "utf8",
    );
    expect(bodyAfterFrontmatter(canonical)).toMatch(/^# [^\n]+\n/u);
    expect(frontmatter(canonical)["allowed-tools"]).toEqual(["Bash"]);
    expect(frontmatter(canonical).tools).toBeUndefined();
    expect(canonical).toContain("workflow.current");
  });

  test("generates semantic-equivalent adapters and keeps only the public entry in Host plugins", async () => {
    const canonical = await readFile(
      join(SOURCE_ROOT, "skills", "context", "SKILL.md"),
      "utf8",
    );
    const adapter = await readFile(
      join(repoInstallHostRoot("claude"), "commands", "context.md"),
      "utf8",
    );
    const installedSkill = await readFile(
      join(repoInstallHostRoot("codex"), "skills", "context", "SKILL.md"),
      "utf8",
    );
    const cursorCommand = await readFile(
      join(repoInstallHostRoot("cursor"), "commands", "c4a-context.md"),
      "utf8",
    );
    expect(bodyAfterFrontmatter(adapter)).toBe(bodyAfterFrontmatter(canonical));
    expect(installedSkill).toBe(canonical);
    expect(frontmatter(adapter)["allowed-tools"]).toEqual([
      "Bash(context:*)", "Bash(bun:*)", "Bash(cd *)",
    ]);
    for (const entry of [adapter, installedSkill, cursorCommand]) {
      expect(frontmatter(entry).description).toBe(frontmatter(canonical).description);
      expect(bodyAfterFrontmatter(entry)).toMatch(/^# [^\n]+\n/u);
    }

    const sourceSkills = (await readdir(join(SOURCE_ROOT, "skills"), {
      withFileTypes: true,
    })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const installedSkills = (await readdir(join(repoInstallHostRoot("codex"), "skills"), {
      withFileTypes: true,
    })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(sourceSkills).toEqual(expect.arrayContaining([
      "context",
      "context-code-indexer",
      "context-markdown-indexer",
    ]));
    expect(installedSkills).toEqual(["context", "context-indexer-create", "context-inspect-search", "context-plan"]);
    for (const host of ["claude", "codex", "cursor"] as const) {
      for (const provider of sourceSkills.filter((skill) => skill.includes("-indexer") && skill !== "context-indexer-create")) {
        await expect(readFile(
          join(repoInstallHostRoot(host), "skills", provider, "SKILL.md"),
          "utf8",
        )).rejects.toThrow();
      }
    }
  });

  test("keeps lifecycle Provider Skills portable and outside namespaced Host plugins", async () => {
    const providerSkills = (await readdir(join(SOURCE_ROOT, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.includes("-indexer") && entry.name !== "context-indexer-create")
      .map((entry) => entry.name);
    for (const skill of providerSkills) {
      expect(await fileBodies(join(REPO_INSTALL_ROOT, "skills", skill))).toEqual(
        await fileBodies(join(SOURCE_ROOT, "skills", skill)),
      );
    }
  });

  test("marks Indexer Providers as lifecycle-managed rather than public entries", async () => {
    const providerSkills = (await readdir(join(SOURCE_ROOT, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.includes("-indexer") && entry.name !== "context-indexer-create")
      .map((entry) => entry.name);
    for (const skill of providerSkills) {
      const source = await readFile(
        join(SOURCE_ROOT, "skills", skill, "SKILL.md"),
        "utf8",
      );
      expect(frontmatter(source)).toMatchObject({
        metadata: {
          "context-role": "indexer-provider",
          "context-public-entry": "false",
        },
      });
      expect(frontmatter(source)["user-invocable"]).toBeUndefined();
    }

    const contextEntry = await readFile(
      join(SOURCE_ROOT, "skills", "context", "SKILL.md"),
      "utf8",
    );
    expect(frontmatter(contextEntry)["user-invocable"]).toBeUndefined();
  });

  test("ships the host-routable inspection skill with explicit command adapters", async () => {
    const name = "context-inspect-search";
    const canonical = await readFile(join(SOURCE_ROOT, "skills", name, "SKILL.md"), "utf8");
    expect(frontmatter(canonical)["disable-model-invocation"]).toBeUndefined();
    expect(frontmatter(canonical).metadata).toBeUndefined();
    for (const root of [join(PACKAGE_ROOT, "dist/plugins"), REPO_INSTALL_ROOT]) {
      const claude = await readFile(join(root, "claude/commands", `${name}.md`), "utf8");
      expect(frontmatter(claude)["disable-model-invocation"]).toBe(true);
      expect(bodyAfterFrontmatter(claude)).toBe(bodyAfterFrontmatter(canonical));
      expect(await readFile(join(root, "codex/skills", name, "SKILL.md"), "utf8")).toBe(canonical);
      const policy = parse(await readFile(join(root, "codex/skills", name, "agents/openai.yaml"), "utf8"));
      expect(policy.policy.allow_implicit_invocation).toBe(true);
      expect(await readFile(join(root, "claude/skills", name, "SKILL.md"), "utf8")).toBe(canonical);
      expect(await readFile(join(root, "cursor/skills", name, "SKILL.md"), "utf8")).toBe(canonical);
      const cursor = await readFile(join(root, "cursor/commands", `c4a-${name}.md`), "utf8");
      expect(bodyAfterFrontmatter(cursor)).toBe(bodyAfterFrontmatter(canonical));
      expect(await readFile(join(root, "skills", name, "agents/openai.yaml"), "utf8"))
        .toBe(await readFile(join(SOURCE_ROOT, "skills", name, "agents/openai.yaml"), "utf8"));
    }
  });

  test("keeps root marketplaces and generated manifests on the package version", async () => {
    const packageJson = JSON.parse(await readFile(
      join(PACKAGE_ROOT, "package.json"),
      "utf8",
    )) as { version: string };
    for (const host of ["claude", "codex", "cursor"]) {
      const manifest = JSON.parse(await readFile(
        join(REPO_INSTALL_ROOT, host, `.${host}-plugin`, "plugin.json"),
        "utf8",
      )) as { name: string; version: string };
      expect(manifest).toMatchObject({ name: "c4a", version: packageJson.version });
    }

    const claudeMarketplace = JSON.parse(await readFile(
      join(REPOSITORY_ROOT, ".claude-plugin", "marketplace.json"),
      "utf8",
    )) as { plugins: Array<{ source: string }> };
    const cursorMarketplace = JSON.parse(await readFile(
      join(REPOSITORY_ROOT, ".cursor-plugin", "marketplace.json"),
      "utf8",
    )) as { plugins: Array<{ source: string }> };
    const codexMarketplace = JSON.parse(await readFile(
      join(REPOSITORY_ROOT, ".agents", "plugins", "marketplace.json"),
      "utf8",
    )) as { plugins: Array<{ source: { path: string } }> };
    expect(claudeMarketplace.plugins[0]?.source)
      .toBe("./plugins/context/repo-install/claude");
    expect(cursorMarketplace.plugins[0]?.source)
      .toBe("./plugins/context/repo-install/cursor");
    expect(codexMarketplace.plugins[0]?.source.path)
      .toBe("./plugins/context/repo-install/codex");
  });

  test("ships the planning entry with usable references and templates for every host", async () => {
    const name = "context-plan";
    const canonicalRoot = join(SOURCE_ROOT, "skills", name);
    const canonical = await readFile(join(canonicalRoot, "SKILL.md"), "utf8");
    expect(frontmatter(canonical)["disable-model-invocation"]).not.toBe(true);
    expect(frontmatter(canonical)["user-invocable"]).not.toBe(false);
    expect(parse(await readFile(join(canonicalRoot, "agents/openai.yaml"), "utf8"))).toMatchObject({
      policy: { allow_implicit_invocation: true },
    });
    const canonicalFiles = await fileBodies(canonicalRoot);
    expect(canonicalFiles.map(([path]) => path)).toEqual(expect.arrayContaining([
      "references/project-planning.md", "references/resource-tools.md", "templates/PLAN.md",
    ]));
    for (const root of [join(PACKAGE_ROOT, "dist/plugins"), REPO_INSTALL_ROOT]) {
      for (const host of ["claude", "cursor", "codex"]) {
        const installedRoot = join(root, host, "skills", name);
        const installedFiles = await fileBodies(installedRoot);
        expect(installedFiles.filter(([path]) => path !== "SKILL.md")).toEqual(
          canonicalFiles.filter(([path]) => path !== "SKILL.md"));
        const installed = await readFile(join(installedRoot, "SKILL.md"), "utf8");
        expect(bodyAfterFrontmatter(installed)).toBe(bodyAfterFrontmatter(canonical));
        expect(frontmatter(installed)["disable-model-invocation"]).not.toBe(true);
        if (host === "codex") expect(frontmatter(installed)["user-invocable"]).not.toBe(false);
        else expect(frontmatter(installed)["user-invocable"]).toBe(false);
        await expect(readFile(join(installedRoot, "context-indexer.yaml"))).rejects.toThrow();
      }
      expect(await fileBodies(join(root, "skills", name))).toEqual(canonicalFiles);
      for (const [host, command] of [["claude", `${name}.md`], ["cursor", `c4a-${name}.md`]] as const) {
        const commandRoot = join(root, host, "commands");
        const content = await readFile(join(commandRoot, command), "utf8");
        expect(frontmatter(content)["disable-model-invocation"]).not.toBe(true);
        if (host === "claude") {
          expect(frontmatter(content)["argument-hint"]).toBeDefined();
          expect(frontmatter(content)["allowed-tools"]).toContain("Bash(context:*)");
          expect(frontmatter(content)["allowed-tools"]).not.toContain("Read");
        }
        expect(content).toContain("../skills/context-plan/SKILL.md");
        expect(bodyAfterFrontmatter(await readFile(resolve(commandRoot, "../skills/context-plan/SKILL.md"), "utf8")))
          .toBe(bodyAfterFrontmatter(canonical));
        const manifest = JSON.parse(await readFile(join(root, host, `.${host}-plugin/plugin.json`), "utf8"));
        expect(manifest.skills).toContain("./skills/context-plan");
      }
    }
  });

  test("build and Indexer release code never read the retired source directories", async () => {
    const buildPlugin = await readFile(
      join(PACKAGE_ROOT, "scripts", "build-plugin.ts"),
      "utf8",
    );
    const indexerBuild = await readFile(
      join(PACKAGE_ROOT, "src", "project", "indexerDistributionBuild.ts"),
      "utf8",
    );
    for (const source of [buildPlugin, indexerBuild]) {
      expect(source).toContain("plugins/context");
      expect(source).not.toContain('"plugin/commands"');
      expect(source).not.toContain('"indexers", "bundles"');
    }
  });
});


test("distributes the creation assistant with SDK references but no command or Provider manifest", async () => {
  const name = "context-indexer-create";
  const canonical = await readFile(join(SOURCE_ROOT, "skills", name, "SKILL.md"), "utf8");
  expect(frontmatter(canonical)["user-invocable"]).toBe(false);
  expect(frontmatter(canonical)["disable-model-invocation"]).toBeUndefined();
  // The authoring guide is SDK-owned and ships unchanged to each host. Old
  // Provider protocol manuals must not re-enter the creation assistant.
  const guides = [
    "indexer-skill-creation.md",
  ].map((file) => ({
    copied: `references/guides/${file}`,
    source: join(REPOSITORY_ROOT, "packages/context/docs/guides", file),
  }));
  for (const root of [join(PACKAGE_ROOT, "dist/plugins"), REPO_INSTALL_ROOT]) {
    for (const host of ["claude", "cursor", "codex"]) {
      expect(await readFile(join(root, host, "skills", name, "SKILL.md"), "utf8")).toBe(canonical);
      for (const guide of guides) {
        expect(await readFile(join(root, host, "skills", name, guide.copied), "utf8"))
          .toBe(await readFile(guide.source, "utf8"));
      }
      await expect(readFile(join(root, host, "skills", name, "context-indexer.yaml"))).rejects.toThrow();
      await expect(readFile(join(root, host, "skills", name, "references/reference/indexer-provider-protocol.md"))).rejects.toThrow();
      const commands = await readdir(join(root, host, "commands")).catch(() => [] as string[]);
      expect(commands.some(file => file.includes(name))).toBe(false);
    }
  }
});
