import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CONTEXT_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const templateScript = (language: string) => join(
  CONTEXT_ROOT,
  "packages",
  "context",
  "templates",
  language,
  "kb",
  "skills",
  "context-knowledge-query",
  "scripts",
  "search.mjs",
);
const ENGLISH_SCRIPT = templateScript("package-templates");
const CHINESE_SCRIPT = templateScript("package-templates.zh-CN");

interface SearchOutput {
  packages: Array<{ name: string; root: string; version?: string; search_guide?: string }>;
  results: Array<{ package: string; path: string; start_line: number; end_line: number; preview: string }>;
}

function writePackage(root: string, name: string, pages: Record<string, string>, options: { distributed?: boolean; guide?: boolean } = {}): void {
  const inventoryDir = options.distributed ? join(root, "others", "context") : root;
  mkdirSync(inventoryDir, { recursive: true });
  writeFileSync(join(inventoryDir, "context-build-inventory.json"), JSON.stringify({
    package: { name, distribution: { roots: { wikis: "wikis", guides: "guides" } } },
  }));
  writeFileSync(join(root, "context-version.json"), JSON.stringify({ version: "1.2.3" }));
  if (options.guide) {
    mkdirSync(join(root, "others", "context"), { recursive: true });
    writeFileSync(join(root, "others", "context", "search-guide.md"), "# Search guide\n");
  }
  for (const [path, content] of Object.entries(pages)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function run(script: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, CONTEXT_KNOWLEDGE_PACKAGES: "", ...options.env },
  });
  return { ...result, output: result.status === 0 && args.includes("--json") ? JSON.parse(result.stdout) as SearchOutput : undefined };
}

describe("context-knowledge-query search script", () => {
  test("ranks mechanically chunked Markdown and returns inspectable locations", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-query-"));
    try {
      writePackage(root, "sample-kb", {
        "wikis/routing.md": [
          "# Routing reference",
          "",
          ...Array.from({ length: 95 }, (_, index) => `ordinary route ${index}`),
          "deployment permission route uses the release gateway",
        ].join("\n"),
        "guides/release.md": "# 发布流程\n\n发布流程需要先验证构建结果，再执行部署。\n",
      });
      const english = run(ENGLISH_SCRIPT, ["--root", root, "--query", "deployment permission route", "--json"]);
      expect(english.status).toBe(0);
      expect(english.output?.results[0]).toMatchObject({ package: "sample-kb", path: "wikis/routing.md" });
      expect(english.output?.results[0]?.start_line).toBeGreaterThan(1);
      expect(english.output?.results[0]?.end_line).toBeGreaterThanOrEqual(98);
      expect(english.output?.results[0]?.preview).toContain("deployment permission route");

      const chinese = run(ENGLISH_SCRIPT, ["--root", root, "--query", "发布流程", "--json"]);
      expect(chinese.output?.results[0]?.path).toBe("guides/release.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is identical in every language and carries no package-specific values", () => {
    const script = readFileSync(ENGLISH_SCRIPT, "utf8");
    expect(readFileSync(CHINESE_SCRIPT, "utf8")).toBe(script);
    expect(script).not.toContain("{{");
  });

  test("a projected copy lists, ranks and filters packages from several collections", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-query-collection-"));
    try {
      const collection = join(root, "packages");
      writePackage(join(collection, "team-a", "runtime-kb"), "runtime-kb", {
        "wikis/entry.md": "# Runtime entry\n\nremote module bootstrap contract\n",
      }, { guide: true });
      writePackage(join(collection, "team-b", "gateway-kb"), "gateway-kb", {
        "guides/gateway.md": "# Gateway\n\nremote module routing through the gateway\n",
      });
      const skillScripts = join(root, ".agents", "skills", "context-knowledge-query", "scripts");
      mkdirSync(skillScripts, { recursive: true });
      const script = join(skillScripts, "search.mjs");
      copyFileSync(ENGLISH_SCRIPT, script);

      const listed = run(script, ["--base", collection, "--list", "--json"], { cwd: root });
      expect(listed.status).toBe(0);
      expect(listed.output?.packages.map((pkg) => pkg.name).sort()).toEqual(["gateway-kb", "runtime-kb"]);
      const runtime = listed.output?.packages.find((pkg) => pkg.name === "runtime-kb");
      expect(runtime).toMatchObject({ version: "1.2.3", search_guide: "others/context/search-guide.md" });
      expect(realpathSync(runtime!.root)).toBe(realpathSync(join(collection, "team-a", "runtime-kb")));

      const across = run(script, ["--base", collection, "--query", "remote module", "--json"], { cwd: root });
      expect(new Set(across.output?.results.map((result) => result.package))).toEqual(new Set(["runtime-kb", "gateway-kb"]));

      const filtered = run(script, ["--base", collection, "--query", "remote module", "--package", "team-b/gateway-kb", "--json"], { cwd: root });
      expect(filtered.output?.results.map((result) => result.package)).toEqual(["gateway-kb"]);

      const missing = run(script, ["--base", collection, "--query", "remote module", "--package", "absent"], { cwd: root });
      expect(missing.status).toBe(2);
      expect(missing.stderr).toContain("--list");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds distributed packages listed in CONTEXT_KNOWLEDGE_PACKAGES", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-query-env-"));
    try {
      const first = join(root, "first");
      const second = join(root, "second");
      writePackage(first, "first-kb", { "guides/entry.md": "# Installed guide\n\ncomplete package metadata contract\n" }, { distributed: true });
      writePackage(second, "second-kb", { "wikis/other.md": "# Other\n\nunrelated page\n" });
      const script = join(root, "search.mjs");
      copyFileSync(ENGLISH_SCRIPT, script);

      const result = run(script, ["--query", "package metadata contract", "--json"], {
        cwd: root,
        env: { CONTEXT_KNOWLEDGE_PACKAGES: [first, second].join(delimiter) },
      });
      expect(result.status).toBe(0);
      expect(result.output?.packages.map((pkg) => pkg.name).sort()).toEqual(["first-kb", "second-kb"]);
      expect(result.output?.results[0]).toMatchObject({ package: "first-kb", path: "guides/entry.md" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("explains how to point it at packages when none are found", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-query-none-"));
    try {
      const script = join(root, "search.mjs");
      copyFileSync(ENGLISH_SCRIPT, script);
      const result = run(script, ["--list"], { cwd: root });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("--base");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
