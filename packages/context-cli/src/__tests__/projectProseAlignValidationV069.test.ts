import { describe, expect, test } from "bun:test";
import { parseAlignPayload } from "../project/proseAlignPayloadParse.js";
import { addStructureQualityDiagnostics } from "../project/proseAlignPayloadValidation.js";
import { payloadSchema, type AlignDiagnostic, type AlignPayload } from "../project/proseAlignTypes.js";

function basePayload(overrides: Partial<AlignPayload> = {}): AlignPayload {
  return {
    schema_version: "context.structure.v1",
    sources: ["file:docs"],
    nodes: [{
      node_ref: "action/login-scenario",
      title: "Login Scenario",
      node_type: "action",
      tags: ["scenario"],
    }],
    views: [{
      view_ref: "test:action/login-scenario",
      node_ref: "action/login-scenario",
      collection: "test",
      title: "Login Scenario",
      node_type: "action",
      containment: "scenario",
      slug: "login-scenario",
      path: "test/scenario/login-scenario.md",
      sections: [{
        id: "note",
        section_ref: "test:action/login-scenario#note",
        kind: "description",
        source_refs: ["file:docs/spec.md#span:acceptance L1-1@111111111111"],
      }],
    }],
    edges: [],
    unresolved: [],
    lifecycle: { state: "draft" },
    evidence_snapshot_hash: "sha256:snapshot",
    payload_digest: "sha256:payload",
    structure_digest: "sha256:structure",
    ...overrides,
  };
}

describe("0.6.9 prose align validation", () => {
  test("schema help exposes node and tag contracts", () => {
    const schema = payloadSchema();
    expect(schema).toMatchObject({
        node_contract: expect.objectContaining({
          legal_node_types: ["entity", "domain", "action"],
          node_ref_prefix_must_match_node_type: true,
        }),
      node_tag_contract: {
        entity: expect.objectContaining({
          allowed_tags: expect.arrayContaining(["term", "module", "application"]),
          group_a_at_most_one: expect.arrayContaining(["app", "service", "lib"]),
          group_b_at_most_one: expect.arrayContaining(["application", "system"]),
        }),
        domain: { tags_allowed: false },
        action: expect.objectContaining({
          exactly_one_action_kind: expect.arrayContaining(["runbook", "scenario", "incident"]),
        }),
      },
      view_input_contract: {
        required_fields: ["view_ref", "node_ref", "collection", "slug", "sections"],
        defaulted_fields: expect.objectContaining({ containment: "root" }),
        derived_fields: expect.objectContaining({
          path: expect.stringContaining("<collection>/<slug>.md"),
          section_ref: "<view_ref>#<section.id>.",
        }),
        optional_fields: ["generated", "summary", "ownership"],
        value_constraints: expect.objectContaining({
          slug: "A safe filename slug without path separators.",
        }),
      },
    });
  });

  test("reports the required stable slug and its derived path contract", () => {
    const payload = basePayload();
    const view = { ...payload.views[0] } as Record<string, unknown>;
    delete view.slug;
    delete view.path;
    const parsed = parseAlignPayload({
      ...payload,
      views: [view],
    });

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "schema.view_slug_missing",
      field: "views[0].slug",
      repair: {
        action: "add_view_slug",
        expected_shape: "<safe-filename-slug>",
        path_derivation: "<collection>/<slug>.md or <collection>/<containment>/<slug>.md",
      },
    }));
  });

  test("derives a flat collection path when containment is omitted", () => {
    const payload = basePayload();
    const input = { ...payload } as Record<string, unknown>;
    delete input.payload_digest;
    delete input.structure_digest;
    const view = payload.views[0]!;
    const parsed = parseAlignPayload({
      ...input,
      views: [{
        ...view,
        containment: undefined,
        path: undefined,
        slug: "login-scenario",
      }],
    });

    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.payload?.views[0]).toMatchObject({
      containment: "root",
      path: "test/login-scenario.md",
    });
  });

  test("rejects free-form view tags at schema parse time", () => {
    const parsed = parseAlignPayload({
      schema_version: "context.structure.v1",
      sources: ["file:docs"],
      evidence_snapshot_hash: "sha256:snapshot",
      nodes: [{
        node_ref: "entity/gateway",
        title: "Gateway",
        node_type: "entity",
        tags: ["service"],
      }],
      views: [{
        view_ref: "architecture:entity/gateway",
        node_ref: "entity/gateway",
        collection: "architecture",
        title: "Gateway",
        node_type: "entity",
        containment: "services",
        slug: "gateway",
        path: "architecture/services/gateway.md",
        tags: ["free-form"],
        sections: [{
          id: "overview",
          section_ref: "architecture:entity/gateway#overview",
          kind: "description",
          source_refs: ["file:docs/spec.md#span:overview L1-1@111111111111"],
        }],
      }],
      edges: [],
      unresolved: [],
      lifecycle: { state: "draft" },
    });

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: "schema.unknown_field",
      field: "views[0].tags",
    }));
  });

  test("warns for single-section actions without forcing semantic kind diversity", () => {
    const scenarioDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload(), scenarioDiagnostics);
    expect(scenarioDiagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "node.action_too_thin",
      repair: expect.objectContaining({
        options: ["keep_with_reviewed_rationale", "move_to_owning_view_section", "add_source_backed_section", "add_child_action"],
      }),
    }));

    const runbookDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "action/runbook",
        title: "Runbook",
        node_type: "action",
        tags: ["runbook"],
      }],
      views: [{
        view_ref: "sop:action/runbook",
        node_ref: "action/runbook",
        collection: "sop",
        title: "Runbook",
        node_type: "action",
        containment: "runbooks",
        slug: "runbook",
        path: "sop/runbooks/runbook.md",
        sections: [{
          id: "overview",
          section_ref: "sop:action/runbook#overview",
          kind: "description",
          source_refs: ["file:docs/runbook.md#span:overview L1-1@111111111111"],
        }],
      }],
    }), runbookDiagnostics);
    expect(runbookDiagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "node.action_too_thin",
    }));
  });

  test("keeps single-section record actions visible as quality warnings", () => {
    const userStoryDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "action/login-story",
        title: "Login Story",
        node_type: "action",
        tags: ["user-story"],
      }],
      views: [{
        view_ref: "product:action/login-story",
        node_ref: "action/login-story",
        collection: "product",
        title: "Login Story",
        node_type: "action",
        containment: "stories",
        slug: "login-story",
        path: "product/stories/login-story.md",
        sections: [{
          id: "acceptance",
          section_ref: "product:action/login-story#acceptance",
          kind: "spec",
          source_refs: ["file:docs/story.md#span:acceptance L1-1@111111111111"],
        }],
      }],
    }), userStoryDiagnostics);
    expect(userStoryDiagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "node.action_too_thin",
      candidate_id: "action/login-story",
    }));

    const weakScenarioDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "action/login-scenario",
        title: "Login Scenario",
        node_type: "action",
        tags: ["scenario"],
      }],
      views: [{
        view_ref: "test:action/login-scenario",
        node_ref: "action/login-scenario",
        collection: "test",
        title: "Login Scenario",
        node_type: "action",
        containment: "scenario",
        slug: "login-scenario",
        path: "test/scenario/login-scenario.md",
        sections: [{
          id: "note",
          section_ref: "test:action/login-scenario#note",
          kind: "description",
          source_refs: ["file:docs/scenario.md#span:note L1-1@111111111111"],
        }],
      }],
    }), weakScenarioDiagnostics);
    expect(weakScenarioDiagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "node.action_too_thin",
      candidate_id: "action/login-scenario",
    }));
  });

  test("counts parent-index contains edges from view refs as node children", () => {
    const diagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [
        {
          node_ref: "domain/platform",
          title: "Platform",
          node_type: "domain",
        },
        {
          node_ref: "entity/gateway",
          title: "Gateway",
          node_type: "entity",
          tags: ["service"],
        },
      ],
      views: [
        {
          view_ref: "architecture:domain/platform",
          node_ref: "domain/platform",
          collection: "architecture",
          title: "Platform",
          node_type: "domain",
          containment: "platform",
          slug: "index",
          path: "architecture/platform/index.md",
          sections: [],
          generated: "parent_index",
        },
        {
          view_ref: "architecture:entity/gateway",
          node_ref: "entity/gateway",
          collection: "architecture",
          title: "Gateway",
          node_type: "entity",
          containment: "platform",
          slug: "gateway",
          path: "architecture/platform/gateway.md",
          sections: [{
            id: "overview",
            section_ref: "architecture:entity/gateway#overview",
            kind: "description",
            source_refs: ["file:docs/spec.md#span:overview L1-1@111111111111"],
          }],
        },
      ],
      edges: [{
        type: "contains",
        from: "architecture:domain/platform",
        to: "architecture:entity/gateway",
        source_refs: ["file:docs/spec.md#span:overview L1-1@111111111111"],
      }],
    }), diagnostics);
    expect(diagnostics.map((item) => item.code)).not.toContain("node.domain_without_children");
  });

  test("does not flag a generated action parent index with source-backed child pages as thin", () => {
    const diagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [
        {
          node_ref: "action/upgrade",
          title: "Upgrade",
          node_type: "action",
          tags: ["howto"],
        },
        {
          node_ref: "entity/runtime",
          title: "Runtime",
          node_type: "entity",
          tags: ["module"],
        },
      ],
      views: [
        {
          view_ref: "product:action/upgrade",
          node_ref: "action/upgrade",
          collection: "product",
          title: "Upgrade",
          node_type: "action",
          containment: "root",
          slug: "upgrade",
          path: "product/upgrade.md",
          sections: [],
          generated: "parent_index",
        },
        {
          view_ref: "product:entity/runtime",
          node_ref: "entity/runtime",
          collection: "product",
          title: "Runtime",
          node_type: "entity",
          containment: "upgrade",
          slug: "runtime",
          path: "product/upgrade/runtime.md",
          sections: [{
            id: "requirements",
            section_ref: "product:entity/runtime#requirements",
            kind: "spec",
            source_refs: ["file:docs/upgrade.md#span:runtime L1-3@111111111111"],
          }],
        },
      ],
      edges: [{
        type: "contains",
        from: "product:action/upgrade",
        to: "product:entity/runtime",
        source_refs: ["file:docs/upgrade.md#span:runtime L1-3@111111111111"],
      }],
    }), diagnostics);

    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      code: "node.action_too_thin",
      candidate_id: "action/upgrade",
    }));
  });

  test("action and domain gates count only the intended child node types", () => {
    const actionToEntityDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [
        {
          node_ref: "action/install",
          title: "Install",
          node_type: "action",
          tags: ["runbook"],
        },
        {
          node_ref: "entity/package",
          title: "Package",
          node_type: "entity",
          tags: ["module"],
        },
      ],
      views: [
        {
          view_ref: "sop:action/install",
          node_ref: "action/install",
          collection: "sop",
          title: "Install",
          node_type: "action",
          containment: "runbooks",
          slug: "install",
          path: "sop/runbooks/install.md",
          sections: [{
            id: "overview",
            section_ref: "sop:action/install#overview",
            kind: "description",
            source_refs: ["file:docs/runbook.md#span:overview L1-1@111111111111"],
          }],
        },
        {
          view_ref: "business:entity/package",
          node_ref: "entity/package",
          collection: "business",
          title: "Package",
          node_type: "entity",
          containment: "packages",
          slug: "package",
          path: "business/packages/package.md",
          sections: [{
            id: "overview",
            section_ref: "business:entity/package#overview",
            kind: "description",
            source_refs: ["file:docs/runbook.md#span:package L2-2@222222222222"],
          }],
        },
      ],
      edges: [{
        type: "contains",
        from: "action/install",
        to: "entity/package",
        source_refs: ["file:docs/runbook.md#span:overview L1-1@111111111111"],
      }],
    }), actionToEntityDiagnostics);
    expect(actionToEntityDiagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "node.action_too_thin",
    }));

    const actionToActionDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [
        {
          node_ref: "action/install",
          title: "Install",
          node_type: "action",
          tags: ["runbook"],
        },
        {
          node_ref: "action/install/verify",
          title: "Verify Install",
          node_type: "action",
          tags: ["runbook"],
        },
      ],
      views: [
        {
          view_ref: "sop:action/install",
          node_ref: "action/install",
          collection: "sop",
          title: "Install",
          node_type: "action",
          containment: "runbooks",
          slug: "install",
          path: "sop/runbooks/install.md",
          sections: [{
            id: "overview",
            section_ref: "sop:action/install#overview",
            kind: "description",
            source_refs: ["file:docs/runbook.md#span:overview L1-1@111111111111"],
          }],
        },
        {
          view_ref: "sop:action/install/verify",
          node_ref: "action/install/verify",
          collection: "sop",
          title: "Verify Install",
          node_type: "action",
          containment: "runbooks",
          slug: "verify",
          path: "sop/runbooks/verify.md",
          sections: [{
            id: "overview",
            section_ref: "sop:action/install/verify#overview",
            kind: "description",
            source_refs: ["file:docs/runbook.md#span:verify L2-2@222222222222"],
          }],
        },
      ],
      edges: [{
        type: "contains",
        from: "action/install",
        to: "action/install/verify",
        source_refs: ["file:docs/runbook.md#span:overview L1-1@111111111111"],
      }],
    }), actionToActionDiagnostics);
    expect(actionToActionDiagnostics).not.toContainEqual(expect.objectContaining({
      code: "node.action_too_thin",
      candidate_id: "action/install",
    }));

    const domainToSectionDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "domain/platform",
        title: "Platform",
        node_type: "domain",
      }],
      views: [{
        view_ref: "architecture:domain/platform",
        node_ref: "domain/platform",
        collection: "architecture",
        title: "Platform",
        node_type: "domain",
        containment: "platform",
        slug: "overview",
        path: "architecture/platform/overview.md",
        sections: [{
          id: "overview",
          section_ref: "architecture:domain/platform#overview",
          kind: "description",
          source_refs: ["file:docs/spec.md#span:overview L1-1@111111111111"],
        }],
      }],
      edges: [{
        type: "contains",
        from: "domain/platform",
        to: "architecture:domain/platform#overview",
        source_refs: ["file:docs/spec.md#span:overview L1-1@111111111111"],
      }],
    }), domainToSectionDiagnostics);
    expect(domainToSectionDiagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "node.domain_without_children",
    }));
  });

  test("accepts multiple source-backed action sections with the same kind", () => {
    const diagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "action/two-notes",
        title: "Two Notes",
        node_type: "action",
        tags: ["runbook"],
      }],
      views: [{
        view_ref: "sop:action/two-notes",
        node_ref: "action/two-notes",
        collection: "sop",
        title: "Two Notes",
        node_type: "action",
        containment: "runbooks",
        slug: "two-notes",
        path: "sop/runbooks/two-notes.md",
        sections: ["one", "two"].map((id) => ({
          id,
          section_ref: `sop:action/two-notes#${id}`,
          kind: "description",
          source_refs: [`file:docs/runbook.md#span:${id} L1-1@111111111111`],
        })),
      }],
    }), diagnostics);
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      code: "node.action_too_thin",
      candidate_id: "action/two-notes",
    }));
  });

  test("does not apply collection-specific page granularity rules", () => {
    const diagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "entity/install",
        title: "Install",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "decision:entity/install",
        node_ref: "entity/install",
        collection: "decision",
        title: "Install Decision",
        node_type: "entity",
        containment: "install",
        slug: "choice",
        path: "decision/install/choice.md",
        sections: [{
          id: "choice",
          section_ref: "decision:entity/install#choice",
          kind: "decision",
          source_refs: ["file:docs/decision.md#span:choice L1-1@111111111111"],
        }],
      }],
      edges: [],
    }), diagnostics);
    expect(diagnostics.map((item) => item.code)).not.toContain("view.collection_route_check");

    const scatteredDiagnostics: AlignDiagnostic[] = [];
    addStructureQualityDiagnostics(basePayload({
      nodes: [{
        node_ref: "entity/support",
        title: "Support",
        node_type: "entity",
        tags: ["module"],
      }],
      views: [{
        view_ref: "faq:entity/support",
        node_ref: "entity/support",
        collection: "faq",
        title: "Support FAQ",
        node_type: "entity",
        containment: "support",
        slug: "faq",
        path: "faq/support/faq.md",
        sections: ["one", "two"].map((id) => ({
          id,
          section_ref: `faq:entity/support#${id}`,
          kind: "faq",
          source_refs: [`file:docs/faq.md#span:${id} L1-1@111111111111`],
        })),
      }],
      edges: [],
    }), scatteredDiagnostics);
    expect(scatteredDiagnostics.map((item) => item.code)).not.toContain("view.collection_route_check");
  });
});
