import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { documentRevisionPathForApprovedPath } from "./knowledgeFileClassification.js";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import {
  collectDocumentOptimizationFragments,
  isRecord,
  sha256,
} from "./documentOptimizationModel.js";
import { DOCUMENT_OPTIMIZATION_CACHE_ROOT } from "./documentOptimizationConfig.js";

const DOCUMENT_REVISION_REQUEST_SCHEMA = "context.document-revision-request.v1";

export interface DocumentRevisionTarget {
  approved_path: string;
  title: string;
  view_ref: string;
  node_ref?: string;
  fragment_count: number;
  fragment_ids: string[];
}

export interface DocumentRevisionRequest {
  schema: typeof DOCUMENT_REVISION_REQUEST_SCHEMA;
  approved_path: string;
  revision_digest: string;
}

export interface DocumentRevisionTargetResolution {
  target?: DocumentRevisionTarget;
  candidates: DocumentRevisionTarget[];
}

function requestPath(projectRoot: string): string {
  return join(projectRoot, DOCUMENT_OPTIMIZATION_CACHE_ROOT, "revision-request.json");
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function collectDocumentRevisionTargets(
  files: readonly ApprovedKnowledgeFile[],
): DocumentRevisionTarget[] {
  const fragments = collectDocumentOptimizationFragments(files);
  const fragmentsByPath = new Map<string, typeof fragments>();
  for (const fragment of fragments) {
    const current = fragmentsByPath.get(fragment.approved_path) ?? [];
    current.push(fragment);
    fragmentsByPath.set(fragment.approved_path, current);
  }
  return files.flatMap((file): DocumentRevisionTarget[] => {
    const pageFragments = fragmentsByPath.get(file.relPath) ?? [];
    if (pageFragments.length === 0) return [];
    const frontmatter = parseKnowledgeFrontmatter(file.content);
    const nodeRef = stringField(frontmatter, "node_ref");
    return [{
      approved_path: file.relPath,
      title: stringField(frontmatter, "title") ?? file.relPath,
      view_ref: stringField(frontmatter, "view_ref") ?? file.relPath,
      ...(nodeRef === undefined ? {} : { node_ref: nodeRef }),
      fragment_count: pageFragments.length,
      fragment_ids: pageFragments.map((fragment) => fragment.fragment_id),
    }];
  }).sort((left, right) => left.approved_path.localeCompare(right.approved_path));
}

function normalizedSelector(value: string): string {
  return value.trim().replace(/^knowledge[\\/]/u, "").replace(/__revision\.md$/u, ".md").toLowerCase();
}

function exactTarget(target: DocumentRevisionTarget, selector: string): boolean {
  return [target.approved_path, target.title, target.view_ref, target.node_ref]
    .filter((value): value is string => value !== undefined)
    .some((value) => value.toLowerCase() === selector) ||
    target.fragment_ids.some((fragmentId) => fragmentId.toLowerCase() === selector);
}

function targetSearchValues(target: DocumentRevisionTarget): string[] {
  return [target.approved_path, target.title, target.view_ref, target.node_ref, ...target.fragment_ids]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.toLowerCase());
}

function targetTokenScore(target: DocumentRevisionTarget, tokens: readonly string[]): number {
  const text = targetSearchValues(target).join(" ");
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

export function resolveDocumentRevisionTarget(
  targets: readonly DocumentRevisionTarget[],
  selector: string,
): DocumentRevisionTargetResolution {
  const normalized = normalizedSelector(selector);
  const exact = targets.filter((target) => exactTarget(target, normalized));
  const exactTargetMatch = exact[0];
  if (exact.length === 1 && exactTargetMatch !== undefined) {
    return { target: exactTargetMatch, candidates: exact };
  }
  if (exact.length > 1) return { candidates: exact };
  const contained = targets.filter((target) => targetSearchValues(target).some((value) =>
    value.length >= 2 && normalized.includes(value)
  ));
  const containedTarget = contained[0];
  if (contained.length === 1 && containedTarget !== undefined) {
    return { target: containedTarget, candidates: contained };
  }
  if (contained.length > 1) return { candidates: contained };
  const tokens = normalized.split(/[^\p{L}\p{N}_.:/-]+/u).filter((token) => token.length > 0);
  const scored = tokens.length === 0
    ? []
    : targets.map((target) => ({ target, score: targetTokenScore(target, tokens) }));
  const maxScore = scored.reduce((max, item) => Math.max(max, item.score), 0);
  const candidates = maxScore === 0
    ? []
    : scored.filter((item) => item.score === maxScore).map((item) => item.target);
  const onlyCandidate = candidates[0];
  return candidates.length === 1 && onlyCandidate !== undefined
    ? { target: onlyCandidate, candidates }
    : { candidates };
}

export async function readDocumentRevisionRequest(projectRoot: string): Promise<DocumentRevisionRequest | null> {
  const path = requestPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isRecord(value) || value.schema !== DOCUMENT_REVISION_REQUEST_SCHEMA ||
      typeof value.approved_path !== "string" || typeof value.revision_digest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.revision_digest)
    ) return null;
    return value as unknown as DocumentRevisionRequest;
  } catch {
    return null;
  }
}

export async function writeDocumentRevisionRequest(input: {
  projectRoot: string;
  approvedPath: string;
  revisionContent: string;
}): Promise<DocumentRevisionRequest> {
  const value: DocumentRevisionRequest = {
    schema: DOCUMENT_REVISION_REQUEST_SCHEMA,
    approved_path: input.approvedPath,
    revision_digest: sha256(input.revisionContent),
  };
  const path = requestPath(input.projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export async function clearDocumentRevisionRequest(projectRoot: string): Promise<void> {
  await rm(requestPath(projectRoot), { force: true });
}

export function documentRevisionRequestPath(approvedPath: string): string {
  return `knowledge/${documentRevisionPathForApprovedPath(approvedPath)}`;
}
