import { expect, test } from "bun:test";
import { gridNavigate } from "../components/DirectoryGrid";

test("gridNavigate left wraps at start", () => {
  expect(gridNavigate(0, "left", 8, 4)).toBe(7);
});

test("gridNavigate right wraps at end", () => {
  expect(gridNavigate(7, "right", 8, 4)).toBe(0);
});

test("gridNavigate left moves one position", () => {
  expect(gridNavigate(3, "left", 8, 4)).toBe(2);
});

test("gridNavigate right moves one position", () => {
  expect(gridNavigate(2, "right", 8, 4)).toBe(3);
});

test("gridNavigate up moves to previous row", () => {
  // index 5 is row 1, col 1 in a 4-column grid
  expect(gridNavigate(5, "up", 8, 4)).toBe(1);
});

test("gridNavigate down moves to next row", () => {
  // index 1 is row 0, col 1 -> should go to index 5
  expect(gridNavigate(1, "down", 8, 4)).toBe(5);
});

test("gridNavigate up from first row wraps to last row", () => {
  // index 1 (row 0, col 1), total 9, 4 cols -> 3 rows
  // last row starts at index 8, col 1 = index 9, but total is 9 so clamp to 8
  expect(gridNavigate(1, "up", 9, 4)).toBe(Math.min(8 + 1, 8));
});

test("gridNavigate up from first row wraps correctly", () => {
  // index 0 (row 0, col 0), total 8, 4 cols -> 2 rows
  // last row: row 1, col 0 = index 4
  expect(gridNavigate(0, "up", 8, 4)).toBe(4);
});

test("gridNavigate down past last row wraps to first row", () => {
  // index 5 (row 1, col 1), total 6, 4 cols -> 2 rows
  // target = 5 + 4 = 9 >= 6, wrap to col 1 = index 1
  expect(gridNavigate(5, "down", 6, 4)).toBe(1);
});

test("gridNavigate handles partial last row", () => {
  // 5 items, 4 cols: row 0 = [0,1,2,3], row 1 = [4]
  // from index 2 (row 0, col 2), down -> target = 6 >= 5, wrap to min(2, 4) = 2
  expect(gridNavigate(2, "down", 5, 4)).toBe(2);
});

test("gridNavigate handles single item", () => {
  expect(gridNavigate(0, "left", 1, 4)).toBe(0);
  expect(gridNavigate(0, "right", 1, 4)).toBe(0);
  expect(gridNavigate(0, "up", 1, 4)).toBe(0);
  expect(gridNavigate(0, "down", 1, 4)).toBe(0);
});

test("gridNavigate handles empty items", () => {
  expect(gridNavigate(0, "left", 0, 4)).toBe(0);
});
