import { describe, expect, test } from "bun:test";
import {
  buildIndexerApprovedLayoutProjection,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition,
  compareIndexerLayout,
  indexerProtocolDigest,
  validateIndexerLayoutChangeReport,
  validateIndexerLayoutProposalSet,
  validateIndexerLayoutTransition,
  type IndexerLayoutProposal,
} from "../index.js";
import {
  indexerLayoutEvolutionFixture as fixture,
  layoutSet,
} from "./indexerLayoutEvolutionV070.fixture.js";

function compare(base: IndexerLayoutProposal, target: IndexerLayoutProposal) {
  return compareIndexerLayout({
    base: buildIndexerApprovedLayoutProjection(base),
    target,
  });
}

function kinds(base: IndexerLayoutProposal, target: IndexerLayoutProposal) {
  return compare(base, target).changes.map((change) => change.kind);
}

type LayoutChangeKind = ReturnType<typeof compareIndexerLayout>["changes"][number]["kind"];

describe("layout resolver evolution fixtures", () => {
  test("reports split and merge as reversible Artifact lineage with Section movement", () => {
    expect(kinds(fixture.baseline, fixture.split).sort()).toEqual([
      "artifact-split",
      "section-move",
    ]);
    expect(kinds(fixture.split, fixture.baseline).sort()).toEqual([
      "artifact-merge",
      "section-move",
    ]);
    expect(compare(fixture.baseline, fixture.split)).toMatchObject({
      requires_confirmation: true,
      reused_artifact_refs: [fixture.baseline.artifacts[0]!.artifact_ref],
      gate: { id: "confirm-layout-change", delegation: "forbidden" },
    });
  });

  test("gates destructive moves but lets a compatible Artifact addition proceed", () => {
    const reversible: Array<{
      target: IndexerLayoutProposal;
      forward: LayoutChangeKind;
      reverse: LayoutChangeKind;
    }> = [{
      target: fixture.renamed,
      forward: "artifact-rename",
      reverse: "artifact-rename",
    }, {
      target: fixture.collectionMoved,
      forward: "collection-move",
      reverse: "collection-move",
    }, {
      target: fixture.pathMoved,
      forward: "path-move",
      reverse: "path-move",
    }];
    for (const scenario of reversible) {
      expect(kinds(fixture.baseline, scenario.target)).toContain(scenario.forward);
      expect(kinds(scenario.target, fixture.baseline)).toContain(scenario.reverse);
      expect(compare(fixture.baseline, scenario.target).requires_confirmation).toBe(true);
      expect(compare(scenario.target, fixture.baseline).requires_confirmation).toBe(true);
    }
    const addition = compare(fixture.baseline, fixture.added);
    expect(addition).toMatchObject({
      requires_confirmation: false,
      gate: null,
      changes: [{
        kind: "artifact-added",
        confirmation_class: "compatible-addition",
      }],
    });
    const removal = compare(fixture.added, fixture.baseline);
    expect(removal).toMatchObject({
      requires_confirmation: true,
      changes: [{
        kind: "artifact-removed",
        confirmation_class: "destructive",
      }],
    });

    const forged = structuredClone(removal);
    forged.changes[0]!.confirmation_class = "compatible-addition";
    const { report_digest: _digest, ...forgedPayload } = forged;
    void _digest;
    forged.report_digest = indexerProtocolDigest(forgedPayload);
    expect(() => validateIndexerLayoutChangeReport(forged)).toThrow(
      /invalid confirmation classification/,
    );
  });

  test("reuses stable Artifacts for content-only increments and skips the layout Gate", () => {
    const report = compare(fixture.baseline, fixture.incremental);
    expect(report.changes).toEqual([]);
    expect(report.reused_artifact_refs).toEqual([
      fixture.baseline.artifacts[0]!.artifact_ref,
    ]);
    expect(report.requires_confirmation).toBe(false);
    expect(report.gate).toBeNull();
    const first = compareIndexerLayout({ base: null, target: fixture.baseline });
    expect(first.changes.map((change) => change.kind)).toEqual(["artifact-added"]);
    expect(first.requires_confirmation).toBe(false);
  });

  test("rejects logical Section and output path collisions before transition", () => {
    expect(() => buildIndexerLayoutProposalSet([fixture.collision])).toThrow(
      /logical Section identities/,
    );
    expect(() => buildIndexerLayoutProposalSet([fixture.outputCollision])).toThrow(
      /Artifact output paths/,
    );
  });

  test("validates canonical proposal sets and layout transitions", () => {
    const set = layoutSet(fixture.incremental);
    expect(validateIndexerLayoutProposalSet(set)).toEqual(set);
    const transition = buildIndexerLayoutTransition({
      layout_proposal_set: set,
      base_projections: [buildIndexerApprovedLayoutProjection(fixture.baseline)],
    });
    expect(validateIndexerLayoutTransition(transition)).toEqual(transition);
    expect(transition.requires_confirmation).toBe(false);
  });
});
