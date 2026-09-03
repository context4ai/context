import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  KNOWLEDGE_COLLECTIONS,
  type KnowledgeCollection,
} from "@c4a/context";
import { parseDocumentSourceLocator, parseSpanSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  hydrateApprovedFrontmatter,
  readApprovedKnowledgeMetadataIndex,
} from "./approvedKnowledgeMetadata.js";
import { knowledgeAssetReferences } from "./knowledgeAssets.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { assertSafeEntityId } from "./entityId.js";
import type { CandidateRecord } from "./candidateLedger.js";

export { assertSafeEntityId } from "./entityId.js";

export type ReviewStatus = "approved" | "rejected";
export type ReviewFormat = "text" | "json";

export interface ReviewDecision {
  candidate_id: string;
  status: ReviewStatus;
}

export interface ReviewPayload {
  decisions: ReviewDecision[];
  note?: string;
  collection?: KnowledgeCollection;
  default?: ReviewStatus;
  scope?: ReviewPayloadScope;
}

export interface ReviewPayloadScope {
  kind?: "collection" | "all";
  collection?: KnowledgeCollection;
  count: number;
  ids_sha256: string;
  candidates_sha256?: string;
  visible_candidate_ids?: string[];
}

export interface CandidateSnapshot {
  candidate_id: string;
  collection: KnowledgeCollection;
  source: string;
  source_refs: string[];
  markdown: string;
}

export interface ParsedCanonicalProseRef {
  locator: string;
  spanBody: string;
  sourceType: "file" | "lark";
  sourceName: string;
  documentPath: string;
}

export interface ReviewCandidateView {
  record: CandidateRecord;
  snapshot: CandidateSnapshot | undefined;
}

export interface ApplyReviewDecisionsResult {
  applied: number;
  approved: number;
  rejected: number;
  unchanged: number;
  materialized: number;
  removed: number;
  candidateFileUpdated: boolean;
  pages: string[];
}

export interface ReviewMaintenanceResult {
  id: string;
  path: string;
  changed: boolean;
  refsUpdated?: number;
  actionLog: string;
}

export const REVIEW_ACTION_ROOT = join(".tmp", "context-runtime", "review-actions");
export const REVIEW_PAYLOAD_SCHEMA = "context.review.decisions.v1";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertCollection(value: string | undefined): KnowledgeCollection {
  if (value === undefined) {
    throw new ContextError(ExitCode.UserError, "review collection is required", {
      category: ErrorCategory.UserInputInvalid,
      next: `Use one of ${KNOWLEDGE_COLLECTIONS.join(", ")}, or use --all for all-scope review.`,
    });
  }
  const collection = value;
  if (!(KNOWLEDGE_COLLECTIONS as readonly string[]).includes(collection)) {
    throw new ContextError(ExitCode.UserError, `unsupported review collection: ${collection}`, {
      category: ErrorCategory.UserInputInvalid,
      next: `Use one of ${KNOWLEDGE_COLLECTIONS.join(", ")}.`,
    });
  }
  return collection as KnowledgeCollection;
}

export function parseCanonicalProseRef(ref: string): ParsedCanonicalProseRef | null {
  const parsed = parseSpanSourceRef(ref);
  if (parsed?.locator === undefined) return null;
  const locator = parseDocumentSourceLocator(parsed.locator);
  if (locator === null) return null;
  return {
    locator: parsed.locator,
    spanBody: ref.slice(parsed.locator.length),
    sourceType: locator.sourceType,
    sourceName: locator.sourceName,
    documentPath: locator.documentPath,
  };
}

export async function readReviewCandidateSnapshot(
  _projectRoot: string,
  record: CandidateRecord,
): Promise<CandidateSnapshot | undefined> {
  return {
    candidate_id: record.candidate_id,
    collection: record.collection,
    source: record.indexer_candidate.source_ref,
    source_refs: record.source_refs,
    markdown: record.body,
  };
}

export interface ApprovedPageReference {
  collection: KnowledgeCollection;
  viewRef: string;
  nodeRef: string;
  path: string;
  relPath: string;
  frontmatter: Record<string, unknown>;
}

export interface ApprovedPageViewRefIndex {
  byViewRef: ReadonlyMap<string, ApprovedPageReference>;
  byRelPath: ReadonlyMap<string, ApprovedPageReference>;
  assetReferencesByRelPath: ReadonlyMap<string, readonly string[]>;
}

export async function buildApprovedPageViewRefIndex(
  projectRoot: string,
): Promise<ApprovedPageViewRefIndex> {
  const metadata = await readApprovedKnowledgeMetadataIndex(projectRoot);
  const byViewRef = new Map<string, ApprovedPageReference>();
  const byRelPath = new Map<string, ApprovedPageReference>();
  const assetReferencesByRelPath = new Map<string, readonly string[]>();
  for (const collection of KNOWLEDGE_COLLECTIONS) {
    const collectionRoot = join(projectRoot, "knowledge", collection);
    if (!existsSync(collectionRoot)) continue;
    const visit = (dir: string, relDir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absPath = join(dir, entry.name);
        const rel = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          visit(absPath, rel);
          continue;
        }
        if (!entry.isFile() || !isApprovedKnowledgeMarkdownPath(rel)) continue;
        const content = readFileSync(absPath, "utf8");
        const relPath = join("knowledge", collection, rel);
        assetReferencesByRelPath.set(relPath, knowledgeAssetReferences({
          pageRelPath: relPath,
          content,
        }));
        const block = frontmatterBlock(content);
        if (block === null) continue;
        const parsed = YAML.parse(block.yaml) as unknown;
        if (!isRecord(parsed)) continue;
        const frontmatter = hydrateApprovedFrontmatter({
          frontmatter: parsed,
          relPath: join(collection, rel),
          metadata,
        });
        if (typeof frontmatter.view_ref !== "string") continue;
        const viewSeparator = frontmatter.view_ref.indexOf(":");
        const viewPrefix = viewSeparator < 0 ? "" : frontmatter.view_ref.slice(0, viewSeparator);
        if (!frontmatter.view_ref.startsWith("view:artifact:") && viewPrefix !== collection) {
          continue;
        }
        const fallbackNodeRef = viewSeparator < 0 ? "" : frontmatter.view_ref.slice(viewSeparator + 1);
        const nodeRef = typeof frontmatter.node_ref === "string" && frontmatter.node_ref.trim().length > 0
          ? frontmatter.node_ref.trim()
          : fallbackNodeRef;
        const page = {
          collection,
          viewRef: frontmatter.view_ref,
          nodeRef,
          path: absPath,
          relPath,
          frontmatter,
        };
        byRelPath.set(relPath, page);
        if (!byViewRef.has(frontmatter.view_ref)) {
          byViewRef.set(frontmatter.view_ref, page);
        }
      }
    };
    visit(collectionRoot, "");
  }
  return { byViewRef, byRelPath, assetReferencesByRelPath };
}

export function findApprovedPageForViewRef(
  viewRef: string,
  index: ApprovedPageViewRefIndex,
): ApprovedPageReference | undefined {
  const separator = viewRef.indexOf(":");
  if (separator <= 0) {
    throw new ContextError(ExitCode.UserError, `approved maintenance target must be a view_ref: ${viewRef}`, {
      category: ErrorCategory.UserInputInvalid,
      view_ref: viewRef,
      next: "Use <collection>:<node_ref>, for example architecture:entity/install.",
    });
  }
  const prefix = viewRef.slice(0, separator);
  const indexerView = viewRef.startsWith("view:artifact:");
  if (!indexerView && !(KNOWLEDGE_COLLECTIONS as readonly string[]).includes(prefix)) {
    throw new ContextError(ExitCode.UserError, `approved maintenance view_ref has unsupported collection: ${viewRef}`, {
      category: ErrorCategory.UserInputInvalid,
      view_ref: viewRef,
      next: `Use one of ${KNOWLEDGE_COLLECTIONS.join(", ")} as the view_ref prefix.`,
    });
  }
  const nodeRef = indexerView ? "" : viewRef.slice(separator + 1);
  if (!indexerView) assertSafeEntityId(nodeRef);
  const found = index.byViewRef.get(viewRef);
  if (found === undefined) return undefined;
  if (!indexerView && found.collection !== prefix) return undefined;
  return {
    ...found,
    nodeRef: found.nodeRef.length > 0 ? found.nodeRef : nodeRef,
  };
}

export async function approvedPageForViewRef(projectRoot: string, viewRef: string): Promise<{ collection: KnowledgeCollection; nodeRef: string; path: string; relPath: string }> {
  const found = findApprovedPageForViewRef(
    viewRef,
    await buildApprovedPageViewRefIndex(projectRoot),
  );
  if (found !== undefined) return found;
  throw new ContextError(ExitCode.WorkspaceStateError, `approved page is not available: ${viewRef}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    view_ref: viewRef,
    next: "Run context verify to inspect current approved knowledge view_refs.",
  });
}

function frontmatterBlock(content: string): { yaml: string; end: number } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (match?.[1] === undefined) return null;
  return {
    yaml: match[1],
    end: match[0].length,
  };
}

export function updateFrontmatter(content: string, mutate: (frontmatter: Record<string, unknown>) => Record<string, unknown>): string {
  const block = frontmatterBlock(content);
  if (block === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, "approved page frontmatter is missing", {
      category: ErrorCategory.SchemaInvalid,
      next: "Fix approved Markdown frontmatter before running this review maintenance command.",
    });
  }
  const parsed = YAML.parse(block.yaml) as unknown;
  if (!isRecord(parsed)) {
    throw new ContextError(ExitCode.WorkspaceStateError, "approved page frontmatter must be a YAML object", {
      category: ErrorCategory.SchemaInvalid,
    });
  }
  const yaml = YAML.stringify(mutate(parsed)).trimEnd();
  return `---\n${yaml}\n---${content.slice(block.end)}`;
}

export function parseApprovedSources(content: string): string[] {
  const block = frontmatterBlock(content);
  if (block === null) return [];
  const parsed = YAML.parse(block.yaml) as unknown;
  if (!isRecord(parsed)) return [];
  const sources = parsed.sources;
  return Array.isArray(sources)
    ? sources.filter((source): source is string => typeof source === "string")
    : [];
}

export async function writeReviewActionLog(input: {
  projectRoot: string;
  action: string;
  id: string;
  summary: Record<string, unknown>;
}): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "");
  const relPath = join(REVIEW_ACTION_ROOT, `${stamp}-${input.action}-${input.id.replace(/[\\/]+/gu, "_")}.json`);
  const path = join(input.projectRoot, relPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    action: input.action,
    id: input.id,
    ...input.summary,
  }, null, 2)}\n`, "utf8");
  return relPath;
}

export function candidateIdsHash(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}

export function candidateSetHash(records: readonly CandidateRecord[]): string {
  const stable = records
    .map((record) => ({
      candidate_id: record.candidate_id,
      fingerprint: record.fingerprint,
      structure_digest: record.structure_digest ?? null,
    }))
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
