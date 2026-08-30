import {
  buildIndexerIncrementalImpactReport,
  buildIndexerRunEnvelope,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerProtocolDigest,
  validateIndexerMainAcceptedRecord,
  validateIndexerMainRunRequest,
  type IndexerIncrementalImpactReport,
} from "@c4a/context";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";

interface AcceptedAuthorRecord {
  accepted_record: unknown;
  run_envelope: unknown;
  dependency_view: unknown;
  artifact_dependency_set: unknown;
}

interface CurrentRunBinding {
  previous_acceptance_digest: string;
  current_request: unknown;
  current_dependency_view: unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function bindings(value: unknown): CurrentRunBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("current_runs must be a non-empty array");
  }
  return value.map((candidate, index) => {
    const item = record(candidate, `current_runs[${index}]`);
    if (
      Object.keys(item).some((key) =>
        key !== "previous_acceptance_digest" &&
        key !== "current_request" &&
        key !== "current_dependency_view"
      ) ||
      typeof item.previous_acceptance_digest !== "string"
    ) {
      throw new TypeError("current_runs entries must bind one previous acceptance to one current run");
    }
    return {
      previous_acceptance_digest: item.previous_acceptance_digest,
      current_request: item.current_request,
      current_dependency_view: item.current_dependency_view,
    };
  });
}

function reportIdentity(report: IndexerIncrementalImpactReport): string {
  return `${report.indexer_id}\u0000${report.logical_unit_ref}`;
}

export function buildProjectIndexerIncrementalImpactFromRecords(input: {
  value: unknown;
  records: readonly AcceptedAuthorRecord[];
}) {
  const value = record(input.value, "Indexer incremental impact input");
  if (value.protocol !== "context.indexer.incremental-impact-input/v1") {
    throw new TypeError("Indexer incremental impact input protocol is invalid");
  }
  const currentRuns = bindings(value.current_runs);
  const accepted = input.records.map((candidate) => ({
    candidate,
    record: validateIndexerMainAcceptedRecord(candidate.accepted_record),
  }));
  if (
    accepted.length === 0 ||
    accepted.some(({ record }) => record.stage !== "author")
  ) {
    throw new TypeError("incremental impact requires the complete accepted author Result set");
  }
  const byAcceptance = new Map(accepted.map((item) => [
    item.record.acceptance_digest,
    item,
  ]));
  const supplied = new Set(currentRuns.map((item) => item.previous_acceptance_digest));
  if (
    byAcceptance.size !== accepted.length ||
    supplied.size !== currentRuns.length ||
    supplied.size !== byAcceptance.size ||
    [...supplied].some((digest) => !byAcceptance.has(digest))
  ) {
    throw new TypeError(
      "current_runs must exactly cover the complete accepted author Result set without duplicates",
    );
  }

  const reports = currentRuns.map((binding) => {
    const previous = byAcceptance.get(binding.previous_acceptance_digest)!;
    const request = validateIndexerMainRunRequest(binding.current_request);
    if (request.workset.stage !== "author") {
      throw new TypeError("incremental impact current requests must use the author stage");
    }
    const currentEnvelope = buildIndexerRunEnvelope({
      workset: request.workset,
      execution_request_digest: request.execution_request_digest,
      final_authority: request.final_authority,
      run_environment: request.run_environment,
    });
    const report = buildIndexerIncrementalImpactReport({
      previous_run_envelope: previous.candidate.run_envelope,
      previous_dependency_view: previous.candidate.dependency_view,
      previous_dependency_set: previous.candidate.artifact_dependency_set,
      current_run_envelope: currentEnvelope,
      current_dependency_view: binding.current_dependency_view,
    });
    if (
      report.previous_run_envelope_digest !== previous.record.run_envelope_digest ||
      report.previous_dependency_set_digest !==
        previous.record.artifact_dependency_set_digest
    ) {
      throw new TypeError("accepted author record does not bind its persisted Merkle inputs");
    }
    return report;
  }).sort((left, right) =>
    compareIndexerCanonicalText(reportIdentity(left), reportIdentity(right))
  );
  if (new Set(reports.map(reportIdentity)).size !== reports.length) {
    throw new TypeError("accepted author Result set contains duplicate logical-unit identities");
  }

  const staleArtifactCount = reports.reduce(
    (total, report) => total + report.stale_artifact_count,
    0,
  );
  const staleSectionCount = reports.reduce(
    (total, report) => total + report.stale_section_count,
    0,
  );
  const previousAcceptanceDigests = accepted.map(({ record }) => record.acceptance_digest)
    .sort(compareIndexerCanonicalText);
  const payload = {
    protocol: "context.indexer.incremental-impact-report-set/v1" as const,
    previous_accepted_result_set_digest: indexerProtocolDigest({
      protocol: "context.indexer.accepted-author-result-set/v1",
      acceptance_digests: previousAcceptanceDigests,
    }),
    logical_unit_count: reports.length,
    stale_logical_unit_count: reports.filter((report) =>
      report.logical_unit_state === "stale"
    ).length,
    stale_artifact_count: staleArtifactCount,
    stale_section_count: staleSectionCount,
    recompute_required: staleArtifactCount > 0 || reports.some((report) =>
      report.recompute_scope === "logical-unit-empty"
    ),
    reports,
  };
  const reportSetDigest = indexerProtocolDigest(payload);
  const output = {
    ...payload,
    report_set_digest: reportSetDigest,
    outcome: "indexer-incremental-impact-reported" as const,
    graph_outcome: "completed" as const,
  };
  canonicalIndexerJson(output);
  return output;
}

export async function reportProjectIndexerIncrementalImpact(input: {
  projectRoot: string;
  value: unknown;
}) {
  return buildProjectIndexerIncrementalImpactFromRecords({
    value: input.value,
    records: await readAcceptedIndexerMainAuthorResultRecords(input.projectRoot),
  });
}
