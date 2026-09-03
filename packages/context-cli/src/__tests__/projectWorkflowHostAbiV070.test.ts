import { describe, expect, test } from "bun:test";
import type { ResourceLocation } from "@c4a/agent-graph";
import {
  projectWorkflowResourceLocation,
  projectWorkflowRouteAction,
} from "../project/workflow/workflowProvider.js";
import type {
  ContextWorkflowHostActionResult,
  ContextWorkflowHostResourceLocation,
  ContextWorkflowRouteActionSource,
} from "../project/workflow/workflowTypes.js";

const HOST_LOCATION: ContextWorkflowHostResourceLocation = {
  schema: "agent-graph.resource-location.host-action.v1",
  id: "context.indexer.instructions",
  kind: "procedure",
  mediaType: "application/json",
  revision: "revision-1",
  materialize: {
    handler: "context.materialize-indexer-instructions/v1",
    input: {
      schema: "context.indexer.materialize-request/v1",
      value: {
        provider: "context.indexer.provider/v1",
        targets: ["source-a", "source-b"],
      },
    },
    output_schema: "context.indexer.materialized-resource/v1",
  },
};

describe("Context Agent Graph Host ABI bridge", () => {
  test("preserves a Host Action materialization envelope with its executable materialization command", () => {
    const projected = projectWorkflowResourceLocation(
      HOST_LOCATION,
      "workflow-revision",
      [],
    );

    expect(projected).toEqual({
      id: HOST_LOCATION.id,
      kind: HOST_LOCATION.kind,
      media_type: HOST_LOCATION.mediaType,
      revision: "revision-1",
      read_state: "read-required",
      command: "context resource materialize 'context.indexer.instructions' --revision 'workflow-revision' --format json",
      materialize: HOST_LOCATION.materialize,
    });
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test("projects a Graph Action resource as a Context materialization command", () => {
    const location: ResourceLocation = {
      schema: "agent-graph.resource-location.graph-action.v1",
      id: "context.source-current",
      kind: "context-view",
      mediaType: "text/markdown",
      materialize: { resourceId: "context.source-current" },
    };

    const projected = projectWorkflowResourceLocation(
      location,
      "workflow-revision",
      [],
    );

    expect(projected.command).toBe(
      "context resource materialize 'context.source-current' --revision 'workflow-revision' --format json",
    );
    expect(projected.materialize).toBeUndefined();
  });

  test("preserves Host handler and schemas on projected route actions", () => {
    const action: ContextWorkflowRouteActionSource = {
      id: "materialize-indexer-instructions",
      runner: "host",
      effect: "external",
      handler: "context.materialize-indexer-instructions/v1",
      input: {
        protocol: "context.indexer.agent-step-input/v1",
        input_digest: "sha256:input",
      },
      inputSchema: HOST_LOCATION,
      outputSchema: {
        ...HOST_LOCATION,
        id: "context.indexer.materialized-output",
      },
    };

    const projected = projectWorkflowRouteAction({
      action,
      revision: "workflow-revision",
      authorities: [],
    });

    expect(projected).toMatchObject({
      id: action.id,
      runner: "host",
      effect: "external",
      handler: action.handler,
      input: action.input,
      input_schema: { materialize: HOST_LOCATION.materialize },
      output_schema: { materialize: HOST_LOCATION.materialize },
    });
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test("keeps the minimal Host result envelope serializable for downstream execution", () => {
    const result: ContextWorkflowHostActionResult = {
      schema: "agent-graph.host-action-result.v1",
      handler: HOST_LOCATION.materialize.handler,
      input_digest: "sha256:input",
      output: {
        schema: HOST_LOCATION.materialize.output_schema,
        resource: {
          ref: "host-resource://context/indexer/instructions",
          digest: "sha256:output",
        },
      },
      receipt: {
        adapter: "codex",
        adapter_version: "1.0.0",
      },
    };

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
