import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "@c4a/context";
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

export interface IndexerCandidateEvidenceBinding {
  evidence_ref: string;
  kind: string;
  source_ref: string;
  module_ref: string | null;
  locator: {
    path: string;
    start_line: number;
    end_line: number;
  };
  content_digest: string;
  coverage_tier: "ast-catalog" | "lightweight-evidence";
  binding_digest: string;
}

export interface IndexerCandidateSection {
  section_ref: string;
  section_key: string;
  evidence_refs: string[];
  markdown: string;
  markdown_digest: string;
}

export interface IndexerCandidateBinding {
  compile_digest: string;
  file_digest: string;
  artifact_ref: string;
  section_refs: string[];
  source_ref: string;
  evidence_bindings: IndexerCandidateEvidenceBinding[];
  sections: IndexerCandidateSection[];
}

export interface CandidateRecord {
  candidate_id: string;
  node_ref: string;
  view_ref: string;
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
}

const KNOWLEDGE_COLLECTION_SET = new Set<KnowledgeCollection>(KNOWLEDGE_COLLECTIONS);
const CANDIDATE_STATUSES = new Set<CandidateStatus>(["draft", "rejected"]);
const RECORD_FIELDS = new Set([
  "candidate_id", "node_ref", "view_ref", "collection", "status",
  "candidate_type", "kind", "visibility", "module", "path",
  "structure_digest", "source_refs", "body", "indexer_candidate",
  "fingerprint", "review", "updated",
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

function locatorField(value: unknown, line: number, index: number): IndexerCandidateEvidenceBinding["locator"] {
  if (!isRecord(value)) {
    throw schemaError(line, `field indexer_candidate.evidence_bindings[${index}].locator must be an object`);
  }
  assertExactFields(value, new Set(["path", "start_line", "end_line"]), "field locator", line);
  const startLine = value.start_line;
  const endLine = value.end_line;
  if (
    !Number.isSafeInteger(startLine) || Number(startLine) < 1 ||
    !Number.isSafeInteger(endLine) || Number(endLine) < Number(startLine)
  ) {
    throw schemaError(line, `field indexer_candidate.evidence_bindings[${index}].locator lines are invalid`);
  }
  return {
    path: stringField(value, "path", line),
    start_line: Number(startLine),
    end_line: Number(endLine),
  };
}

function evidenceBindingField(
  value: unknown,
  line: number,
  index: number,
): IndexerCandidateEvidenceBinding {
  if (!isRecord(value)) {
    throw schemaError(line, `field indexer_candidate.evidence_bindings[${index}] must be an object`);
  }
  assertExactFields(
    value,
    new Set([
      "evidence_ref", "kind", "source_ref", "module_ref", "locator",
      "content_digest", "coverage_tier", "binding_digest",
    ]),
    `field indexer_candidate.evidence_bindings[${index}]`,
    line,
  );
  if (value.coverage_tier !== "ast-catalog" && value.coverage_tier !== "lightweight-evidence") {
    throw schemaError(line, `field indexer_candidate.evidence_bindings[${index}].coverage_tier is invalid`);
  }
  if (value.module_ref !== null && (typeof value.module_ref !== "string" || value.module_ref.length === 0)) {
    throw schemaError(
      line,
      `field indexer_candidate.evidence_bindings[${index}].module_ref must be a non-empty string or null`,
    );
  }
  return {
    evidence_ref: stringField(value, "evidence_ref", line),
    kind: stringField(value, "kind", line),
    source_ref: stringField(value, "source_ref", line),
    module_ref: value.module_ref,
    locator: locatorField(value.locator, line, index),
    content_digest: stringField(value, "content_digest", line),
    coverage_tier: value.coverage_tier,
    binding_digest: stringField(value, "binding_digest", line),
  };
}

function sectionField(value: unknown, line: number, index: number): IndexerCandidateSection {
  if (!isRecord(value)) {
    throw schemaError(line, `field indexer_candidate.sections[${index}] must be an object`);
  }
  assertExactFields(
    value,
    new Set(["section_ref", "section_key", "evidence_refs", "markdown", "markdown_digest"]),
    `field indexer_candidate.sections[${index}]`,
    line,
  );
  return {
    section_ref: stringField(value, "section_ref", line),
    section_key: stringField(value, "section_key", line),
    evidence_refs: stringArray(value.evidence_refs, "indexer_candidate.sections[].evidence_refs", line, true),
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
      "source_ref", "evidence_bindings", "sections",
    ]),
    "field indexer_candidate",
    line,
  );
  if (!Array.isArray(value.evidence_bindings)) {
    throw schemaError(line, "field indexer_candidate.evidence_bindings must be an array");
  }
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
    source_ref: stringField(value, "source_ref", line),
    evidence_bindings: value.evidence_bindings.map((binding, index) =>
      evidenceBindingField(binding, line, index)
    ),
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
  const nodeRef = stringField(value, "node_ref", line);
  const viewRef = stringField(value, "view_ref", line);
  const path = stringField(value, "path", line);
  const structureDigest = stringField(value, "structure_digest", line);
  const fingerprint = stringField(value, "fingerprint", line);
  const expectedCandidateId = indexerCandidateId(binding.file_digest);
  if (candidateId !== expectedCandidateId) {
    throw schemaError(line, `field candidate_id must bind Indexer file digest: ${expectedCandidateId}`);
  }
  if (!/^node:subject:sha256:[a-f0-9]{64}$/u.test(nodeRef)) {
    throw schemaError(line, "field node_ref must be a canonical Indexer Subject ref");
  }
  if (!/^view:artifact:sha256:[a-f0-9]{64}$/u.test(viewRef)) {
    throw schemaError(line, "field view_ref must be a canonical Indexer Artifact view ref");
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
    node_ref: nodeRef,
    view_ref: viewRef,
    collection: collection as KnowledgeCollection,
    status: status as CandidateStatus,
    candidate_type: "indexer-artifact",
    kind: stringField(value, "kind", line),
    visibility: stringField(value, "visibility", line),
    module: stringField(value, "module", line),
    path,
    structure_digest: structureDigest,
    source_refs: stringArray(value.source_refs, "source_refs", line),
    body: stringField(value, "body", line),
    indexer_candidate: binding,
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
