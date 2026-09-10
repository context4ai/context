import { expect, test } from "bun:test";
import { updateKnowledgeMap } from "@c4a/context";
import { assertKnowledgeMapCoverage } from "../project/knowledgeMapCoverage.js";
const article = { artifact_ref: "article:a", section_keys: ["entry"] };
const make = (target?: { artifact_ref: string; section_key?: string }) => updateKnowledgeMap(undefined, { expected_revision: null,
  upsert: [{ key: "category", parent: null, title: "Guide" }, ...(target ? [{ key: "page", parent: "category", title: "Start", target }] : [])] });
test("categories alone cannot approve articles and diagnostics contain recovery input", () => {
  try { assertKnowledgeMapCoverage(make(), [article]); throw new Error("expected rejection"); }
  catch (error) { expect(error).toMatchObject({ detail: { reason_code: "knowledge-map-incomplete", coverage: { total: 1, bound: 0 }, next_action: { command: "context task adjust --input - --format json" } } }); }
});
test("article and section links count once; invalid identities and sections fail", () => {
  expect(assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref }), [article]).bound).toBe(1);
  expect(assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref, section_key: "entry" }), [article]).bound).toBe(1);
  const rejection = (run: () => unknown) => { try { run(); } catch (error) { return error; } throw new Error("expected rejection"); };
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref, section_key: "typo" }), [article])))
    .toMatchObject({ detail: { invalid_targets: [{ reason: "unknown-section" }] } });
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: "missing" }), [], { known: [article] })))
    .toMatchObject({ detail: { invalid_targets: [{ reason: "unknown-article" }] } });
  expect(rejection(() => assertKnowledgeMapCoverage(make({ artifact_ref: article.artifact_ref }), [article], { require_update: true, has_update: false })))
    .toMatchObject({ detail: { reason_code: "knowledge-map-incomplete", coverage: { bound: 1, missing: [] } } });
});
