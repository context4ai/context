import { expect, test } from "bun:test";
import { productionSourceSummary } from "../project/productionSourceSummary.js";

test("large pending inventory is not reported as equally many unavailable sources", () => {
  const scopes = Array.from({ length: 111 }, (_, i) => ({ scope: `source:${i}`, baseline: null }));
  const result = productionSourceSummary({ scopes, pending_scopes: scopes.map(s => s.scope), tasks: [],
    gaps: scopes.slice(0, 5).map(s => ({ scope: s.scope, reason: "Checkout missing" })) });
  expect(result.stage_source_count).toBe(111);
  expect(result.pending_scope_count).toBe(111);
  expect(result.unavailable_source_count).toBe(5);
  expect(result.pending_without_read_failure_count).toBe(106);
  expect(result.planned_article_count).toBe(0);
  expect(result.unavailable_sources).toHaveLength(5);
});

test("available sources and absent failures do not invent missing articles", () => {
  const result = productionSourceSummary({ scopes: [{ scope: "note:a", baseline: null }], pending_scopes: [], gaps: [], tasks: [] });
  expect(result.pending_scope_count).toBe(0);
  expect(result.unavailable_source_count).toBe(0);
  expect(result.planned_article_count).toBe(0);
  expect(result.unavailable_sources).toEqual([]);
});
