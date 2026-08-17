import { expect, test } from "bun:test";
import { displayWidth, padToWidth, truncateToWidth } from "../utils/displayWidth";

test("displayWidth returns correct width for ASCII strings", () => {
  expect(displayWidth("hello")).toBe(5);
  expect(displayWidth("")).toBe(0);
  expect(displayWidth("a")).toBe(1);
});

test("displayWidth returns correct width for CJK characters", () => {
  expect(displayWidth("中文")).toBe(4);
  expect(displayWidth("日本語")).toBe(6);
});

test("displayWidth handles mixed ASCII and CJK", () => {
  expect(displayWidth("hello中文")).toBe(9); // 5 + 4
  // s(1) + r(1) + c(1) + /(1) + 组(2) + 件(2) = 8
  expect(displayWidth("src/组件")).toBe(8);
});

test("padToWidth pads ASCII string", () => {
  expect(padToWidth("abc", 6)).toBe("abc   ");
  expect(padToWidth("abc", 3)).toBe("abc");
  expect(padToWidth("abc", 2)).toBe("abc");
});

test("padToWidth pads CJK string correctly", () => {
  // "中文" has displayWidth 4, so pad to 6 means 2 spaces
  expect(padToWidth("中文", 6)).toBe("中文  ");
});

test("truncateToWidth returns short string unchanged", () => {
  expect(truncateToWidth("abc", 10)).toBe("abc");
  expect(truncateToWidth("src", 3)).toBe("src");
});

test("truncateToWidth truncates long ASCII string with ellipsis", () => {
  // "node_modules" is 12 chars, truncate to 10: 9 chars + "…"
  const result = truncateToWidth("node_modules", 10);
  expect(displayWidth(result)).toBeLessThanOrEqual(10);
  expect(result.endsWith("…")).toBe(true);
});

test("truncateToWidth truncates CJK correctly", () => {
  // "组件目录名" has displayWidth 10, truncate to 8
  const result = truncateToWidth("组件目录名", 8);
  expect(displayWidth(result)).toBeLessThanOrEqual(8);
  expect(result.endsWith("…")).toBe(true);
});

test("truncateToWidth handles zero and negative width", () => {
  expect(truncateToWidth("abc", 0)).toBe("");
  expect(truncateToWidth("abc", -1)).toBe("");
});
