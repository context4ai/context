import { describe, expect, test } from "bun:test";
import { mergeProcessedScopes, processedVersionForScope, processedScopeKey, readProcessedScopes } from "../processedScopes.js";

const scope = { requirement_ref: "manual", source_ref: "repo:sample/library",
  processed_version: "a".repeat(40) };

describe("processed source scopes", () => {
  test("advances only completed scopes and retains a conservative whole-source baseline", () => {
    const narrow = { ...scope, module_refs: ["module:a"], processed_version: "b".repeat(40) };
    const merged = mergeProcessedScopes([scope], [narrow]);
    expect(merged).toHaveLength(2);
    expect(processedVersionForScope(merged, scope)).toBe(scope.processed_version);
    expect(processedVersionForScope(merged, narrow)).toBe(narrow.processed_version);
    expect(processedVersionForScope(merged, { ...scope, module_refs: ["module:b"] })).toBe(scope.processed_version);
    const whole = { ...scope, processed_version: "c".repeat(40) };
    expect(mergeProcessedScopes(merged, [whole])).toEqual([whole]);
    expect(processedVersionForScope([whole], { ...scope, requirement_ref: "other" })).toBeUndefined();
  });

  test("does not guess chronology from overlapping scope versions", () => {
    const overlapping = [{ ...scope, module_refs: ["a", "b"] },
      { ...scope, module_refs: ["b", "c"], processed_version: "b".repeat(40) }];
    expect(processedVersionForScope(overlapping, { ...scope, module_refs: ["b"] })).toBeUndefined();
    expect(processedVersionForScope(overlapping, scope)).toBeUndefined();
  });
  test("legacy structures remain unknown rather than inheriting acquired versions", () => {
    expect(readProcessedScopes(null)).toEqual([]);
    expect(readProcessedScopes({ views: [], sources: [{ ...scope }] })).toEqual([]);
  });

  test("keeps independent requirements and module scopes distinct", () => {
    const records = [scope, { ...scope, requirement_ref: "operations" },
      { ...scope, module_refs: ["module:a"] }, { ...scope, module_refs: ["module:b"] }];
    expect(readProcessedScopes({ processed_scopes: records })).toEqual(records);
    expect(new Set(records.map(processedScopeKey)).size).toBe(4);
  });

  test("rejects conflicting duplicate ranges regardless of module ordering", () => {
    expect(() => readProcessedScopes({ processed_scopes: [
      { ...scope, module_refs: ["module:a", "module:b"] },
      { ...scope, module_refs: ["module:b", "module:a"], processed_version: "b".repeat(40) },
    ] })).toThrow("one latest version");
  });

  test.each([null, {}, [{ ...scope, module_refs: [] }],
    [{ ...scope, module_refs: ["module:a", "module:a"] }],
    [{ ...scope, processed_version: "" }], [{ ...scope, source_ref: " repo:sample/library" }],
    [{ ...scope, history: [] }], [{ ...scope, page_versions: {} }],
  ])("rejects invalid or unapproved metadata %j", (processed_scopes) => {
    expect(() => readProcessedScopes({ processed_scopes })).toThrow();
  });
});
