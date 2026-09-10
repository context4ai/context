import { expect, test } from "bun:test";
import { indexerProtocolDigest, type IndexerLayoutProposal } from "@c4a/context";
import { approvedBaseProjection } from "../project/indexerCurrentFinalization.js";
import { prepareIndexerReaderPaths, resolveIndexerReaderPaths } from "../project/indexerLayoutPathResolution.js";
import { approvedReaderStructure, readerLayoutProposal } from "./projectIndexerReaderPathsV075.fixture.js";

function slice(proposal: IndexerLayoutProposal, index: number): IndexerLayoutProposal {
  const { proposal_digest: _digest, ...original } = proposal;
  void _digest;
  const artifact = original.artifacts[index]!;
  const payload = { ...original, artifacts: [artifact], delivery_artifact_ids: [artifact.artifact_id] };
  return { ...payload, proposal_digest: indexerProtocolDigest(payload) };
}

test("delivering page B of the same subject does not adopt already approved page A", () => {
  const full = readerLayoutProposal("shared-subject", { multiple: true });
  const first = slice(full, 0);
  const next = slice(full, 1);
  expect(first.node.node_ref).toBe(next.node.node_ref);
  const base = approvedBaseProjection({ proposal: next, structure: approvedReaderStructure([first]) });
  expect(base).toBeUndefined();
  const preparation = prepareIndexerReaderPaths({ proposals: [next], base_projections: base ? [base] : [],
    occupied_paths: [first.artifacts[0]!.output_path] });
  expect(preparation.conflicts).toEqual([]);
  const resolved = resolveIndexerReaderPaths({ preparation, paths: [] });
  expect(resolved.proposals[0]!.artifacts[0]!.output_path).toBe(next.artifacts[0]!.output_path);
  expect(resolved.proposals[0]!.artifacts[0]!.output_path).not.toBe(first.artifacts[0]!.output_path);
});

test("the same delivered page retains an approved renamed path through its stable identity", () => {
  const page = slice(readerLayoutProposal("shared-subject", { multiple: true }), 0);
  const structure = approvedReaderStructure([page]);
  structure.views[0]!.path = "codeindex/custom/accepted-page.md";
  const base = approvedBaseProjection({ proposal: page, structure });
  expect(base?.artifacts[0]?.output_path).toBe("knowledge/codeindex/custom/accepted-page.md");
  expect(base?.artifacts[0]?.artifact_ref).toBe(page.artifacts[0]!.artifact_ref);
});
