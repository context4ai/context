import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { articleSectionSchema, type ArticleSourceReference, KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { CANDIDATE_LEDGER_FILE } from "./lifecyclePaths.js";

export { CANDIDATE_LEDGER_FILE } from "./lifecyclePaths.js";

export type CandidateStatus = "draft" | "rejected";

export interface CandidateReviewSummary {
  title: string;
  summary: string;
  behavior_summary?: string;
  edge_summary?: string;
  signals: string[];
  reason: string;
}

export interface IndexerCandidateSection {
  section_ref: string;
  section_key: string;
  references: ArticleSourceReference[];
  markdown: string;
  markdown_digest: string;
}

export interface IndexerCandidateBinding {
  compile_digest: string;
  file_digest: string;
  artifact_ref: string;
  section_refs: string[];
  sections: IndexerCandidateSection[];
}

export interface CandidateRecord {
  candidate_id: string;
  article_id: string;
  collection: KnowledgeCollection;
  status: CandidateStatus;
  candidate_type: "indexer-artifact";
  kind: string;
  visibility: string;
  module: string;
  path: string;
  structure_digest: string;
  source_refs: string[];
  body: string;
  indexer_candidate: IndexerCandidateBinding;
  fingerprint: string;
  review: CandidateReviewSummary;
  updated: string;
  approved_revision?: { request_digest: string; base_digest: string | null; previous_path?: string };
}

const KNOWLEDGE_COLLECTION_SET = new Set<KnowledgeCollection>(KNOWLEDGE_COLLECTIONS);
const CANDIDATE_STATUSES = new Set<CandidateStatus>(["draft", "rejected"]);
const RECORD_FIELDS = new Set([
  "candidate_id", "article_id", "collection", "status",
  "candidate_type", "kind", "visibility", "module", "path",
  "structure_digest", "source_refs", "body", "indexer_candidate",
  "fingerprint", "review", "updated",
  "approved_revision",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaError(line: number, message: string): ContextError {
  return new ContextError(
    ExitCode.WorkspaceStateError,
    `${CANDIDATE_LEDGER_FILE}:${line} ${message}`,
    {
      category: ErrorCategory.SchemaInvalid,
      path: CANDIDATE_LEDGER_FILE,
      line,
      next: "Regenerate Candidates through the current Indexer lifecycle.",
    },
  );
}

function stringField(record: Record<string, unknown>, field: string, line: number): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw schemaError(line, `field ${field} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, field: string, line: number, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw schemaError(line, `field ${field} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
  }
  return value as string[];
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
  line: number,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw schemaError(line, `${field} contains unsupported fields: ${unknown.sort().join(", ")}`);
  }
}

/** Compare portable article paths without changing their reader-facing spelling. */
export function knowledgeTargetPathKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function isSafeKnowledgeTargetPath(collection: string, value: string): boolean {
  return value.startsWith(`${collection}/`) &&
    value.endsWith(".md") &&
    !value.startsWith("/") &&
    !/^[a-zA-Z]:[\\/]/u.test(value) &&
    value.split(/[\\/]+/u).every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function isReservedKnowledgeIndexPath(value: string): boolean {
  return value.split(/[\\/]+/u).at(-1)?.toLowerCase() === "index.md";
}

export function knowledgeTargetPathForNode(collection: string, nodeRef: string): string {
  const segments = nodeRef.split("/");
  const leaf = segments.at(-1);
  if (leaf?.toLowerCase() === "index") segments[segments.length - 1] = "index-page";
  return `${collection}/${segments.join("/")}.md`;
}

function reviewField(value: unknown, line: number): CandidateReviewSummary {
  if (!isRecord(value)) throw schemaError(line, "field review must be an object");
  assertExactFields(
    value,
    new Set(["title", "summary", "behavior_summary", "edge_summary", "signals", "reason"]),
    "field review",
    line,
  );
  return {
    title: stringField(value, "title", line),
    summary: stringField(value, "summary", line),
    ...(value.behavior_summary === undefined
      ? {}
      : { behavior_summary: stringField(value, "behavior_summary", line) }),
    ...(value.edge_summary === undefined
      ? {}
      : { edge_summary: stringField(value, "edge_summary", line) }),
    signals: stringArray(value.signals, "review.signals", line),
    reason: stringField(value, "reason", line),
  };
}

function sectionField(value: unknown, line: number, index: number): IndexerCandidateSection {
  if (!isRecord(value)) {
    throw schemaError(line, `field indexer_candidate.sections[${index}] must be an object`);
  }
  assertExactFields(
    value,
    new Set(["section_ref", "section_key", "references", "markdown", "markdown_digest"]),
    `field indexer_candidate.sections[${index}]`,
    line,
  );
  return {
    section_ref: stringField(value, "section_ref", line),
    section_key: stringField(value, "section_key", line),
    references: articleSectionSchema.shape.references.parse(value.references),
    markdown: stringField(value, "markdown", line),
    markdown_digest: stringField(value, "markdown_digest", line),
  };
}

function indexerCandidateField(value: unknown, line: number): IndexerCandidateBinding {
  if (!isRecord(value)) throw schemaError(line, "field indexer_candidate must be an object");
  assertExactFields(
    value,
    new Set([
      "compile_digest", "file_digest", "artifact_ref", "section_refs",
      "sections",
    ]),
    "field indexer_candidate",
    line,
  );
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    throw schemaError(line, "field indexer_candidate.sections must be a non-empty array");
  }
  const sections = value.sections.map((section, index) => sectionField(section, line, index));
  const sectionRefs = stringArray(value.section_refs, "indexer_candidate.section_refs", line);
  if (JSON.stringify(sectionRefs) !== JSON.stringify(sections.map((section) => section.section_ref))) {
    throw schemaError(line, "field indexer_candidate.section_refs must match sections in order");
  }
  return {
    compile_digest: stringField(value, "compile_digest", line),
    file_digest: stringField(value, "file_digest", line),
    artifact_ref: stringField(value, "artifact_ref", line),
    section_refs: sectionRefs,
    sections,
  };
}

export function indexerCandidateId(fileDigest: string): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(fileDigest);
  if (match?.[1] === undefined) {
    throw new TypeError(`Indexer Candidate file digest is invalid: ${fileDigest}`);
  }
  return `indexer/${match[1]}`;
}

export function parseCandidateRecord(value: unknown, line: number): CandidateRecord {
  if (!isRecord(value)) throw schemaError(line, "must be a JSON object");
  assertExactFields(value, RECORD_FIELDS, "Candidate", line);
  if (value.candidate_type !== "indexer-artifact") {
    throw schemaError(line, "field candidate_type must be indexer-artifact");
  }
  const collection = value.collection;
  if (typeof collection !== "string" || !KNOWLEDGE_COLLECTION_SET.has(collection as KnowledgeCollection)) {
    throw schemaError(line, `field collection must be one of ${KNOWLEDGE_COLLECTIONS.join(", ")}`);
  }
  const status = value.status;
  if (typeof status !== "string" || !CANDIDATE_STATUSES.has(status as CandidateStatus)) {
    throw schemaError(line, "field status must be one of draft, rejected");
  }
  const binding = indexerCandidateField(value.indexer_candidate, line);
  const candidateId = stringField(value, "candidate_id", line);
  const articleId = stringField(value, "article_id", line);
  const path = stringField(value, "path", line);
  const structureDigest = stringField(value, "structure_digest", line);
  const fingerprint = stringField(value, "fingerprint", line);
  let approvedRevision: CandidateRecord["approved_revision"];
  if (value.approved_revision !== undefined) {
    if (!isRecord(value.approved_revision)) throw schemaError(line, "approved_revision must be an object");
    assertExactFields(value.approved_revision, new Set(["request_digest", "base_digest", "previous_path"]), "approved_revision", line);
    approvedRevision = {
      request_digest: stringField(value.approved_revision, "request_digest", line),
      ...(value.approved_revision.previous_path === undefined ? {} : { previous_path: stringField(value.approved_revision, "previous_path", line) }),
      base_digest: value.approved_revision.base_digest === null ? null : stringField(value.approved_revision, "base_digest", line),
    };
    if ([approvedRevision.request_digest, approvedRevision.base_digest].some((digest) => digest !== null && !/^sha256:[a-f0-9]{64}$/u.test(digest))) {
      throw schemaError(line, "approved_revision requires content digests");
    }
  }
  const expectedCandidateId = indexerCandidateId(binding.file_digest);
  if (candidateId !== expectedCandidateId) {
    throw schemaError(line, `field candidate_id must bind Indexer file digest: ${expectedCandidateId}`);
  }
  if (articleId !== binding.artifact_ref) {
    throw schemaError(line, "field article_id must identify the compiled article");
  }
  if (!isSafeKnowledgeTargetPath(collection, path)) {
    throw schemaError(line, "field path must be relative to its knowledge collection");
  }
  if (structureDigest !== binding.compile_digest) {
    throw schemaError(line, "field structure_digest must equal indexer_candidate.compile_digest");
  }
  if (fingerprint !== binding.file_digest) {
    throw schemaError(line, "field fingerprint must equal indexer_candidate.file_digest");
  }
  return {
    candidate_id: candidateId,
    article_id: articleId,
    collection: collection as KnowledgeCollection,
    status: status as CandidateStatus,
    candidate_type: "indexer-artifact",
    kind: stringField(value, "kind", line),
    visibility: stringField(value, "visibility", line),
    module: stringField(value, "module", line),
    path,
    structure_digest: structureDigest,
    source_refs: stringArray(value.source_refs, "source_refs", line, true),
    body: stringField(value, "body", line),
    indexer_candidate: binding,
    ...(approvedRevision === undefined ? {} : { approved_revision: approvedRevision }),
    fingerprint,
    review: reviewField(value.review, line),
    updated: stringField(value, "updated", line),
  };
}

export function parseCandidateLine(line: string, lineNumber: number): CandidateRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw schemaError(lineNumber, `invalid JSON: ${message}`);
  }
  return parseCandidateRecord(parsed, lineNumber);
}

export async function readCandidateRecords(projectRoot: string): Promise<CandidateRecord[]> {
  const filePath = join(projectRoot, CANDIDATE_LEDGER_FILE);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw.split(/\r?\n/u).flatMap((line, index) =>
    line.trim().length === 0 ? [] : [parseCandidateLine(line, index + 1)]
  );
}

export function candidateRecordsContent(rows: readonly CandidateRecord[]): string | undefined {
  return rows.length === 0
    ? undefined
    : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

export async function writeCandidateRecords(
  projectRoot: string,
  rows: readonly CandidateRecord[],
): Promise<void> {
  const filePath = join(projectRoot, CANDIDATE_LEDGER_FILE);
  const content = candidateRecordsContent(rows);
  if (content === undefined) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
