import { expect, test } from "bun:test";
import { impactedIndexerKnowledgeArticles, indexerKnowledgeDependencyFingerprint,
  validateIndexerKnowledgeDependencyGraph } from "../indexerKnowledgeDependency.js";

const dependency = (artifact_ref: string) => ({ artifact_ref, section_refs: [], required: true });
const graph = [
  { artifact_ref: "artifact:journey", dependencies: [dependency("artifact:application"), dependency("artifact:service")] },
  { artifact_ref: "artifact:overview", dependencies: [dependency("artifact:journey")] },
];

test("supporting references can wait for future approved articles, but cannot form cycles or duplicate primary identities", () => {
  expect(() => validateIndexerKnowledgeDependencyGraph(graph)).not.toThrow();
  expect(() => validateIndexerKnowledgeDependencyGraph([...graph,
    { artifact_ref: "artifact:service", dependencies: [dependency("artifact:overview")] },
  ])).toThrow("cycle");
  expect(() => validateIndexerKnowledgeDependencyGraph([graph[0]!, graph[0]!])).toThrow("duplicate responsibility");
  expect(() => validateIndexerKnowledgeDependencyGraph([{ artifact_ref: "artifact:self", dependencies: [dependency("artifact:self")] }])).toThrow("cycle");
});

test("correcting or removing a supporting article invalidates every transitive reader", () => {
  expect(impactedIndexerKnowledgeArticles(graph, new Set(["artifact:service"]))).toEqual(["artifact:journey", "artifact:overview"]);
  expect(impactedIndexerKnowledgeArticles(graph, new Set(["artifact:unrelated"]))).toEqual([]);
});

test("dependency versions are order independent and change with approval or projection", () => {
  const a = { artifact_ref: "artifact:a", approved_content_digest: `sha256:${"1".repeat(64)}`, projection_digest: `sha256:${"2".repeat(64)}` };
  const b = { ...a, artifact_ref: "artifact:b" };
  expect(indexerKnowledgeDependencyFingerprint([a, b])).toBe(indexerKnowledgeDependencyFingerprint([b, a]));
  expect(indexerKnowledgeDependencyFingerprint([a])).not.toBe(indexerKnowledgeDependencyFingerprint([{ ...a, approved_content_digest: b.projection_digest }]));
});
