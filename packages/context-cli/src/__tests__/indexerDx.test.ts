import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { excludedIndexerSourcePath } from "../project/indexerScopeExclusions.js";
import { prepareActionCompletionOutput } from "../project/actionCompletionOutput.js";

const target = { source_ref: "repo:library", module_refs: ["library"] };
const requirement = { id: "guide", targets: [target], exclusions: [{ id: "obsolete", scope: { targets: [target] },
  reason: "User chose current APIs only", paths: ["src/retired/"] }] };

test("explicit path exclusions are exact and do not override another requirement", () => {
  const excluded = (path: string, requirements = [requirement]) => excludedIndexerSourcePath({
    requirements, source_ref: target.source_ref, module_ref: "library", path,
  });
  expect(excluded("src/retired/entry.ts")).toBe(true);
  expect(excluded("src/retired-copy/entry.ts")).toBe(false);
  expect(excluded("src/deprecated/entry.ts")).toBe(false);
  expect(excluded("src/retired/entry.ts", [requirement, { ...requirement, id: "migration", exclusions: [] }])).toBe(false);
});

test("small completion is compact by default and preserves the exact Route and verbose result", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-dx-"));
  try {
    const result = { protocol: "test", outcomes: [{ task_key: "task-001", outcome: "accepted", committed: true }],
      revision_after: "new", next: { revision: "new", node: "author", availability: "immediate",
        commands: [{ command: "context action complete-current --revision new --input -", effect: "write" }],
        action: { input: { material: "Full authority" } } } };
    const summary = await prepareActionCompletionOutput({ projectRoot: root, result, format: "json" }) as {
      committed_count: number; next_route: { file: string; digest: string }; result_file: string;
    };
    expect(summary.committed_count).toBe(1);
    expect(summary).toHaveProperty("details_required", false);
    expect(summary).not.toHaveProperty("next.action");
    const bytes = await readFile(summary.next_route.file, "utf8");
    expect(JSON.parse(bytes)).toEqual(result.next);
    expect(summary.next_route.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(JSON.parse(await readFile(summary.result_file, "utf8"))).toEqual(result);
    expect(await prepareActionCompletionOutput({ projectRoot: root, result, format: "json", verbose: true })).toEqual(result);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed, unknown and omitted completion outcomes require full diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-dx-"));
  try {
    for (const outcomes of [
      [{ task_key: "task-001", outcome: "failed", message: "diagnostic".repeat(1000) }],
      [{ task_key: "task-001", outcome: "unexpected" }],
      Array.from({ length: 240 }, (_, i) => ({ task_key: `task-${i}`, outcome: "accepted", committed: true })),
    ]) {
      const output = await prepareActionCompletionOutput({ projectRoot: root, format: "json", result: { outcomes } });
      expect(output).toHaveProperty("details_required", true);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
