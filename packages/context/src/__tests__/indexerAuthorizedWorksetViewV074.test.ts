import { describe, expect, test } from "bun:test";
import {
  buildIndexerAuthorDependencyView,
  buildIndexerAuthorizedWorksetView,
  buildIndexerMainRunWorksetViewSources,
  buildIndexerMainRunRequest,
  buildIndexerMainWorkset,
  buildIndexerParserWorksetViewSource,
  buildIndexerParserFactView,
  buildIndexerPartitionInventoryFromParserFactView,
  buildIndexerPrimaryExecutionProjection,
  buildIndexerRunEnvironment,
  buildIndexerToolSnapshotReadReceipt,
  buildIndexerToolSnapshotWorksetViewSource,
  canonicalIndexerNodeRef,
  composeIndexerLayerInput,
  indexerCapabilityGroupMemberIdsDigest,
  indexerDependencyNodeRef,
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerEvidenceAdapterOutputDigest,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  indexerToolSnapshotDigest,
  indexerToolSnapshotPageRef,
  indexerToolSnapshotResponseDigest,
  validateIndexerAuthorizedWorksetProjection,
  validateIndexerAuthorizedWorksetView,
  type IndexerEvidenceAdapterResult,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
  type IndexerParserFactView,
  type IndexerSubjectKey,
  type IndexerToolSnapshot,
} from "../index.js";
import { artifactPolicyEligibilityFixture } from "./indexerArtifactPolicyV070.fixture.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SOURCE_REF = "repo:sample@revision";
const MODULE_REF = "module:packages/sample";
const MEMBER_REF = "member:export/button";
const PROVIDER = {
  layer_ref: "provider:sample#layer:primary",
  integrity: digest("a"),
  bundle_digest: digest("b"),
  config_fingerprint: digest("c"),
  customization_fingerprint: null,
};
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "button",
};
const PARTITION_SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component-library",
  local_key: "root",
};
const STRATEGY = {
  kind: "project-indexer" as const,
  indexer_id: "component-library",
  strategy_id: "component-family",
  implementation_digest: digest("d"),
};
const STRATEGY_DIGEST = digest("e");
const PRIMARY_EXECUTION_PROJECTION = buildIndexerPrimaryExecutionProjection({
  indexer_id: "component-library",
  primary_registry_projection_digest: digest("1"),
  program_digest: null,
  instructions_digest: digest("2"),
  template_set_digest: digest("3"),
  config_digest: PROVIDER.config_fingerprint,
  cli_contract_digest: digest("4"),
  profile_contract_digest: digest("5"),
  resources: [{
    layer_ref: PROVIDER.layer_ref,
    phase: "primary",
    kind: "instructions",
    ref: "bundle:sample/instructions/main.md",
    digest: digest("2"),
  }],
});

const common = {
  indexer_id: "component-library",
  requirement_ref: "requirement:public-knowledge",
  owner_cell_refs: ["owner-cell:public-knowledge#public-contract"],
  source_ref: SOURCE_REF,
  module_ref: MODULE_REF,
  primary_registry_projection_digest: digest("1"),
  requirement_set_digest: digest("6"),
  primary_execution_fingerprint:
    PRIMARY_EXECUTION_PROJECTION.primary_execution_fingerprint,
  profile_contract_digest: digest("5"),
  subject_key_schema_digest: digest("7"),
  source_scope_digest: digest("8"),
  source_binding_digest: digest("9"),
  primary_resource_binding_digest:
    PRIMARY_EXECUTION_PROJECTION.primary_resource_binding_digest,
  question_target_inventory_digest: digest("0"),
};

function parserFactView(): IndexerParserFactView {
  const path = "src/button.ts";
  const fileRef = indexerEvidenceAdapterFileRef({
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    normalized_path: path,
  });
  const facts = ["Button", "Link"].map((name) => {
    const locator = {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: path,
      qualified_item_path: name,
      signature_digest: indexerProtocolDigest({ name }),
    };
    const payload = {
      name,
      export_kind: "named",
      kind: name === "Button" ? "component" : "type",
    };
    return {
      fact_ref: indexerEvidenceAdapterFactRef({
        ...locator,
        kind: "exported-symbol",
      }),
      kind: "exported-symbol",
      locator,
      payload,
      payload_digest: indexerProtocolDigest(payload),
      denominator: "symbol" as const,
    };
  });
  const scope = {
    source_ref: SOURCE_REF,
    module_refs: [MODULE_REF],
    scope_digest: indexerProtocolDigest({
      source_ref: SOURCE_REF,
      module_refs: [MODULE_REF],
    }),
  };
  const resultPayload: Omit<IndexerEvidenceAdapterResult, "output_digest"> = {
    protocol: "context.indexer.evidence-adapter-result/v1",
    adapter: {
      id: "sample-typescript-parser",
      package: "@example/typescript-parser",
      export: "materializeEvidence",
      version: "1.0.0",
      digest: digest("a"),
    },
    authorized_scope: scope,
    input_digest: digest("b"),
    precedence: 10,
    files: [{
      file_ref: fileRef,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      normalized_path: path,
      role: "primary-owner",
      coverage_tier: "ast-catalog",
      disposition: "analyzed",
      facts: facts.map((fact) => ({
        fact_ref: fact.fact_ref,
        kind: fact.kind,
        locator: fact.locator,
        payload_digest: fact.payload_digest,
        denominator: fact.denominator,
      })),
    }],
    diagnostics: [],
    toolchain: [{
      step: "parse-typescript",
      package: "@example/typescript-parser",
      export: "materializeEvidence",
      version: "1.0.0",
      digest: digest("a"),
      capabilities: ["parser.typescript"],
      input_digest: digest("b"),
      output_digest: digest("c"),
    }],
  };
  const result = {
    ...resultPayload,
    output_digest: indexerEvidenceAdapterOutputDigest(resultPayload),
  };
  return buildIndexerParserFactView({
    adapter_results: [result],
    fact_payloads: facts.map((fact) => ({
      fact_ref: fact.fact_ref,
      payload: fact.payload,
    })),
    inventory_digest: digest("d"),
  });
}

function partitionWorkset(): IndexerMainPartitionWorkset {
  const inventory = buildIndexerPartitionInventoryFromParserFactView(parserFactView());
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "partition",
    partition_subject_key: PARTITION_SUBJECT,
    strategy_set_digest: indexerPartitionStrategySetDigest([{
      strategy_ref: STRATEGY,
      strategy_digest: STRATEGY_DIGEST,
    }]),
    reader_question_refs: ["question:public-contract"],
    partition_input_digests: [digest("f")],
    partition_inventory_digest: indexerInventoryMembersDigest(inventory),
    allowed_question_target_refs: ["question-target:public-contract"],
  });
  if (workset.stage !== "partition") throw new Error("expected partition workset");
  return workset;
}

function authorFixture(view: IndexerParserFactView): {
  workset: IndexerMainAuthorWorkset;
  dependencyView: ReturnType<typeof buildIndexerAuthorDependencyView>;
} {
  const logicalUnitRef = canonicalIndexerNodeRef(SUBJECT);
  const sourceSpan = {
    kind: "source-span" as const,
    evidence_ref: "evidence:button-source",
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    locator: { path: "src/button.ts", start_line: 1, end_line: 20 },
    content_digest: digest("e"),
    targets: [],
  };
  const selectedFact = view.files[0]!.facts[0]!;
  const dependencyView = buildIndexerAuthorDependencyView({
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    logical_unit_ref: logicalUnitRef,
    positive_nodes: [sourceSpan, {
      kind: "selected-fact",
      fact_ref: selectedFact.fact_ref,
      fact_digest: selectedFact.payload_digest,
      source_span_node_refs: [indexerDependencyNodeRef({
        polarity: "positive",
        node: sourceSpan,
      })],
      targets: [],
    }, {
      kind: "logical-unit",
      logical_unit_ref: logicalUnitRef,
      group_projection_digest: digest("f"),
      targets: [{ level: "logical-unit" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: logicalUnitRef,
      set_digest: indexerInventoryMembersDigest([{
        member_id: MEMBER_REF,
        member_kind: "component",
      }]),
      targets: [{ level: "logical-unit" }],
    }],
  });
  const eligibility = artifactPolicyEligibilityFixture();
  const workset = buildIndexerMainWorkset({
    ...common,
    stage: "author",
    partition_plan_binding_digest: digest("a"),
    group_key: "component:button",
    logical_unit_ref: logicalUnitRef,
    member_ids_digest: indexerCapabilityGroupMemberIdsDigest([MEMBER_REF]),
    member_inventory_digest: indexerInventoryMembersDigest([{
      member_id: MEMBER_REF,
      member_kind: "component",
    }]),
    group_projection_digest: digest("f"),
    group_dependency_view_digest: dependencyView.view_digest,
    allowed_artifact_policy_variants: eligibility.eligible_variants.map(
      (variant) => variant.id,
    ),
    artifact_policy_eligibility_digest: eligibility.eligibility_digest,
  });
  if (workset.stage !== "author") throw new Error("expected author workset");
  return { workset, dependencyView };
}

function request(
  workset: IndexerMainPartitionWorkset | IndexerMainAuthorWorkset,
) {
  return buildIndexerMainRunRequest({
    workset,
    ...(workset.stage === "partition"
      ? {
          partition_strategy_attempt: {
            strategy_order: 0,
            strategy_ref: STRATEGY,
            strategy_digest: STRATEGY_DIGEST,
            previous_attempt_digest: null,
          },
        }
      : {}),
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: PROVIDER.layer_ref,
      fragments: [],
    }),
    final_authority: PROVIDER,
    run_environment: buildIndexerRunEnvironment({
      source_snapshot_digest: digest("1"),
      source_dependency_fingerprint: workset.source_binding_digest,
      source_role: "authoritative-source",
      source_precedence_digest: digest("3"),
      metric_set_digest: digest("4"),
      dependency_view_digest: workset.stage === "author"
        ? workset.group_dependency_view_digest
        : null,
      primary_execution_projection: PRIMARY_EXECUTION_PROJECTION,
    }),
  });
}

function toolSnapshot(): IndexerToolSnapshot {
  const responseDigest = digest("c");
  const resourceIdentity = "tool-resource:component-catalog";
  const page = {
    page_ref: indexerToolSnapshotPageRef({
      resource_identity: resourceIdentity,
      query_arguments_digest: digest("b"),
      cursor_in: null,
      response_digest: responseDigest,
    }),
    cursor_in: null,
    cursor_out: null,
    item_count: 1,
    response_digest: responseDigest,
  };
  const payload: Omit<IndexerToolSnapshot, "snapshot_digest"> = {
    protocol: "context.indexer.tool-snapshot/v1",
    tool: {
      id: "component-catalog-client",
      version: "1.0.0",
      implementation_digest: digest("a"),
      authority_ref: "tool-authority:component-catalog",
    },
    source: {
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      input_digest: digest("b"),
    },
    resource: {
      provider: "component-catalog",
      kind: "component-catalog",
      identity: resourceIdentity,
      endpoint_type: "components",
      protocol: "rpc",
      resolved_revision: "2026.09.02",
    },
    location: { site: "example", region: null },
    query: { operation: "list-components", arguments_digest: digest("b") },
    pages: [page],
    completion: { state: "complete", next_cursor: null },
    observation: {
      observed_at: "2026-09-02T00:00:00.000Z",
      response_digest: indexerToolSnapshotResponseDigest([page]),
    },
  };
  return { ...payload, snapshot_digest: indexerToolSnapshotDigest(payload) };
}

describe("authorized Indexer workset View", () => {
  test("projects all exact parser facts for a partition workset", () => {
    const factView = parserFactView();
    const runRequest = request(partitionWorkset());
    const projection = buildIndexerAuthorizedWorksetView({
      request: runRequest,
      projection_sources: buildIndexerMainRunWorksetViewSources({
        request: runRequest,
        source_projection_sources: buildIndexerParserWorksetViewSource({
          request: runRequest,
          parser_fact_view: factView,
        }),
        canonical_inventory_members:
          buildIndexerPartitionInventoryFromParserFactView(factView),
      }),
    });

    expect(validateIndexerAuthorizedWorksetProjection({
      request: runRequest,
      view: projection.view,
      read_receipt: projection.read_receipt,
    })).toEqual(projection);
    expect(projection.view.items.filter((item) => item.category === "fact")
      .map((item) => item.ref)).toEqual(
        factView.files[0]!.facts.map((fact) => fact.fact_ref).sort(),
      );
    const inventoryItems = projection.view.items.filter((item) =>
      item.category === "inventory-member"
    );
    expect(inventoryItems).toHaveLength(3);
    expect(inventoryItems.map((item) => item.value)).toContainEqual({
      member_id: factView.files[0]!.facts[0]!.fact_ref,
      member_kind: "component",
    });
  });

  test("limits an author View to selected facts plus its dependency closure", () => {
    const factView = parserFactView();
    const { workset, dependencyView } = authorFixture(factView);
    const runRequest = request(workset);
    const projection = buildIndexerAuthorizedWorksetView({
      request: runRequest,
      projection_sources: buildIndexerMainRunWorksetViewSources({
        request: runRequest,
        source_projection_sources: buildIndexerParserWorksetViewSource({
          request: runRequest,
          parser_fact_view: factView,
          dependency_view: dependencyView,
        }),
        canonical_inventory_members: [{
          member_id: MEMBER_REF,
          member_kind: "component",
        }],
      }),
    });

    const facts = projection.view.items.filter((item) => item.category === "fact");
    expect(facts.map((item) => item.ref)).toEqual([
      dependencyView.positive_nodes.find((node) => node.kind === "selected-fact")!.fact_ref,
    ]);
    expect(projection.view.items.some((item) => item.category === "dependency")).toBe(true);
    expect(projection.read_receipt.read_set).toHaveLength(projection.view.items.length);
  });

  test("accepts a new evidence adapter through the same projection source boundary", () => {
    const factView = parserFactView();
    const runRequest = request(partitionWorkset());
    const snapshot = toolSnapshot();
    const expectedRead = {
      handler: "example.context.component-catalog-read/v1",
      authority_ref: snapshot.tool.authority_ref,
      authority_digest: digest("d"),
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      input_digest: snapshot.source.input_digest,
    };
    const readReceipt = buildIndexerToolSnapshotReadReceipt({
      snapshot,
      handler: expectedRead.handler,
      authority_digest: expectedRead.authority_digest,
    });
    const toolSource = buildIndexerToolSnapshotWorksetViewSource({
      request: runRequest,
      snapshot,
      read_receipt: readReceipt,
      expected_read: expectedRead,
    });
    const projection = buildIndexerAuthorizedWorksetView({
      request: runRequest,
      projection_sources: [
        ...buildIndexerMainRunWorksetViewSources({
          request: runRequest,
          source_projection_sources: buildIndexerParserWorksetViewSource({
            request: runRequest,
            parser_fact_view: factView,
          }),
          canonical_inventory_members:
            buildIndexerPartitionInventoryFromParserFactView(factView),
        }),
        toolSource,
      ],
    });

    const toolItem = projection.view.items.find((item) =>
      item.ref === `tool-snapshot:${snapshot.snapshot_digest}` &&
      item.category === "tool-snapshot"
    );
    expect(toolItem?.value).toEqual(snapshot);
    expect(projection.view.projection_input_digests).toContain(snapshot.snapshot_digest);
    expect(JSON.stringify(toolItem?.value)).not.toContain('"payload"');
  });

  test("rejects stale source scope, View payload, and read receipt", () => {
    const factView = parserFactView();
    const runRequest = request(partitionWorkset());
    const wrongScope = structuredClone(factView);
    wrongScope.authorized_scope.source_ref = "repo:other@revision";
    expect(() => buildIndexerMainRunWorksetViewSources({
      request: runRequest,
      source_projection_sources: buildIndexerParserWorksetViewSource({
        request: runRequest,
        parser_fact_view: wrongScope,
      }),
      canonical_inventory_members:
        buildIndexerPartitionInventoryFromParserFactView(wrongScope),
    })).toThrow();

    const projection = buildIndexerAuthorizedWorksetView({
      request: runRequest,
      projection_sources: buildIndexerMainRunWorksetViewSources({
        request: runRequest,
        source_projection_sources: buildIndexerParserWorksetViewSource({
          request: runRequest,
          parser_fact_view: factView,
        }),
        canonical_inventory_members:
          buildIndexerPartitionInventoryFromParserFactView(factView),
      }),
    });
    const forgedView = structuredClone(projection.view);
    forgedView.items[0]!.category = "forged";
    expect(() => validateIndexerAuthorizedWorksetView(forgedView)).toThrow(/item digest/);

    const forgedReceipt = structuredClone(projection.read_receipt);
    forgedReceipt.read_set[0]!.item_digest = digest("f");
    expect(() => validateIndexerAuthorizedWorksetProjection({
      request: runRequest,
      view: projection.view,
      read_receipt: forgedReceipt,
    })).toThrow();
  });
});
