import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  type IndexerRegistry,
  validateIndexerCurrentActionInput,
} from "@c4a/context";
import { validateSchemaDocument } from "@c4a/agent-graph";
import { listCliBundledIndexers } from "../project/indexerCliBundledProvider.js";
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
      { stage: "structure-review", decision: "approved" },
      {
        stage: "structure-review",
        decision: "request-adjustment",
        feedback: "Merge duplicate subjects.",
      },
      { stage: "layout-confirmation", decision: "approved" },
      {
        stage: "layout-confirmation",
        decision: "rejected",
        feedback: "Preserve the existing public path.",
      },
    ];
    for (const value of accepted) {
      expect(() => validateSchemaDocument(schema, value, "Gate Result")).not.toThrow();
      expect(() => validateIndexerCurrentActionInput(value)).not.toThrow();
    }
    const rejected = [
      { stage: "structure-review", decision: "request-adjustment" },
      { stage: "layout-confirmation", decision: "rejected" },
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

  test("projects deterministic lifecycle advance without an Agent output contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-route-contract-"));
    roots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    const provider = (await listCliBundledIndexers()).bundles.find((candidate) =>
      candidate.skill === "context-markdown-indexer"
    );
    if (provider === undefined) throw new Error("missing bundled Markdown Indexer");
    const registry: IndexerRegistry = {
      protocol: "context.indexer.registry/v1",
      requirements: [{
        id: "documentation-knowledge",
        reader_goals: ["understand-documentation"],
        coverage_domains: { "business-semantics": "required" },
        target_scope: {
          targets: [{ source_ref: "file:fixture/docs", module_refs: [] }],
        },
        evidence_source_scope: {
          targets: [{ source_ref: "file:fixture/docs", module_refs: [] }],
        },
      }],
      indexers: [{
        id: "workspace-markdown",
        operations: ["main-index"],
        requirement_bindings: [{
          requirement_ref: "documentation-knowledge",
          coverage_domains: ["business-semantics"],
          owned_scope: { ref: "requirement:documentation-knowledge#target_scope" },
          role: "primary",
        }],
        read_scope: {
          refs: ["requirement:documentation-knowledge#evidence_source_scope"],
        },
        profile: {
          primary: { id: "documentation-site", provider: "community" },
        },
        providers: [{
          id: "community",
          role: "primary",
          skill: provider.skill,
          version: provider.version,
          integrity: provider.integrity,
          distribution: provider.distribution,
        }],
      }],
    };
    await writeFile(
      join(root, "src", "indexers.yaml"),
      YAML.stringify(registry),
      "utf8",
    );

    const route = await projectCurrentIndexerWorkflowRoute({
      projectRoot: root,
      route: outerIndexerAgentRoute(),
      authorities: contextWorkflowAuthorities({ managed: true }),
      managed: true,
    });

    expect(route).toMatchObject({
      node: "advance-current-indexer-lifecycle",
      availability: "immediate",
      resources: { required: [], recommended: [] },
      commands: [{
        command: expect.stringContaining(" run --managed --format json"),
        effect: "write",
        managed_execution: "automatic",
      }],
    });
    expect(route?.action).toBeUndefined();
    expect(route?.gate).toBeUndefined();
  });
});
