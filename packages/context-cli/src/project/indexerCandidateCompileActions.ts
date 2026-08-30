import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerCandidateCompile,
  canonicalIndexerJson,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  type IndexerAcceptedAuthorResultInput,
} from "@c4a/context";
import { loadCliIndexerBaseContracts } from "./indexerCliBundledProvider.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import {
  durableContentDigest,
  recoverDurableSingleFileTransaction,
  runDurableSingleFileTransaction,
} from "./durableSingleFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";

export const INDEXER_CANDIDATE_COMPILE_CURRENT_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "candidate-compile",
  "current.json",
);

const COMPILE_TRANSACTION = "compile-indexer-candidates";

interface AcceptedAuthorRecord {
  run_result: unknown;
  accepted_record: unknown;
  artifact_result: unknown;
  run_envelope: unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function currentResultRef(item: AcceptedAuthorRecord) {
  const accepted = record(item.accepted_record, "accepted author record");
  const artifact = indexerArtifactResultSchema.parse(item.artifact_result);
  return {
    workset_digest: accepted.workset_digest,
    execution_request_digest: accepted.execution_request_digest,
    acceptance_digest: accepted.acceptance_digest,
    artifact_result_digest: artifact.output_digest,
  };
}

function canonicalResultRefs(value: unknown): unknown[] {
  return array(value, "accepted_result_refs")
    .map((item, index) => {
      const ref = record(item, `accepted_result_refs[${index}]`);
      const keys = Object.keys(ref).sort();
      const expected = [
        "acceptance_digest",
        "artifact_result_digest",
        "execution_request_digest",
        "workset_digest",
      ];
      if (
        canonicalIndexerJson(keys) !== canonicalIndexerJson(expected) ||
        expected.some((key) => typeof ref[key] !== "string")
      ) {
        throw new TypeError("accepted_result_refs must contain exact Result identities");
      }
      return ref;
    })
    .sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
}

function renderedByResult(value: unknown): Map<string, unknown[]> {
  const entries = array(value, "rendered_artifacts").map((item, index) => {
    const entry = record(item, `rendered_artifacts[${index}]`);
    if (
      typeof entry.artifact_result_digest !== "string" ||
      !Array.isArray(entry.artifacts) ||
      Object.keys(entry).some((key) =>
        key !== "artifact_result_digest" && key !== "artifacts"
      )
    ) {
      throw new TypeError("rendered_artifacts entries must bind one explicit ArtifactResult");
    }
    return [entry.artifact_result_digest, entry.artifacts] as const;
  });
  const mapped = new Map(entries);
  if (mapped.size !== entries.length) {
    throw new TypeError("rendered_artifacts contains duplicate Result bindings");
  }
  return mapped;
}

export function buildProjectIndexerCandidateCompileFromRecords(input: {
  value: unknown;
  records: readonly AcceptedAuthorRecord[];
  operator_contract: unknown;
  profile_contract: unknown;
}) {
  const value = record(input.value, "Candidate compile input");
  if (value.protocol !== "context.indexer.candidate-compile-input/v1") {
    throw new TypeError("Candidate compile input protocol is invalid");
  }
  const expectedRefs = input.records.map(currentResultRef)
    .sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
  const suppliedRefs = canonicalResultRefs(value.accepted_result_refs);
  if (canonicalIndexerJson(expectedRefs) !== canonicalIndexerJson(suppliedRefs)) {
    throw new TypeError("Candidate compile does not reference the exact current accepted Result set");
  }
  const rendered = renderedByResult(value.rendered_artifacts);
  const acceptedResults: IndexerAcceptedAuthorResultInput[] = input.records.map((item) => {
    const artifact = indexerArtifactResultSchema.parse(item.artifact_result);
    const artifacts = rendered.get(artifact.output_digest) ?? [];
    rendered.delete(artifact.output_digest);
    return {
      run_result: item.run_result,
      accepted_record: item.accepted_record,
      run_envelope: item.run_envelope,
      rendered_artifacts: artifacts,
    };
  });
  if (rendered.size > 0) {
    throw new TypeError("Candidate compile contains rendered output for an unaccepted Result");
  }
  return buildIndexerCandidateCompile({
    layout_proposal_set: value.layout_proposal_set,
    layout_transition: value.layout_transition,
    layout_change_confirmations: array(
      value.layout_change_confirmations,
      "layout_change_confirmations",
    ),
    accepted_results: acceptedResults,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
    subject_key_schema_set: value.subject_key_schema_set,
  });
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function compileProjectIndexerCandidates(input: {
  projectRoot: string;
  value: unknown;
  assetsRoot?: string;
}) {
  const [records, contracts] = await Promise.all([
    readAcceptedIndexerMainAuthorResultRecords(input.projectRoot),
    loadCliIndexerBaseContracts(
      input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot },
    ),
  ]);
  const compile = buildProjectIndexerCandidateCompileFromRecords({
    value: input.value,
    records,
    operator_contract: contracts.operators,
    profile_contract: contracts.profiles,
  });
  const content = `${JSON.stringify(JSON.parse(canonicalIndexerJson(compile)), null, 2)}\n`;
  const transaction = await withProjectWriteLock(
    input.projectRoot,
    COMPILE_TRANSACTION,
    async () => {
      await recoverDurableSingleFileTransaction({
        projectRoot: input.projectRoot,
        kind: COMPILE_TRANSACTION,
        expected_target_path: INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
      });
      const current = await readMaybe(join(
        input.projectRoot,
        INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
      ));
      return runDurableSingleFileTransaction({
        projectRoot: input.projectRoot,
        kind: COMPILE_TRANSACTION,
        target_path: INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
        expected_base_digest: current === undefined ? null : durableContentDigest(current),
        target_content: content,
      });
    },
  );
  const payload = {
    protocol: "context.indexer.candidate-compile-action/v1" as const,
    outcome: "indexer-candidates-compiled" as const,
    graph_outcome: "completed" as const,
    compile,
    transaction,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}
