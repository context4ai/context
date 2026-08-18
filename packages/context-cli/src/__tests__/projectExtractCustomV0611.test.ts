import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli_main } from "../cli.js";
import { addRepoSource } from "../project/repoSources.js";
import { initContextProject } from "../project/workspace.js";

async function runCliInDir(dir: string, args: string[]): Promise<string> {
  const cwd = process.cwd();
  const write = process.stdout.write;
  const chunks: string[] = [];
  process.chdir(dir);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await cli_main(["node", "context", ...args]);
  } finally {
    process.stdout.write = write;
    process.chdir(cwd);
  }
  return chunks.join("");
}

function initRepo(repo: string): string {
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

describe("custom code extraction lifecycle", () => {
  test("routes, materializes and freshness-checks source-backed custom candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-"));
    const repo = join(root, "service");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/protocol.ts"), "export const protocol = 'v1';\n", "utf8");
      await writeFile(join(repo, "src/index.ts"), "export const module = 'service';\n", "utf8");
      const head = initRepo(repo);
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      await addRepoSource({
        projectRoot: initialized.projectRoot,
        namespace: "20260811",
        module: "service",
        local: "../service",
        remote: "https://example.invalid/service.git",
        ref: head,
      });
      const projectFile = join(initialized.projectRoot, "src/index.ts");
      const projectSource = [
        'import { defineProject, extractCustom, reviewValidity, source } from "@c4a/context";',
        'const service = source("20260811", "service");',
        "export default defineProject({",
        "  sources: [service],",
        "  phases: [",
        "    extractCustom({",
        '      id: "extract:20260811/service:protocol",',
        "      sources: [service],",
        '      collection: "codegraph",',
        "      extract: async () => ({ candidates: [{",
        '        nodeRef: "service/index",',
        '        kind: "protocol",',
        '        visibility: "exported",',
        '        module: "service",',
        '        markdown: "# Service protocol\\n\\nStable protocol boundary.\\n",',
        "        evidence: [{",
        '          source: "20260811/service", file: "src/protocol.ts", symbol: "protocol", kind: "variable", digest: "0123456789ab", line: 1,',
        "        }, {",
        '          source: "20260811/service", file: "src/index.ts", symbol: "module", kind: "variable", digest: "fedcba987654", line: 1,',
        "        }],",
        "        review: {",
        '          title: "Service protocol", summary: "Aggregated protocol boundary.", signals: ["source-backed"], reason: "Review the custom extraction.",',
        "        },",
        "      }] }),",
        "    }),",
        '    reviewValidity({ collection: "codegraph" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n");
      await writeFile(projectFile, projectSource, "utf8");

      const before = JSON.parse(await runCliInDir(initialized.projectRoot, ["status", "--format", "json"])) as {
        progress: { pendingExtractPhases: number };
        workflow: { current: { commands: Array<{ command: string; execution?: { target: string } }> } };
      };
      expect(before.progress.pendingExtractPhases).toBe(1);
      expect(before.workflow.current.commands[0]?.command).toContain("extract:20260811/service:protocol");
      expect(before.workflow.current.commands[0]?.execution).toEqual({ target: "subprocess" });

      const extracted = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "run", "extract:20260811/service:protocol", "--format", "json",
      ])) as { result: { candidates: { produced: number }; review: { required: boolean } } };
      expect(extracted.result).toMatchObject({
        candidates: { produced: 1 },
        review: { required: true },
      });

      const review = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "review", "list", "codegraph", "--format", "json",
      ])) as Array<{ candidate_id: string; snapshot_ready: boolean }>;
      expect(review).toEqual([expect.objectContaining({
        candidate_id: "codegraph/service/index",
        snapshot_ready: true,
      })]);
      const candidateLedger = await readFile(join(
        initialized.projectRoot,
        ".tmp/context-runtime/lifecycle/candidates.jsonl",
      ), "utf8");
      expect(candidateLedger).toContain('"path":"codegraph/service/index-page.md"');
      const symbolIndex = await readFile(join(
        initialized.projectRoot,
        ".tmp/context-runtime/extract/source-symbols.json",
      ), "utf8");
      expect(symbolIndex).toContain('"source": "20260811/service"');
      expect(symbolIndex).toContain('"name": "protocol"');
      expect(symbolIndex).toContain('"name": "module"');

      await runCliInDir(initialized.projectRoot, [
        "review", "approve", "codegraph/service/index", "--collection", "codegraph",
      ]);
      const approved = await readFile(join(
        initialized.projectRoot,
        "knowledge/codegraph/service/index-page.md",
      ), "utf8");
      expect(approved).toContain("- service|module|variable");
      expect(approved).toContain("- service|protocol|variable");
      await runCliInDir(initialized.projectRoot, ["close", "--format", "json"]);
      const verified = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "verify", "--format", "json",
      ])) as { ok: boolean; summary: { errors: number } };
      expect(verified).toMatchObject({ ok: true, summary: { errors: 0 } });

      await writeFile(projectFile, projectSource.replace("0123456789ab", "abcdef012345"), "utf8");
      await runCliInDir(initialized.projectRoot, [
        "run", "extract:20260811/service:protocol", "--format", "json",
      ]);
      const refreshedSymbolIndex = await readFile(join(
        initialized.projectRoot,
        ".tmp/context-runtime/extract/source-symbols.json",
      ), "utf8");
      expect(refreshedSymbolIndex).toContain('"digest": "abcdef012345"');
      expect(refreshedSymbolIndex).not.toContain('"digest": "0123456789ab"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
