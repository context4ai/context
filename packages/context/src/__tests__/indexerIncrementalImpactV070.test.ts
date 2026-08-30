import { describe, expect, test } from "bun:test";
import {
  buildIndexerArtifactDependencySet,
  buildIndexerAuthorDependencyView,
  buildIndexerIncrementalImpactReport,
  buildIndexerMainWorkset,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvelope,
  buildIndexerRunEnvironment,
  validateIndexerIncrementalImpactReport,
  type IndexerAuthorDependencyView,
  type IndexerMainAuthorWorkset,
  type IndexerPrimaryExecutionProjection,
} from "../index.js";
import {
  INPUT_DIGEST,
  PRIMARY_EXECUTION_PROJECTION,
  PROVIDER,
  artifactResult,
  authorDependencyView,
  authorWorkset,
  digest,
  rehashArtifactResult,
  runEnvironment,
} from "./indexerArtifactResultV070.fixture.js";

function rebuildView(
  view: IndexerAuthorDependencyView,
  mutate: (input: {
    positive_nodes: Array<Record<string, unknown>>;
    negative_nodes: Array<Record<string, unknown>>;
  }) => void,
) {
  const input = {
    positive_nodes: view.positive_nodes.map((node) => Object.fromEntries(
      Object.entries(structuredClone(node)).filter(([key]) => key !== "node_ref"),
    )),
    negative_nodes: view.negative_nodes.map((node) => Object.fromEntries(
      Object.entries(structuredClone(node)).filter(([key]) => key !== "node_ref"),
    )),
  };
  mutate(input);
  return buildIndexerAuthorDependencyView({
    source_ref: view.source_ref,
    module_ref: view.module_ref,
    logical_unit_ref: view.logical_unit_ref,
    ...input,
  });
}

function worksetForView(
  previous: IndexerMainAuthorWorkset,
  view: IndexerAuthorDependencyView,
  projection: IndexerPrimaryExecutionProjection = PRIMARY_EXECUTION_PROJECTION,
): IndexerMainAuthorWorkset {
  const input = Object.fromEntries(Object.entries(previous).filter(([key]) =>
    key !== "protocol" && key !== "operation" && key !== "workset_digest"
  ));
  const rebuilt = buildIndexerMainWorkset({
    ...input,
    group_dependency_view_digest: view.view_digest,
    primary_execution_fingerprint: projection.primary_execution_fingerprint,
    primary_resource_binding_digest: projection.primary_resource_binding_digest,
  } as Parameters<typeof buildIndexerMainWorkset>[0]);
  if (rebuilt.stage !== "author") throw new Error("expected author workset");
  return rebuilt;
}

function runEnvelopeWithProjection(input: {
  workset: IndexerMainAuthorWorkset;
  projection: IndexerPrimaryExecutionProjection;
}) {
  const baselineEnvironment = runEnvironment(authorWorkset());
  return buildIndexerRunEnvelope({
    workset: input.workset,
    execution_request_digest: digest("9"),
    final_authority: PROVIDER,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: baselineEnvironment.source_snapshot_digest,
      parser_dependency_fingerprint:
        baselineEnvironment.parser_dependency_fingerprint,
      source_role: baselineEnvironment.source_role,
      source_precedence_digest: baselineEnvironment.source_precedence_digest,
      metric_set_digest: baselineEnvironment.metric_set_digest,
      dependency_view_digest: input.workset.group_dependency_view_digest,
      primary_execution_projection: input.projection,
    }),
  });
}

function fingerprintDependencyView(): IndexerAuthorDependencyView {
  const shared = PRIMARY_EXECUTION_PROJECTION.shared_artifact_fingerprint;
  return rebuildView(authorDependencyView(), ({ positive_nodes }) => {
    positive_nodes.push({
      kind: "template-policy-fragment",
      target_ref: "implementation:component-library",
      content_digest: shared.implementation_fingerprint,
      targets: [{ level: "artifact-kind", artifact_kind: "overview" }],
    }, {
      kind: "template-policy-fragment",
      target_ref: "instructions:component-library/summary",
      content_digest: shared.instructions_fingerprint,
      targets: [{
        level: "section",
        artifact_kind: "overview",
        section_key: "summary",
      }],
    }, {
      kind: "template-policy-fragment",
      target_ref: "template:component-library/usage",
      content_digest: shared.template_fingerprint,
      targets: [{
        level: "section",
        artifact_kind: "overview",
        section_key: "usage",
      }],
    });
  });
}

function fingerprintBaseline() {
  const view = fingerprintDependencyView();
  const workset = worksetForView(authorWorkset(), view);
  const result = artifactResult(workset);
  const artifact = result.artifacts[0]!;
  if (artifact.representation !== "sections") throw new Error("expected sections");
  artifact.sections.push({
    section_key: "usage",
    owner_indexer_id: workset.indexer_id,
    document_kind: "reference",
    reader_goal: "use-capability",
    artifact_kind: "overview",
    blocks: [{
      block_id: "usage-block",
      layer: "semantic-prose",
      markdown: "Use the public control.",
      evidence_refs: [result.evidence_bindings[0]!.evidence_ref],
    }],
  });
  rehashArtifactResult(result);
  const envelope = runEnvelope(workset, INPUT_DIGEST);
  return {
    workset,
    view,
    envelope,
    dependencySet: buildIndexerArtifactDependencySet({
      result,
      workset,
      run_envelope: envelope,
      dependency_view: view,
    }),
  };
}

function changedPrimaryProjection(
  field: "implementation" | "instructions" | "template",
): IndexerPrimaryExecutionProjection {
  const previous = PRIMARY_EXECUTION_PROJECTION;
  return buildIndexerPrimaryExecutionProjection({
    indexer_id: previous.indexer_id,
    primary_registry_projection_digest:
      previous.primary_registry_projection_digest,
    program_digest: field === "implementation" ? digest("9") : previous.program_digest,
    instructions_digest: field === "instructions"
      ? digest("9")
      : previous.instructions_digest,
    template_set_digest: field === "template"
      ? digest("9")
      : previous.template_set_digest,
    config_digest: previous.config_digest,
    cli_contract_digest: previous.cli_contract_digest,
    profile_contract_digest: previous.profile_contract_digest,
    resources: previous.resources.map((resource) => ({
      ...resource,
      digest: field === "instructions" && resource.kind === "instructions"
        ? digest("9")
        : resource.digest,
    })),
  });
}

function runEnvelope(workset: IndexerMainAuthorWorkset, requestDigest: string) {
  return buildIndexerRunEnvelope({
    workset,
    execution_request_digest: requestDigest,
    final_authority: PROVIDER,
    run_environment: runEnvironment(workset),
  });
}

function baseline() {
  const workset = authorWorkset();
  const view = authorDependencyView();
  const result = artifactResult(workset);
  const artifact = result.artifacts[0]!;
  if (artifact.representation !== "sections") throw new Error("expected sections");
  artifact.sections.push({
    section_key: "usage",
    owner_indexer_id: workset.indexer_id,
    document_kind: "reference",
    reader_goal: "use-capability",
    artifact_kind: "overview",
    blocks: [{
      block_id: "usage-block",
      layer: "semantic-prose",
      markdown: "Use the public control.",
      evidence_refs: [result.evidence_bindings[0]!.evidence_ref],
    }],
  });
  rehashArtifactResult(result);
  const envelope = runEnvelope(workset, INPUT_DIGEST);
  const dependencySet = buildIndexerArtifactDependencySet({
    result,
    workset,
    run_envelope: envelope,
    dependency_view: view,
  });
  return { workset, view, result, envelope, dependencySet };
}

function reportForView(input: {
  currentView: IndexerAuthorDependencyView;
  currentEnvelope?: ReturnType<typeof buildIndexerRunEnvelope>;
}) {
  const previous = baseline();
  const currentWorkset = worksetForView(previous.workset, input.currentView);
  const currentEnvelope = input.currentEnvelope ?? runEnvelope(currentWorkset, digest("f"));
  const report = buildIndexerIncrementalImpactReport({
    previous_run_envelope: previous.envelope,
    previous_dependency_view: previous.view,
    previous_dependency_set: previous.dependencySet,
    current_run_envelope: currentEnvelope,
    current_dependency_view: input.currentView,
  });
  expect(validateIndexerIncrementalImpactReport({
    report,
    previous_run_envelope: previous.envelope,
    previous_dependency_view: previous.view,
    previous_dependency_set: previous.dependencySet,
    current_run_envelope: currentEnvelope,
    current_dependency_view: input.currentView,
  })).toEqual(report);
  return report;
}

describe("Indexer run envelope and fine-grained Merkle impact", () => {
  test("keeps every Artifact and Section current when only request provenance changes", () => {
    const previous = baseline();
    const currentEnvelope = runEnvelope(previous.workset, digest("e"));
    const report = buildIndexerIncrementalImpactReport({
      previous_run_envelope: previous.envelope,
      previous_dependency_view: previous.view,
      previous_dependency_set: previous.dependencySet,
      current_run_envelope: currentEnvelope,
      current_dependency_view: previous.view,
    });
    expect(report).toMatchObject({
      envelope_changes: [],
      dependency_changes: [],
      logical_unit_state: "current",
      stale_artifact_count: 0,
      stale_section_count: 0,
      recompute_scope: "none",
    });
  });

  test("marks only the selected Section stale when its candidate pool changes", () => {
    const currentView = rebuildView(authorDependencyView(), ({ negative_nodes }) => {
      const candidate = negative_nodes.find((node) => node.kind === "candidate-pool")!;
      candidate.set_digest = digest("9");
    });
    const report = reportForView({ currentView });
    expect(report.dependency_changes).toEqual([
      expect.objectContaining({
        polarity: "negative",
        kind: "candidate-pool",
        change: "changed",
        affected_sections: [{ artifact_id: "button-overview", section_key: "summary" }],
      }),
    ]);
    expect(report.artifacts[0]?.sections).toEqual([
      { section_key: "summary", state: "stale", changed_node_refs: expect.any(Array) },
      { section_key: "usage", state: "current", changed_node_refs: [] },
    ]);
    expect(report.recompute_scope).toBe("artifact-sections");
  });

  test("detects changed consumed spans and newly added directory membership nodes", () => {
    const changedSpan = rebuildView(authorDependencyView(), ({ positive_nodes }) => {
      const source = positive_nodes.find((node) => node.kind === "source-span")!;
      source.content_digest = digest("8");
    });
    const spanReport = reportForView({ currentView: changedSpan });
    expect(spanReport.stale_section_count).toBe(2);
    expect(spanReport.dependency_changes).toEqual([
      expect.objectContaining({ kind: "source-span", change: "changed" }),
    ]);

    const addedMembership = rebuildView(authorDependencyView(), ({ negative_nodes }) => {
      negative_nodes.push({
        kind: "directory-membership",
        scope_ref: "directory:component-examples",
        set_digest: digest("7"),
        targets: [{
          level: "section",
          artifact_kind: "overview",
          section_key: "usage",
        }],
      });
    });
    const membershipReport = reportForView({ currentView: addedMembership });
    expect(membershipReport.dependency_changes).toContainEqual(
      expect.objectContaining({
        kind: "directory-membership",
        change: "added",
        affected_sections: [{ artifact_id: "button-overview", section_key: "usage" }],
      }),
    );
  });

  test("invalidates the complete logical unit when its group-input denominator changes", () => {
    const currentView = rebuildView(authorDependencyView(), ({ negative_nodes }) => {
      const denominator = negative_nodes.find((node) => node.kind === "group-input-set")!;
      denominator.set_digest = digest("7");
    });
    const report = reportForView({ currentView });
    expect(report.dependency_changes).toEqual([
      expect.objectContaining({
        kind: "group-input-set",
        change: "changed",
      }),
    ]);
    expect(report.stale_artifact_count).toBe(1);
    expect(report.stale_section_count).toBe(2);
    expect(report.recompute_scope).toBe("artifact-sections");
  });

  test("reports envelope drift without turning it into source- or collection-wide recomputation", () => {
    const previous = baseline();
    const currentEnvelope = buildIndexerRunEnvelope({
      workset: previous.workset,
      execution_request_digest: digest("6"),
      final_authority: {
        ...PROVIDER,
        config_fingerprint: digest("7"),
      },
      run_environment: runEnvironment(previous.workset),
    });
    const report = buildIndexerIncrementalImpactReport({
      previous_run_envelope: previous.envelope,
      previous_dependency_view: previous.view,
      previous_dependency_set: previous.dependencySet,
      current_run_envelope: currentEnvelope,
      current_dependency_view: previous.view,
    });
    expect(report.envelope_changes).toEqual([{
      field: "config_fingerprint",
      previous_value: PROVIDER.config_fingerprint,
      current_value: digest("7"),
    }]);
    expect(report.dependency_changes).toEqual([]);
    expect(report.recompute_scope).toBe("none");
  });

  test("limits implementation, instructions, and template drift to their exact Artifact Sections", () => {
    const previous = fingerprintBaseline();
    const cases: Array<{
      field: "implementation" | "instructions" | "template";
      targetRef: string;
      fingerprintField: string;
      expectedStates: Array<"current" | "stale">;
    }> = [{
      field: "implementation" as const,
      targetRef: "implementation:component-library",
      fingerprintField:
        "shared_artifact_fingerprint.implementation_fingerprint",
      expectedStates: ["stale", "stale"],
    }, {
      field: "instructions" as const,
      targetRef: "instructions:component-library/summary",
      fingerprintField: "shared_artifact_fingerprint.instructions_fingerprint",
      expectedStates: ["stale", "current"],
    }, {
      field: "template" as const,
      targetRef: "template:component-library/usage",
      fingerprintField: "shared_artifact_fingerprint.template_fingerprint",
      expectedStates: ["current", "stale"],
    }];
    for (const scenario of cases) {
      const projection = changedPrimaryProjection(scenario.field);
      const currentView = rebuildView(previous.view, ({ positive_nodes }) => {
        const resource = positive_nodes.find((node) =>
          node.kind === "template-policy-fragment" &&
          node.target_ref === scenario.targetRef
        )!;
        resource.content_digest = projection.shared_artifact_fingerprint[
          scenario.field === "implementation"
            ? "implementation_fingerprint"
            : scenario.field === "instructions"
            ? "instructions_fingerprint"
            : "template_fingerprint"
        ];
      });
      const currentWorkset = worksetForView(
        previous.workset,
        currentView,
        projection,
      );
      const report = buildIndexerIncrementalImpactReport({
        previous_run_envelope: previous.envelope,
        previous_dependency_view: previous.view,
        previous_dependency_set: previous.dependencySet,
        current_run_envelope: runEnvelopeWithProjection({
          workset: currentWorkset,
          projection,
        }),
        current_dependency_view: currentView,
      });
      expect(report.envelope_changes.map((change) => change.field)).toContain(
        scenario.fingerprintField,
      );
      expect(report.artifacts[0]?.sections.map((section) => section.state)).toEqual(
        scenario.expectedStates,
      );
      expect(report.dependency_changes).toHaveLength(1);
      expect(report.recompute_scope).toBe("artifact-sections");
    }
  });

  test("rejects forged Merkle carriers and duplicate evidence identities", () => {
    const previous = baseline();
    const forgedSet = structuredClone(previous.dependencySet);
    forgedSet.dependency_set_digest = digest("9");
    expect(() => buildIndexerIncrementalImpactReport({
      previous_run_envelope: previous.envelope,
      previous_dependency_view: previous.view,
      previous_dependency_set: forgedSet,
      current_run_envelope: previous.envelope,
      current_dependency_view: previous.view,
    })).toThrow(/dependency set digest is invalid/);

    expect(() => rebuildView(previous.view, ({ positive_nodes }) => {
      const source = structuredClone(
        positive_nodes.find((node) => node.kind === "source-span")!,
      );
      source.locator = { path: "src/other.ts", start_line: 1, end_line: 2 };
      positive_nodes.push(source);
    })).toThrow(/evidence refs must be unique/);
  });
});
