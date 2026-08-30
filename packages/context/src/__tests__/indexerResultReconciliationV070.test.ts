import { describe, expect, test } from "bun:test";
import {
  buildIndexerQuestionTargetInventory,
  buildIndexerMaterialGapLedger,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  canonicalOwnerCellRef,
  indexerArtifactResultDigest,
  indexerEvidenceBindingDigest,
  indexerMaterialQuestionKey,
  indexerProtocolDigest,
  indexerRegistryDigests,
  indexerResolvedMaterialQuestionDigest,
  reconcileIndexerResults,
  type IndexerArtifactResult,
  type IndexerRegistry,
  type IndexerResolvedMaterialQuestion,
  type IndexerSubjectKey,
} from "../index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const REQUIREMENT_ID = "workspace-knowledge";
const REQUIREMENT_REF = `requirement:${REQUIREMENT_ID}`;
const SOURCE_REF = "repo:sample";
const MODULE_REF = "module:service";
const DOMAIN = "operations";
const QUESTION_REF = "question:failure-recovery";
const SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample",
  kind: "service",
  local_key: "worker",
};

function question(): IndexerResolvedMaterialQuestion {
  const payload: Omit<IndexerResolvedMaterialQuestion, "contract_digest"> = {
    ref: QUESTION_REF,
    authority: {
      kind: "cli-base-contract",
      ref: "contract:community-service",
      digest: digest("a"),
    },
    contract_version: 1,
    semantic: "How does the service recover after a failed operation?",
    coverage_domain: DOMAIN,
    target_domain_ref: "service",
    target_selector: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.visibility", value: "public" },
    },
    evidence_contract: {
      accepted_kinds: ["code", "runbook"],
      minimum_items: 1,
      minimum_distinct_sources: 1,
    },
  };
  return {
    ...payload,
    contract_digest: indexerResolvedMaterialQuestionDigest(payload),
  };
}

function registry(withOwner = true): IndexerRegistry {
  const resolved = question();
  return {
    protocol: "context.indexer.registry/v1",
    requirements: [{
      id: REQUIREMENT_ID,
      reader_goals: ["operate-service"],
      coverage_domains: { [DOMAIN]: "required" },
      questions: [{
        ref: resolved.ref,
        authority: resolved.authority,
        contract_version: resolved.contract_version,
        contract_digest: resolved.contract_digest,
      }],
      target_scope: {
        targets: [{ source_ref: SOURCE_REF, module_refs: [MODULE_REF] }],
      },
      evidence_source_scope: {
        targets: [{ source_ref: "source:runbook", module_refs: [] }],
      },
    }],
    indexers: withOwner ? [{
      id: "service-indexer",
      operations: ["main-index"],
      requirement_bindings: [{
        requirement_ref: REQUIREMENT_ID,
        coverage_domains: [DOMAIN],
        owned_scope: { ref: `requirement:${REQUIREMENT_ID}#target_scope` },
        role: "primary",
      }],
      read_scope: { refs: [`requirement:${REQUIREMENT_ID}#target_scope`] },
      profile: { primary: { id: "domain-service", provider: "community" } },
      providers: [{
        id: "community",
        role: "primary",
        skill: "context-code-indexer",
        version: "0.7.0",
        integrity: digest("b"),
        distribution: {
          kind: "cli-bundled",
          locator: "cli-bundled://context/context-code-indexer",
        },
      }],
    }] : [],
  };
}

function authority(registryValue = registry()) {
  const ownerRef = canonicalOwnerCellRef({
    requirementRef: REQUIREMENT_ID,
    coverageDomain: DOMAIN,
    sourceRef: SOURCE_REF,
    moduleRef: MODULE_REF,
  });
  const inventory = buildIndexerQuestionTargetInventory({
    requirement_set_digest: indexerRegistryDigests(registryValue).requirementSetDigest,
    profile_contract_digests: [digest("c")],
    source_inventory_digests: [digest("d")],
    items: [{
      target_domain_ref: "service",
      requirement_ref: REQUIREMENT_REF,
      owner_cell_ref: ownerRef,
      source_ref: SOURCE_REF,
      module_ref: MODULE_REF,
      subject_key: SUBJECT,
      canonical_fact_slice_digest: digest("e"),
    }],
  });
  const target = inventory.items[0]!;
  return {
    ownerRef,
    inventory,
    target,
    questionKey: indexerMaterialQuestionKey({
      owner_cell_ref: ownerRef,
      question_contract_digest: question().contract_digest,
      question_subject_target_ref: target.target_ref,
    }),
  };
}

function result(input: {
  questionKey: string;
  disposition: "answered" | "material-gap" | "omitted";
}): IndexerArtifactResult {
  const evidencePayload = {
    evidence_ref: "evidence:worker-recovery",
    kind: "code" as const,
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    locator: { path: "src/worker.ts", start_line: 1, end_line: 20 },
    content_digest: digest("f"),
    coverage_tier: "ast-catalog" as const,
  };
  const evidence = {
    ...evidencePayload,
    binding_digest: indexerEvidenceBindingDigest(evidencePayload),
  };
  const proposal = {
    proposal_ref: "proposal:worker-recovery",
    requirement_ref: REQUIREMENT_REF,
    question_ref: QUESTION_REF,
    question_target_key: input.questionKey,
    source_hints: ["source:runbook"],
  };
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: digest("1"),
    partition_plan_binding_digest: digest("2"),
    group_projection_digest: digest("3"),
    indexer_id: "service-indexer",
    provider_layer_ref: "provider:community#layer:primary",
    provider_integrity: digest("4"),
    provider_bundle_digest: digest("5"),
    config_fingerprint: digest("6"),
    customization_fingerprint: null,
    requirement_ref: REQUIREMENT_REF,
    source_ref: SOURCE_REF,
    module_ref: MODULE_REF,
    source_role: "authoritative-source",
    logical_unit: {
      group_key: "service:worker",
      subject_key: SUBJECT,
      logical_unit_ref: "node:worker",
      target_resolution_dispositions: [],
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: "node:worker",
      member_ids: ["member:worker"],
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: digest("1"),
      group_projection_digest: digest("3"),
      logical_unit_ref: "node:worker",
      dispositions: input.disposition === "material-gap"
        ? [{
            member_id: "member:worker",
            member_kind: "service",
            inventory_disposition: "request-material",
            material_question_proposal_ref: proposal.proposal_ref,
          }]
        : [{
            member_id: "member:worker",
            member_kind: "service",
            inventory_disposition: "owned",
            projection_disposition: "boundary-only",
            evidence_refs: [evidence.evidence_ref],
          }],
    }),
    facts: [],
    evidence_bindings: [evidence],
    artifacts: [],
    artifact_bundle: null,
    material_question_proposals: input.disposition === "material-gap" ? [proposal] : [],
    question_target_dispositions: input.disposition === "answered"
      ? [{
          question_target_key: input.questionKey,
          state: "answered",
          evidence_binding_digest: evidence.binding_digest,
        }]
      : input.disposition === "material-gap"
      ? [{
          question_target_key: input.questionKey,
          state: "material-gap",
          material_question_proposal_ref: proposal.proposal_ref,
        }]
      : [],
    diagnostics: [],
    input_digest: digest("7"),
  };
  return {
    ...payload,
    output_digest: indexerArtifactResultDigest(payload),
  };
}

function reconcile(input: {
  registry?: IndexerRegistry;
  disposition?: "answered" | "material-gap" | "omitted";
  withResult?: boolean;
  withMaterial?: boolean;
  inventoryUnsupported?: boolean;
  additionalTarget?: boolean;
} = {}) {
  const registryValue = input.registry ?? registry();
  const current = authority(registryValue);
  const authorResult = result({
    questionKey: current.questionKey,
    disposition: input.disposition ?? "answered",
  });
  const questionTargetInventory = input.additionalTarget === true
    ? buildIndexerQuestionTargetInventory({
        requirement_set_digest: current.inventory.requirement_set_digest,
        profile_contract_digests: current.inventory.profile_contract_digests,
        source_inventory_digests: current.inventory.source_inventory_digests,
        items: [{
          target_domain_ref: current.target.target_domain_ref,
          requirement_ref: current.target.requirement_ref,
          owner_cell_ref: current.target.owner_cell_ref,
          source_ref: current.target.source_ref,
          module_ref: current.target.module_ref,
          subject_key: current.target.subject_key,
          canonical_fact_slice_digest: current.target.canonical_fact_slice_digest,
        }, {
          target_domain_ref: current.target.target_domain_ref,
          requirement_ref: current.target.requirement_ref,
          owner_cell_ref: current.target.owner_cell_ref,
          source_ref: current.target.source_ref,
          module_ref: current.target.module_ref,
          subject_key: {
            ...current.target.subject_key,
            local_key: "scheduler",
          },
          canonical_fact_slice_digest: digest("9"),
        }],
      })
    : current.inventory;
  if (input.inventoryUnsupported === true) {
    authorResult.inventory_dispositions = buildIndexerInventoryDispositionSet({
      author_workset_digest: authorResult.author_workset_digest,
      group_projection_digest: authorResult.group_projection_digest,
      logical_unit_ref: authorResult.logical_unit.logical_unit_ref,
      dispositions: [{
        member_id: "member:worker",
        member_kind: "service",
        inventory_disposition: "unsupported",
        missing_capabilities: ["service-parser"],
      }],
    });
    const { output_digest: _digest, ...payload } = authorResult;
    void _digest;
    authorResult.output_digest = indexerArtifactResultDigest(payload);
  }
  return reconcileIndexerResults({
    registry: registryValue,
    question_target_inventory: questionTargetInventory,
    resolved_questions: [{ requirement_ref: REQUIREMENT_REF, question: question() }],
    target_facts: Object.fromEntries(questionTargetInventory.items.map((item) => [
      item.target_ref,
      { target: { visibility: "public" } },
    ])),
    allowed_selector_fact_paths: new Set(["target.visibility"]),
    author_results: input.withResult === false
      ? []
      : [authorResult],
    registered_material_sources: input.withMaterial ? [{
      source_ref: "source:runbook",
      source_input_digest: digest("8"),
      evidence_kinds: ["runbook"],
    }] : [],
  });
}

describe("Indexer result reconciliation and domain completion", () => {
  test("reports a required domain complete only after owner, author, and question closure", () => {
    const report = reconcile();
    expect(report).toMatchObject({
      outcome: "complete",
      graph_outcome: "completed",
      can_report_complete: true,
      blocking_count: 0,
    });
    expect(report.domains).toEqual([
      expect.objectContaining({
        coverage_domain: DOMAIN,
        state: "completed",
        answered_question_count: 1,
      }),
    ]);
  });

  test("turns an unsupported required inventory member into a capability blocker", () => {
    const report = reconcile({ inventoryUnsupported: true });
    expect(report).toMatchObject({
      outcome: "indexer-capability-gap",
      graph_outcome: "blocked",
      can_report_complete: false,
    });
    expect(report.capability_gaps).toEqual([
      expect.objectContaining({ reason_code: "inventory-member-unsupported" }),
    ]);
  });

  test("turns an omitted required question pair into a blocking material gap", () => {
    const report = reconcile({ disposition: "omitted" });
    expect(report.outcome).toBe("index-material-required");
    expect(report.can_report_complete).toBe(false);
    expect(report.material_gaps).toEqual([
      expect.objectContaining({
        reason_code: "provider-omitted-required-question",
        severity: "blocking",
        registered_material_source_refs: [],
      }),
    ]);
    expect(report.domains[0]).toMatchObject({
      state: "partial",
      material_gap_count: 1,
    });
  });

  test("does not let one merged Provider Result shrink a two-target denominator", () => {
    const report = reconcile({ additionalTarget: true });
    expect(report.question_target_inventory_digest).not.toBe(
      authority().inventory.inventory_digest,
    );
    expect(report).toMatchObject({
      outcome: "index-material-required",
      can_report_complete: false,
      domains: [{
        answered_question_count: 1,
        material_gap_count: 1,
      }],
    });
    expect(report.material_gaps).toEqual([
      expect.objectContaining({
        reason_code: "provider-omitted-required-question",
        severity: "blocking",
      }),
    ]);
  });

  test("retains a material gap even when an authorized material source is registered", () => {
    const report = reconcile({ disposition: "material-gap", withMaterial: true });
    expect(report.outcome).toBe("index-material-required");
    expect(report.material_gaps[0]).toMatchObject({
      reason_code: "provider-requested-material",
      registered_material_source_refs: ["source:runbook"],
      suggested_source_refs: ["source:runbook"],
    });
  });

  test("keeps missing platform documentation as a blocking material gap", () => {
    const report = reconcile({ disposition: "material-gap" });
    expect(report).toMatchObject({
      outcome: "index-material-required",
      graph_outcome: "partial",
      can_report_complete: false,
    });
    expect(report.material_gaps).toEqual([
      expect.objectContaining({
        reason_code: "provider-requested-material",
        severity: "blocking",
        suggested_source_refs: ["source:runbook"],
        registered_material_source_refs: [],
      }),
    ]);
  });

  test("reports an exact capability gap instead of completing an unowned domain", () => {
    const unowned = registry(false);
    const report = reconcile({ registry: unowned, withResult: false });
    expect(report).toMatchObject({
      outcome: "indexer-capability-gap",
      graph_outcome: "blocked",
      can_report_complete: false,
    });
    expect(report.capability_gaps).toEqual([
      expect.objectContaining({
        owner_cell_ref: authority(unowned).ownerRef,
        reason_code: "missing-primary-owner",
      }),
    ]);
    expect(report.domains[0]?.state).toBe("capability-gap");
  });

  test("binds the report to canonical inputs", () => {
    const report = reconcile();
    expect(report.report_digest).toBe(indexerProtocolDigest(
      Object.fromEntries(Object.entries(report).filter(([key]) => key !== "report_digest")),
    ));
  });

  test("treats a retained ledger from an older complete inventory as stale input", () => {
    const registryValue = registry();
    const first = authority(registryValue);
    const initialReport = reconcile({ disposition: "omitted" });
    const retained = buildIndexerMaterialGapLedger({
      question_target_inventory_digest: first.inventory.inventory_digest,
      entries: [initialReport.material_gaps[0]!.entry],
    });
    const rotatedInventory = buildIndexerQuestionTargetInventory({
      requirement_set_digest: indexerRegistryDigests(registryValue).requirementSetDigest,
      profile_contract_digests: [digest("c")],
      source_inventory_digests: [digest("9")],
      items: [{
        target_domain_ref: "service",
        requirement_ref: REQUIREMENT_REF,
        owner_cell_ref: first.ownerRef,
        source_ref: SOURCE_REF,
        module_ref: MODULE_REF,
        subject_key: SUBJECT,
        canonical_fact_slice_digest: digest("e"),
      }],
    });
    const report = reconcileIndexerResults({
      registry: registryValue,
      question_target_inventory: rotatedInventory,
      resolved_questions: [{ requirement_ref: REQUIREMENT_REF, question: question() }],
      target_facts: {
        [rotatedInventory.items[0]!.target_ref]: { target: { visibility: "public" } },
      },
      allowed_selector_fact_paths: new Set(["target.visibility"]),
      author_results: [result({
        questionKey: first.questionKey,
        disposition: "omitted",
      })],
      registered_material_sources: [],
      retained_material_gap_ledger: retained,
    });
    expect(report.question_target_inventory_digest).toBe(rotatedInventory.inventory_digest);
    expect(report.material_gaps[0]?.entry.state).toBe("unresolved");
  });
});
