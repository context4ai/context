import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import YAML from "yaml";
import { taskSourceAdjustmentSchema } from "../project/taskSourceAdjustment.js";

test("adjust exposes both input variants without a workspace or input file", () => {
  for (const format of ["json", "yaml"]) {
    const output = execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"),
      "task", "adjust", "--schema", "--format", format], {
      cwd: tmpdir(), encoding: "utf8", timeout: 20_000,
    });
    const schema = format === "json" ? JSON.parse(output) : YAML.parse(output);
    expect(schema.anyOf).toHaveLength(2);
    expect(schema.anyOf.some((entry: { properties: Record<string, unknown> }) => entry.properties.scopes)).toBe(true);
    expect(schema.anyOf.some((entry: { properties: Record<string, unknown> }) => entry.properties.knowledge_map)).toBe(true);
  }
  expect(taskSourceAdjustmentSchema.safeParse({ scopes: [{ source_ref: "note:sample" }], instruction: "Refresh material" }).success).toBe(true);
  expect(taskSourceAdjustmentSchema.safeParse({ scopes: [], instruction: "Refresh" }).success).toBe(false);
});
