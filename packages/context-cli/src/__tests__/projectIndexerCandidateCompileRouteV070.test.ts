import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import { buildProjectIndexerCandidateCompileFromRecords } from "../project/indexerCandidateCompileActions.js";

const PACKAGE_ROOT = join(import.meta.dir, "../..");
const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("Indexer Candidate compile Route", () => {
  test("publishes one explicit Result-bound compile entrypoint", async () => {
    const provider = await loadContextWorkflowProvider();
    const graph = provider.graphs.get("indexer")?.definition;
    expect(graph?.entrypoints["candidate-compile"]).toBe("compile-indexer-candidates");
    expect(graph?.nodes.some((node) => node.id === "compile-indexer-candidates"))
      .toBe(true);
    expect(graph?.nodes.some((node) => node.id === "indexer-candidates-compiled"))
      .toBe(true);
    const [actionRaw, schemaRaw] = await Promise.all([
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/actions/compile-indexer-candidates.yaml",
      ), "utf8"),
      readFile(join(
        PACKAGE_ROOT,
        "context-workflow/schemas/indexer-candidate-compile-input.schema.json",
      ), "utf8"),
    ]);
    const action = YAML.parse(actionRaw) as Record<string, unknown>;
    const schema = JSON.parse(schemaRaw) as { required?: string[] };
    expect(action).toMatchObject({
      runner: "command",
      effect: "write",
      command: expect.stringContaining("compile-indexer-candidates"),
    });
    expect(schema.required).toContain("accepted_result_refs");
    expect(schema.required).toContain("layout_transition");
  });

  test("rejects a caller-supplied Result ref that is absent from the accepted store", () => {
    expect(() => buildProjectIndexerCandidateCompileFromRecords({
      value: {
        protocol: "context.indexer.candidate-compile-input/v1",
        accepted_result_refs: [{
          workset_digest: digest("1"),
          execution_request_digest: digest("2"),
          acceptance_digest: digest("3"),
          artifact_result_digest: digest("4"),
        }],
        layout_proposal_set: {},
        layout_transition: {},
        layout_change_confirmations: [],
        rendered_artifacts: [],
      },
      records: [],
      operator_contract: {},
      profile_contract: {},
    })).toThrow(/exact current accepted Result set/);
  });

});
