import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluateGraph, loadProvider, resolveRoute } from "@c4a/agent-graph";
import { clearCompletedLifecycle } from "../project/lifecycleCleanup.js";
import { INDEXER_RUNTIME_ROOT } from "../project/lifecyclePaths.js";

test("the packaged production route requires report resources and explicit user confirmation", async () => {
  const provider = await loadProvider(resolve(import.meta.dir, "../../dist/providers/context/manifest.json"));
  const evaluated = evaluateGraph(provider, "indexer", "production");
  const selected = evaluated.evaluation.primaryRoute!;
  const route = await resolveRoute(provider, "indexer", "production", selected.routeId,
    { workspace: "/isolated-report-workspace" }, evaluated.evaluation.revision);
  expect(route.node).toBe("confirm-production-report");
  expect(route.availability).toBe("requires-user");
  expect(route.gate?.delegatable).toBe(false);
  expect(route.gate?.resolutionAction?.action.id).toBe("approve-production-report");
  for (const [id, relative] of [
    ["procedure.work-start-report", "resources/procedures/work-start-report.md"],
    ["template.work-start-report", "resources/templates/work-start-report.md"],
  ]) {
    const resource = route.resources.required.find((item) => item.id === id)!;
    expect(resource.schema).toBe("agent-graph.resource-location.file.v1");
    if (resource.schema !== "agent-graph.resource-location.file.v1") throw new Error("expected file resource");
    expect(await readFile(resource.filePath, "utf8")).toBe(await readFile(
      resolve(import.meta.dir, "../../context-workflow", relative!), "utf8"));
  }
});

test("normal lifecycle cleanup preserves the reader report outside runtime state", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-work-start-"));
  try {
    await mkdir(join(root, INDEXER_RUNTIME_ROOT), { recursive: true });
    await writeFile(join(root, INDEXER_RUNTIME_ROOT, "temporary.json"), "{}");
    const report = join(root, ".tmp/work-start-report.md");
    const content = "# Work plan\n\nRelated requirement: ../src/indexers.yaml\n";
    await writeFile(report, content);
    await clearCompletedLifecycle(root);
    expect(await readFile(report, "utf8")).toBe(content);
    expect(await readFile(join(root, INDEXER_RUNTIME_ROOT, "temporary.json"), "utf8").catch((error: NodeJS.ErrnoException) => error.code)).toBe("ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
