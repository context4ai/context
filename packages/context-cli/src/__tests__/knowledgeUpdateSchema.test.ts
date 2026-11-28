import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import YAML from "yaml";

const cli = (...args: string[]) => execFileSync(process.execPath, [resolve(import.meta.dir, "../cli.ts"), "update", ...args], {
  cwd: tmpdir(), encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });

test("update shows its input schema without a workspace or input file", () => {
  for (const format of ["json", "yaml"]) {
    const output = cli("--schema", "--format", format);
    const schema = format === "json" ? JSON.parse(output) : YAML.parse(output);
    expect(schema.required).toContain("scopes");
    expect(Object.keys(schema.properties.scopes.items.properties)).toEqual(expect.arrayContaining(["requirement_ref", "source_ref"]));
  }
  expect(() => cli("--schema", "--format", "table")).toThrow();
});

test("update without input names the schema command", () => {
  const error = (() => { try { cli(); return undefined; } catch (value) { return value as { stdout?: string; stderr?: string }; } })();
  expect(`${error?.stdout ?? ""}${error?.stderr ?? ""}`).toContain("context update --schema --format json");
});
