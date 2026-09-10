import { expect, test } from "bun:test";
import { indexerArticlePlanSchema, validateIndexerArticlePlan, validateIndexerPlannedArticles } from "../indexerArticlePlan.js";
import type { IndexerArtifactResult } from "../indexerArtifactResult.js";

const article = indexerArticlePlanSchema.parse({ key: "entry", title: "Entry", reader_task: "Locate the exported capability",
  artifact_intent: "authoritative-source/usage-guide/integrate-capability/content", required: true,
  sections: [{ key: "usage", heading: "Usage", required: true }] });
function result(): IndexerArtifactResult {
  // This validator uses only the artifact projection; digest/provenance and
  // evidence safety are exercised by the full run acceptance integration.
  return { source_role: "authoritative-source", artifacts: [{ artifact_id: "entry", artifact_kind: "content",
    artifact_policy_variant: "standard", representation: "sections", sections: [{ section_key: "entry--usage",
      owner_indexer_id: "fixture", document_kind: "usage-guide", reader_goal: "integrate-capability", artifact_kind: "content",
      blocks: [{ block_id: "usage", layer: "semantic-prose", markdown: "Use the public entry", evidence_refs: ["source:entry"] }] }] }] } as IndexerArtifactResult;
}

test("article plans keep unique identities and explicit question responsibility", () => {
  expect(() => validateIndexerArticlePlan([article])).not.toThrow();
  expect(() => validateIndexerArticlePlan([article, article])).toThrow("duplicate article");
  expect(() => validateIndexerArticlePlan([{ ...article, question_targets: ["target:one"] }], ["target:one"])).not.toThrow();
  expect(() => validateIndexerArticlePlan([article], ["target:one"])).toThrow("primary article");
});

test("writing outline drift is advisory while required article completion remains structural", () => {
  const actual = result();
  expect(validateIndexerPlannedArticles(actual, [article])).toEqual([]);
  const first = actual.artifacts[0]!;
  if (first.representation !== "sections") throw new Error("expected sections");
  first.sections[0]!.section_key = "entry--examples";
  expect(validateIndexerPlannedArticles(actual, [article]).map(warning => warning.code)).toEqual(["article-outline-drift", "article-outline-gap"]);
  actual.artifacts = [];
  expect(() => validateIndexerPlannedArticles(actual, [article])).toThrow("missing required article");
});

test("optional articles may be absent but an unrelated artifact cannot satisfy a required entry", () => {
  expect(validateIndexerPlannedArticles(result(), [article, { ...article, key: "examples", required: false }])).toEqual([]);
  const actual = result(); actual.artifacts[0]!.artifact_id = "unplanned";
  expect(() => validateIndexerPlannedArticles(actual, [article])).toThrow("unplanned article");
});
