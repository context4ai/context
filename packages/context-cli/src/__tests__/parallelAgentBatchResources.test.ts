import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateGraph, loadProvider, resolveRoute } from "@c4a/agent-graph";

const loadPackagedProvider = () => loadProvider(
  resolve(import.meta.dir, "../../dist/providers/context/manifest.json"),
);

const resources = [
  { id: "procedure.parallel-agent-batch", kind: "required",
    path: "resources/procedures/parallel-agent-batch.md" },
  { id: "template.indexer-agent-worker", kind: "recommended",
    path: "resources/templates/indexer-agent-worker.md" },
] as const;

test("both main Indexer entrypoints select the Host parallel execution resources", async () => {
  const provider = await loadPackagedProvider();
  const graph = [...provider.graphs.values()].find((item) => item.definition.id === "indexer")!;
  for (const nodeId of ["run-current-indexer-agent", "run-indexer-agent-step"]) {
    const node = graph.nodeById.get(nodeId)!;
    expect(node.kind).toBe("action");
    if (node.kind !== "action") throw new Error("expected Agent action node");
    for (const resource of resources) {
      expect(node.resources?.[resource.kind]).toContain(resource.path);
    }
  }
});

test("the packaged main Agent route delivers the procedure and worker template without changing its action contract", async () => {
  const provider = await loadPackagedProvider();
  const evaluated = evaluateGraph(provider, "indexer", "agent-step");
  const route = await resolveRoute(provider, "indexer", "agent-step",
    evaluated.evaluation.primaryRoute!.routeId, { workspace: "/isolated-parallel-workspace" },
    evaluated.evaluation.revision);
  expect(route.action?.id).toBe("run-indexer-agent-step");
  expect(route.action?.inputSchema).toBeDefined();
  expect(route.action?.outputSchema).toBeDefined();
  for (const expected of resources) {
    const resource = route.resources[expected.kind].find((item) => item.id === expected.id)!;
    expect(resource.schema).toBe("agent-graph.resource-location.file.v1");
    if (resource.schema !== "agent-graph.resource-location.file.v1") throw new Error("expected file resource");
    expect(await readFile(resource.filePath, "utf8")).toBe(await readFile(
      resolve(import.meta.dir, "../../context-workflow", expected.path), "utf8"));
  }
});

test("Composer does not opt in to Partition and Author worker orchestration", async () => {
  const provider = await loadPackagedProvider();
  const evaluated = evaluateGraph(provider, "indexer", "post-author-composer-step");
  const route = await resolveRoute(provider, "indexer", "post-author-composer-step",
    evaluated.evaluation.primaryRoute!.routeId, { workspace: "/isolated-parallel-workspace" },
    evaluated.evaluation.revision);
  const ids = [...route.resources.required, ...route.resources.recommended].map((item) => item.id);
  for (const resource of resources) expect(ids).not.toContain(resource.id);
});
