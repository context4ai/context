import {
  validateIndexerMaterialGapLedger,
  type IndexerUnresolvedMaterialGap,
} from "./indexerMaterialGapLedger.js";
import type { IndexerArtifactResult } from "./indexerArtifactResult.js";
import { validateIndexerQuestionTargetInventory } from "./indexerQuestionAuthority.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerRegistryDigests,
  indexerRegistrySchema,
} from "./indexerRegistry.js";
import {
  capabilityGap,
  canonicalSources,
  coverageCompletionReportPayloadSchema,
  coverageDomainCompletionSchema,
  dispositionMap,
  exactRetainedEntry,
  indexerCoverageCompletionReportSchema,
  mainEvidenceMeetsContract,
  materialGap,
  ownerCells,
  questionPairs,
  relevantResults,
  requirementRef,
  resolvedQuestions,
  validateArtifactResults,
  type IndexerCoverageCompletionReport,
  type OwnerCell,
  type ResolvedQuestionEntry,
} from "./indexerResultReconciliation.js";

function ownerCapabilityGaps(
  owner: OwnerCell,
  results: readonly IndexerArtifactResult[],
): Array<ReturnType<typeof capabilityGap>> {
  if (owner.owner_indexer_ids.length === 0) {
    return [capabilityGap(owner, "missing-primary-owner", [])];
  }
  if (owner.owner_indexer_ids.length > 1) {
    return [capabilityGap(
      owner,
      "ambiguous-primary-owner",
      owner.owner_indexer_ids,
    )];
  }
  const ownerResults = relevantResults(owner, results);
  const gaps: Array<ReturnType<typeof capabilityGap>> = ownerResults.length === 0
    ? [capabilityGap(owner, "missing-author-result", owner.owner_indexer_ids)]
    : [];
  for (const result of ownerResults) {
    for (const disposition of result.inventory_dispositions.dispositions) {
      if (disposition.inventory_disposition === "unsupported") {
        gaps.push(capabilityGap(
          owner,
          "inventory-member-unsupported",
          owner.owner_indexer_ids,
        ));
      } else if (
        disposition.inventory_disposition === "request-material" &&
        !result.question_target_dispositions.some((question) =>
          question.state === "material-gap" &&
          question.material_question_proposal_ref ===
            disposition.material_question_proposal_ref
        )
      ) {
        gaps.push(capabilityGap(
          owner,
          "inventory-material-gap-missing",
          owner.owner_indexer_ids,
        ));
      }
    }
    for (const disposition of result.logical_unit.target_resolution_dispositions) {
      if (disposition.disposition === "unsupported") {
        gaps.push(capabilityGap(
          owner,
          "target-resolution-unsupported",
          owner.owner_indexer_ids,
        ));
      } else if (disposition.disposition === "request-material") {
        gaps.push(capabilityGap(
          owner,
          "target-resolution-material-required",
          owner.owner_indexer_ids,
        ));
      }
    }
  }
  return gaps;
}

export function reconcileIndexerResults(input: {
  registry: unknown;
  question_target_inventory: unknown;
  resolved_questions: readonly ResolvedQuestionEntry[];
  target_facts: Readonly<Record<string, Record<string, unknown>>>;
  allowed_selector_fact_paths: ReadonlySet<string>;
  author_results: readonly unknown[];
  registered_material_sources: readonly unknown[];
  retained_material_gap_ledger?: unknown;
}): IndexerCoverageCompletionReport {
  const registry = indexerRegistrySchema.parse(input.registry);
  const inventory = validateIndexerQuestionTargetInventory(
    input.question_target_inventory,
  );
  const digests = indexerRegistryDigests(registry);
  if (inventory.requirement_set_digest !== digests.requirementSetDigest) {
    throw new TypeError("reconciliation inventory belongs to another requirement set");
  }
  const owners = ownerCells(registry);
  const questions = resolvedQuestions({
    registry,
    values: input.resolved_questions,
    allowed_selector_fact_paths: input.allowed_selector_fact_paths,
  });
  const { pairs, empty_required: emptyRequired } = questionPairs({
    inventory,
    questions,
    owners,
    target_facts: input.target_facts,
    allowed_selector_fact_paths: input.allowed_selector_fact_paths,
  });
  const results = validateArtifactResults(input.author_results);
  const sources = canonicalSources(input.registered_material_sources);
  const retainedCandidate = input.retained_material_gap_ledger === undefined
    ? undefined
    : validateIndexerMaterialGapLedger(input.retained_material_gap_ledger);
  const retained = retainedCandidate?.question_target_inventory_digest ===
      inventory.inventory_digest
    ? retainedCandidate
    : undefined;
  const dispositions = dispositionMap({ pairs, results });
  const capabilityGaps: Array<ReturnType<typeof capabilityGap>> = [];
  for (const owner of owners.filter((item) => item.obligation === "required")) {
    capabilityGaps.push(...ownerCapabilityGaps(owner, results));
  }
  for (const missing of emptyRequired) {
    const owner = owners.find((item) =>
      item.requirement_ref === missing.requirement_ref &&
      item.coverage_domain === missing.question.coverage_domain
    );
    if (owner !== undefined) {
      capabilityGaps.push(capabilityGap(
        owner,
        "required-question-target-empty",
        owner.owner_indexer_ids,
      ));
    }
  }
  for (const requirement of registry.requirements) {
    for (const binding of requirement.questions ?? []) {
      const current = questions.find((entry) =>
        entry.requirement_ref === requirementRef(requirement.id) &&
        entry.question.ref === binding.ref
      );
      if (current !== undefined) continue;
      const owner = owners.find((item) =>
        item.requirement_id === requirement.id &&
        item.obligation === "required"
      );
      if (owner !== undefined) {
        capabilityGaps.push(capabilityGap(
          owner,
          "required-question-authority-unavailable",
          owner.owner_indexer_ids,
        ));
      }
    }
  }
  const materialGaps: Array<ReturnType<typeof materialGap>> = [];
  const answered = new Set<string>();
  const excluded = new Set<string>();
  for (const pair of pairs) {
    const current = dispositions.get(pair.question_key);
    const placeholder = materialGap({
      registry,
      pair,
      sources,
      ...(retained === undefined ? {} : { retained_ledger: retained }),
      ...(current === undefined ? {} : { disposition: current }),
      reason_code: current?.disposition.state === "material-gap"
        ? "provider-requested-material"
        : "provider-omitted-required-question",
    });
    const retainedEntry = exactRetainedEntry({
      ...(retained === undefined ? {} : { ledger: retained }),
      candidate: placeholder.entry as IndexerUnresolvedMaterialGap,
    });
    if (retainedEntry?.state === "resolved" ||
      retainedEntry?.state === "excluded-with-confirmed-reason") {
      (retainedEntry.state === "resolved" ? answered : excluded).add(pair.question_key);
      continue;
    }
    if (current?.disposition.state === "answered" && mainEvidenceMeetsContract({
      pair,
      result: current.result,
      evidence_binding_digest: current.disposition.evidence_binding_digest,
    })) {
      answered.add(pair.question_key);
      continue;
    }
    materialGaps.push(current?.disposition.state === "answered"
      ? materialGap({
          registry,
          pair,
          sources,
          ...(retained === undefined ? {} : { retained_ledger: retained }),
          disposition: current,
          reason_code: "main-evidence-contract-not-met",
        })
      : placeholder);
  }
  const uniqueCapabilityGaps = [...new Map(capabilityGaps.map((gap) => [
    `${gap.owner_cell_ref}\u0000${gap.reason_code}`,
    gap,
  ])).values()].sort((left, right) =>
    compareIndexerCanonicalText(left.gap_ref, right.gap_ref)
  );
  materialGaps.sort((left, right) =>
    compareIndexerCanonicalText(left.question_key, right.question_key)
  );
  const domains = registry.requirements.flatMap((requirement) =>
    Object.entries(requirement.coverage_domains).map(([domain, obligation]) => {
      const requirement_ref = requirementRef(requirement.id);
      const domainOwners = owners.filter((owner) =>
        owner.requirement_ref === requirement_ref && owner.coverage_domain === domain
      );
      const domainCapabilities = uniqueCapabilityGaps.filter((gap) =>
        gap.requirement_ref === requirement_ref && gap.coverage_domain === domain
      );
      const domainMaterials = materialGaps.filter((gap) =>
        gap.requirement_ref === requirement_ref && gap.coverage_domain === domain
      );
      const domainPairs = pairs.filter((pair) =>
        pair.owner.requirement_ref === requirement_ref &&
        pair.owner.coverage_domain === domain
      );
      const completedOwners = domainOwners.filter((owner) =>
        owner.owner_indexer_ids.length === 1 &&
        relevantResults(owner, results).length > 0 &&
        domainCapabilities.every((gap) => gap.owner_cell_ref !== owner.owner_cell_ref) &&
        domainMaterials.every((gap) => gap.owner_cell_ref !== owner.owner_cell_ref)
      ).length;
      const state = obligation === "out-of-scope"
        ? "out-of-scope" as const
        : domainCapabilities.length > 0
        ? "capability-gap" as const
        : domainMaterials.length > 0
        ? "partial" as const
        : completedOwners === domainOwners.length && domainOwners.length > 0
        ? "completed" as const
        : "partial" as const;
      const domainPayload = {
        requirement_ref,
        coverage_domain: domain,
        obligation,
        state,
        owner_cell_count: domainOwners.length,
        completed_owner_cell_count: completedOwners,
        answered_question_count: domainPairs.filter((pair) =>
          answered.has(pair.question_key)
        ).length,
        excluded_question_count: domainPairs.filter((pair) =>
          excluded.has(pair.question_key)
        ).length,
        material_gap_count: domainMaterials.length,
        capability_gap_count: domainCapabilities.length,
      };
      return coverageDomainCompletionSchema.parse({
        ...domainPayload,
        domain_digest: indexerProtocolDigest(domainPayload),
      });
    })
  ).sort((left, right) => compareIndexerCanonicalText(
    `${left.requirement_ref}\u0000${left.coverage_domain}`,
    `${right.requirement_ref}\u0000${right.coverage_domain}`,
  ));
  const blockingMaterialCount = materialGaps.filter((gap) =>
    gap.severity === "blocking"
  ).length;
  const requiredIncomplete = domains.filter((domain) =>
    domain.obligation === "required" && domain.state !== "completed"
  ).length;
  const outcome = uniqueCapabilityGaps.length > 0
    ? "indexer-capability-gap" as const
    : blockingMaterialCount > 0 || requiredIncomplete > 0
    ? "index-material-required" as const
    : "complete" as const;
  const payload = coverageCompletionReportPayloadSchema.parse({
    protocol: "context.indexer.coverage-completion-report/v1",
    requirement_set_digest: digests.requirementSetDigest,
    registry_digest: digests.registryDigest,
    question_target_inventory_digest: inventory.inventory_digest,
    registered_material_source_set_digest: indexerProtocolDigest({ sources }),
    domains,
    capability_gaps: uniqueCapabilityGaps,
    material_gaps: materialGaps,
    blocking_count: uniqueCapabilityGaps.length + blockingMaterialCount,
    partial_domain_count: domains.filter((domain) =>
      domain.state !== "completed" && domain.state !== "out-of-scope"
    ).length,
    outcome,
    graph_outcome: outcome === "complete"
      ? "completed"
      : outcome === "index-material-required"
      ? "partial"
      : "blocked",
    can_report_complete: outcome === "complete",
  });
  return indexerCoverageCompletionReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerCoverageCompletionReport(input: {
  report: unknown;
  rebuild: () => IndexerCoverageCompletionReport;
}): IndexerCoverageCompletionReport {
  const report = indexerCoverageCompletionReportSchema.parse(input.report);
  const expected = input.rebuild();
  if (canonicalIndexerJson(report) !== canonicalIndexerJson(expected)) {
    throw new TypeError("coverage completion report is stale or invalid");
  }
  return report;
}
