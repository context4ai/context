import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateGraph, loadProvider, resolveRoute } from "@c4a/agent-graph";

test("the current writing route makes directory worker guidance available without an extra gate", async () => {
  const provider = await loadProvider(resolve(import.meta.dir, "../../dist/providers/context/manifest.json"));
  const context = { workspace: "/isolated-workspace", facts: { production: {
    report_approved: true, prepared: true, writing_complete: false, complete: false,
  } } };
  const evaluated = evaluateGraph(provider, "indexer", "production", context);
  const route = await resolveRoute(provider, "indexer", "production",
    evaluated.evaluation.primaryRoute!.routeId, context, evaluated.evaluation.revision);
  expect(route.node).toBe("work-production-stage");
  expect(route.gate).toBeUndefined();
  for (const [id, path] of [["procedure.parallel-agent-batch", "resources/procedures/parallel-agent-batch.md"],
    ["template.indexer-agent-worker", "resources/templates/indexer-agent-worker.md"]]) {
    const resource = route.resources.recommended.find(item => item.id === id)!;
    expect(resource.schema).toBe("agent-graph.resource-location.file.v1");
    if (resource.schema !== "agent-graph.resource-location.file.v1") throw new Error("Expected file resource");
    expect(await readFile(resource.filePath, "utf8")).toBe(await readFile(resolve(import.meta.dir, "../../context-workflow", path!), "utf8"));
  }
});

test("retired Provider and per-member production entrypoints are not shipped", async () => {
  const provider = await loadProvider(resolve(import.meta.dir, "../../dist/providers/context/manifest.json"));
  const graph = [...provider.graphs.values()].find(item => item.definition.id === "indexer")!;
  for (const entry of ["provider-selection", "current-provider-resolution", "agent-step", "main-index", "current-lifecycle", "post-author-composer-step"]) {
    expect(graph.definition.entrypoints).not.toHaveProperty(entry);
  }
});
