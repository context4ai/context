import { expect, test } from "bun:test";
import { mapParserWork } from "../project/parserConcurrency.js";

test("bounds active parser work and preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const values = await mapParserWork([3, 1, 2, 0], 2, async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, value));
    active--;
    return value * 2;
  });
  expect(peak).toBe(2);
  expect(active).toBe(0);
  expect(values).toEqual([6, 2, 4, 0]);
});

test("failure drains active work and does not start queued work", async () => {
  const started: number[] = [];
  let drained = false;
  const error = new Error("parser failed");
  await expect(mapParserWork([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw error;
    await new Promise(resolve => setTimeout(resolve, 5));
    drained = true;
  })).rejects.toBe(error);
  expect(started).toEqual([0, 1]);
  expect(drained).toBe(true);
});
