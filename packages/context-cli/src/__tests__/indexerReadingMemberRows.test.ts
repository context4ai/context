import { expect, test } from "bun:test";
import { compactReadingMembers, readingJson } from "../project/indexerReadingMemberRows.js";

test("member reading layout preserves defaults, extensions, absent fields and ordering without mutation", () => {
  const members = Array.from({ length: 12 }, (_, index) => ({
    name: `field${index}`, file: "src/public/types.ts", kind: "property", visibility: "exported",
    optional: true, readonly: false, type: "string | boolean", line: index + 10,
    ...(index < 6 ? { default: index % 2 ? false : "", extension: { origin: "implementation" } } : {}),
  }));
  const input = { name: "Options", members, custom: { retain: true } };
  const before = structuredClone(input);
  const projected = compactReadingMembers(input) as { members: { groups: { common: object; columns: string[]; rows: unknown[][] }[] } };
  const restored = projected.members.groups.flatMap(group => group.rows.map(row => ({ ...group.common,
    ...Object.fromEntries(group.columns.map((key, index) => [key, row[index]])),
  })));
  expect(restored).toEqual(members);
  expect(input).toEqual(before);
  expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(input).length);
  expect(projected).toMatchObject({ custom: { retain: true } });
});

test("small, malformed or already compact member records remain unchanged", () => {
  for (const value of [null, { members: [] }, { members: [{ name: "x" }] }, { members: [{ name: "x" }, null] },
    { members: [{ x: 1 }, { y: 2 }] }, { members: { groups: [] } }]) {
    expect(compactReadingMembers(value)).toBe(value);
  }
});

 test("compact JSON keeps escapes, nested records and scalar row values round-trippable", () => {
  const value = { rows: [[false, null, 0, "line\nquote\"", "```"], [1, { a: ["nested"] }]], empty: [], absent: undefined };
  expect(JSON.parse(readingJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
 });
