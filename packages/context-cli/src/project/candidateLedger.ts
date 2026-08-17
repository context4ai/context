import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { candidateIdFromViewRef, nodeRefFromViewRef } from "./candidateIdentity.js";
import { CANDIDATE_LEDGER_FILE } from "./lifecyclePaths.js";

export { CANDIDATE_LEDGER_FILE } from "./lifecyclePaths.js";

export type CandidateStatus = "draft" | "rejected";
export type CandidateType = "code-symbol" | "prose-align";
export type CandidateChange = "add" | "update" | "remove";

export interface ProseCandidateSource {
  type: "file" | "lark";
  name: string;
  document_path: string;
  locator: string;
  source_ref: string;
  snapshot_hash?: string;
}

export interface ProseCandidateSection {
  id: string;
  kind?: string;
  title?: string;
  summary?: string;
  body?: string;
  source_ref: string;
  source_refs?: string[];
  content_mode?: "verbatim" | "empty";
}

export interface ParentIndexChildRecord {
  view_ref: string;
  node_ref: string;
  title: string;
  path: string;
  summary?: string;
}

export interface ParentIndexRecord {
  children: ParentIndexChildRecord[];
}

export interface CandidateReviewSummary {
  title: string;
  summary: string;
  behavior_summary?: string;
  edge_summary?: string;
  signals: string[];
  reason: string;
}

export interface CodeCandidateEdge {
  type: "contains" | "depends_on";
  from: string;
  to: string;
  source_refs: string[];
  relation_type: string;
}

export interface CandidateRecord {
  candidate_id: string;
  node_ref: string;
  view_ref: string;
  collection: KnowledgeCollection;
  status: CandidateStatus;
  candidate_type?: CandidateType;
  change?: CandidateChange;
  generated?: "parent_index";
  parent_index?: ParentIndexRecord;
  kind: string;
  node_tags?: string[];
  visibility: string;
  module: string;
  path: string;
  structure_digest?: string;
  source_refs: string[];
  shared_source_refs?: string[];
  source?: ProseCandidateSource;
  body?: string;
  sections?: ProseCandidateSection[];
  code_edges?: CodeCandidateEdge[];
  fingerprint: string;
  review: CandidateReviewSummary;
  updated: string;
}

const KNOWLEDGE_COLLECTION_SET = new Set<KnowledgeCollection>(KNOWLEDGE_COLLECTIONS);
const CANDIDATE_STATUSES = new Set<CandidateStatus>(["draft", "rejected"]);
const CANDIDATE_TYPES = new Set<CandidateType>(["code-symbol", "prose-align"]);
const CANDIDATE_CHANGES = new Set<CandidateChange>(["add", "update", "remove"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaError(line: number, message: string): ContextError {
  return new ContextError(ExitCode.WorkspaceStateError, `${CANDIDATE_LEDGER_FILE}:${line} ${message}`, {
    category: ErrorCategory.SchemaInvalid,
    path: CANDIDATE_LEDGER_FILE,
    line,
    next: `Fix ${CANDIDATE_LEDGER_FILE}, then rerun the command.`,
  });
}

function stringField(record: Record<string, unknown>, field: string, line: number): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw schemaError(line, `field ${field} must be a non-empty string`);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, field: string, line: number): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw schemaError(line, `field ${field} must be a non-empty string array`);
  }
  return value as string[];
}

function optionalStringArrayField(record: Record<string, unknown>, field: string, line: number): string[] | undefined {
  if (record[field] === undefined) return undefined;
  return stringArrayField(record, field, line);
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

function collectionField(record: Record<string, unknown>, line: number): KnowledgeCollection {
  const value = record.collection;
  if (typeof value !== "string" || !KNOWLEDGE_COLLECTION_SET.has(value as KnowledgeCollection)) {
    throw schemaError(line, `field collection must be one of ${KNOWLEDGE_COLLECTIONS.join(", ")}`);
  }
  return value as KnowledgeCollection;
}

function statusField(record: Record<string, unknown>, line: number): CandidateStatus {
  const value = record.status;
  if (typeof value !== "string" || !CANDIDATE_STATUSES.has(value as CandidateStatus)) {
    throw schemaError(line, "field status must be one of draft, rejected");
  }
  return value as CandidateStatus;
}

function reviewField(record: Record<string, unknown>, line: number): CandidateReviewSummary {
  const value = record.review;
  if (!isRecord(value)) {
    throw schemaError(line, "field review must be an object");
  }
  return {
    title: stringField(value, "title", line),
    summary: stringField(value, "summary", line),
    ...(value.behavior_summary !== undefined ? { behavior_summary: stringField(value, "behavior_summary", line) } : {}),
    ...(value.edge_summary !== undefined ? { edge_summary: stringField(value, "edge_summary", line) } : {}),
    signals: stringArrayField(value, "signals", line),
    reason: stringField(value, "reason", line),
  };
}

function candidateTypeField(record: Record<string, unknown>, line: number): CandidateType | undefined {
  if (record.candidate_type === undefined) return undefined;
  if (typeof record.candidate_type !== "string" || !CANDIDATE_TYPES.has(record.candidate_type as CandidateType)) {
    throw schemaError(line, "field candidate_type must be one of code-symbol, prose-align");
  }
  return record.candidate_type as CandidateType;
}

function candidateChangeField(record: Record<string, unknown>, line: number): CandidateChange | undefined {
  if (record.change === undefined) return undefined;
  if (typeof record.change !== "string" || !CANDIDATE_CHANGES.has(record.change as CandidateChange)) {
    throw schemaError(line, "field change must be one of add, update, remove");
  }
  return record.change as CandidateChange;
}

function optionalStringField(record: Record<string, unknown>, field: string, line: number): string | undefined {
  if (record[field] === undefined) return undefined;
  if (typeof record[field] !== "string" || (record[field] as string).length === 0) {
    throw schemaError(line, `field ${field} must be a non-empty string when present`);
  }
  return record[field] as string;
}

function sourceField(record: Record<string, unknown>, line: number): ProseCandidateSource | undefined {
  if (record.source === undefined) return undefined;
  if (!isRecord(record.source)) {
    throw schemaError(line, "field source must be an object when present");
  }
  const source = record.source;
  if (source.type !== "file" && source.type !== "lark") {
    throw schemaError(line, "field source.type must be file or lark");
  }
  return {
    type: source.type,
    name: stringField(source, "name", line),
    document_path: stringField(source, "document_path", line),
    locator: stringField(source, "locator", line),
    source_ref: stringField(source, "source_ref", line),
    ...(source.snapshot_hash !== undefined ? { snapshot_hash: stringField(source, "snapshot_hash", line) } : {}),
  };
}

function parentIndexField(record: Record<string, unknown>, line: number): ParentIndexRecord | undefined {
  if (record.parent_index === undefined) return undefined;
  if (!isRecord(record.parent_index)) {
    throw schemaError(line, "field parent_index must be an object when present");
  }
  const children = record.parent_index.children;
  if (!Array.isArray(children) || children.length === 0) {
    throw schemaError(line, "field parent_index.children must be a non-empty array");
  }
  return {
    children: children.map((rawChild, index) => {
      if (!isRecord(rawChild)) {
        throw schemaError(line, `field parent_index.children[${index}] must be an object`);
      }
      return {
        view_ref: stringField(rawChild, "view_ref", line),
        node_ref: stringField(rawChild, "node_ref", line),
        title: stringField(rawChild, "title", line),
        path: stringField(rawChild, "path", line),
        ...(rawChild.summary !== undefined ? { summary: stringField(rawChild, "summary", line) } : {}),
      };
    }),
  };
}

function generatedField(record: Record<string, unknown>, line: number): "parent_index" | undefined {
  if (record.generated === undefined) return undefined;
  if (record.generated !== "parent_index") {
    throw schemaError(line, "field generated must be parent_index when present");
  }
  return "parent_index";
}

function sectionsField(record: Record<string, unknown>, line: number): ProseCandidateSection[] | undefined {
  if (record.sections === undefined) return undefined;
  if (!Array.isArray(record.sections)) {
    throw schemaError(line, "field sections must be an array when present");
  }
  return record.sections.map((rawSection, index) => {
    if (!isRecord(rawSection)) {
      throw schemaError(line, `field sections[${index}] must be an object`);
    }
    const kind = optionalStringField(rawSection, "kind", line);
    const title = optionalStringField(rawSection, "title", line);
    const summary = optionalStringField(rawSection, "summary", line);
    const body = optionalStringField(rawSection, "body", line);
    const sourceRefs = rawSection.source_refs === undefined
      ? undefined
      : stringArrayField(rawSection, "source_refs", line);
    const contentMode = optionalStringField(rawSection, "content_mode", line);
    if (
      contentMode !== undefined &&
      contentMode !== "verbatim" &&
      contentMode !== "empty"
    ) {
      throw schemaError(line, "field sections[].content_mode must be verbatim or empty");
    }
    if (rawSection.content_source_digest !== undefined) throw schemaError(line, "field sections[].content_source_digest is not supported");
    if (rawSection.content_intent !== undefined) throw schemaError(line, "field sections[].content_intent is not supported");
    if (rawSection.rewritten_confirmed !== undefined) throw schemaError(line, "field sections[].rewritten_confirmed is not supported");
    if (rawSection.audit !== undefined) throw schemaError(line, "field sections[].audit is not supported");
    return {
      id: stringField(rawSection, "id", line),
      ...(kind !== undefined ? { kind } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(body !== undefined ? { body } : {}),
      source_ref: stringField(rawSection, "source_ref", line),
      ...(sourceRefs !== undefined ? { source_refs: sourceRefs } : {}),
      ...(contentMode !== undefined ? { content_mode: contentMode } : {}),
    };
  });
}

function codeEdgesField(record: Record<string, unknown>, line: number): CodeCandidateEdge[] | undefined {
  if (record.code_edges === undefined) return undefined;
  if (!Array.isArray(record.code_edges)) {
    throw schemaError(line, "field code_edges must be an array when present");
  }
  return record.code_edges.map((rawEdge, index) => {
    if (!isRecord(rawEdge)) {
      throw schemaError(line, `field code_edges[${index}] must be an object`);
    }
    if (rawEdge.type !== "contains" && rawEdge.type !== "depends_on") {
      throw schemaError(line, `field code_edges[${index}].type must be contains or depends_on`);
    }
    return {
      type: rawEdge.type,
      from: stringField(rawEdge, "from", line),
      to: stringField(rawEdge, "to", line),
      source_refs: stringArrayField(rawEdge, "source_refs", line),
      relation_type: stringField(rawEdge, "relation_type", line),
    };
  });
}

function validateCodeEdgesCandidate(input: {
  candidateType: CandidateType | undefined;
  codeEdges: readonly CodeCandidateEdge[] | undefined;
  nodeRef: string;
  line: number;
}): void {
  if (input.codeEdges !== undefined && input.candidateType !== "code-symbol") {
    throw schemaError(input.line, "field code_edges is supported only for code-symbol candidates");
  }
  if (input.codeEdges?.some((edge) => edge.from !== input.nodeRef)) {
    throw schemaError(input.line, "field code_edges[].from must equal candidate node_ref");
  }
}

export function parseCandidateRecord(value: unknown, line: number): CandidateRecord {
  if (!isRecord(value)) {
    throw schemaError(line, "must be a JSON object");
  }
  const candidateType = candidateTypeField(value, line);
  const candidateChange = candidateChangeField(value, line);
  const generated = generatedField(value, line);
  const parentIndex = parentIndexField(value, line);
  if (generated === "parent_index" && parentIndex === undefined) {
    throw schemaError(line, "field parent_index is required when generated is parent_index");
  }
  if (generated === undefined && parentIndex !== undefined) {
    throw schemaError(line, "field generated=parent_index is required when parent_index is present");
  }
  const source = sourceField(value, line);
  const targetPath = optionalStringField(value, "target_path", line);
  const candidateId = stringField(value, "candidate_id", line);
  const viewRef = stringField(value, "view_ref", line);
  const nodeRef = stringField(value, "node_ref", line);
  const collection = collectionField(value, line);
  const path = stringField(value, "path", line);
  const expectedCandidateId = candidateIdFromViewRef(viewRef);
  if (candidateId !== expectedCandidateId) {
    throw schemaError(line, `field candidate_id must be derived from view_ref: ${expectedCandidateId}`);
  }
  const expectedNodeRef = nodeRefFromViewRef(viewRef);
  if (expectedNodeRef === undefined || nodeRef !== expectedNodeRef) {
    throw schemaError(line, "field node_ref must equal the suffix of view_ref");
  }
  if (!viewRef.startsWith(`${collection}:`)) {
    throw schemaError(line, "field view_ref must start with <collection>:");
  }
  if (!isSafeKnowledgeTargetPath(collection, path)) {
    throw schemaError(line, "field path must be an approved knowledge path relative to knowledge/<collection>/");
  }
  const body = optionalStringField(value, "body", line);
  const structureDigest = optionalStringField(value, "structure_digest", line);
  const sections = sectionsField(value, line);
  const codeEdges = codeEdgesField(value, line);
  const sharedSourceRefs = optionalStringArrayField(value, "shared_source_refs", line);
  const nodeTags = value.node_tags === undefined
    ? undefined
    : stringArrayField(value, "node_tags", line);
  if (value.id !== undefined) throw schemaError(line, "field id is not supported; use candidate_id");
  if (value.target_id !== undefined) throw schemaError(line, "field target_id is not supported");
  if (targetPath !== undefined) throw schemaError(line, "field target_path is not supported; use path");
  if (value.replaces !== undefined) throw schemaError(line, "field replaces is not supported");
  validateCodeEdgesCandidate({ candidateType, codeEdges, nodeRef, line });
  return {
    candidate_id: candidateId,
    node_ref: nodeRef,
    view_ref: viewRef,
    collection,
    status: statusField(value, line),
    ...(candidateType !== undefined ? { candidate_type: candidateType } : {}),
    ...(candidateChange !== undefined ? { change: candidateChange } : {}),
    ...(generated !== undefined ? { generated } : {}),
    ...(parentIndex !== undefined ? { parent_index: parentIndex } : {}),
    kind: stringField(value, "kind", line),
    ...(nodeTags !== undefined ? { node_tags: nodeTags } : {}),
    visibility: stringField(value, "visibility", line),
    module: stringField(value, "module", line),
    path,
    ...(structureDigest !== undefined ? { structure_digest: structureDigest } : {}),
    source_refs: stringArrayField(value, "source_refs", line),
    ...(sharedSourceRefs !== undefined ? { shared_source_refs: sharedSourceRefs } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(sections !== undefined ? { sections } : {}),
    ...(codeEdges !== undefined ? { code_edges: codeEdges } : {}),
    fingerprint: stringField(value, "fingerprint", line),
    review: reviewField(value, line),
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
  const rows: CandidateRecord[] = [];
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    rows.push(parseCandidateLine(line, index + 1));
  }
  return rows;
}

export async function writeCandidateRecords(projectRoot: string, rows: readonly CandidateRecord[]): Promise<void> {
  const filePath = join(projectRoot, CANDIDATE_LEDGER_FILE);
  if (rows.length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, `${content}\n`, "utf8");
}
