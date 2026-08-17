import { describe, expect, test } from "bun:test";

import { buildSearchPrefix, stripSearchPrefix } from "../utils/factContent.js";

describe("buildSearchPrefix", () => {
  test("returns empty when no keywords", () => {
    expect(buildSearchPrefix(undefined)).toBe("");
    expect(buildSearchPrefix(null)).toBe("");
    expect(buildSearchPrefix([])).toBe("");
  });

  test("single keyword", () => {
    expect(buildSearchPrefix(["DemoButton"])).toBe("[c4a:search DemoButton]\n\n");
  });

  test("multiple keywords joined with space", () => {
    expect(buildSearchPrefix(["DemoButton", "@example-scope/demo-react-web"]))
      .toBe("[c4a:search DemoButton @example-scope/demo-react-web]\n\n");
  });

  test("trims and drops empty entries", () => {
    expect(buildSearchPrefix(["  DemoButton  ", "", "  ", "@pkg"]))
      .toBe("[c4a:search DemoButton @pkg]\n\n");
  });

  test("all-empty keywords returns empty string", () => {
    expect(buildSearchPrefix(["", "  "])).toBe("");
  });

  test("caller decides prefix conventions — no @ normalization", () => {
    // Fact 是通用实体，caller 想怎么写就怎么写，buildSearchPrefix 不干预
    expect(buildSearchPrefix(["plain-package"])).toBe("[c4a:search plain-package]\n\n");
    expect(buildSearchPrefix(["@scoped/package"])).toBe("[c4a:search @scoped/package]\n\n");
  });
});

describe("stripSearchPrefix", () => {
  test("strips known prefix", () => {
    const content = "[c4a:search DemoButton @example-scope/demo-react-web]\n\nReal content here";
    expect(stripSearchPrefix(content)).toBe("Real content here");
  });

  test("leaves unknown content untouched", () => {
    const content = "Real content here";
    expect(stripSearchPrefix(content)).toBe(content);
  });

  test("does not strip bracket text that is not search prefix", () => {
    const content = "[note] something\n\nmore";
    expect(stripSearchPrefix(content)).toBe(content);
  });

  test("requires double newline separator", () => {
    const content = "[c4a:search DemoButton]\nsingle newline";
    expect(stripSearchPrefix(content)).toBe(content);
  });

  test("handles null/undefined/empty", () => {
    expect(stripSearchPrefix(null)).toBe("");
    expect(stripSearchPrefix(undefined)).toBe("");
    expect(stripSearchPrefix("")).toBe("");
  });

  test("round-trip: build + strip recovers original", () => {
    const original = "Some body text\nwith line breaks";
    const prefixed = buildSearchPrefix(["DemoButton", "@pkg"]) + original;
    expect(stripSearchPrefix(prefixed)).toBe(original);
  });
});
