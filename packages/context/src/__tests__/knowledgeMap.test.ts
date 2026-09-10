import { expect, test } from "bun:test";
import { projectKnowledgeMap, knowledgeMapTargetKey, updateKnowledgeMap, validateKnowledgeMap } from "../knowledgeMap.js";

function structure() {
  return updateKnowledgeMap(undefined, { expected_revision: null, upsert: [
    { key: "business", parent: null, title: "Business" },
    { key: "entry", parent: "business", title: "Entry", target: { artifact_ref: "artifact:entry" } },
    { key: "details", parent: "business", title: "Details", target: { artifact_ref: "artifact:entry", section_key: "entry--details" } },
    { key: "later", parent: null, title: "Later", target: { artifact_ref: "artifact:later" } },
  ] });
}

test("reading edits preserve other waves and stable targets while changing grouping", () => {
  const previous = structure();
  const next = updateKnowledgeMap(previous, { expected_revision: previous.revision,
    upsert: [{ key: "business", parent: null, title: "Product scenarios", order: 2 }] });
  expect(next.entries.find(entry => entry.key === "entry")).toEqual(previous.entries.find(entry => entry.key === "entry"));
  expect(next.revision).not.toBe(previous.revision);
  expect(validateKnowledgeMap(next)).toEqual(next);
  expect(() => updateKnowledgeMap(next, { expected_revision: previous.revision, remove: ["entry"] })).toThrow("reread");
});

test("two channels resolve the same directory independently and omit pending targets", () => {
  const shared = structure();
  const snapshot = JSON.stringify(shared);
  const section = knowledgeMapTargetKey({ artifact_ref: "artifact:entry", section_key: "entry--details" });
  const kb = projectKnowledgeMap(shared, new Map([["artifact:entry", "./wikis/codeindex/entry.md"], [section, "./wikis/codeindex/entry.md#section-entry--details"]]));
  const website = projectKnowledgeMap(shared, new Map([["artifact:entry", "/business/start"], ["artifact:later", "/business/later"]]));
  expect(kb.entries[0]?.children.map(entry => entry.href)).toEqual(["./wikis/codeindex/entry.md#section-entry--details", "./wikis/codeindex/entry.md"]);
  expect(kb.warnings.map(entry => entry.target)).toEqual(["artifact:later"]);
  expect(website.entries.some(entry => entry.href === "/business/later")).toBe(true);
  expect(website.warnings.map(entry => entry.target)).toEqual([section]);
  expect(JSON.stringify(shared)).toBe(snapshot);
});

test("invalid parent references, cycles, duplicate identities and content tampering are structural errors", () => {
  const current = structure();
  expect(() => updateKnowledgeMap(current, { expected_revision: current.revision, remove: ["business"] })).toThrow("unknown parent");
  expect(() => updateKnowledgeMap(current, { expected_revision: current.revision,
    upsert: [{ key: "business", parent: "entry", title: "Cycle" }] })).toThrow("cycle");
  expect(() => updateKnowledgeMap(undefined, { expected_revision: null,
    upsert: [{ key: "x", parent: null, title: "One" }, { key: "x", parent: null, title: "Two" }] })).toThrow("identities");
  expect(() => validateKnowledgeMap({ ...current, revision: "stale" })).toThrow("revision");
});
