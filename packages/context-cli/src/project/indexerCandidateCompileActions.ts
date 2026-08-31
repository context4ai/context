import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerCandidateCompile,
  canonicalIndexerJson,
  type IndexerCandidateCompile,
  indexerCandidateCompileSchema,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  type IndexerAcceptedAuthorResultInput,
} from "@c4a/context";
import {
  indexerCandidateId,
  parseCandidateRecord,
  readCandidateRecords,
  writeCandidateRecords,
  type CandidateRecord,
} from "./candidateLedger.js";
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

function candidateTitle(markdown: string, artifactKind: string): string {
  return /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim() || artifactKind;
}

function candidatePath(outputPath: string, collection: string): string {
  const prefix = "knowledge/";
  const path = outputPath.startsWith(prefix) ? outputPath.slice(prefix.length) : outputPath;
  if (!path.startsWith(`${collection}/`)) {
    throw new TypeError(`Indexer Candidate output path is outside its collection: ${outputPath}`);
  }
  return path;
}

async function approvedFileDigest(
  projectRoot: string,
  outputPath: string,
): Promise<string | undefined> {
  const content = await readMaybe(join(projectRoot, outputPath));
  if (content === undefined) return undefined;
  const match = /^indexer_file_digest:\s*["']?([^"'\n]+)["']?\s*$/mu.exec(content);
  return match?.[1]?.trim();
}

function validatePersistedCompile(value: unknown): IndexerCandidateCompile {
  const compile = indexerCandidateCompileSchema.parse(value);
  const { compile_digest: _compileDigest, ...payload } = compile;
  void _compileDigest;
  if (indexerProtocolDigest(payload) !== compile.compile_digest) {
    throw new TypeError("Persisted Indexer Candidate compile digest is invalid");
  }
  return compile;
}

export interface ProjectIndexerCandidateCompileStatus {
  state: "missing" | "current" | "stale" | "invalid";
  compile?: IndexerCandidateCompile;
  candidates: CandidateRecord[];
  diagnostic?: string;
}

export async function readProjectIndexerCandidateCompileStatus(
  projectRoot: string,
): Promise<ProjectIndexerCandidateCompileStatus> {
  const raw = await readMaybe(join(projectRoot, INDEXER_CANDIDATE_COMPILE_CURRENT_PATH));
  if (raw === undefined) return { state: "missing", candidates: [] };
  try {
    const compile = validatePersistedCompile(JSON.parse(raw) as unknown);
    const accepted = await readAcceptedIndexerMainAuthorResultRecords(projectRoot);
    const currentRefs = accepted.map(currentResultRef)
      .sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
    const compileRefs = compile.result_bindings.map((binding) => ({
      workset_digest: binding.workset_digest,
      execution_request_digest: binding.execution_request_digest,
      acceptance_digest: binding.acceptance_digest,
      artifact_result_digest: binding.artifact_result_digest,
    })).sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
    if (canonicalIndexerJson(currentRefs) !== canonicalIndexerJson(compileRefs)) {
      return {
        state: "stale",
        compile,
        candidates: [],
        diagnostic: "Candidate compile does not bind the exact current accepted author Result set.",
      };
    }
    const rows = (await readCandidateRecords(projectRoot))
      .filter((record) => record.candidate_type === "indexer-artifact");
    const expectedIds = new Set(compile.files.map((file) => indexerCandidateId(file.file_digest)));
    if (rows.some((record) => !expectedIds.has(record.candidate_id))) {
      return {
        state: "stale",
        compile,
        candidates: rows,
        diagnostic: "Candidate ledger contains an Indexer Candidate outside the current compile.",
      };
    }
    for (const file of compile.files) {
      const candidateId = indexerCandidateId(file.file_digest);
      const record = rows.find((candidate) => candidate.candidate_id === candidateId);
      const approved = await approvedFileDigest(projectRoot, file.output_path);
      if (approved === file.file_digest) continue;
      if (
        record === undefined ||
        record.fingerprint !== file.file_digest ||
        record.structure_digest !== compile.compile_digest ||
        record.indexer_candidate?.compile_digest !== compile.compile_digest ||
        canonicalIndexerJson(record.indexer_candidate?.evidence_bindings) !==
          canonicalIndexerJson(file.evidence_bindings) ||
        canonicalIndexerJson(record.indexer_candidate?.sections) !==
          canonicalIndexerJson(file.sections)
      ) {
        return {
          state: "stale",
          compile,
          candidates: rows,
          diagnostic: `Candidate ledger is missing or stale for ${file.file_digest}.`,
        };
      }
    }
    return { state: "current", compile, candidates: rows };
  } catch (error) {
    return {
      state: "invalid",
      candidates: [],
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function assertProjectIndexerCandidateCurrent(input: {
  projectRoot: string;
  record: CandidateRecord;
}): Promise<IndexerCandidateCompile["files"][number]> {
  const raw = await readMaybe(join(
    input.projectRoot,
    INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
  ));
  if (raw === undefined) throw new TypeError("Indexer Candidate compile is missing");
  const compile = validatePersistedCompile(JSON.parse(raw) as unknown);
  const file = compile.files.find((candidate) =>
    candidate.file_digest === input.record.indexer_candidate?.file_digest
  );
  if (
    file === undefined ||
    indexerCandidateId(file.file_digest) !== input.record.candidate_id ||
    input.record.indexer_candidate?.compile_digest !== compile.compile_digest ||
    input.record.fingerprint !== file.file_digest ||
    canonicalIndexerJson(input.record.indexer_candidate.evidence_bindings) !==
      canonicalIndexerJson(file.evidence_bindings) ||
    canonicalIndexerJson(input.record.indexer_candidate.sections) !==
      canonicalIndexerJson(file.sections)
  ) {
    throw new TypeError("Indexer Candidate is not part of the current compile");
  }
  return file;
}

async function projectIndexerCandidates(input: {
  projectRoot: string;
  compile: IndexerCandidateCompile;
  existing: readonly CandidateRecord[];
}): Promise<CandidateRecord[]> {
  const existingById = new Map(input.existing
    .filter((record) => record.candidate_type === "indexer-artifact")
    .map((record) => [record.candidate_id, record]));
  const now = new Date().toISOString();
  const projected = await Promise.all(input.compile.files.map(async (file) => {
    if (await approvedFileDigest(input.projectRoot, file.output_path) === file.file_digest) {
      return undefined;
    }
    const candidateId = indexerCandidateId(file.file_digest);
    const previous = existingById.get(candidateId);
    const candidate = {
      candidate_id: candidateId,
      node_ref: file.node_ref,
      view_ref: file.internal_view_ref,
      collection: file.collection,
      status: previous?.fingerprint === file.file_digest
        ? previous.status
        : "draft" as const,
      candidate_type: "indexer-artifact" as const,
      change: "add" as const,
      kind: file.artifact_kind,
      visibility: "public",
      module: file.indexer_id,
      path: candidatePath(file.output_path, file.collection),
      structure_digest: input.compile.compile_digest,
      source_refs: file.evidence_bindings.length > 0
        ? file.evidence_bindings.map((binding) => binding.evidence_ref)
        : [file.source_ref],
      body: file.markdown,
      fingerprint: file.file_digest,
      indexer_candidate: {
        compile_digest: input.compile.compile_digest,
        file_digest: file.file_digest,
        artifact_ref: file.artifact_ref,
        section_refs: file.section_refs,
        source_ref: file.source_ref,
        evidence_bindings: file.evidence_bindings,
        sections: file.sections,
      },
      review: {
        title: candidateTitle(file.markdown, file.artifact_kind),
        summary: `${file.artifact_kind} Artifact from ${file.indexer_id}.`,
        signals: ["indexer-compiled", "mechanical-audit-bound"],
        reason: "Exact current Indexer Candidate compiled from accepted author Results.",
      },
      updated: previous?.fingerprint === file.file_digest ? previous.updated : now,
    };
    return parseCandidateRecord(candidate, 1);
  }));
  return [
    ...input.existing.filter((record) => record.candidate_type !== "indexer-artifact"),
    ...projected.filter((record): record is CandidateRecord => record !== undefined),
  ];
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
  const persisted = await withProjectWriteLock(
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
      const transaction = await runDurableSingleFileTransaction({
        projectRoot: input.projectRoot,
        kind: COMPILE_TRANSACTION,
        target_path: INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
        expected_base_digest: current === undefined ? null : durableContentDigest(current),
        target_content: content,
      });
      const candidates = await projectIndexerCandidates({
        projectRoot: input.projectRoot,
        compile,
        existing: await readCandidateRecords(input.projectRoot),
      });
      await writeCandidateRecords(input.projectRoot, candidates);
      return { transaction, candidate_count: compile.files.length };
    },
  );
  const payload = {
    protocol: "context.indexer.candidate-compile-action/v1" as const,
    outcome: "indexer-candidates-compiled" as const,
    graph_outcome: "completed" as const,
    compile,
    transaction: persisted.transaction,
    candidate_count: persisted.candidate_count,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}
