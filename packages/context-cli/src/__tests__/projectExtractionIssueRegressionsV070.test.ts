import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCustom, extractTs, source, type CodeIndexUnitPlan } from "@c4a/context";
import {
  runExtractCustomPhase,
} from "../project/customExtractCandidates.js";
import { customInventoryPathExcluded } from "../project/customExtractInventory.js";
import { prepareExtractTsPhase, runExtractTsPhase } from "../project/extractCandidates.js";
import {
  previewExtractionBatch,
  readExtractionPreviewState,
} from "../project/extractionPreviewCache.js";
import { selectRepoSourcesForExtraction } from "../project/extractSourceSelection.js";
import { addRepoSource } from "../project/repoSources.js";
import {
  probeStructuralCapabilities,
  probesForIndexUnit,
} from "../project/structuralCapabilityProbes.js";
import { initContextProject } from "../project/workspace.js";

const SOURCE_NAME = "20260829/lib";
const PHASE_ID = `extract:${SOURCE_NAME}:codeindex`;

function initRepo(repo: string): string {
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ctx-extraction-issues-v070-"));
  const repo = join(root, "lib");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "package.json"), `${JSON.stringify({
    name: "lib",
    version: "1.0.0",
    type: "module",
    exports: "./src/index.ts",
  }, null, 2)}\n`, "utf8");
  await writeFile(join(repo, "src/index.ts"), [
    "export function first() { return 1; }",
    "export function second() { return 2; }",
    "export function third() { return 3; }",
    "",
  ].join("\n"), "utf8");
  const head = initRepo(repo);
  const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  await addRepoSource({
    projectRoot: initialized.projectRoot,
    namespace: "20260829",
    module: "lib",
    local: "../lib",
    remote: "https://example.invalid/lib.git",
    ref: head,
  });
  return {
    root,
    repo,
    projectRoot: initialized.projectRoot,
    repoSource: source("20260829", "lib"),
  };
}

function indexUnit(outputProfile: CodeIndexUnitPlan["outputProfile"]): CodeIndexUnitPlan {
  return {
    id: "lib",
    inputSources: [SOURCE_NAME],
    outputOwner: "lib",
    moduleType: "sdk-library",
    moduleTypeEvidence: ["src/index.ts public entry"],
    outputProfile,
    responsibility: "Document the library boundary.",
    entries: ["src/index.ts"],
    pageKinds: [outputProfile === "module-map" ? "module-map" : "public-contract"],
    protocols: [],
    dependencies: [],
    exclusions: [],
    capability: outputProfile === "module-map" ? "project-adapter" : "complete",
  };
}

function customPhase(repoSource: ReturnType<typeof source>, names: readonly string[]) {
  return extractCustom({
    id: PHASE_ID,
    sources: [repoSource],
    collection: "codeindex",
    indexUnits: [indexUnit("module-map")],
    extract: async () => ({
      candidates: names.map((name, index) => {
        const evidence = {
          source: SOURCE_NAME,
          file: "src/index.ts",
          symbol: name,
          kind: "function",
          digest: (index + 1).toString(16).padStart(12, "0"),
          line: index + 1,
        };
        return {
          nodeRef: `lib/${name}`,
          kind: "module-map",
          visibility: "exported" as const,
          module: "lib",
          evidence: [evidence],
          sections: [{
            id: "responsibility",
            kind: "responsibility" as const,
            title: "Responsibility",
            markdown: `${name} responsibility.`,
            evidence: [evidence],
          }, {
            id: "entrypoint",
            kind: "entrypoint" as const,
            title: "Entrypoint",
            markdown: `${name} entrypoint.`,
            evidence: [evidence],
          }],
          review: {
            title: name,
            summary: `${name} module boundary.`,
            signals: ["source-backed"],
            reason: "Exercise phase-owned candidate replacement.",
          },
        };
      }),
    }),
  });
}

async function candidateIds(projectRoot: string): Promise<string[]> {
  const content = await readFile(join(projectRoot, ".tmp/context-runtime/lifecycle/candidates.jsonl"), "utf8");
  return content.split(/\r?\n/u).filter(Boolean).map((line) =>
    (JSON.parse(line) as { candidate_id: string }).candidate_id
  );
}

describe("0.7.0 extraction issue regressions", () => {
  test("invalidates a cached custom extraction preview when project callback source changes", async () => {
    const setup = await fixture();
    try {
      const phase = customPhase(setup.repoSource, ["overview"]);
      await previewExtractionBatch({ projectRoot: setup.projectRoot, phases: [phase] });
      expect((await readExtractionPreviewState({
        projectRoot: setup.projectRoot,
        pendingPhaseIds: [phase.id],
        phases: [phase],
      })).current).toBe(true);

      const projectEntry = join(setup.projectRoot, "src/index.ts");
      await writeFile(projectEntry, `${await readFile(projectEntry, "utf8")}\n// extract callback now emits v2 evidence\n`, "utf8");
      expect((await readExtractionPreviewState({
        projectRoot: setup.projectRoot,
        pendingPhaseIds: [phase.id],
        phases: [phase],
      })).current).toBe(false);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  test("reports and removes every stale custom draft owned by the same phase", async () => {
    const setup = await fixture();
    try {
      const first = customPhase(setup.repoSource, ["alpha", "beta", "gamma"]);
      await runExtractCustomPhase({ projectRoot: setup.projectRoot, phase: first, runId: "custom-v1" });
      const second = customPhase(setup.repoSource, ["delta"]);
      const result = await runExtractCustomPhase({ projectRoot: setup.projectRoot, phase: second, runId: "custom-v2" });
      expect(result.candidates.removed).toBe(3);
      expect(result.changes.removed).toBe(3);
      expect(await candidateIds(setup.projectRoot)).toEqual(["codeindex/lib/delta"]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  test("removes extractTs drafts when the same phase switches to extractCustom", async () => {
    const setup = await fixture();
    try {
      const tsPhase = extractTs({
        source: setup.repoSource,
        collection: "codeindex",
        indexUnits: [indexUnit("public-api-reference")],
      });
      expect(tsPhase.id).toBe(PHASE_ID);
      const prepared = await prepareExtractTsPhase({ projectRoot: setup.projectRoot, phase: tsPhase });
      const tsResult = await runExtractTsPhase({
        projectRoot: setup.projectRoot,
        phase: tsPhase,
        runId: "extract-ts",
        prepared,
      });
      expect(tsResult.candidates.produced).toBeGreaterThan(1);

      const custom = customPhase(setup.repoSource, ["overview"]);
      const customResult = await runExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase: custom,
        runId: "extract-custom",
      });
      expect(customResult.candidates.removed).toBe(tsResult.candidates.produced);
      expect(await candidateIds(setup.projectRoot)).toEqual(["codeindex/lib/overview"]);
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  test("supports directory exclusions ending in double-star without constructing an invalid RegExp", () => {
    expect(customInventoryPathExcluded("src/__tests__", ["**/__tests__/**"])).toBe(true);
    expect(customInventoryPathExcluded("src/__tests__/fixture.test.ts", ["**/__tests__/**"])).toBe(true);
    expect(customInventoryPathExcluded("src/runtime/index.ts", ["**/__tests__/**"])).toBe(false);
  });

  test("keeps declared and manifest TypeScript entries ahead of heuristic truncation", async () => {
    const setup = await fixture();
    try {
      for (let index = 0; index < 16; index += 1) {
        const directory = join(setup.repo, "components", index.toString().padStart(2, "0"));
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "index.ts"), `export const item${index} = ${index};\n`, "utf8");
      }
      await writeFile(join(setup.repo, "package.json"), `${JSON.stringify({
        name: "lib",
        version: "1.0.0",
        type: "module",
        exports: "./dist/index.js",
      }, null, 2)}\n`, "utf8");
      const phase = customPhase(setup.repoSource, ["overview"]);
      const selected = await selectRepoSourcesForExtraction({
        projectRoot: setup.projectRoot,
        phase,
        materialize: false,
      });
      const probes = await probeStructuralCapabilities({ projectRoot: setup.projectRoot, sources: selected });
      const scoped = probesForIndexUnit({
        probes,
        inputSources: [SOURCE_NAME],
        outputProfile: "module-map",
        entries: ["src/index.ts"],
      });
      expect(scoped.find((probe) => probe.capability === "typescript-symbols" && probe.kind === "entry")?.paths[0])
        .toBe("src/index.ts");

      await writeFile(join(setup.repo, "package.json"), `${JSON.stringify({
        name: "lib",
        version: "1.0.0",
        type: "module",
        exports: "./src/index.ts",
      }, null, 2)}\n`, "utf8");
      const manifestProbes = await probeStructuralCapabilities({ projectRoot: setup.projectRoot, sources: selected });
      expect(manifestProbes.find((probe) => probe.capability === "typescript-symbols" && probe.kind === "entry")?.paths[0])
        .toBe("src/index.ts");
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });
});
