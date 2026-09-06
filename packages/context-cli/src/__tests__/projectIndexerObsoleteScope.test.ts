import { describe, expect, test } from "bun:test";
import { evaluateGraph, resolveRoute } from "@c4a/agent-graph";
import { indexerEvidenceAdapterFileRef, validateIndexerCurrentActionInput } from "@c4a/context";
import { summarizeIndexerObsoleteScope } from "../project/indexerObsoleteScope.js";
import { loadContextWorkflowProvider } from "../project/workflow/workflowProvider.js";
import { contextWorkflowAuthorities } from "../project/workflow/workflowFacts.js";
import { qualifyIndexerPartitionEntrySubject } from "../project/indexerPartitionEntrySubject.js";
import type { IndexerAuthorizedWorksetView } from "@c4a/context";

function spec(paths: string[], supporting: string[] = []) {
  return { request: { workset: { source_ref: "repo:sample" } }, validation: {
    expected_subject_key: { local_key: paths[0] },
    canonical_inventory_members: paths.map((path) => ({ member_id: `symbol:${path}` })),
    source_identity_inventory: { source_ref: "repo:sample", module_ref: null,
      files: [...paths, ...supporting].map((path) => ({ normalized_path: path, facts: [{ fact_ref: `symbol:${path}` }] })) },
  } };
}
describe("obsolete scope confirmation", () => {
  test("explicit declaration deprecation does not classify its current siblings", () => {
    const summary = summarizeIndexerObsoleteScope([spec(["src/old.ts", "src/current.ts"])], {
      deprecated_member_ids: new Set(["symbol:src/old.ts"]),
    });
    expect(summary).toMatchObject({ affected_page_count: 1, affected_file_count: 1, mixed_page_count: 1 });
  });
  test("short same-name subjects stay separate across deprecated and current entries", () => {
    const subject = { protocol: "context.subject-key/v1" as const, namespace: "library", kind: "component", local_key: "button" };
    const view = { items: [
      { ref: "old", value: { locator: { normalized_path: "deprecated/components/button.ts" } } },
      { ref: "current", value: { locator: { normalized_path: "src/components/button.ts" } } },
    ] } as unknown as IndexerAuthorizedWorksetView;
    const qualify = (members: string[], explicit = false) => qualifyIndexerPartitionEntrySubject({ subject, members, view, explicit_subject: explicit });
    expect(qualify(["old"]).local_key).toBe("deprecated-button");
    expect(qualify(["current"])).toEqual(subject);
    expect(qualify(["old"], true)).toEqual(subject);
    expect(qualify(["old", "current"])).toEqual(subject);
    expect(qualify(["missing"])).toEqual(subject);
  });
  test("counts target pages and unique files, distinguishing mixed pages from supporting-only material", () => {
    const specs = Array.from({ length: 5 }, (_, i) => spec([`deprecated/old-${i}.ts`, ...(i === 0 ? ["src/current.ts"] : [])]));
    specs.push(spec(["src/active.ts"], ["deprecated/support.ts"]));
    const summary = summarizeIndexerObsoleteScope(specs);
    expect(summary).toMatchObject({ requires_confirmation: true, affected_page_count: 5, affected_file_count: 5, mixed_page_count: 1, total_page_count: 6 });
    expect(summary.exclude_consequence).toContain("not deleted");
    expect(summary.include_consequence).toContain("maintenance");
    expect(() => validateIndexerCurrentActionInput(summary.include_action)).not.toThrow();
    expect(() => validateIndexerCurrentActionInput(summary.exclude_action)).not.toThrow();
  });
  test("does not infer deprecation from a legacy name, or count repeated facts as files", () => {
    expect(summarizeIndexerObsoleteScope([spec(["legacy/v1.ts"]), spec(["src/deprecatedBehavior.ts"])])).toMatchObject({ requires_confirmation: false, affected_file_count: 0 });
    expect(summarizeIndexerObsoleteScope([spec(["deprecated/a.ts", "deprecated/a.ts"])]))
      .toMatchObject({ requires_confirmation: false, affected_file_count: 1 });
  });
  test("counts whole-file ownership with no symbol facts", () => {
    const value = spec(["deprecated/a.ts"]);
    value.validation.canonical_inventory_members = [{ member_id: indexerEvidenceAdapterFileRef({
      source_ref: "repo:sample", module_ref: null, normalized_path: "deprecated/a.ts",
    }) }];
    value.validation.source_identity_inventory.files[0]!.facts = [];
    expect(summarizeIndexerObsoleteScope([value]).affected_page_count).toBe(1);
  });
  test("excluding an entirely obsolete scope stops instead of sending an empty Partition", () => {
    expect(summarizeIndexerObsoleteScope(Array.from({ length: 5 }, (_, i) => spec([`deprecated/api-${i}.ts`]))))
      .toMatchObject({ requires_confirmation: true, exclusion_leaves_no_current_pages: true, exclude_action: null });
  });
  test("both ordinary and managed Graph routes require an explicit scope decision", async () => {
    const provider = await loadContextWorkflowProvider();
    for (const managed of [false, true]) {
      const context = { facts: { indexer_current: { advance_complete: true, agent_complete: true,
        obsolete_scope_confirmed: false, structure_review_complete: false,
        composer_complete: true, blockers_clear: true, layout_confirmed: true } },
        authorities: contextWorkflowAuthorities({ managed }), workspace: "/unused" };
      const evaluated = await evaluateGraph(provider, "indexer", "current-lifecycle", context);
      const route = await resolveRoute(provider, "indexer", "current-lifecycle", evaluated.evaluation.primaryRoute!.routeId,
        context, evaluated.evaluation.revision);
      expect(route.node).toBe("confirm-current-indexer-obsolete-scope");
      expect(route.availability).toBe("requires-user");
      expect(route.gate?.delegatable).toBe(false);
      const after = await evaluateGraph(provider, "indexer", "current-lifecycle", { ...context, facts: {
        indexer_current: { ...context.facts.indexer_current, obsolete_scope_confirmed: true, structure_review_complete: true },
      } });
      expect(after.evaluation.statusCode).toBe("complete");
    }
  });
});
