import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CONTEXT_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const ENGLISH_SCRIPT = join(
  CONTEXT_ROOT,
  "packages",
  "context",
  "templates",
  "package-templates",
  "kb",
  "skills",
  "knowledge-query",
  "scripts",
  "search.mjs",
);
const CHINESE_SCRIPT = join(
  CONTEXT_ROOT,
  "packages",
  "context",
  "templates",
  "package-templates.zh-CN",
  "kb",
  "skills",
  "knowledge-query",
  "scripts",
  "search.mjs",
);

describe("knowledge-query BM25 search script", () => {
  test("ranks mechanically chunked Markdown and returns inspectable locations", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-search-"));
    try {
      mkdirSync(join(root, "wikis"), { recursive: true });
      mkdirSync(join(root, "guides"), { recursive: true });
      writeFileSync(join(root, "context-build-inventory.json"), JSON.stringify({
        package: {
          name: "sample-kb",
          distribution: { roots: { wikis: "wikis", guides: "guides" } },
        },
      }));
      writeFileSync(join(root, "wikis", "routing.md"), [
        "# Routing reference",
        "",
        ...Array.from({ length: 95 }, (_, index) => `ordinary route ${index}`),
        "deployment permission route uses the release gateway",
      ].join("\n"));
      writeFileSync(join(root, "guides", "release.md"), [
        "# 发布流程",
        "",
        "发布流程需要先验证构建结果，再执行部署。",
      ].join("\n"));

      const result = spawnSync("node", [
        ENGLISH_SCRIPT,
        "--root",
        root,
        "--query",
        "deployment permission route",
        "--json",
      ], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        results: Array<{ path: string; start_line: number; end_line: number; preview: string }>;
      };
      expect(output.results[0]?.path).toBe("wikis/routing.md");
      expect(output.results[0]?.start_line).toBeGreaterThan(1);
      expect(output.results[0]?.end_line).toBeGreaterThanOrEqual(98);
      expect(output.results[0]?.preview).toContain("deployment permission route");

      const chinese = spawnSync("node", [
        ENGLISH_SCRIPT,
        "--root",
        root,
        "--query",
        "发布流程",
        "--json",
      ], { encoding: "utf8" });
      expect(chinese.status).toBe(0);
      const chineseOutput = JSON.parse(chinese.stdout) as { results: Array<{ path: string }> };
      expect(chineseOutput.results[0]?.path).toBe("guides/release.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps localized package templates on one deterministic script", () => {
    expect(readFileSync(CHINESE_SCRIPT, "utf8")).toBe(readFileSync(ENGLISH_SCRIPT, "utf8"));
  });

  test("discovers its rendered package in an explicit package collection", () => {
    const root = mkdtempSync(join(tmpdir(), "context-knowledge-search-collection-"));
    try {
      const packageRoot = join(root, "packages", "team", "sample-kb");
      const skillRoot = join(root, ".agents", "skills", "knowledge-query", "scripts");
      mkdirSync(join(packageRoot, "wikis"), { recursive: true });
      mkdirSync(skillRoot, { recursive: true });
      writeFileSync(join(packageRoot, "context-build-inventory.json"), JSON.stringify({
        package: {
          name: "sample-kb",
          distribution: { roots: { wikis: "wikis" } },
        },
      }));
      writeFileSync(join(packageRoot, "wikis", "entry.md"), "# Runtime entry\n\nremote module bootstrap contract\n");
      const renderedScript = readFileSync(ENGLISH_SCRIPT, "utf8")
        .replaceAll("{{packageName}}", "sample-kb");
      const scriptPath = join(skillRoot, "search.mjs");
      writeFileSync(scriptPath, renderedScript);

      const result = spawnSync("node", [
        scriptPath,
        "--base",
        join(root, "packages"),
        "--query",
        "remote module bootstrap",
        "--json",
      ], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as { root: string; results: Array<{ path: string }> };
      expect(realpathSync(output.root)).toBe(realpathSync(packageRoot));
      expect(output.results[0]?.path).toBe("wikis/entry.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
