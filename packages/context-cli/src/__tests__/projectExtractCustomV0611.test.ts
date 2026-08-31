import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { extractCustom, source } from "@c4a/context";
import { cli_main } from "../cli.js";
import {
  prepareExtractCustomPhase,
  runExtractCustomPhase,
} from "../project/customExtractCandidates.js";
import {
  previewExtractionBatch,
  readExtractionPreviewState,
} from "../project/extractionPreviewCache.js";
import { addRepoSource } from "../project/repoSources.js";
import { initContextProject } from "../project/workspace.js";
import { applyReviewDecisions } from "../project/reviewApply.js";
import { candidateIdsHash } from "../project/reviewShared.js";

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
  test("streaming custom preview stops retaining a blocked unit after its proof boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-stream-"));
    const repo = join(root, "service");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const service = true;\n", "utf8");
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
      const service = source("20260811", "service");
      const phase = extractCustom({
        id: "extract:20260811/service:stream",
        sources: [service],
        collection: "codegraph",
        indexUnits: [{
          id: "service",
          inputSources: ["20260811/service"],
          outputOwner: "service",
          moduleType: "service",
          moduleTypeEvidence: ["src/index.ts service entry"],
          outputProfile: "service-boundary",
          responsibility: "Document the stable service boundary.",
          entries: ["src/index.ts"],
          pageKinds: ["service-boundary"],
          protocols: ["src/index.ts"],
          dependencies: [],
          exclusions: [],
          capability: "project-adapter",
        }],
        extract: async () => ({
          candidates: (async function* () {
            for (let index = 0; index < 305; index += 1) {
              const evidence = {
                source: "20260811/service",
                file: "src/index.ts",
                symbol: `item${index}`,
                kind: "variable",
                digest: index.toString(16).padStart(12, "0"),
              };
              yield {
                nodeRef: `service/item-${index}`,
                kind: "service",
                visibility: "exported",
                module: "service",
                evidence: [evidence],
                sections: [{
                  id: "operations",
                  kind: "operation" as const,
                  title: "Operations",
                  markdown: `Service item ${index}.`,
                  evidence: [evidence],
                }, {
                  id: "handoff",
                  kind: "handoff" as const,
                  title: "Handoff",
                  markdown: `Service item ${index} handoff.`,
                  evidence: [evidence],
                }],
                review: {
                  title: `Service item ${index}`,
                  summary: "Generated streaming fixture.",
                  signals: ["source-backed"],
                  reason: "Exercise the custom preview boundary.",
                },
              };
            }
          })(),
        }),
      });

      const prepared = await prepareExtractCustomPhase({
        projectRoot: initialized.projectRoot,
        phase,
        runId: "preview-stream",
      });
      expect(prepared.preview.indexUnits[0]).toMatchObject({
        projectedPageCount: 305,
        scale: "blocked",
      });
      expect(prepared.built).toHaveLength(301);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("batch totals do not block independently bounded index units", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-batch-"));
    const repo = join(root, "service");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const service = true;\n", "utf8");
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
      const service = source("20260811", "service");
      const unitIds = ["api", "runtime", "protocol", "integration"];
      const phase = extractCustom({
        id: "extract:20260811/service:batch",
        sources: [service],
        collection: "codegraph",
        indexUnits: unitIds.map((id) => ({
          id,
          inputSources: ["20260811/service"],
          outputOwner: id,
          moduleType: "service" as const,
          moduleTypeEvidence: ["src/index.ts service entry"],
          outputProfile: "module-map" as const,
          responsibility: `Document the ${id} boundary.`,
          entries: ["src/index.ts"],
          pageKinds: ["module-map"],
          protocols: [],
          dependencies: [],
          exclusions: [],
          capability: "project-adapter" as const,
        })),
        extract: async () => ({
          candidates: (async function* () {
            for (const unitId of unitIds) {
              for (let index = 0; index < 80; index += 1) {
                const evidence = {
                  source: "20260811/service",
                  file: "src/index.ts",
                  symbol: `${unitId}Item${index}`,
                  kind: "variable",
                  digest: `${unitIds.indexOf(unitId) + 1}${index.toString(16).padStart(11, "0")}`,
                };
                yield {
                  nodeRef: `${unitId}/item-${index}`,
                  kind: "service",
                  visibility: "exported",
                  module: unitId,
                  evidence: [evidence],
                  sections: [{
                    id: "responsibility",
                    kind: "responsibility" as const,
                    title: "Responsibility",
                    markdown: `${unitId} item ${index}.`,
                    evidence: [evidence],
                  }, {
                    id: "entrypoint",
                    kind: "entrypoint" as const,
                    title: "Entrypoint",
                    markdown: `${unitId} item ${index} entrypoint.`,
                    evidence: [evidence],
                  }],
                  review: {
                    title: `${unitId} item ${index}`,
                    summary: "Generated batch fixture.",
                    signals: ["source-backed"],
                    reason: "Exercise per-index-unit scale boundaries.",
                  },
                };
              }
            }
          })(),
        }),
      });

      const preview = await previewExtractionBatch({
        projectRoot: initialized.projectRoot,
        phases: [phase],
      });
      expect(preview.totals.projectedPages).toBe(320);
      expect(preview.totals.blocked).toBe(0);
      expect(preview.advisories).toEqual(["batch-page-count-warning"]);
      expect(preview.scaleClear).toBe(true);
      expect(preview.phases[0]?.indexUnits).toHaveLength(4);
      expect(preview.phases[0]?.indexUnits.every((unit) =>
        unit.projectedPageCount === 80 && unit.scale === "normal"
      )).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("100 and 300 page boundaries are evaluated per multi-source index unit", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-boundaries-"));
    const repos = [join(root, "service-a"), join(root, "service-b")];
    try {
      for (const repo of repos) {
        await mkdir(join(repo, "src"), { recursive: true });
        await writeFile(join(repo, "src/index.ts"), "export const service = true;\n", "utf8");
      }
      const heads = repos.map(initRepo);
      const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
      for (const [index, repo] of repos.entries()) {
        await addRepoSource({
          projectRoot: initialized.projectRoot,
          namespace: "20260811",
          module: `service-${index === 0 ? "a" : "b"}`,
          local: `../${basename(repo)}`,
          remote: `https://example.invalid/service-${index}.git`,
          ref: heads[index]!,
        });
      }
      const sources = [source("20260811", "service-a"), source("20260811", "service-b")];
      const makePhase = (id: string, count: number) => extractCustom({
        id: `extract:20260811/services:${id}`,
        sources,
        collection: "codegraph",
        indexUnits: [{
          id,
          inputSources: ["20260811/service-a", "20260811/service-b"],
          outputOwner: id,
          moduleType: "service",
          moduleTypeEvidence: ["src/index.ts service entry"],
          outputProfile: "module-map",
          responsibility: `Document the ${id} boundary.`,
          entries: ["src/index.ts"],
          pageKinds: ["module-map"],
          protocols: [],
          dependencies: [],
          exclusions: [],
          capability: "project-adapter",
        }],
        extract: async () => ({
          candidates: (async function* () {
            for (let index = 0; index < count; index += 1) {
              const sourceName = `20260811/service-${index % 2 === 0 ? "a" : "b"}`;
              const evidence = {
                source: sourceName,
                file: "src/index.ts",
                symbol: `${id}Item${index}`,
                kind: "variable",
                digest: index.toString(16).padStart(12, "0"),
              };
              yield {
                nodeRef: `${id}/item-${index}`,
                kind: "service",
                visibility: "exported",
                module: id,
                evidence: [evidence],
                sections: [{
                  id: "responsibility",
                  kind: "responsibility" as const,
                  title: "Responsibility",
                  markdown: `${id} item ${index}.`,
                  evidence: [evidence],
                }, {
                  id: "entrypoint",
                  kind: "entrypoint" as const,
                  title: "Entrypoint",
                  markdown: `${id} item ${index} entrypoint.`,
                  evidence: [evidence],
                }],
                review: {
                  title: `${id} item ${index}`,
                  summary: "Generated boundary fixture.",
                  signals: ["source-backed"],
                  reason: "Exercise exact scale thresholds.",
                },
              };
            }
          })(),
        }),
      });
      const phases = [makePhase("normal", 100), makePhase("warning", 300)];

      const preview = await previewExtractionBatch({
        projectRoot: initialized.projectRoot,
        phases,
      });
      const units = preview.phases.flatMap((phase) => phase.indexUnits);
      expect(preview.totals.projectedPages).toBe(400);
      expect(preview.advisories).toEqual(["batch-page-count-warning"]);
      expect(preview.scaleClear).toBe(true);
      expect(units.find((unit) => unit.id === "normal")).toMatchObject({
        projectedPageCount: 100,
        scale: "normal",
      });
      expect(units.find((unit) => unit.id === "warning")).toMatchObject({
        projectedPageCount: 300,
        scale: "warning",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preview cache is invalidated by project inputs and missing runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-cache-"));
    const repo = join(root, "service");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const service = true;\n", "utf8");
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
      const service = source("20260811", "service");
      const phase = extractCustom({
        id: "extract:20260811/service:cache",
        sources: [service],
        collection: "codegraph",
        indexUnits: [{
          id: "service",
          inputSources: ["20260811/service"],
          outputOwner: "service",
          moduleType: "service",
          moduleTypeEvidence: ["src/index.ts service entry"],
          outputProfile: "module-map",
          responsibility: "Document the stable service map.",
          entries: ["src/index.ts"],
          pageKinds: ["module-map"],
          protocols: [],
          dependencies: [],
          exclusions: [],
          capability: "project-adapter",
        }],
        extract: async () => ({ candidates: [] }),
      });
      const stateInput = {
        projectRoot: initialized.projectRoot,
        pendingPhaseIds: [phase.id],
        phases: [phase],
      };

      await previewExtractionBatch({ projectRoot: initialized.projectRoot, phases: [phase] });
      expect((await readExtractionPreviewState(stateInput)).current).toBe(true);

      const projectFile = join(initialized.projectRoot, "src/index.ts");
      await writeFile(projectFile, `${await readFile(projectFile, "utf8")}\n// changed\n`, "utf8");
      expect((await readExtractionPreviewState(stateInput)).current).toBe(false);

      await previewExtractionBatch({ projectRoot: initialized.projectRoot, phases: [phase] });
      await rm(join(initialized.projectRoot, ".tmp"), { recursive: true, force: true });
      expect((await readExtractionPreviewState(stateInput)).current).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("custom inspection capability gaps block candidate writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ctx-extract-custom-capability-"));
    const repo = join(root, "service");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await writeFile(join(repo, "src/index.ts"), "export const service = true;\n", "utf8");
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
      const service = source("20260811", "service");
      let resolvedSourceRoot: string | undefined;
      const phase = extractCustom({
        id: "extract:20260811/service:capability",
        sources: [service],
        collection: "codegraph",
        indexUnits: [{
          id: "service",
          inputSources: ["20260811/service"],
          outputOwner: "service",
          moduleType: "api-service",
          moduleTypeEvidence: ["main.go and handler/user.go"],
          outputProfile: "protocol-index",
          responsibility: "Document the externally visible protocol.",
          entries: ["src/index.ts"],
          pageKinds: ["protocol-index"],
          protocols: ["src/index.ts"],
          dependencies: [],
          exclusions: [],
          capability: "project-adapter",
        }],
        inspect: async () => ({
          findings: [{
            indexUnitId: "service",
            source: "20260811/service",
            kind: "protocol",
            path: "src/index.ts",
            summary: "A protocol locator was found but cannot be decoded by the current adapter.",
          }],
          capabilityGaps: [{
            indexUnitId: "service",
            capability: "protocol-decoder",
            reason: "The protocol format needs an additional generic adapter.",
            requestedMaterial: "Provide the protocol schema or a compatible adapter.",
          }],
        }),
        extract: async ({ sources: resolvedSources }) => {
          resolvedSourceRoot = resolvedSources[0]?.absolutePath;
          return { candidates: [] };
        },
      });
      const prepared = await prepareExtractCustomPhase({
        projectRoot: initialized.projectRoot,
        phase,
        runId: "preview-capability",
      });
      expect(prepared.preview.inspection.capabilityGaps).toHaveLength(1);
      expect(resolvedSourceRoot).toBe(join(initialized.projectRoot, "sources/repo/20260811/service"));
      expect(prepared.preview.indexUnits[0]?.capability).toBe("material-required");
      expect(prepared.preview.indexUnits[0]?.risks).toContain("capability-material-required");
      await expect(runExtractCustomPhase({
        projectRoot: initialized.projectRoot,
        phase,
        runId: "extract-capability",
        prepared,
      })).rejects.toMatchObject({
        detail: expect.objectContaining({ code: "extract-capability-required" }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
        '      collection: "codeindex",',
        "      indexUnits: [{",
        '        id: "service", inputSources: ["20260811/service"], outputOwner: "service",',
        '        moduleType: "api-service", moduleTypeEvidence: ["src/index.ts protocol registration"], outputProfile: "protocol-index", responsibility: "Document the service protocol.",',
        '        entries: ["src/protocol.ts"], pageKinds: ["protocol-index"], protocols: ["src/protocol.ts"],',
        '        dependencies: [], exclusions: [], capability: "project-adapter"',
        "      }],",
        "      extract: async () => ({ candidates: [{",
        '        nodeRef: "service/index",',
        '        kind: "protocol",',
        '        visibility: "exported",',
        '        module: "service",',
        "        evidence: [{",
        '          source: "20260811/service", file: "src/protocol.ts", symbol: "protocol", kind: "variable", digest: "0123456789ab", line: 1,',
        "        }, {",
        '          source: "20260811/service", file: "src/index.ts", symbol: "module", kind: "variable", digest: "fedcba987654", line: 1,',
        "        }],",
        "        sections: [{",
        '          id: "contract", kind: "contract", title: "Contract", markdown: "Stable protocol contract.",',
        '          evidence: [{ source: "20260811/service", file: "src/protocol.ts", symbol: "protocol", kind: "variable", digest: "0123456789ab", line: 1 }],',
        "        }, {",
        '          id: "operations", kind: "operation", title: "Operations", markdown: "Supported operations.",',
        '          evidence: [{ source: "20260811/service", file: "src/protocol.ts", symbol: "protocol", kind: "variable", digest: "0123456789ab", line: 1 }],',
        "        }, {",
        '          id: "handoff", kind: "handoff", title: "Handoff", markdown: "Implementation handoff.",',
        '          evidence: [{ source: "20260811/service", file: "src/index.ts", symbol: "module", kind: "variable", digest: "fedcba987654", line: 1 }],',
        "        }],",
        "        review: {",
        '          title: "Service protocol", summary: "Aggregated protocol boundary.", signals: ["source-backed"], reason: "Review the custom extraction.",',
        "        },",
        "      }] }),",
        "    }),",
        '    reviewValidity({ collection: "codeindex" }),',
        "  ],",
        "  packages: [],",
        "});",
        "",
      ].join("\n");
      await writeFile(projectFile, projectSource, "utf8");

      const previewRequired = JSON.parse(await runCliInDir(initialized.projectRoot, ["status", "--format", "json"])) as {
        workflow: { current: { reason_code: string } };
      };
      expect(previewRequired.workflow.current.reason_code).toBe("route.indexer.lifecycle-required");
      await runCliInDir(initialized.projectRoot, ["run", "--preview-extraction-batch", "--format", "json"]);
      const before = JSON.parse(await runCliInDir(initialized.projectRoot, ["status", "--format", "json"])) as {
        progress: { pendingExtractPhases: number };
        workflow: { current: { commands: Array<{ command: string; execution?: { target: string } }> } };
      };
      expect(before.progress.pendingExtractPhases).toBe(1);
      expect(before.workflow.current.commands).toEqual([]);

      const extracted = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "run", "extract:20260811/service:protocol", "--format", "json",
      ])) as { result: { candidates: { produced: number }; review: { required: boolean } } };
      expect(extracted.result).toMatchObject({
        candidates: { produced: 1 },
        review: { required: true },
      });

      const review = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "review", "list", "codeindex", "--format", "json",
      ])) as Array<{ candidate_id: string; snapshot_ready: boolean }>;
      expect(review).toEqual([expect.objectContaining({
        candidate_id: "codeindex/service/index",
        snapshot_ready: true,
      })]);
      const candidateLedger = await readFile(join(
        initialized.projectRoot,
        ".tmp/context-runtime/lifecycle/candidates.jsonl",
      ), "utf8");
      expect(candidateLedger).toContain('"path":"codeindex/service/index-page.md"');
      const symbolIndex = await readFile(join(
        initialized.projectRoot,
        ".tmp/context-runtime/extract/source-symbols.json",
      ), "utf8");
      expect(symbolIndex).toContain('"source": "20260811/service"');
      expect(symbolIndex).toContain('"name": "protocol"');
      expect(symbolIndex).toContain('"name": "module"');

      await applyReviewDecisions({
        projectRoot: initialized.projectRoot,
        payload: {
          decisions: [{ candidate_id: "codeindex/service/index", status: "approved" }],
          collection: "codeindex",
          scope: {
            kind: "collection",
            collection: "codeindex",
            count: 1,
            ids_sha256: candidateIdsHash(["codeindex/service/index"]),
          },
        },
      });
      const approved = await readFile(join(
        initialized.projectRoot,
        "knowledge/codeindex/service/index-page.md",
      ), "utf8");
      expect(approved).toContain("- service|module|variable");
      expect(approved).toContain("- service|protocol|variable");
      expect(approved).toContain("relationship_mode: source-backed-explicit");
      expect(approved).toContain('context:section id="contract" kind="contract"');
      expect(approved).toContain('context:section id="operations" kind="operation"');
      expect(approved).toContain('context:section id="handoff" kind="handoff"');
      await runCliInDir(initialized.projectRoot, ["close", "--format", "json"]);
      const verified = JSON.parse(await runCliInDir(initialized.projectRoot, [
        "verify", "--format", "json",
      ])) as { ok: boolean; summary: { errors: number } };
      expect(verified).toMatchObject({ ok: true, summary: { errors: 0 } });

      await writeFile(projectFile, projectSource.replaceAll("0123456789ab", "abcdef012345"), "utf8");
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
