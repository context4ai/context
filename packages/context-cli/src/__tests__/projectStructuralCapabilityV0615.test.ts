import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCustom, source } from "@c4a/context";
import {
  prepareExtractCustomPhase,
  runExtractCustomPhase,
} from "../project/customExtractCandidates.js";
import { addRepoSource } from "../project/repoSources.js";
import { initContextProject } from "../project/workspace.js";

function initRepo(repo: string): string {
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

async function fixture(input: { includeImplementationEvidence: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "ctx-structural-capability-"));
  const repo = join(root, "service");
  await mkdir(join(repo, "handler"), { recursive: true });
  await writeFile(join(repo, "go.mod"), "module example.com/service\n\ngo 1.22\n", "utf8");
  await writeFile(join(repo, "main.go"), "package main\nfunc main() {}\n", "utf8");
  await writeFile(join(repo, "handler/user.go"), "package handler\nfunc GetUser() {}\n", "utf8");
  const head = initRepo(repo);
  const initialized = await initContextProject({ cwd: root, projectDir: "kb", dev: true });
  await addRepoSource({
    projectRoot: initialized.projectRoot,
    namespace: "20260823",
    module: "service",
    local: "../service",
    remote: "https://example.invalid/service.git",
    ref: head,
  });
  const service = source("20260823", "service");
  const evidence = [{
    source: "20260823/service",
    file: "main.go",
    symbol: "main",
    kind: "function",
    digest: "0123456789ab",
  }];
  if (input.includeImplementationEvidence) evidence.push({
    source: "20260823/service",
    file: "handler/user.go",
    symbol: "GetUser",
    kind: "function",
    digest: "abcdef012345",
  });
  const phase = extractCustom({
    id: "extract:20260823/service:map",
    sources: [service],
    collection: "codegraph",
    indexUnits: [{
      id: "service",
      inputSources: ["20260823/service"],
      outputOwner: "service",
      moduleType: "api-service",
      moduleTypeEvidence: ["main.go entry and handler/user.go implementation"],
      outputProfile: "service-boundary",
      responsibility: "Document the stable service boundary.",
      entries: ["main.go"],
      pageKinds: ["service-boundary"],
      protocols: ["HTTP"],
      dependencies: [],
      exclusions: [],
      capability: "project-adapter",
    }],
    extract: async () => ({
      candidates: [{
        nodeRef: "service/module-map",
        kind: "module-map",
        visibility: "exported",
        module: "service",
        evidence,
        sections: [{
          id: "operations",
          kind: "operation",
          title: "Operations",
          markdown: "The service exposes its registered operations.",
          evidence: [evidence[0]!],
        }, {
          id: "handoff",
          kind: "handoff",
          title: "Implementation handoff",
          markdown: "The entry dispatches into the implementation boundary.",
          evidence: [evidence.at(-1)!],
        }],
        review: {
          title: "Service boundary",
          summary: "Aggregate the entry and implementation boundary.",
          signals: ["source-backed"],
          reason: "Review the module-level map.",
        },
      }],
    }),
  });
  return { root, projectRoot: initialized.projectRoot, phase };
}

describe("0.6.15 structural capability coverage", () => {
  test("blocks a static module card that does not consume a known implementation probe", async () => {
    const setup = await fixture({ includeImplementationEvidence: false });
    try {
      const prepared = await prepareExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase: setup.phase,
        runId: "preview-uncovered",
      });
      expect(prepared.preview.inspection.structuralProbes).toEqual(expect.arrayContaining([
        expect.objectContaining({ capability: "go-symbols", kind: "entry" }),
        expect.objectContaining({ capability: "go-symbols", kind: "implementation" }),
      ]));
      expect(prepared.preview.indexUnits[0]).toMatchObject({
        capability: "material-required",
        structuralCoverage: {
          required: 2,
          covered: 1,
          uncovered: [expect.objectContaining({ kind: "implementation" })],
        },
      });
      expect(prepared.preview.indexUnits[0]?.risks).toContain("structural-capability-uncovered");
      await expect(runExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase: setup.phase,
        runId: "run-uncovered",
        prepared,
      })).rejects.toMatchObject({
        detail: expect.objectContaining({ code: "extract-capability-required" }),
      });
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  test("allows one aggregate page when it covers every applicable structural probe", async () => {
    const setup = await fixture({ includeImplementationEvidence: true });
    try {
      const prepared = await prepareExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase: setup.phase,
        runId: "preview-covered",
      });
      expect(prepared.preview.indexUnits[0]).toMatchObject({
        capability: "project-adapter",
        projectedPageCount: 1,
        structuralCoverage: { required: 2, covered: 2, uncovered: [] },
      });
      const result = await runExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase: setup.phase,
        runId: "run-covered",
        prepared,
      });
      expect(result.candidates.produced).toBe(1);
      expect(result.relationships.mode).toBe("source-backed-explicit");
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  test("blocks a cross-module flow that has prose coverage but no structured edge", async () => {
    const setup = await fixture({ includeImplementationEvidence: true });
    try {
      const phase = {
        ...setup.phase,
        id: "extract:20260823/service:flow",
        indexUnits: setup.phase.indexUnits.map((unit) => ({
          ...unit,
          outputProfile: "cross-module-flow" as const,
        })),
      };
      const prepared = await prepareExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase,
        runId: "preview-flow-without-edge",
      });
      expect(prepared.preview.indexUnits[0]).toMatchObject({
        capability: "material-required",
        semanticCoverage: { uncovered: [] },
      });
      expect(prepared.preview.indexUnits[0]?.risks).toContain("structured-relationship-missing");
      await expect(runExtractCustomPhase({
        projectRoot: setup.projectRoot,
        phase,
        runId: "run-flow-without-edge",
        prepared,
      })).rejects.toMatchObject({
        detail: expect.objectContaining({ code: "extract-capability-required" }),
      });
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });
});
