import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import {
  validateIndexerCurrentActionInput,
} from "@c4a/context";
import { validateSchemaDocument } from "@c4a/agent-graph";
import { projectCurrentIndexerWorkflowRoute } from
  "../project/indexerCurrentWorkflowRoute.js";
import { contextWorkflowAuthorities } from
  "../project/workflow/workflowFacts.js";
import type { ContextResolvedWorkflowRoute } from
  "../project/workflow/workflowTypes.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

function outerIndexerAgentRoute(): ContextResolvedWorkflowRoute {
  return {
    protocol: "context.workflow.route.v1",
    id: "run-indexer-lifecycle",
    revision: `sha256:${"a".repeat(64)}`,
    node: "run-indexer-lifecycle",
    reason_code: "route.indexer.lifecycle-required",
    availability: "immediate",
    commands: [],
    resources: { required: [], recommended: [] },
    after_action: { evaluate: true },
  };
}

describe("current Indexer workflow Route contract", () => {
  test("keeps Gate feedback conditions equal in JSON Schema and runtime validation", async () => {
    const schema = JSON.parse(await readFile(
      join(
        import.meta.dir,
        "..",
        "..",
        "context-workflow",
        "schemas",
        "indexer-agent-step-result.schema.json",
      ),
      "utf8",
    )) as object;
    const accepted = [
      { stage: "structure-review", decision: "approved", knowledge_map: { expected_revision: null, upsert: [], remove: [] } },
      {
        stage: "structure-review",
        decision: "request-adjustment",
        feedback: "Merge duplicate subjects.",
      },
    ];
    for (const value of accepted) {
      expect(() => validateSchemaDocument(schema, value, "Gate Result")).not.toThrow();
      expect(() => validateIndexerCurrentActionInput(value)).not.toThrow();
    }
    const rejected = [
      { stage: "structure-review", decision: "request-adjustment" },
    ];
    for (const value of rejected) {
      expect(() => validateSchemaDocument(schema, value, "Gate Result")).toThrow();
      expect(() => validateIndexerCurrentActionInput(value)).toThrow();
    }
    const retiredAgentFinalization = { stage: "provider-finalization" };
    expect(() => validateSchemaDocument(
      schema,
      retiredAgentFinalization,
      "Provider finalization Result",
    )).toThrow();
    expect(() => validateIndexerCurrentActionInput(retiredAgentFinalization)).toThrow();
  });

  test("current requirements expose source selection and the known-task schema before preparation", async () => {
    const parent = resolve(".tmp/production-route-tests");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "case-")); roots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    const configuration = YAML.stringify({ requirements: [{ id: "documentation", purpose: "Explain documentation",
      target_scope: { targets: [{ source_ref: "file:fixture/docs" }] } }] });
    const path = join(root, "src/indexers.yaml");
    await writeFile(path, configuration);
    const route = await projectCurrentIndexerWorkflowRoute({ projectRoot: root,
      route: outerIndexerAgentRoute(), authorities: contextWorkflowAuthorities({ managed: true }), managed: true });
    expect(route).toMatchObject({ node: "prepare-production-planning", availability: "immediate",
      commands: [{ command: expect.stringContaining("action prepare-current"), effect: "write", managed_execution: "agent-required" }] });
    expect(route?.resources.recommended).toContainEqual(expect.objectContaining({
      command: "context action prepare-current --schema --format json", media_type: "application/schema+json",
    }));
    expect(route?.action).toBeUndefined();
    expect(route?.gate).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe(configuration);
  });
});
