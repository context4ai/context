import { describe, expect, test } from "bun:test";
import {
  buildIndexerRequirementInspection,
  buildIndexerRequirementWorksetReport,
  confirmIndexerRequirementWorkset,
  indexerProtocolDigest,
  validateIndexerRequirementInspection,
  validateIndexerRequirementWorksetConfirmation,
  validateIndexerRequirementWorksetReport,
  type IndexRequirement,
  type ResolvedQuestionContractView,
} from "../index.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const SELECTOR_DIGEST = `sha256:${"b".repeat(64)}`;
const SOURCE_BOUNDARY_DIGEST = `sha256:${"c".repeat(64)}`;

function requirement(overrides: Partial<IndexRequirement> = {}): IndexRequirement {
  return {
    id: "service-understanding",
    reader_goals: ["operate", "understand"],
    coverage_domains: {
      operations: "required",
      architecture: "required",
    },
    questions: [{
      ref: "question:service/operational-risk",
      authority: {
        kind: "cli-base-contract",
        ref: "profile:service/base",
        digest: DIGEST,
      },
      contract_version: 1,
      contract_digest: DIGEST,
    }],
    target_scope: {
      targets: [{
        source_ref: "repo:20260827/service",
        module_refs: ["module:web", "module:api"],
      }],
    },
    evidence_source_scope: {
      targets: [{
        source_ref: "docs:20260827/runbook",
        module_refs: [],
      }],
    },
    ...overrides,
  };
}

function questionContract(): ResolvedQuestionContractView {
  return {
    ref: "question:service/operational-risk",
    contractDigest: DIGEST,
    semanticId: "operational-risk",
    coverageDomain: "operations",
    targetDomainId: "service-module",
    selectorContractDigest: SELECTOR_DIGEST,
    targetRefs: ["domain:service-module"],
    evidence: {
      acceptedKinds: ["runbook", "runtime-observation"],
      minimumItems: 1,
      minimumDistinctSources: 1,
      provenanceRequired: true,
    },
  };
}

function inspection(requirements: IndexRequirement[]) {
  return buildIndexerRequirementInspection({
    value: {
      protocol: "context.indexer.requirement-inspection-input/v1",
      project_ref: "project:sample",
      requirements,
      question_contracts: [questionContract()],
    },
    source_boundary_digest: SOURCE_BOUNDARY_DIGEST,
  });
}

describe("0.7.0 Indexer requirement lifecycle", () => {
  test("normalizes requirement order and exposes scenario/capability/evidence summary", () => {
    const result = inspection([requirement()]);

    expect(result.requirement_set.requirements[0]!.reader_goals).toEqual([
      "operate",
      "understand",
    ]);
    expect(result.requirement_set.requirements[0]!.target_scope.targets[0]!.module_refs)
      .toEqual(["module:api", "module:web"]);
    expect(result.summary).toEqual([{
      scenario: "service-understanding",
      reader_goals: ["operate", "understand"],
      capabilities: [
        { coverage_domain: "architecture", obligation: "required" },
        { coverage_domain: "operations", obligation: "required" },
      ],
      evidence_kinds: ["runbook", "runtime-observation"],
      target_source_refs: ["repo:20260827/service"],
      evidence_source_refs: ["docs:20260827/runbook"],
    }]);
    expect(validateIndexerRequirementInspection(result)).toEqual(result);
  });

  test("confirms an initial requirement batch with managed authority", () => {
    const draft = inspection([requirement()]);
    const report = buildIndexerRequirementWorksetReport({
      inspection: draft,
      base_requirement_set: null,
    });
    const confirmation = confirmIndexerRequirementWorkset({
      report,
      authority: "managed",
      confirmed_by: "context-agent",
      confirmed_at: "2026-08-27T10:00:00+08:00",
    });

    expect(report.relation).toBe("strengthening");
    expect(report.requires_human_confirmation).toBe(false);
    expect(report.changes.map((change) => change.kind)).toEqual(["added"]);
    expect(confirmation.gate).toBe("confirm-index-requirements");
    expect(validateIndexerRequirementWorksetReport(report)).toEqual(report);
    expect(validateIndexerRequirementWorksetConfirmation({ report, confirmation }))
      .toEqual(confirmation);
  });

  test("routes contractions and mixed changes to a non-delegable human Gate", () => {
    const base = inspection([requirement(), requirement({
      id: "removed-scenario",
      questions: undefined,
    })]).requirement_set;
    const target = inspection([requirement({
      reader_goals: ["understand"],
    }), requirement({
      id: "new-scenario",
      questions: undefined,
    })]);
    const report = buildIndexerRequirementWorksetReport({
      inspection: target,
      base_requirement_set: base,
      comparator_options: {
        "service-understanding": {
          oldQuestionContracts: [questionContract()],
          newQuestionContracts: [questionContract()],
        },
      },
    });

    expect(report.relation).toBe("incomparable");
    expect(report.requires_human_confirmation).toBe(true);
    expect(() => confirmIndexerRequirementWorkset({
      report,
      authority: "managed",
      confirmed_by: "context-agent",
      confirmed_at: "2026-08-27T10:00:00+08:00",
    })).toThrow(/cannot be delegated/);

    const confirmation = confirmIndexerRequirementWorkset({
      report,
      authority: "human",
      confirmed_by: "reviewer",
      confirmed_at: "2026-08-27T10:01:00+08:00",
    });
    expect(confirmation.gate).toBe("confirm-index-requirement-contraction");
    expect(confirmation.non_delegable).toBe(true);
  });

  test("rejects stale report and confirmation digests", () => {
    const draft = inspection([requirement()]);
    const report = buildIndexerRequirementWorksetReport({
      inspection: draft,
      base_requirement_set: null,
    });
    const tampered = {
      ...report,
      target_requirement_set_digest: indexerProtocolDigest({ tampered: true }),
    };
    expect(() => validateIndexerRequirementWorksetReport(tampered)).toThrow();

    const confirmation = confirmIndexerRequirementWorkset({
      report,
      authority: "managed",
      confirmed_by: "context-agent",
      confirmed_at: "2026-08-27T10:00:00+08:00",
    });
    expect(() => validateIndexerRequirementWorksetConfirmation({
      report,
      confirmation: { ...confirmation, confirmed_by: "other" },
    })).toThrow(/stale or invalid/);
  });
});
