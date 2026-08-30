import { describe, expect, test } from "bun:test";
import {
  applyIndexerMaterialQuestionExclusion,
  checkpointIndexerEmittedMaterialGaps,
  confirmIndexerMaterialQuestionExclusion,
  deriveIndexerMaterialGapSeverity,
  indexerMaterialGapLedgerRevision,
  indexerMaterialGapQuestionKey,
  indexerMaterialQuestionExclusionReportDigest,
  indexerQuestionRevisionDigest,
  proposeIndexerMaterialQuestionExclusion,
  validateIndexerMaterialGapLedger,
  type IndexerUnresolvedMaterialGap,
} from "../index.js";
import {
  OWNER_REF,
  approve,
  digest,
  inventory,
  ledger,
  question,
  unresolvedEntry,
} from "./indexerMaterialAnswerV070.fixture.js";

describe("Material Gap Ledger retained state", () => {
  test("stores one strict canonical unresolved state without severity or runtime data", () => {
    const current = ledger();
    expect(validateIndexerMaterialGapLedger(current)).toEqual(current);
    expect(current.entries[0]!.state).toBe("unresolved");
    expect(deriveIndexerMaterialGapSeverity({ domain_state: "required" })).toBe("blocking");
    expect(deriveIndexerMaterialGapSeverity({ domain_state: "optional" })).toBe("recommended");
    expect(deriveIndexerMaterialGapSeverity({ domain_state: "out-of-scope" })).toBeUndefined();

    const forbidden = structuredClone(current) as unknown as Record<string, unknown>;
    (forbidden.entries as Array<Record<string, unknown>>)[0]!.severity = "blocking";
    (forbidden.entries as Array<Record<string, unknown>>)[0]!.answer_body = "runtime text";
    expect(() => validateIndexerMaterialGapLedger(forbidden)).toThrow();
  });

  test("reconciles only authoritative owners and reopens changed dependencies", () => {
    const original = unresolvedEntry();
    const other = {
      ...original,
      owner_cell_ref: "owner-cell:other#operations",
    };
    other.question_revision_digest = indexerQuestionRevisionDigest({
      question_contract_digest: other.question_contract_digest,
      question_key: indexerMaterialGapQuestionKey(other),
      owner_cell_digest: other.dependencies.owner_cell_digest,
      question_target_item_digest: other.question_target_item_digest,
      ...(other.dependencies.answer_landing_dependency_digest === undefined
        ? {}
        : {
            answer_landing_dependency_digest:
              other.dependencies.answer_landing_dependency_digest,
          }),
    });
    const base = ledger([original, other]);
    const partial = checkpointIndexerEmittedMaterialGaps({
      ledger: base,
      expected_revision: base.revision,
      authoritative_owner_cell_refs: [OWNER_REF],
      current_entries: [],
    });
    expect(partial.entries).toHaveLength(1);
    expect(partial.entries[0]!.owner_cell_ref).toBe(other.owner_cell_ref);

    const approved = approve(ledger());
    const changedEntry: IndexerUnresolvedMaterialGap = {
      ...unresolvedEntry(),
      dependencies: {
        ...unresolvedEntry().dependencies,
        emitted_question_digest: digest("8"),
      },
    };
    const reopened = checkpointIndexerEmittedMaterialGaps({
      ledger: approved.ledger,
      expected_revision: approved.ledger.revision,
      authoritative_owner_cell_refs: [OWNER_REF],
      current_entries: [changedEntry],
    });
    expect(reopened.entries[0]!.state).toBe("unresolved");
    expect(reopened.entries[0]).not.toHaveProperty("answer");
  });

  test("persists only an exact contract-allowlisted exclusion and reopens on freshness change", () => {
    const initial = ledger();
    const questionKey = indexerMaterialGapQuestionKey(initial.entries[0]!);
    expect(() => proposeIndexerMaterialQuestionExclusion({
      ledger: initial,
      expected_revision: initial.revision,
      project_ref: "project:sample",
      question_key: questionKey,
      resolved_question: question(),
      reason_code: "business-choice",
      domain_state: "required",
      reader_impact: "The target would remain unanswered.",
    })).toThrow(/allowlisted/);
    const report = proposeIndexerMaterialQuestionExclusion({
      ledger: initial,
      expected_revision: initial.revision,
      project_ref: "project:sample",
      question_key: questionKey,
      resolved_question: question(),
      reason_code: "not-applicable",
      domain_state: "required",
      reader_impact: "The exact recovery target will remain intentionally unanswered.",
    });
    expect(() => confirmIndexerMaterialQuestionExclusion({
      report,
      authority: "managed",
      confirmed_by: "authority:managed",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    })).toThrow(/managed delegation/);
    const confirmation = confirmIndexerMaterialQuestionExclusion({
      report,
      authority: "human",
      confirmed_by: "user:reviewer",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    });
    const forgedReport = structuredClone(report);
    forgedReport.question_target_item_digest = digest("9");
    const { report_digest: _oldReportDigest, ...forgedPayload } = forgedReport;
    void _oldReportDigest;
    forgedReport.report_digest = indexerMaterialQuestionExclusionReportDigest(
      forgedPayload,
    );
    const forgedConfirmation = confirmIndexerMaterialQuestionExclusion({
      report: forgedReport,
      authority: "human",
      confirmed_by: "user:reviewer",
      confirmed_at: "2026-08-27T12:00:00.000Z",
    });
    expect(() => applyIndexerMaterialQuestionExclusion({
      ledger: initial,
      expected_revision: initial.revision,
      report: forgedReport,
      confirmation: forgedConfirmation,
      resolved_question: question(),
      domain_state: "required",
    })).toThrow(/stale|invalid/);
    const excluded = applyIndexerMaterialQuestionExclusion({
      ledger: initial,
      expected_revision: initial.revision,
      report,
      confirmation,
      resolved_question: question(),
      domain_state: "required",
    });
    expect(excluded.entries[0]).toMatchObject({
      state: "excluded-with-confirmed-reason",
      exclusion: {
        reason_code: "not-applicable",
        decision_digest: confirmation.decision_digest,
      },
    });
    expect(excluded.entries[0]).not.toHaveProperty("answer");
    const excludedEntry = excluded.entries[0];
    if (excludedEntry?.state !== "excluded-with-confirmed-reason") {
      throw new Error("expected confirmed exclusion");
    }
    expect(excludedEntry.exclusion).not.toHaveProperty("report_digest");

    const changed = {
      ...unresolvedEntry(),
      dependencies: {
        ...unresolvedEntry().dependencies,
        requirement_digest: digest("8"),
      },
    };
    const reopened = checkpointIndexerEmittedMaterialGaps({
      ledger: excluded,
      expected_revision: excluded.revision,
      authoritative_owner_cell_refs: [OWNER_REF],
      current_entries: [changed],
    });
    expect(reopened.entries[0]!.state).toBe("unresolved");
  });

  test("rejects revision, evidence-item, state-combination, and ordering drift", () => {
    const approved = approve();
    const revisionDrift = structuredClone(approved.ledger);
    revisionDrift.revision = digest("9");
    expect(() => validateIndexerMaterialGapLedger(revisionDrift)).toThrow(/revision/);

    const evidenceDrift = structuredClone(approved.ledger);
    const answerEntry = evidenceDrift.entries[0];
    if (answerEntry?.state !== "answer-approved") throw new Error("expected answer");
    answerEntry.answer.evidence[0]!.evidence_item_ref = "evidence-item:forged";
    const rebuilt = {
      protocol: "context.indexer.material-gap-ledger/v1" as const,
      question_target_inventory_digest: evidenceDrift.question_target_inventory_digest,
      entries: evidenceDrift.entries,
      revision: "",
    };
    rebuilt.revision = indexerMaterialGapLedgerRevision({
      protocol: rebuilt.protocol,
      question_target_inventory_digest: rebuilt.question_target_inventory_digest,
      entries: rebuilt.entries,
    });
    expect(() => validateIndexerMaterialGapLedger(rebuilt)).toThrow(/item ref/);

    const halfState = structuredClone(ledger()) as unknown as Record<string, unknown>;
    const halfEntry = (halfState.entries as Array<Record<string, unknown>>)[0]!;
    halfEntry.state = "resolved";
    expect(() => validateIndexerMaterialGapLedger(halfState)).toThrow();
  });

  test("keeps complete inventory replacement explicit", () => {
    const current = ledger();
    expect(() => checkpointIndexerEmittedMaterialGaps({
      ledger: current,
      expected_revision: current.revision,
      authoritative_owner_cell_refs: [],
      current_entries: [],
      complete_inventory_digest: inventory().inventory_digest,
    })).toThrow(/authority for every retained owner/);
  });
});
