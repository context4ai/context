import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  KNOWLEDGE_COLLECTIONS,
  loadSourcesRegistry,
  type ExtractCustomPhaseDefinition,
  type ExtractTsPhaseDefinition,
  type KnowledgeCollection,
} from "@c4a/context";
import { parseDocumentSourceLocator, parseSpanSourceRef } from "@c4a/extract";
import YAML from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { buildCommittedEvidenceIndex } from "./documentEvidenceIndex.js";
import { isApprovedKnowledgeMarkdownPath } from "./knowledgeFileClassification.js";
import { assertSafeEntityId } from "./entityId.js";
import { extractPhaseSourceFingerprint } from "./extractCandidateArtifacts.js";
import { selectRepoSourcesForExtraction } from "./extractSourceSelection.js";
import { proseCandidateMarkdown } from "./proseCandidateMarkdown.js";
import type { ProseCandidateSection, CandidateRecord } from "./candidateLedger.js";
import { loadContextProjectModule } from "./workspace.js";

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
  phase_id?: string;
  phase_fingerprint?: string;
  markdown: string;
  sections?: ProseCandidateSection[];
  symbol?: {
    name?: string;
    kind?: string;
    members?: Array<{ name?: string; kind?: string }>;
  };
}

export interface ParsedCanonicalSourceRef {
  source: string;
  file: string;
  symbol: string;
  kind: string;
  digest: string;
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

export const SNAPSHOT_ROOT = join(".tmp", "context-runtime", "extract", "candidates");
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

function snapshotPath(projectRoot: string, candidateId: string): string {
  assertSafeEntityId(candidateId);
  return join(projectRoot, SNAPSHOT_ROOT, `${candidateId}.json`);
}

async function readCandidateSnapshot(projectRoot: string, candidateId: string): Promise<CandidateSnapshot | undefined> {
  const file = snapshotPath(projectRoot, candidateId);
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate snapshot is invalid JSON: ${join(SNAPSHOT_ROOT, `${candidateId}.json`)}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: candidateId,
      reason: message,
      next: "Rerun the extract phase before reviewing this candidate.",
    });
  }
  if (!isRecord(parsed) || typeof parsed.candidate_id !== "string" || typeof parsed.markdown !== "string") {
    throw new ContextError(ExitCode.WorkspaceStateError, `candidate snapshot is invalid: ${join(SNAPSHOT_ROOT, `${candidateId}.json`)}`, {
      category: ErrorCategory.SchemaInvalid,
      candidate_id: candidateId,
      next: "Rerun the extract phase before reviewing this candidate.",
    });
  }
  return parsed as unknown as CandidateSnapshot;
}

function isCodeExtractionPhase(
  phase: { kind: string },
): phase is ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition {
  return phase.kind === "phase.extract.ts" || phase.kind === "phase.extract.custom";
}

async function extractCandidateSnapshotIsCurrent(
  projectRoot: string,
  snapshot: CandidateSnapshot,
): Promise<boolean> {
  if (snapshot.phase_id === undefined || snapshot.phase_fingerprint === undefined) return false;
  try {
    const loaded = await loadContextProjectModule(projectRoot);
    const phase = loaded.project.phases.find((candidate): candidate is ExtractTsPhaseDefinition | ExtractCustomPhaseDefinition =>
      isCodeExtractionPhase(candidate) && candidate.id === snapshot.phase_id
    );
    if (phase === undefined) return false;
    const sources = await selectRepoSourcesForExtraction({ projectRoot, phase, materialize: false });
    if (sources.some((source) => !source.status.ready)) return false;
    const current = extractPhaseSourceFingerprint({ phase, sources });
    return current.fingerprint === snapshot.phase_fingerprint;
  } catch {
    return false;
  }
}

export async function removeCandidateSnapshot(projectRoot: string, candidateId: string): Promise<void> {
  const file = snapshotPath(projectRoot, candidateId);
  await rm(file, { force: true });
  const snapshotRoot = join(projectRoot, SNAPSHOT_ROOT);
  let current = dirname(file);
  while (current !== snapshotRoot && current.startsWith(snapshotRoot)) {
    try {
      await rmdir(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

export function parseCanonicalSourceRef(ref: string): ParsedCanonicalSourceRef {
  const match = /^repo:([^#]+)#symbol:(.+):([^:@]+):([^:@]+)@([a-f0-9]+)$/iu.exec(ref);
  if (match === null) {
    throw new ContextError(ExitCode.WorkspaceStateError, `unsupported canonical source_ref: ${ref}`, {
      category: ErrorCategory.SchemaInvalid,
      source_ref: ref,
    });
  }
  const source = match[1];
  const file = match[2];
  const symbol = match[3];
  const kind = match[4];
  const digest = match[5];
  if (source === undefined || file === undefined || symbol === undefined || kind === undefined || digest === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `unsupported canonical source_ref: ${ref}`, {
      category: ErrorCategory.SchemaInvalid,
      source_ref: ref,
    });
  }
  return {
    source,
    file,
    symbol,
    kind,
    digest,
  };
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

async function hydrateProseCandidateSnapshot(
  projectRoot: string,
  record: CandidateRecord,
): Promise<CandidateSnapshot | undefined> {
  if (record.candidate_type !== "prose-align") return undefined;
  const evidence = await currentProseCandidateEvidence(projectRoot, record);
  if (evidence === undefined) return undefined;
  const markdown = proseCandidateMarkdown({
    ...(record.body !== undefined ? { body: record.body } : {}),
    ...(record.sections !== undefined ? { sections: record.sections } : {}),
  });
  if (markdown.trim().length === 0) return undefined;
  return {
    candidate_id: record.candidate_id,
    collection: record.collection,
    source: record.source?.locator ?? record.source_refs[0] ?? record.module,
    source_refs: record.source_refs,
    markdown,
    ...(record.sections !== undefined ? { sections: record.sections } : {}),
  };
}

export async function currentProseCandidateEvidence(
  projectRoot: string,
  record: CandidateRecord,
): Promise<{ parsed: ParsedCanonicalProseRef; indexResult: Awaited<ReturnType<typeof buildCommittedEvidenceIndex>> } | undefined> {
  const stagedSnapshotHash = record.source?.snapshot_hash;
  if (stagedSnapshotHash === undefined) return undefined;
  const parsed = parseCanonicalProseRef(record.source?.source_ref ?? record.source_refs[0] ?? "");
  if (parsed === null) return undefined;
  const registry = await loadSourcesRegistry({ rootDir: projectRoot });
  const entry = parsed.sourceType === "file"
    ? registry.files.find((source) => source.name === parsed.sourceName || source.id === parsed.sourceName)
    : registry.larks.find((source) => source.name === parsed.sourceName || source.id === parsed.sourceName);
  if (entry === undefined) return undefined;
  try {
    const indexResult = await buildCommittedEvidenceIndex({
      projectRoot,
      sourceType: parsed.sourceType,
      sourceName: parsed.sourceName,
      materializedAt: entry.materializedAt,
      ...(entry.snapshot?.manifest !== undefined ? { manifestPath: entry.snapshot.manifest } : {}),
      writeRuntimeIndex: false,
    });
    if (indexResult.index.snapshot_hash !== stagedSnapshotHash) return undefined;
    return { parsed, indexResult };
  } catch {
    return undefined;
  }
}

export async function readReviewCandidateSnapshot(
  projectRoot: string,
  record: CandidateRecord,
): Promise<CandidateSnapshot | undefined> {
  if (record.candidate_type === "prose-align") {
    return hydrateProseCandidateSnapshot(projectRoot, record);
  }
  const snapshot = await readCandidateSnapshot(projectRoot, record.candidate_id);
  if (snapshot === undefined) return undefined;
  return await extractCandidateSnapshotIsCurrent(projectRoot, snapshot) ? snapshot : undefined;
}

export function findApprovedPageForViewRef(projectRoot: string, viewRef: string): { collection: KnowledgeCollection; nodeRef: string; path: string; relPath: string } | undefined {
  const separator = viewRef.indexOf(":");
  if (separator <= 0) {
    throw new ContextError(ExitCode.UserError, `approved maintenance target must be a view_ref: ${viewRef}`, {
      category: ErrorCategory.UserInputInvalid,
      view_ref: viewRef,
      next: "Use <collection>:<node_ref>, for example architecture:entity/install.",
    });
  }
  const collection = viewRef.slice(0, separator);
  if (!(KNOWLEDGE_COLLECTIONS as readonly string[]).includes(collection)) {
    throw new ContextError(ExitCode.UserError, `approved maintenance view_ref has unsupported collection: ${viewRef}`, {
      category: ErrorCategory.UserInputInvalid,
      view_ref: viewRef,
      next: `Use one of ${KNOWLEDGE_COLLECTIONS.join(", ")} as the view_ref prefix.`,
    });
  }
  const nodeRef = viewRef.slice(separator + 1);
  assertSafeEntityId(nodeRef);
  const collectionRoot = join(projectRoot, "knowledge", collection);
  if (existsSync(collectionRoot)) {
    const visit = (dir: string, relDir: string): { path: string; relPath: string; nodeRef: string } | undefined => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absPath = join(dir, entry.name);
        const rel = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          const found = visit(absPath, rel);
          if (found !== undefined) return found;
          continue;
        }
        if (!entry.isFile() || !isApprovedKnowledgeMarkdownPath(rel)) continue;
        const block = frontmatterBlock(readFileSync(absPath, "utf8"));
        if (block === null) continue;
        const parsed = YAML.parse(block.yaml) as unknown;
        if (!isRecord(parsed) || parsed.view_ref !== viewRef) continue;
        const approvedNodeRef = typeof parsed.node_ref === "string" && parsed.node_ref.trim().length > 0
          ? parsed.node_ref.trim()
          : nodeRef;
        return {
          path: absPath,
          relPath: join("knowledge", collection, rel),
          nodeRef: approvedNodeRef,
        };
      }
      return undefined;
    };
    const found = visit(collectionRoot, "");
    if (found !== undefined) {
      return { collection: collection as KnowledgeCollection, nodeRef: found.nodeRef, path: found.path, relPath: found.relPath };
    }
  }
  return undefined;
}

export function approvedPageForViewRef(projectRoot: string, viewRef: string): { collection: KnowledgeCollection; nodeRef: string; path: string; relPath: string } {
  const found = findApprovedPageForViewRef(projectRoot, viewRef);
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

export function proseResourceForSource(source: string | undefined, fallback: string): string {
  if (source === undefined) return fallback;
  const index = source.indexOf(":");
  if (index < 0) return fallback;
  const scheme = source.slice(0, index);
  return scheme === "file" || scheme === "lark" ? source : fallback;
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
