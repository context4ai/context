import { describe, expect, test } from "bun:test";
import type { AlignPayload, StructureViewPlan } from "../project/proseAlignTypes.js";
import { alignSemanticRules } from "../project/proseAlignTypes.js";
import { compileSemanticRules } from "../project/proseCompileSemanticRules.js";

function structure(nodeType: "entity" | "action" | "domain" = "entity"): {
  payload: AlignPayload;
  view: StructureViewPlan;
} {
  const view = {
    view_ref: "architecture:entity/example",
    node_ref: "entity/example",
    collection: "architecture",
    slug: "example",
    title: "Example",
    node_type: "entity",
    path: "architecture/example.md",
    sections: [{ id: "overview", kind: "description", source_refs: ["file:docs/guide.md#span:intro L1-2@123456789abc"] }],
    split_requirement: { status: "not_required", reason: "" },
  } as unknown as StructureViewPlan;
  return {
    view,
    payload: {
      nodes: [{ node_ref: "entity/example", node_type: nodeType, title: "Example", tags: [] }],
      views: [view],
      edges: [],
      unresolved: [],
    } as unknown as AlignPayload,
  };
}

describe("0.6.9 semantic rule selection", () => {
  test("align keeps core rules and adds candidate resolution only for matching diagnostics", () => {
    const core = alignSemanticRules();
    expect(core.required.map((rule) => rule.id)).toEqual([
      "structure-planning",
      "align-gates",
      "density-profile",
    ]);
    const conditional = alignSemanticRules([{
      severity: "warning",
      code: "duplicate.candidate",
      message: "duplicate",
      family: "duplicate",
    } as never]);
    expect(conditional.required.map((rule) => rule.id)).toContain("candidate-resolution");
  });

  test("compile read-plan defers rules until node context and node context selects a subset", () => {
    const { payload, view } = structure();
    expect(compileSemanticRules({ view: "read-plan", structure: payload }).required).toEqual([]);
    const rules = compileSemanticRules({ view: "node-context", structure: payload, node: view });
    expect(rules.required.map((rule) => rule.id)).toEqual([
      "compile-actions",
      "compile-judgment",
      "semantic-judgment",
    ]);
    expect(rules.required.every((rule) => rule.content_available && rule.content_digest.startsWith("sha256:"))).toBe(true);
    expect(rules.handle).toMatch(/^context-rules:compile:[a-f0-9]{16}$/u);
    expect(compileSemanticRules({ view: "node-context", structure: payload, node: view }).digest).toBe(rules.digest);
  });

  test("compile adds only conditions applicable to action nodes with approved content", () => {
    const { payload, view } = structure("action");
    const ids = compileSemanticRules({
      view: "node-context",
      structure: payload,
      node: view,
      existingSectionCount: 2,
    }).required.map((rule) => rule.id);
    expect(ids).toContain("action-domain-gates");
    expect(ids).toContain("compile-notes");
    expect(ids).toContain("refresh-and-update");
    expect(ids).toContain("temporal-and-evidence");
    expect(ids).not.toContain("close-gate");
    expect(ids).not.toContain("user-confirmation");
  });
});
