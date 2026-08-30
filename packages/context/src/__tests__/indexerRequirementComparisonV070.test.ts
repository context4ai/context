import { describe, expect, test } from "bun:test";
import {
  buildIndexerRequirementChangeReport,
  compareIndexRequirementContraction,
  confirmIndexerRequirementChange,
  indexerProtocolDigest,
  indexerRequirementChangeReportDigest,
  validateIndexerRequirementChangeConfirmation,
  validateIndexerRequirementChangeReport,
  type IndexRequirement,
  type ResolvedQuestionContractView,
} from "../index.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function requirement(): IndexRequirement {
  return {
    id: "workspace-knowledge",
    reader_goals: ["understand-capabilities"],
    coverage_domains: {
      public_contract: "required",
      operations: "optional",
    },
    questions: [{
      ref: "question:failure-recovery",
      authority: {
        kind: "cli-base-contract",
        ref: "profile:service/operations",
        digest: DIGEST_A,
      },
      contract_version: 1,
      contract_digest: DIGEST_A,
    }],
    target_scope: {
      targets: [{
        source_ref: "repo:sample-app",
        module_refs: ["module:application"],
      }],
    },
    evidence_source_scope: {
      targets: [{
        source_ref: "repo:sample-app",
        module_refs: ["module:application"],
      }],
    },
    exclusions: [],
  };
}

function questionView(
  contractDigest: string,
  overrides: Partial<ResolvedQuestionContractView> = {},
): ResolvedQuestionContractView {
  return {
    ref: "question:failure-recovery",
    contractDigest,
    semanticId: "failure-recovery",
    coverageDomain: "operations",
    targetDomainId: "service-operation",
    selectorContractDigest: DIGEST_A,
    targetRefs: ["target:service-operation"],
    evidence: {
      acceptedKinds: ["documentation", "runbook"],
      minimumItems: 1,
      minimumDistinctSources: 1,
      provenanceRequired: true,
    },
    ...overrides,
  };
}

describe("RequirementContractionComparator", () => {
  test("uses the ordinary Gate for a strengthening and allows managed confirmation", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.reader_goals.push("operate-reliably");
    const report = buildIndexerRequirementChangeReport({
      project_ref: "project:sample",
      old_requirement: before,
      new_requirement: after,
    });
    const confirmation = confirmIndexerRequirementChange({
      report,
      authority: "managed",
      confirmed_by: "authority:managed-project",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    });
    expect(report.comparison.relation).toBe("strengthening");
    expect(confirmation).toMatchObject({
      gate: "confirm-index-requirements",
      authority: "managed",
      non_delegable: false,
    });
    expect(validateIndexerRequirementChangeConfirmation({ report, confirmation }))
      .toEqual(confirmation);
  });

  test("requires an exact non-delegable human Gate for contraction", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.coverage_domains.public_contract = "optional";
    const report = buildIndexerRequirementChangeReport({
      project_ref: "project:sample",
      old_requirement: before,
      new_requirement: after,
    });
    expect(() => confirmIndexerRequirementChange({
      report,
      authority: "managed",
      confirmed_by: "authority:managed-project",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    })).toThrow(/cannot be delegated/);
    const confirmation = confirmIndexerRequirementChange({
      report,
      authority: "human",
      confirmed_by: "user:reviewer",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    });
    expect(confirmation).toMatchObject({
      gate: "confirm-index-requirement-contraction",
      authority: "human",
      non_delegable: true,
      old_requirement_digest: indexerProtocolDigest(before),
      new_requirement_digest: indexerProtocolDigest(after),
      comparison_digest: report.comparison_digest,
      report_digest: report.report_digest,
    });

    const differentAfter = structuredClone(after);
    differentAfter.reader_goals.push("operate-reliably");
    const differentReport = buildIndexerRequirementChangeReport({
      project_ref: "project:sample",
      old_requirement: before,
      new_requirement: differentAfter,
    });
    expect(() => validateIndexerRequirementChangeConfirmation({
      report: differentReport,
      confirmation,
    })).toThrow(/stale|invalid/);
  });

  test("recomputes the comparator instead of trusting a self-digested report", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.coverage_domains.public_contract = "optional";
    const forged = buildIndexerRequirementChangeReport({
      project_ref: "project:sample",
      old_requirement: before,
      new_requirement: after,
    });
    forged.comparison.relation = "strengthening";
    forged.comparison.requiresHumanConfirmation = false;
    forged.comparison_digest = indexerProtocolDigest(forged.comparison);
    const { report_digest: oldReportDigest, ...forgedPayload } = forged;
    void oldReportDigest;
    forged.report_digest = indexerRequirementChangeReportDigest(forgedPayload);
    expect(() => validateIndexerRequirementChangeReport(forged)).toThrow(/stale|invalid/);
  });

  test("classifies a byte-independent equivalent requirement", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.coverage_domains = {
      operations: "optional",
      public_contract: "required",
    };

    expect(compareIndexRequirementContraction(before, after)).toMatchObject({
      relation: "equivalent",
      requiresHumanConfirmation: false,
      evidenceSourceChange: "unchanged",
      changes: [],
    });
  });

  test("classifies target and reader-goal expansion as strengthening", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.target_scope.targets.push({
      source_ref: "repo:sample-library",
      module_refs: [],
    });
    after.reader_goals.push("operate-reliably");

    expect(compareIndexRequirementContraction(before, after)).toMatchObject({
      relation: "strengthening",
      requiresHumanConfirmation: false,
    });
  });

  test("classifies target deletion and coverage weakening as contraction", () => {
    const before = requirement();
    before.target_scope.targets.push({
      source_ref: "repo:sample-library",
      module_refs: [],
    });
    const after = structuredClone(before);
    after.target_scope.targets.pop();
    after.coverage_domains.public_contract = "optional";

    const comparison = compareIndexRequirementContraction(before, after);
    expect(comparison.relation).toBe("contraction");
    expect(comparison.requiresHumanConfirmation).toBe(true);
    expect(comparison.changes.map((change) => change.area)).toContain("target-scope");
    expect(comparison.changes.map((change) => change.area)).toContain("coverage-domain");
  });

  test("uses canonical reader-goal implication instead of natural-language guessing", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.reader_goals = ["integrate-and-operate"];

    expect(compareIndexRequirementContraction(before, after).relation).toBe("incomparable");
    expect(compareIndexRequirementContraction(before, after, {
      readerGoalImplications: {
        "integrate-and-operate": ["understand-capabilities"],
      },
    }).relation).toBe("strengthening");
  });

  test("treats new exclusions as contraction and removed exclusions as strengthening", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.exclusions = [{
      id: "generated-output",
      scope: {
        targets: [{
          source_ref: "repo:sample-app",
          module_refs: ["module:application"],
        }],
      },
      reason: "Generated output is not an authority.",
    }];

    expect(compareIndexRequirementContraction(before, after).relation).toBe("contraction");
    expect(compareIndexRequirementContraction(after, before).relation).toBe("strengthening");
  });

  test("does not let evidence-only scope changes alter the target obligation", () => {
    const before = requirement();
    const expanded = structuredClone(before);
    expanded.evidence_source_scope.targets.push({
      source_ref: "docs:operations-guide",
      module_refs: [],
    });
    const reduced = structuredClone(expanded);
    reduced.evidence_source_scope.targets = before.evidence_source_scope.targets;

    expect(compareIndexRequirementContraction(before, expanded)).toMatchObject({
      relation: "equivalent",
      evidenceSourceChange: "expanded",
    });
    expect(compareIndexRequirementContraction(expanded, reduced)).toMatchObject({
      relation: "equivalent",
      evidenceSourceChange: "reduced",
    });
  });

  test("requires confirmation when a canonical question is removed", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.questions = [];

    expect(compareIndexRequirementContraction(before, after)).toMatchObject({
      relation: "contraction",
      requiresHumanConfirmation: true,
      changes: [{ area: "question", relation: "contraction" }],
    });
  });

  test("compares resolved selector and evidence contracts mechanically", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.questions![0]!.contract_digest = DIGEST_B;
    after.questions![0]!.contract_version = 2;
    const oldView = questionView(DIGEST_A);
    const newView = questionView(DIGEST_B, {
      selectorContractDigest: DIGEST_B,
      targetRefs: ["target:service-operation", "target:background-operation"],
      evidence: {
        acceptedKinds: ["documentation"],
        minimumItems: 2,
        minimumDistinctSources: 2,
        provenanceRequired: true,
      },
    });

    const comparison = compareIndexRequirementContraction(before, after, {
      oldQuestionContracts: [oldView],
      newQuestionContracts: [newView],
      selectorRelations: {
        "question:failure-recovery": "strengthening",
      },
    });
    expect(comparison.relation).toBe("strengthening");
    expect(comparison.changes.every((change) => change.relation === "strengthening")).toBe(true);
  });

  test("classifies weaker evidence or unavailable canonical contracts as blocking", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.questions![0]!.contract_digest = DIGEST_B;
    after.questions![0]!.contract_version = 2;

    expect(compareIndexRequirementContraction(before, after)).toMatchObject({
      relation: "incomparable",
      requiresHumanConfirmation: true,
    });

    const oldView = questionView(DIGEST_A);
    const newView = questionView(DIGEST_B, {
      evidence: {
        acceptedKinds: ["documentation", "runbook", "runtime-observation"],
        minimumItems: 1,
        minimumDistinctSources: 1,
        provenanceRequired: false,
      },
    });
    expect(compareIndexRequirementContraction(before, after, {
      oldQuestionContracts: [oldView],
      newQuestionContracts: [newView],
    }).relation).toBe("contraction");
  });

  test("classifies mixed strengthening and contraction as incomparable", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.reader_goals.push("operate-reliably");
    after.coverage_domains.public_contract = "optional";

    expect(compareIndexRequirementContraction(before, after)).toMatchObject({
      relation: "incomparable",
      requiresHumanConfirmation: true,
    });
  });

  test("routes every obligation weakening in the contraction table to the human Gate", () => {
    const questionChange = (
      overrides: Partial<ResolvedQuestionContractView>,
    ) => ({
      mutate: (value: IndexRequirement) => {
        value.questions![0]!.contract_digest = DIGEST_B;
        value.questions![0]!.contract_version = 2;
      },
      options: {
        oldQuestionContracts: [questionView(DIGEST_A)],
        newQuestionContracts: [questionView(DIGEST_B, overrides)],
      },
    });
    const cases: Array<{
      name: string;
      mutate: (value: IndexRequirement) => void;
      options?: Parameters<typeof compareIndexRequirementContraction>[2];
    }> = [{
      name: "target deletion",
      mutate: (value) => {
        value.target_scope.targets = [];
      },
    }, {
      name: "reader goal deletion",
      mutate: (value) => {
        value.reader_goals = [];
      },
    }, {
      name: "question deletion",
      mutate: (value) => {
        value.questions = [];
      },
    }, {
      name: "exclusion expansion",
      mutate: (value) => {
        value.exclusions = [{
          id: "generated-output",
          scope: { targets: value.target_scope.targets },
          reason: "Generated output is not an authority.",
        }];
      },
    }, {
      name: "question domain rebind",
      ...questionChange({ coverageDomain: "public_contract" }),
    }, {
      name: "accepted evidence kind expansion",
      ...questionChange({
        evidence: {
          acceptedKinds: ["documentation", "runbook", "runtime-observation"],
          minimumItems: 1,
          minimumDistinctSources: 1,
          provenanceRequired: true,
        },
      }),
    }, {
      name: "minimum evidence cardinality reduction",
      ...questionChange({
        evidence: {
          acceptedKinds: ["documentation", "runbook"],
          minimumItems: 0,
          minimumDistinctSources: 1,
          provenanceRequired: true,
        },
      }),
    }, {
      name: "minimum source cardinality reduction",
      ...questionChange({
        evidence: {
          acceptedKinds: ["documentation", "runbook"],
          minimumItems: 1,
          minimumDistinctSources: 0,
          provenanceRequired: true,
        },
      }),
    }, {
      name: "provenance relaxation",
      ...questionChange({
        evidence: {
          acceptedKinds: ["documentation", "runbook"],
          minimumItems: 1,
          minimumDistinctSources: 1,
          provenanceRequired: false,
        },
      }),
    }];

    for (const item of cases) {
      const before = requirement();
      const after = structuredClone(before);
      item.mutate(after);
      const comparison = compareIndexRequirementContraction(
        before,
        after,
        item.options,
      );
      expect(
        comparison.requiresHumanConfirmation,
        `${item.name} must require human confirmation`,
      ).toBe(true);
      expect(
        ["contraction", "incomparable"],
        `${item.name} must not be treated as equivalent or strengthening`,
      ).toContain(comparison.relation);
    }
  });

  test("does not compare two different requirement identities", () => {
    const before = requirement();
    const after = structuredClone(before);
    after.id = "replacement-requirement";

    expect(() => compareIndexRequirementContraction(before, after)).toThrow(
      /cannot replace a requirement identity/,
    );
  });
});
