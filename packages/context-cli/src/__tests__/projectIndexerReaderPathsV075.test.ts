import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import YAML from "yaml";
import { indexerProtocolDigest } from "@c4a/context";
import {
  confirmCurrentIndexerLayout,
  INDEXER_CURRENT_FINALIZATION_PATH,
  prepareCurrentIndexerLayout,
  readCurrentIndexerFinalization,
} from "../project/indexerCurrentFinalization.js";
import {
  prepareIndexerReaderPaths,
  resolveIndexerReaderPaths,
} from "../project/indexerLayoutPathResolution.js";
import { approvedReaderStructure, readerLayoutProposal } from
  "./projectIndexerReaderPathsV075.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "context-reader-paths-"));
  roots.push(root);
  return root;
}
async function saveStructure(root: string, proposals: Parameters<typeof approvedReaderStructure>[0]) {
  await mkdir(join(root, "knowledge"), { recursive: true });
  await writeFile(join(root, "knowledge/structure.yaml"), YAML.stringify(approvedReaderStructure(proposals)));
}
const proposals = [readerLayoutProposal("guide/a"), readerLayoutProposal("guide-a")];
const paths = proposals.map((proposal, index) => ({
  artifact_ref: proposal.artifacts[0]!.artifact_ref,
  output_path: `knowledge/codeindex/anonymous-package/${index === 0 ? "shared-guide" : "guide-a-reference"}.md`,
}));

describe("reader path confirmation", () => {
  test("turns a new-page collision into a Gate, resolves names, and resumes without asking again", async () => {
    const root = await workspace();
    const pending = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(pending.pending).toBe(true);
    if (!pending.pending) throw new Error("expected collision Gate");
    expect(pending.state.path_preparation?.conflicts).toHaveLength(1);
    expect(pending.state.layout_transition).toBeUndefined();
    await confirmCurrentIndexerLayout({
      projectRoot: root, revision: pending.state.revision, actor_ref: "human:local-user", paths,
    });
    const approved = await readCurrentIndexerFinalization(root);
    expect(approved?.path_preparation).toBeUndefined();
    expect(approved?.path_resolution?.paths).toEqual(paths);
    expect(approved?.confirmations).toEqual([]);
    const resumed = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(resumed.pending).toBe(false);
    if (resumed.pending) throw new Error("expected resolved layout");
    expect(resumed.layout.layout_proposal_set.proposals.flatMap((proposal) =>
      proposal.artifacts.map((artifact) => artifact.output_path)
    ).sort()).toEqual(paths.map((entry) => entry.output_path).sort());
    expect(resumed.layout.layout_transition.requires_confirmation).toBe(false);
    // Close removes runtime state. Existing structure.yaml alone retains approved names.
    await saveStructure(root, resumed.layout.layout_proposal_set.proposals);
    await rm(join(root, INDEXER_CURRENT_FINALIZATION_PATH));
    const nextRun = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(nextRun.pending).toBe(false);
    if (nextRun.pending) throw new Error("expected stable approved paths");
    expect(nextRun.layout.layout_proposal_set).toEqual(resumed.layout.layout_proposal_set);
    expect(nextRun.layout.layout_transition.requires_confirmation).toBe(false);
  });

  test("maps multiple renamed artifacts by existing view identity rather than the old filename", async () => {
    const root = await workspace();
    const proposal = readerLayoutProposal("multiple", { multiple: true });
    const previous = { ...proposal, artifacts: proposal.artifacts.map((artifact, index) => ({
      ...artifact, output_path: `knowledge/codeindex/anonymous-package/approved-${index}.md`,
    })) };
    await saveStructure(root, [previous]);
    const next = await prepareCurrentIndexerLayout({ projectRoot: root, proposals: [proposal] });
    expect(next.pending).toBe(false);
    if (next.pending) throw new Error("approved identity should recover every filename");
    expect(next.layout.layout_proposal_set.proposals[0]!.artifacts.map((entry) => entry.output_path))
      .toEqual(previous.artifacts.map((entry) => entry.output_path));
    expect(next.layout.layout_transition.requires_confirmation).toBe(false);
  });

  test("does not alter state for invalid, incomplete, duplicate, unsafe, or unrelated path choices", async () => {
    const root = await workspace();
    const pending = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    if (!pending.pending) throw new Error("expected Gate");
    const before = await readFile(join(root, INDEXER_CURRENT_FINALIZATION_PATH), "utf8");
    const invalid = [
      [], paths.slice(0, 1), [paths[0]!, paths[0]!],
      [...paths, { artifact_ref: "unrelated", output_path: paths[0]!.output_path }],
      [paths[0]!, { ...paths[1]!, output_path: paths[0]!.output_path.toUpperCase().replace("KNOWLEDGE/CODEINDEX/", "knowledge/codeindex/").replace(".MD", ".md") }],
      ...["../escape.md", "knowledge/codeindex/../escape.md", "knowledge/codeindex/anonymous-package/%2e%2e.md",
        `knowledge/codeindex/anonymous-package/${"a".repeat(64)}.md`,
        "knowledge/business/anonymous-package/moved.md"].map((output_path) => [paths[0]!, { ...paths[1]!, output_path }]),
    ];
    for (const choices of invalid) {
      await expect(confirmCurrentIndexerLayout({
        projectRoot: root, revision: pending.state.revision, actor_ref: "human:local-user", paths: choices,
      })).rejects.toThrow();
      expect(await readFile(join(root, INDEXER_CURRENT_FINALIZATION_PATH), "utf8")).toBe(before);
    }
    await expect(confirmCurrentIndexerLayout({
      projectRoot: root, revision: indexerProtocolDigest("stale"), actor_ref: "human:local-user", paths,
    })).rejects.toThrow("stale");
    expect(await readFile(join(root, INDEXER_CURRENT_FINALIZATION_PATH), "utf8")).toBe(before);
  });

  test("does not reuse a choice when proposals or approved occupancy have changed", async () => {
    const root = await workspace();
    const pending = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    if (!pending.pending) throw new Error("expected Gate");
    await confirmCurrentIndexerLayout({
      projectRoot: root, revision: pending.state.revision, actor_ref: "human:local-user", paths,
    });
    await saveStructure(root, [readerLayoutProposal("another-page", { path: paths[1]!.output_path })]);
    const changed = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(changed.pending).toBe(true);
    if (!changed.pending) throw new Error("expected new confirmation");
    expect(changed.state.revision).not.toBe(pending.state.revision);
    await expect(confirmCurrentIndexerLayout({
      projectRoot: root, revision: changed.state.revision, actor_ref: "human:local-user", paths,
    })).rejects.toThrow("approved page");
  });

  test("does not treat selecting new names as approval of destructive changes to existing pages", async () => {
    const root = await workspace();
    const old = readerLayoutProposal("guide/a", { multiple: true });
    await saveStructure(root, [old]);
    const pending = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    if (!pending.pending) throw new Error("expected collision Gate");
    await confirmCurrentIndexerLayout({
      projectRoot: root, revision: pending.state.revision, actor_ref: "human:local-user", paths,
    });
    const destructive = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(destructive.pending).toBe(true);
    if (!destructive.pending) throw new Error("removing the old examples still needs approval");
    expect(destructive.state.layout_transition?.requires_confirmation).toBe(true);
    expect(destructive.state.confirmations).toEqual([]);
    await confirmCurrentIndexerLayout({
      projectRoot: root, revision: destructive.state.revision, actor_ref: "human:local-user",
    });
    const resolved = await prepareCurrentIndexerLayout({ projectRoot: root, proposals });
    expect(resolved.pending).toBe(false);
    // Simulate the later readiness revision: approval belongs to the same transition,
    // not to a transient finalization state name or readiness digest.
    const state = await readCurrentIndexerFinalization(root);
    await mkdir(dirname(join(root, INDEXER_CURRENT_FINALIZATION_PATH)), { recursive: true });
    await writeFile(join(root, INDEXER_CURRENT_FINALIZATION_PATH), JSON.stringify({
      ...state, state: "ready", revision: indexerProtocolDigest("readiness"),
    }));
    expect((await prepareCurrentIndexerLayout({ projectRoot: root, proposals })).pending).toBe(false);
  });

  test("detects unicode normalization/case collisions and permits non-Latin readable names", () => {
    const preparation = prepareIndexerReaderPaths({
      proposals: [readerLayoutProposal("first", { path: "knowledge/codeindex/anonymous-package/café.md" }),
        readerLayoutProposal("second", { path: "knowledge/codeindex/anonymous-package/CAFE\u0301.md" })],
      base_projections: [], occupied_paths: [],
    });
    expect(preparation.conflicts).toHaveLength(1);
    const resolved = resolveIndexerReaderPaths({
      preparation,
      paths: preparation.conflicts[0]!.artifacts.map((entry, index) => ({
        artifact_ref: entry.artifact_ref,
        output_path: `knowledge/codeindex/组件库/${index === 0 ? "使用说明" : "接口说明"}.md`,
      })),
    });
    expect(resolved.proposals).toHaveLength(2);
  });
});
