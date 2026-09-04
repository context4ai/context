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
    expect(canonical).toContain("## Your Task");
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
    expect(bodyAfterFrontmatter(adapter)).toBe(bodyAfterFrontmatter(canonical));
    expect(installedSkill).toBe(canonical);

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
    expect(installedSkills).toEqual(["context"]);
    for (const host of ["claude", "codex", "cursor"] as const) {
      for (const provider of sourceSkills.filter((skill) => skill !== "context")) {
        await expect(readFile(
          join(repoInstallHostRoot(host), "skills", provider, "SKILL.md"),
          "utf8",
        )).rejects.toThrow();
      }
    }
  });

  test("keeps lifecycle Provider Skills portable and outside namespaced Host plugins", async () => {
    const providerSkills = (await readdir(join(SOURCE_ROOT, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== "context")
      .map((entry) => entry.name);
    for (const skill of providerSkills) {
      expect(await fileBodies(join(REPO_INSTALL_ROOT, "skills", skill))).toEqual(
        await fileBodies(join(SOURCE_ROOT, "skills", skill)),
      );
    }
  });

  test("marks Indexer Providers as lifecycle-managed rather than public entries", async () => {
    const providerSkills = (await readdir(join(SOURCE_ROOT, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== "context")
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
