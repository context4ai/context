import { describe, expect, test } from "bun:test";
import {
  assertIndexerExampleCandidateDecisionClosure,
  buildIndexerExampleDecisionSet,
  buildIndexerExampleInventory,
  buildIndexerExampleLinkageAudit,
  indexerExampleLinkageAuditDigest,
  validateIndexerExampleDecisionSet,
  validateIndexerExampleLinkageAudit,
  type IndexerExampleCandidateDecision,
  type IndexerExampleLinkageAudit,
  type IndexerExampleObservationInput,
  type IndexerExampleRepresentation,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function observation(input: {
  path: string;
  evidence: string;
  scenario?: string;
  target?: string;
}): IndexerExampleObservationInput {
  return {
    public_target_ref: input.target ?? "target:button",
    scenario_key: input.scenario ?? "basic-usage",
    source_ref: "repo:sample@revision",
    module_ref: "module:components",
    full_relative_path: input.path,
    content_digest: digest(input.path.includes("variant") ? "c" : "b"),
    evidence_refs: [input.evidence],
  };
}

function representation(evidenceRef: string): IndexerExampleRepresentation {
  return {
    setup: {
      state: "extracted",
      fact_refs: ["fact:setup"],
      evidence_refs: [evidenceRef],
    },
    key_calls: {
      state: "extracted",
      fact_refs: ["fact:key-call"],
      evidence_refs: [evidenceRef],
    },
    parameters: {
      state: "not-applicable",
      reason_code: "no-runtime-parameters",
      evidence_refs: [evidenceRef],
    },
    expected_behavior: {
      state: "extracted",
      fact_refs: ["fact:expected-behavior"],
      evidence_refs: [evidenceRef],
    },
  };
}

function metric(
  audit: IndexerExampleLinkageAudit,
  metricId: IndexerExampleLinkageAudit["metrics"][number]["metric_id"],
): IndexerExampleLinkageAudit["metrics"][number] {
  return audit.metrics.find((item) => item.metric_id === metricId)!;
}

describe("example candidate decisions and linkage metrics", () => {
  const inventory = buildIndexerExampleInventory({
    source_scope_digest: digest("a"),
    observations: [
      observation({ path: "stories/basic.tsx", evidence: "evidence:basic" }),
      observation({ path: "stories/basic.variant.tsx", evidence: "evidence:variant" }),
      observation({
        path: "docs/button.mdx",
        evidence: "evidence:docs",
        scenario: "documentation",
      }),
      observation({
        path: "legacy/button.tsx",
        evidence: "evidence:legacy",
        scenario: "legacy",
      }),
      observation({
        path: "sandboxes/button.tsx",
        evidence: "evidence:sandbox",
        scenario: "interactive",
      }),
    ],
  });
  const byPath = new Map(inventory.observations.map((item) => [
    item.full_relative_path,
    item.example_ref,
  ]));

  function completeDecisions(): IndexerExampleCandidateDecision[] {
    return [{
      example_ref: byPath.get("stories/basic.tsx")!,
      decision: "link-public-target",
      public_target_ref: "target:button",
      landing_ref: "section:button-examples",
      representation: representation("evidence:basic"),
      evidence_refs: ["evidence:basic"],
    }, {
      example_ref: byPath.get("stories/basic.variant.tsx")!,
      decision: "merge-scenario-variant",
      canonical_example_ref: byPath.get("stories/basic.tsx")!,
      evidence_refs: ["evidence:variant"],
    }, {
      example_ref: byPath.get("docs/button.mdx")!,
      decision: "documentation-example",
      document_ref: "document:button-guide",
      landing_ref: "section:button-guide-example",
      representation: representation("evidence:docs"),
      evidence_refs: ["evidence:docs"],
    }, {
      example_ref: byPath.get("legacy/button.tsx")!,
      decision: "excluded-with-reason",
      reason_code: "obsolete-api",
      rationale: "The example targets a removed compatibility surface.",
      evidence_refs: ["evidence:legacy"],
    }, {
      example_ref: byPath.get("sandboxes/button.tsx")!,
      decision: "request-material",
      material_request_ref: "material-request:interactive-runtime",
      missing_facts: ["expected-runtime-state"],
      source_hints: ["source:runtime-capture"],
      evidence_refs: ["evidence:sandbox"],
    }];
  }

  test("closes every candidate and resolves merged variants into mechanical metrics", () => {
    const decisions = buildIndexerExampleDecisionSet({
      inventory,
      decisions: completeDecisions().reverse(),
    });
    const audit = buildIndexerExampleLinkageAudit({ inventory, decision_set: decisions });
    expect(decisions.decisions.map((item) => item.example_ref)).toEqual(
      [...decisions.decisions.map((item) => item.example_ref)].sort(),
    );
    expect(metric(audit, "example-candidate-decision-coverage")).toMatchObject({
      numerator: 5,
      denominator: 5,
      actual: 1,
      missing_example_refs: [],
    });
    expect(metric(audit, "example-representative-coverage")).toMatchObject({
      numerator: 3,
      denominator: 4,
      actual: 0.75,
    });
    expect(metric(audit, "example-public-target-linkage")).toMatchObject({
      numerator: 2,
      denominator: 4,
      actual: 0.5,
    });
    expect(assertIndexerExampleCandidateDecisionClosure({
      value: audit,
      inventory,
      decision_set: decisions,
    })).toEqual(audit);
  });

  test("keeps incomplete authoring state auditable and lists every missing candidate", () => {
    const decisions = buildIndexerExampleDecisionSet({
      inventory,
      decisions: [completeDecisions()[0]!],
    });
    const audit = buildIndexerExampleLinkageAudit({ inventory, decision_set: decisions });
    const closure = metric(audit, "example-candidate-decision-coverage");
    expect(closure).toMatchObject({ numerator: 1, denominator: 5, actual: 0.2 });
    expect(closure.missing_example_refs).toHaveLength(4);
    expect(audit.decision_closure_pass).toBe(false);
    expect(() => assertIndexerExampleCandidateDecisionClosure({
      value: audit,
      inventory,
      decision_set: decisions,
    })).toThrow(/example-candidate-decision-incomplete/);
  });

  test("rejects duplicate, unknown, cross-scenario, and cyclic decisions", () => {
    const complete = completeDecisions();
    const variant = complete[1]!;
    if (variant.decision !== "merge-scenario-variant") throw new Error("invalid fixture");
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [complete[0]!, complete[0]!],
    })).toThrow(/at most one decision/);
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [{ ...complete[0]!, example_ref: "example:unknown" }],
    })).toThrow(/unknown candidate/);
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [{
        ...variant,
        canonical_example_ref: byPath.get("docs/button.mdx")!,
      }],
    })).toThrow(/share public target and scenario/);
    const first = byPath.get("stories/basic.tsx")!;
    const second = byPath.get("stories/basic.variant.tsx")!;
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [{
        example_ref: first,
        decision: "merge-scenario-variant",
        canonical_example_ref: second,
        evidence_refs: ["evidence:basic"],
      }, {
        example_ref: second,
        decision: "merge-scenario-variant",
        canonical_example_ref: first,
        evidence_refs: ["evidence:variant"],
      }],
    })).toThrow(/merge cycles/);
  });

  test("binds target identity and all representation evidence to the candidate", () => {
    const complete = completeDecisions();
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [{
        ...complete[0]!,
        public_target_ref: "target:other",
      } as IndexerExampleCandidateDecision],
    })).toThrow(/does not match candidate identity/);
    const unrelated = structuredClone(complete[0]!);
    if (unrelated.decision !== "link-public-target") throw new Error("invalid fixture");
    unrelated.representation.setup.evidence_refs = ["evidence:docs"];
    expect(() => buildIndexerExampleDecisionSet({
      inventory,
      decisions: [unrelated],
    })).toThrow(/unrelated evidence/);
  });

  test("rejects non-canonical decision sets and digest-consistent forged audits", () => {
    const decisions = buildIndexerExampleDecisionSet({
      inventory,
      decisions: completeDecisions(),
    });
    const nonCanonical = structuredClone(decisions);
    nonCanonical.decisions.reverse();
    expect(() => validateIndexerExampleDecisionSet({
      value: nonCanonical,
      inventory,
    })).toThrow(/non-canonical|invalid digest/);

    const forged = structuredClone(buildIndexerExampleLinkageAudit({
      inventory,
      decision_set: decisions,
    }));
    const linkage = forged.metrics.find((item) =>
      item.metric_id === "example-public-target-linkage"
    )!;
    linkage.numerator = linkage.denominator;
    linkage.actual = 1;
    linkage.covered_example_refs = [
      ...linkage.covered_example_refs,
      ...linkage.missing_example_refs,
    ].sort();
    linkage.missing_example_refs = [];
    const payload = Object.fromEntries(
      Object.entries(forged).filter(([key]) => key !== "audit_digest"),
    ) as Omit<IndexerExampleLinkageAudit, "audit_digest">;
    forged.audit_digest = indexerExampleLinkageAuditDigest(payload);
    expect(() => validateIndexerExampleLinkageAudit({
      value: forged,
      inventory,
      decision_set: decisions,
    })).toThrow(/does not match its current inputs/);
  });
});
