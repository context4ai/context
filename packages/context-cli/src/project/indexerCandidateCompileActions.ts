import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerCandidateCompile,
  canonicalIndexerJson,
  type IndexerCandidateCompile,
  indexerCandidateCompileSchema,
  indexerArtifactResultSchema,
  indexerProtocolDigest,
  indexerRegistryDigests,
  loadIndexerRegistry,
  type IndexerAcceptedAuthorResultInput,
} from "@c4a/context";
import {
  CANDIDATE_LEDGER_FILE,
  candidateRecordsContent,
  indexerCandidateId,
  parseCandidateRecord,
  readCandidateRecords,
  type CandidateRecord,
} from "./candidateLedger.js";
import { readAcceptedIndexerMainAuthorResultRecords } from "./indexerMainRunStore.js";
import { readCurrentIndexerPostAuthorEnvelopeForResult } from "./indexerPostAuthorRunStore.js";
import {
  durableContentDigest,
} from "./durableSingleFileTransaction.js";
import {
  recoverDurableMultiFileTransactions,
  runDurableMultiFileTransaction,
  type DurableMultiFileFailureInjector,
} from "./durableMultiFileTransaction.js";
import { withProjectWriteLock } from "./writeLock.js";
import {
  readApprovedKnowledgeMetadataIndex,
  type ApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";
import { parseFrontmatterLoose } from "./verifyFrontmatter.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { canonicalizeApprovedKnowledgeAssetPair } from "./knowledgeAssetRepair.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";

export const INDEXER_CANDIDATE_COMPILE_CURRENT_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "candidate-compile",
  "current.json",
);
export const INDEXER_CURRENT_READINESS_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "finalization",
  "readiness.json",
);

const COMPILE_TRANSACTION = "compile-indexer-candidates";

interface AcceptedAuthorRecord {
  request: unknown;
  run_result: unknown;
  accepted_record: unknown;
  artifact_result: unknown;
  run_envelope: unknown;
  post_author_envelope?: unknown | null;
}

async function currentRegistryStaleDiagnostic(
  projectRoot: string,
  records: readonly AcceptedAuthorRecord[],
): Promise<string | undefined> {
  let loaded: Awaited<ReturnType<typeof loadIndexerRegistry>>;
  try {
    loaded = await loadIndexerRegistry(projectRoot);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const requirementSetDigest = indexerRegistryDigests(loaded.registry).requirementSetDigest;
  for (const item of records) {
    const request = record(item.request, "accepted author request");
    const workset = record(request.workset, "accepted author request workset");
    if (workset.requirement_set_digest !== requirementSetDigest) {
      return "Accepted author Results do not bind the current requirement set.";
    }
    if (typeof workset.indexer_id !== "string") {
      return "Accepted author Result is missing its Indexer identity.";
    }
    let currentProjection;
    try {
      currentProjection = (await resolveCurrentProjectIndexerPrimaryAuthority({
        projectRoot,
        registry: loaded.registry,
        indexer_id: workset.indexer_id,
      })).primary_registry;
    } catch {
      return `Accepted author Result references inactive Indexer ${workset.indexer_id}.`;
    }
    if (workset.primary_registry_projection_digest !== currentProjection.projection_digest) {
      return `Accepted author Results for ${workset.indexer_id} do not bind its current registry selection.`;
    }
  }
  return undefined;
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

async function withCurrentPostAuthorEnvelopes(
  projectRoot: string,
  records: readonly AcceptedAuthorRecord[],
): Promise<AcceptedAuthorRecord[]> {
  const resolved: AcceptedAuthorRecord[] = [];
  for (const item of records) {
    const accepted = record(item.accepted_record, "accepted author record");
    resolved.push({
      ...item,
      post_author_envelope: await readCurrentIndexerPostAuthorEnvelopeForResult({
        projectRoot,
        author_workset_digest: String(accepted.workset_digest ?? ""),
        primary_result_digest: String(accepted.result_digest ?? ""),
      }),
    });
  }
  return resolved;
}

async function currentContractAuthority(input: {
  projectRoot: string;
  records: readonly AcceptedAuthorRecord[];
}) {
  const loaded = await loadIndexerRegistry(input.projectRoot);
  const indexerIds = [...new Set(input.records.map((item) => {
    const request = record(item.request, "accepted author request");
    const workset = record(request.workset, "accepted author request workset");
    if (typeof workset.indexer_id !== "string") {
      throw new TypeError("Accepted author Result is missing its Indexer identity");
    }
    return workset.indexer_id;
  }))].sort();
  if (indexerIds.length === 0) {
    throw new TypeError("Candidate compile requires accepted Author Results");
  }
  const authorities = await Promise.all(indexerIds.map((indexerId) =>
    resolveCurrentProjectIndexerPrimaryAuthority({
      projectRoot: input.projectRoot,
      registry: loaded.registry,
      indexer_id: indexerId,
    })
  ));
  const authority = authorities[0]!;
  if (authorities.some((item) =>
    item.operator_contract.contract_digest !== authority.operator_contract.contract_digest ||
    item.profile_contract.contract_digest !== authority.profile_contract.contract_digest
  )) {
    throw new TypeError("Accepted Author Results disagree on Provider contract authority");
  }
  return authority;
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
      post_author_envelope: item.post_author_envelope,
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

function readableArtifactName(outputPath: string, artifactKind: string): string {
  const filename = outputPath.split("/").at(-1)?.replace(/\.md$/iu, "") ?? "";
  const kindSuffix = `-${artifactKind.toLocaleLowerCase()}`;
  const semanticName = filename.toLocaleLowerCase().endsWith(kindSuffix)
    ? filename.slice(0, -kindSuffix.length)
    : filename;
  const words = semanticName.replace(/[-_]+/gu, " ").trim();
  return words.length === 0
    ? artifactKind
    : `${words[0]!.toLocaleUpperCase()}${words.slice(1)}`;
}

export function indexerCandidateTitle(
  markdown: string,
  outputPath: string,
  artifactKind: string,
): string {
  return /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim() ||
    readableArtifactName(outputPath, artifactKind);
}

export function indexerCandidateSummary(markdown: string, title: string): string {
  const paragraph = markdown
    .split(/\n\s*\n/gu)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !/^#/u.test(value) && !/^<!--/u.test(value));
  if (paragraph === undefined) return `Knowledge page for ${title}.`;
  const normalized = paragraph.replace(/\s+/gu, " ");
  const sentence = /^.{1,240}?[.!?。！？](?=\s|$)/u.exec(normalized)?.[0];
  if (sentence !== undefined) return sentence;
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239).trimEnd()}…`;
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
  file: IndexerCandidateCompile["files"][number],
  metadata?: ApprovedKnowledgeMetadataIndex,
): Promise<string | undefined> {
  const outputPath = file.output_path;
  const relPath = outputPath.startsWith("knowledge/")
    ? outputPath.slice("knowledge/".length)
    : outputPath;
  const content = await readMaybe(join(projectRoot, outputPath));
  if (content === undefined) return undefined;
  const frontmatter = {
    ...(metadata?.byPath.get(relPath) ?? {}),
    ...parseFrontmatterLoose(content),
  };
  if (
    frontmatter.node_ref !== file.node_ref ||
    frontmatter.view_ref !== file.internal_view_ref
  ) {
    return undefined;
  }
  const sourceByEvidenceRef = new Map(file.evidence_bindings.map((binding) => [
    binding.evidence_ref,
    binding.source_ref,
  ]));
  const expectedSections = file.sections.map((section) => ({
    id: section.section_key,
    markdown: section.markdown.trim(),
    source_refs: [...new Set(section.evidence_refs.flatMap((evidenceRef) => {
      const sourceRef = sourceByEvidenceRef.get(evidenceRef);
      return sourceRef === undefined ? [] : [sourceRef];
    }))].sort(),
  }));
  const actualSections = approvedContextSectionsInMarkdown(content).map((section) => ({
    id: section.id,
    markdown: section.readerVisibleBody.trim(),
    source_refs: [...section.refs].sort(),
  }));
  const actualById = new Map(actualSections.map((section) => [section.id, section]));
  for (const expected of expectedSections) {
    const actual = actualById.get(expected.id);
    if (actual === undefined) continue;
    const canonical = await canonicalizeApprovedKnowledgeAssetPair({
      projectRoot,
      pageRelPath: outputPath,
      expectedContent: expected.markdown,
      approvedContent: actual.markdown,
      sourceLocators: [file.source_ref, ...expected.source_refs],
    });
    expected.markdown = canonical.expectedContent.trim();
    actual.markdown = canonical.approvedContent.trim();
  }
  return canonicalIndexerJson(actualSections) === canonicalIndexerJson(expectedSections)
    ? file.file_digest
    : undefined;
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
    const readinessRaw = await readMaybe(join(projectRoot, INDEXER_CURRENT_READINESS_PATH));
    const readiness = readinessRaw === undefined
      ? undefined
      : record(JSON.parse(readinessRaw) as unknown, "Indexer Candidate readiness");
    if (readiness?.compile_digest !== compile.compile_digest) {
      return {
        state: "stale",
        compile,
        candidates: [],
        diagnostic: "Candidate compile has not completed the current mechanical readiness checks.",
      };
    }
    const accepted = await withCurrentPostAuthorEnvelopes(
      projectRoot,
      await readAcceptedIndexerMainAuthorResultRecords(projectRoot),
    );
    const registryDiagnostic = await currentRegistryStaleDiagnostic(projectRoot, accepted);
    if (registryDiagnostic !== undefined) {
      return {
        state: "stale",
        compile,
        candidates: [],
        diagnostic: registryDiagnostic,
      };
    }
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
    const currentCompositions = accepted.map((item) => ({
      artifact_result_digest: indexerArtifactResultSchema.parse(item.artifact_result)
        .output_digest,
      post_author_composition_fingerprint: item.post_author_envelope === null ||
          item.post_author_envelope === undefined
        ? null
        : String(record(item.post_author_envelope, "post-author envelope")
          .composition_fingerprint ?? ""),
    })).sort((left, right) => left.artifact_result_digest.localeCompare(
      right.artifact_result_digest,
    ));
    const compileCompositions = compile.result_bindings.map((binding) => ({
      artifact_result_digest: binding.artifact_result_digest,
      post_author_composition_fingerprint:
        binding.post_author_composition_fingerprint,
    })).sort((left, right) => left.artifact_result_digest.localeCompare(
      right.artifact_result_digest,
    ));
    if (canonicalIndexerJson(currentCompositions) !== canonicalIndexerJson(compileCompositions)) {
      return {
        state: "stale",
        compile,
        candidates: [],
        diagnostic: "Candidate compile does not bind the current post-author composition.",
      };
    }
    const rows = (await readCandidateRecords(projectRoot))
      .filter((record) => record.candidate_type === "indexer-artifact");
    const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
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
      const approved = await approvedFileDigest(projectRoot, file, metadata);
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
  const index = await loadProjectIndexerCandidateCompileIndex(input.projectRoot);
  return assertProjectIndexerCandidateInCompileIndex({
    index,
    record: input.record,
  });
}

export interface ProjectIndexerCandidateCompileIndex {
  compile: IndexerCandidateCompile;
  filesByDigest: ReadonlyMap<string, IndexerCandidateCompile["files"][number]>;
}

export async function loadProjectIndexerCandidateCompileIndex(
  projectRoot: string,
): Promise<ProjectIndexerCandidateCompileIndex> {
  const raw = await readMaybe(join(
    projectRoot,
    INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
  ));
  if (raw === undefined) throw new TypeError("Indexer Candidate compile is missing");
  const compile = validatePersistedCompile(JSON.parse(raw) as unknown);
  const filesByDigest = new Map<string, IndexerCandidateCompile["files"][number]>();
  for (const file of compile.files) {
    if (!filesByDigest.has(file.file_digest)) filesByDigest.set(file.file_digest, file);
  }
  return {
    compile,
    filesByDigest,
  };
}

export function assertProjectIndexerCandidateInCompileIndex(input: {
  index: ProjectIndexerCandidateCompileIndex;
  record: CandidateRecord;
}): IndexerCandidateCompile["files"][number] {
  const fileDigest = input.record.indexer_candidate?.file_digest;
  const file = fileDigest === undefined
    ? undefined
    : input.index.filesByDigest.get(fileDigest);
  if (
    file === undefined ||
    indexerCandidateId(file.file_digest) !== input.record.candidate_id ||
    input.record.indexer_candidate?.compile_digest !== input.index.compile.compile_digest ||
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
  const metadata = await readApprovedKnowledgeMetadataIndex(input.projectRoot);
  const projected = await Promise.all(input.compile.files.map(async (file) => {
    if (await approvedFileDigest(input.projectRoot, file, metadata) === file.file_digest) {
      return undefined;
    }
    const candidateId = indexerCandidateId(file.file_digest);
    const previous = existingById.get(candidateId);
    const title = indexerCandidateTitle(
      file.markdown,
      file.output_path,
      file.artifact_kind,
    );
    const candidate = {
      candidate_id: candidateId,
      node_ref: file.node_ref,
      view_ref: file.internal_view_ref,
      collection: file.collection,
      status: previous?.fingerprint === file.file_digest
        ? previous.status
        : "draft" as const,
      candidate_type: "indexer-artifact" as const,
      kind: file.artifact_kind,
      visibility: "public",
      module: file.indexer_id,
      path: candidatePath(file.output_path, file.collection),
      structure_digest: input.compile.compile_digest,
      source_refs: [...new Set(
        file.evidence_bindings.length > 0
          ? file.evidence_bindings.map((binding) => binding.source_ref)
          : [file.source_ref],
      )].sort(),
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
        title,
        summary: indexerCandidateSummary(file.markdown, title),
        signals: ["indexer-compiled", "mechanically-validated"],
        reason: "Exact current Indexer Candidate compiled from accepted author Results.",
      },
      updated: previous?.fingerprint === file.file_digest ? previous.updated : now,
    };
    return parseCandidateRecord(candidate, 1);
  }));
  return [
    ...projected.filter((record): record is CandidateRecord => record !== undefined),
  ];
}

export async function compileProjectIndexerCandidates(input: {
  projectRoot: string;
  value: unknown;
  inject_failure?: DurableMultiFileFailureInjector;
}) {
  const persisted = await withProjectWriteLock(
    input.projectRoot,
    COMPILE_TRANSACTION,
    async () => {
      await recoverDurableMultiFileTransactions(input.projectRoot);
      const currentRecords = await readAcceptedIndexerMainAuthorResultRecords(input.projectRoot);
      const authority = await currentContractAuthority({
        projectRoot: input.projectRoot,
        records: currentRecords,
      });
      const records = await withCurrentPostAuthorEnvelopes(input.projectRoot, currentRecords);
      const compile = buildProjectIndexerCandidateCompileFromRecords({
        value: input.value,
        records,
        operator_contract: authority.operator_contract,
        profile_contract: authority.profile_contract,
      });
      const content = `${JSON.stringify(JSON.parse(canonicalIndexerJson(compile)), null, 2)}\n`;
      const candidates = await projectIndexerCandidates({
        projectRoot: input.projectRoot,
        compile,
        existing: await readCandidateRecords(input.projectRoot),
      });
      const candidateContent = candidateRecordsContent(candidates);
      const current = await readMaybe(join(
        input.projectRoot,
        INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
      ));
      const currentCandidateLedger = await readMaybe(join(
        input.projectRoot,
        CANDIDATE_LEDGER_FILE,
      ));
      const targets = [{
        path: INDEXER_CANDIDATE_COMPILE_CURRENT_PATH,
        operation: "write" as const,
        base_digest: current === undefined ? null : durableContentDigest(current),
        target_digest: durableContentDigest(content),
        content,
      }, candidateContent === undefined
        ? {
            path: CANDIDATE_LEDGER_FILE,
            operation: "delete" as const,
            base_digest: currentCandidateLedger === undefined
              ? null
              : durableContentDigest(currentCandidateLedger),
            target_digest: null,
          }
        : {
            path: CANDIDATE_LEDGER_FILE,
            operation: "write" as const,
            base_digest: currentCandidateLedger === undefined
              ? null
              : durableContentDigest(currentCandidateLedger),
            target_digest: durableContentDigest(candidateContent),
            content: candidateContent,
          }].sort((left, right) => left.path.localeCompare(right.path));
      const transaction = await runDurableMultiFileTransaction({
        projectRoot: input.projectRoot,
        kind: COMPILE_TRANSACTION,
        proposal_digest: indexerProtocolDigest({
          compile_digest: compile.compile_digest,
          candidate_content_digest: candidateContent === undefined
            ? null
            : durableContentDigest(candidateContent),
        }),
        targets,
        ...(input.inject_failure === undefined
          ? {}
          : { inject_failure: input.inject_failure }),
      });
      return { transaction, candidate_count: compile.files.length, compile };
    },
  );
  const payload = {
    protocol: "context.indexer.candidate-compile-action/v1" as const,
    outcome: "indexer-candidates-compiled" as const,
    graph_outcome: "completed" as const,
    compile: persisted.compile,
    transaction: persisted.transaction,
    candidate_count: persisted.candidate_count,
  };
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}
