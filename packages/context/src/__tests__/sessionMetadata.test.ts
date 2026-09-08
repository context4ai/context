import { expect, test } from "bun:test";
import { readSessionChanges, writeSessionChanges, sessionChangesSchema } from "../sessionMetadata.js";

test("session associations are optional and do not interpret summary prose", () => {
  const markdown = "# Decision\n\nDiscussed commit abc and an MR, with no known reference.\n";
  expect(readSessionChanges(markdown)).toBeUndefined();
  expect(writeSessionChanges(markdown)).toBe(markdown);
  const changes = [{ repository: "team/project", commit: "a".repeat(40), mr: "https://git.example.org/team/project/pull/42" }];
  const stored = writeSessionChanges(markdown, changes);
  expect(readSessionChanges(stored)).toEqual(changes);
  expect(writeSessionChanges(stored, changes)).toBe(stored);
  expect(writeSessionChanges(stored, [])).toBe(markdown);
  expect(sessionChangesSchema.parse([{ commit: "B".repeat(64) }])).toHaveLength(1);
});

test("source metadata updates preserve unrelated metadata and exact summary body", () => {
  const body = "\n# Summary\n\n  quoted spacing\n";
  const markdown = `---\ntitle: Actual source\nchanges:\n  - mr: https://git.example.org/old\n---\n${body}`;
  const stored = writeSessionChanges(markdown, [{ mr: "https://git.example.org/new" }]);
  expect(stored).toContain("title: Actual source");
  expect(stored.endsWith(body)).toBe(true);
  const cleared = writeSessionChanges(stored, []);
  expect(readSessionChanges(cleared)).toBeUndefined();
  expect(cleared).toContain("title: Actual source");
  expect(cleared.endsWith(body)).toBe(true);
});

test("invalid associations and ambiguous frontmatter fail without fabricated normalization", () => {
  for (const changes of [[{}], [{ repository: "repo" }], [{ commit: "abc" }], [{ sha: "a".repeat(40) }], [{ mr: "file:///tmp/mr" }]]) {
    expect(() => sessionChangesSchema.parse(changes)).toThrow();
  }
  expect(() => readSessionChanges("---\nchanges: []\nchanges: []\n---\nBody")).toThrow("frontmatter");
  expect(() => readSessionChanges("---\nchanges: wrong\n---\nBody")).toThrow();
});
