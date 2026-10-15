import { describe, expect, test } from "bun:test";
import {
  articleSourceRegionDigest, createArticleSourceReference,
  relocateUnchangedArticleRegion, validateArticleStructureEntries,
} from "../articleStructure.js";

const locator = { path: "src/login.ts", start_line: 2, end_line: 3 };
const source = "header\nlogin\nreturn result\nfooter";
const reference = () => createArticleSourceReference("repo:app", locator, source);
const article = () => ({ article_id: "article:login", path: "faq/login.md",
  collection: "faq" as const, visibility: "public", sections: [{ id: "login", references: [reference()] }] });

describe("article structure", () => {
  test("keeps identities, classification and actual references without a fact ledger", () => {
    expect(validateArticleStructureEntries([article()])).toEqual([article()]);
    expect(() => validateArticleStructureEntries([{ ...article(), facts: [] }])).toThrow();
    expect(() => validateArticleStructureEntries([{ ...article(), node_ref: "node:login" }])).toThrow();
    expect(() => validateArticleStructureEntries([{ ...article(), summary: "duplicate" }])).toThrow();
  });

  test("the limit is per fragment, not per article", () => {
    const section = article().sections[0]!;
    expect(validateArticleStructureEntries([{ ...article(), sections: [
      { ...section, references: [reference(), reference(), reference()] },
      { ...section, id: "next", references: [reference(), reference(), reference()] },
    ] }])[0]!.sections).toHaveLength(2);
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
    const at = (path: string, line: number) => createArticleSourceReference("repo:app", { path, start_line: line, end_line: line }, lines);
    const regions = (count: number) => Array.from({ length: count }, (_, index) => at("src/login.ts", index + 1));
    expect(validateArticleStructureEntries([{ ...article(), sections: [
      { ...section, references: regions(8) },
    ] }])[0]!.sections[0]!.references).toHaveLength(8);
    expect(() => validateArticleStructureEntries([{ ...article(), sections: [
      { ...section, references: regions(9) },
    ] }])).toThrow("at most 8 source regions");
    expect(validateArticleStructureEntries([{ ...article(), sections: [
      { ...section, references: ["a.ts", "a.ts", "b.md", "c.md"].map((path, index) => at(path, index + 1)) },
    ] }])[0]!.sections[0]!.references).toHaveLength(4);
    expect(() => validateArticleStructureEntries([{ ...article(), sections: [
      { ...section, references: ["a.ts", "b.md", "c.md", "d.md"].map(path => at(path, 1)) },
    ] }])).toThrow("at most 3 distinct source files");
  });

  test("rejects duplicate identities or paths instead of overwriting", () => {
    expect(() => validateArticleStructureEntries([article(), article()])).toThrow();
    expect(() => validateArticleStructureEntries([article(), { ...article(), article_id: "other" }])).toThrow();
    expect(() => validateArticleStructureEntries([{ ...article(), sections: [
      ...article().sections, ...article().sections,
    ] }])).toThrow();
  });

  test("does not invent a new visibility taxonomy", () => {
    expect(validateArticleStructureEntries([{ ...article(), visibility: "exported" }])[0]!.visibility).toBe("exported");
  });
});

describe("source regions", () => {
  test("hashes only the selected region with a consistent newline convention", () => {
    expect(articleSourceRegionDigest(source, locator)).toBe(articleSourceRegionDigest(source.replace(/\n/g, "\r\n"), locator));
    expect(articleSourceRegionDigest(source, locator)).toBe(articleSourceRegionDigest(source.replace("footer", "new footer"), locator));
    expect(articleSourceRegionDigest(source, locator)).not.toBe(articleSourceRegionDigest(source.replace("login", "logout"), locator));
  });

  test("rejects invalid regions and traversal paths", () => {
    for (const invalid of [
      { ...locator, start_line: 0 }, { ...locator, end_line: 1 },
      { ...locator, end_line: 99 }, { ...locator, path: "../private.txt" },
    ]) expect(() => createArticleSourceReference("repo:app", invalid, source)).toThrow();
  });

  test("relocates a unique unchanged region after preceding lines are inserted", () => {
    expect(relocateUnchangedArticleRegion(source, `inserted\n${source}`, locator)).toEqual({
      ...locator, start_line: 3, end_line: 4,
    });
  });

  test("does not call changed, removed or ambiguous regions current", () => {
    expect(relocateUnchangedArticleRegion(source, source.replace("login", "logout"), locator)).toBeNull();
    expect(relocateUnchangedArticleRegion(source, "header\nfooter", locator)).toBeNull();
    expect(relocateUnchangedArticleRegion(source, `${source}\nlogin\nreturn result`, locator)).toBeNull();
  });

  test("unchanged source preserves the original region even when text repeats", () => {
    const repeated = `${source}\nlogin\nreturn result`;
    expect(relocateUnchangedArticleRegion(repeated, repeated, locator)).toEqual(locator);
  });
});
