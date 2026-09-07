import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertActionInputWorkspace } from "../project/actionInputWorkspace.js";
import { ContextError } from "../lib/errors.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  mkdirSync(".tmp", { recursive: true });
  const base = mkdtempSync(join(process.cwd(), ".tmp/input-workspace-"));
  roots.push(base);
  const parent = join(base, "project");
  const child = join(parent, "knowledge");
  for (const root of [parent, child]) {
    mkdirSync(join(root, ".tmp"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ context: { project: true, entry: "src/index.ts" } }));
    writeFileSync(join(root, ".tmp/result.json"), "{}");
  }
  return { base, parent, child };
}
test("rejects nested workspace payloads with explicit recovery before submission", () => {
  const { parent, child } = fixture();
  try {
    assertActionInputWorkspace(parent, "knowledge/.tmp/result.json");
    throw new Error("expected workspace mismatch");
  } catch (error) {
    expect(error).toBeInstanceOf(ContextError);
    expect((error as ContextError).detail).toMatchObject({
      category: "workflow-workspace-mismatch", project_root: parent,
      input_project_root: child, revision_advanced: false,
      next_action: { cwd: child, command: "context status --view summary --format json" },
    });
  }
  expect(() => assertActionInputWorkspace(child, join(parent, ".tmp/result.json"))).toThrow(ContextError);
});
test("accepts same workspace, unowned input and stdin; input reader handles missing files", () => {
  const { base, child } = fixture();
  const external = join(base, "result.json");
  writeFileSync(external, "{}");
  for (const path of [".tmp/result.json", external, "-", "missing.json"]) {
    expect(() => assertActionInputWorkspace(child, path)).not.toThrow();
  }
});
test("resolves symlinks without hiding a different workspace or rejecting the same root", () => {
  const { base, parent, child } = fixture();
  const alias = join(base, "alias");
  symlinkSync(child, alias);
  expect(() => assertActionInputWorkspace(alias, join(child, ".tmp/result.json"))).not.toThrow();
  symlinkSync(join(child, ".tmp/result.json"), join(parent, ".tmp/linked.json"));
  expect(() => assertActionInputWorkspace(parent, ".tmp/linked.json")).toThrow(ContextError);
});
