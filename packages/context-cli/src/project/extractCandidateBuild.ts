import { EdgeType, Visibility } from "@c4a/core";
import type { ExtractTsPhaseDefinition, KnowledgeCollection } from "@c4a/context";
import type { RelationInfo, RepositoryExtractionResult, SymbolInfo } from "@c4a/extract";
import {
  canonicalSourceRef,
  stableHash,
  symbolShapeDigest,
} from "./extractCandidateArtifacts.js";
import { candidateIdFromCollectionNodeRef, viewRefFromCollectionNodeRef } from "./candidateIdentity.js";
import type { ApprovedCodegraphPage } from "./codegraphApproved.js";
import type {
  CandidateDraft,
  ExtractRelationshipCoverage,
  ExtractTsPhasePreview,
} from "./extractCandidateTypes.js";
import type { RepoSourceRecord } from "./repoSources.js";
import {
  knowledgeTargetPathForNode,
  type CandidateReviewSummary,
  type CodeCandidateEdge,
  type CandidateStatus,
  type CandidateRecord,
} from "./candidateLedger.js";

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/^@/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "unknown";
}

function slugifyPackageName(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  const scoped = /^@[^/]+\/(.+)$/u.exec(raw);
  return slugify(scoped?.[1] ?? raw);
}

function modulePathFallback(path: string): string {
  const normalized = path.trim().replace(/\\/gu, "/").replace(/\/+$/u, "");
  if (normalized.length === 0 || normalized === ".") return "module";
  return normalized.split("/").filter(Boolean).at(-1) ?? "module";
}

function candidateModuleSlug(input: {
  sourceModule: string;
  packageName?: string;
  modulePath: string;
}): string {
  const sourceSlug = slugify(input.sourceModule);
  if (input.modulePath === "." || input.modulePath.trim().length === 0) return sourceSlug;
  const packageSlug = slugifyPackageName(input.packageName, modulePathFallback(input.modulePath));
  return packageSlug === sourceSlug ? sourceSlug : `${sourceSlug}/${packageSlug}`;
}

export function manifestVersion(manifests: readonly { type: string; content: unknown }[]): string | undefined {
  const packageManifest = manifests.find((manifest) => manifest.type === "package.json");
  const content = packageManifest?.content;
  if (content !== null && typeof content === "object" && !Array.isArray(content)) {
    const version = (content as { version?: unknown }).version;
    if (typeof version === "string" && version.trim().length > 0) return version.trim();
  }
  return undefined;
}

export function knowledgePath(collection: KnowledgeCollection, candidate: CandidateDraft): string {
  return `knowledge/${candidate.path}`;
}

export function knowledgeTreeFromExamples(
  collection: KnowledgeCollection,
  examples: readonly ExtractTsPhasePreview["knowledgePathExamples"][number][],
): string[] {
  if (examples.length === 0) return ["knowledge/", `  ${collection}/`, "    <no candidate examples>"];
  const lines = ["knowledge/", `  ${collection}/`];
  const rendered = new Set<string>();
  for (const example of examples) {
    const rel = example.path.replace(/^knowledge\/[^/]+\//u, "");
    const parts = rel.split("/");
    let indent = 4;
    let prefix = "";
    for (const part of parts) {
      prefix = prefix.length === 0 ? part : `${prefix}/${part}`;
      const isFile = part.endsWith(".md");
      const label = isFile ? part : `${part}/`;
      const key = `${indent}:${prefix}`;
      if (!rendered.has(key)) {
        lines.push(`${" ".repeat(indent)}${label}`);
        rendered.add(key);
      }
      indent += 2;
    }
  }
  return lines;
}

export function renderSymbolMarkdown(symbol: SymbolInfo): string {
  const lines = [`# ${symbol.name}`, ""];
  if (symbol.doc?.trim()) {
    lines.push(symbol.doc.trim(), "");
  }
  lines.push(`- kind: ${symbol.kind}`);
  lines.push(`- visibility: ${symbol.visibility}`);
  lines.push(`- source: ${symbol.file}:${symbol.line}`);
  if (symbol.extends) lines.push(`- extends: ${symbol.extends}`);
  if (symbol.implements?.length) {
    lines.push("- implements:");
    for (const implemented of symbol.implements) {
      lines.push(`  - ${implemented}`);
    }
  }
  if (symbol.signature) lines.push(`- signature: ${symbol.signature}`);
  if (symbol.propsType) lines.push(`- props: ${symbol.propsType}`);
  if (symbol.params?.length) {
    lines.push("- params:");
    for (const param of symbol.params) {
      lines.push(`  - ${param.name}: ${param.type ?? "unknown"}`);
    }
  }
  if (symbol.returnType) lines.push(`- returns: ${symbol.returnType}`);
  if (symbol.typeAnnotation) lines.push(`- type: ${symbol.typeAnnotation}`);
  lines.push(...renderInitializer(symbol.initializer));
  if (symbol.unionValues?.length) {
    lines.push("- values:");
    for (const value of symbol.unionValues) {
      lines.push(`  - ${value}`);
    }
  }
  if (symbol.members?.length) {
    lines.push("- members:");
    for (const member of symbol.members) {
      const details: string[] = [member.kind];
      if (member.typeAnnotation) details.push(member.typeAnnotation);
      if (member.returnType) details.push(`returns ${member.returnType}`);
      const suffix = details.length > 0 ? `: ${details.join("; ")}` : "";
      lines.push(`  - ${member.name}${suffix}`);
      if (member.doc?.trim()) lines.push(`    - doc: ${member.doc.trim()}`);
      if (member.params?.length) {
        lines.push("    - params:");
        for (const param of member.params) {
          lines.push(`      - ${param.name}: ${param.type ?? "unknown"}`);
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderInitializer(initializer: string | null | undefined): string[] {
  if (!initializer) return [];
  if (initializer.includes("\n")) {
    return ["- initializer:", "```ts", initializer, "```"];
  }
  return [`- initializer: \`${initializer}\``];
}

export function applyMarkdownTransforms(markdown: string, phase: ExtractTsPhaseDefinition): string {
  const transforms = Array.isArray(phase.transform)
    ? phase.transform
    : phase.transform
      ? [phase.transform]
      : [];
  return transforms.reduce((current, transform) => transform(current), markdown);
}

function candidateFingerprint(input: {
  candidateId: string;
  nodeRef: string;
  viewRef: string;
  collection: KnowledgeCollection;
  symbol: SymbolInfo;
  moduleSlug: string;
  sourceRefs: readonly string[];
  codeEdges: readonly CodeCandidateEdge[];
}): string {
  return stableHash({
    candidate_id: input.candidateId,
    node_ref: input.nodeRef,
    view_ref: input.viewRef,
    collection: input.collection,
    path: knowledgeTargetPathForNode(input.collection, input.nodeRef),
    module: input.moduleSlug,
    kind: input.symbol.kind,
    visibility: input.symbol.visibility,
    file: input.symbol.file,
    line: input.symbol.line,
    endLine: input.symbol.endLine,
    source_refs: input.sourceRefs,
    code_edges: input.codeEdges,
    params: input.symbol.params,
    returnType: input.symbol.returnType,
    typeAnnotation: input.symbol.typeAnnotation,
    propsType: input.symbol.propsType,
    initializer: input.symbol.initializer,
    signature: input.symbol.signature,
    members: input.symbol.members?.map((member) => ({
      name: member.name,
      kind: member.kind,
      file: member.file,
      line: member.line,
      endLine: member.endLine,
      typeAnnotation: member.typeAnnotation,
      returnType: member.returnType,
      doc: member.doc,
    })),
  });
}

function structureEdgeType(type: RelationInfo["type"]): CodeCandidateEdge["type"] {
  return type === EdgeType.Contains ? "contains" : "depends_on";
}

function uniqueCodeEdges(edges: readonly CodeCandidateEdge[]): CodeCandidateEdge[] {
  const byKey = new Map(edges.map((edge) => [JSON.stringify(edge), edge]));
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, edge]) => edge);
}

export interface CodeCandidateBuildResult {
  candidates: CandidateDraft[];
  relationships: ExtractRelationshipCoverage;
}

function reviewSummary(symbol: SymbolInfo): CandidateReviewSummary {
  const exported = symbol.visibility === Visibility.Exported;
  return {
    title: symbol.name,
    summary: `${exported ? "Exported" : "Internal"} ${symbol.kind} symbol from ${symbol.file}.`,
    signals: [
      exported ? "exported symbol" : "internal symbol",
      `kind:${symbol.kind}`,
      "has source location",
    ],
    reason: exported
      ? "Newly extracted exported symbol awaiting inclusion review."
      : "Internal symbol extracted for review because exportedOnly is disabled.",
  };
}

export function makeCandidates(input: {
  phase: ExtractTsPhaseDefinition;
  extraction: RepositoryExtractionResult;
  source: RepoSourceRecord;
}): CodeCandidateBuildResult {
  const drafts: CandidateDraft[] = [];
  const usedIds = new Map<string, number>();
  const relationships: ExtractRelationshipCoverage = {
    mode: "source-backed-ast",
    detected: 0,
    emitted: 0,
    omitted: {
      external: 0,
      endpointNotSelected: 0,
      ambiguousEndpoint: 0,
    },
  };
  for (const result of input.extraction.results) {
    const resultDrafts: Array<{ candidate: CandidateDraft; symbol: SymbolInfo }> = [];
    const moduleSlug = candidateModuleSlug({
      sourceModule: input.source.module,
      packageName: result.extraction.package.name,
      modulePath: result.module.path,
    });
    for (const symbol of result.extraction.symbols) {
      if (input.phase.exportedOnly && symbol.visibility !== Visibility.Exported) continue;
      const symbolSlug = slugify(symbol.name);
      const baseId = `${moduleSlug}/symbol/${symbolSlug}`;
      const count = usedIds.get(baseId) ?? 0;
      usedIds.set(baseId, count + 1);
      const nodeRef = count === 0
        ? baseId
        : `${baseId}--${stableHash({ file: symbol.file, name: symbol.name, kind: symbol.kind }, 8)}`;
      const viewRef = viewRefFromCollectionNodeRef(input.phase.collection, nodeRef);
      const candidateId = candidateIdFromCollectionNodeRef(input.phase.collection, nodeRef);
      const sourceRefs = [canonicalSourceRef(input.source.name, symbol)];
      const candidate: CandidateDraft = {
        candidate_id: candidateId,
        node_ref: nodeRef,
        view_ref: viewRef,
        collection: input.phase.collection,
        status: "draft",
        candidate_type: "code-symbol",
        relationship_mode: "source-backed-ast",
        change: "add",
        kind: symbol.kind,
        visibility: symbol.visibility,
        module: moduleSlug,
        path: knowledgeTargetPathForNode(input.phase.collection, nodeRef),
        source_refs: sourceRefs,
        fingerprint: "pending",
        review: reviewSummary(symbol),
      };
      drafts.push(candidate);
      resultDrafts.push({ candidate, symbol });
    }
    const candidatesByName = new Map<string, CandidateDraft[]>();
    for (const item of resultDrafts) {
      const rows = candidatesByName.get(item.symbol.name) ?? [];
      rows.push(item.candidate);
      candidatesByName.set(item.symbol.name, rows);
    }
    const outgoing = new Map<string, CodeCandidateEdge[]>();
    for (const relation of result.extraction.relations) {
      relationships.detected++;
      if (relation.isExternal) {
        relationships.omitted.external++;
        continue;
      }
      const fromCandidates = candidatesByName.get(relation.from) ?? [];
      const toCandidates = candidatesByName.get(relation.to) ?? [];
      if (fromCandidates.length === 0 || toCandidates.length === 0) {
        relationships.omitted.endpointNotSelected++;
        continue;
      }
      if (fromCandidates.length !== 1 || toCandidates.length !== 1) {
        relationships.omitted.ambiguousEndpoint++;
        continue;
      }
      const from = fromCandidates[0]!;
      const to = toCandidates[0]!;
      const edge: CodeCandidateEdge = {
        type: structureEdgeType(relation.type),
        from: from.node_ref,
        to: to.node_ref,
        source_refs: [...from.source_refs],
        relation_type: relation.type,
      };
      const edges = outgoing.get(from.candidate_id) ?? [];
      edges.push(edge);
      outgoing.set(from.candidate_id, edges);
    }
    for (const item of resultDrafts) {
      const codeEdges = uniqueCodeEdges(outgoing.get(item.candidate.candidate_id) ?? []);
      if (codeEdges.length > 0) item.candidate.code_edges = codeEdges;
      relationships.emitted += codeEdges.length;
      item.candidate.fingerprint = candidateFingerprint({
        candidateId: item.candidate.candidate_id,
        nodeRef: item.candidate.node_ref,
        viewRef: item.candidate.view_ref,
        collection: input.phase.collection,
        symbol: item.symbol,
        moduleSlug,
        sourceRefs: item.candidate.source_refs,
        codeEdges,
      });
    }
  }
  return { candidates: drafts, relationships };
}

export function removalCandidate(page: ApprovedCodegraphPage): CandidateDraft {
  return {
    candidate_id: page.candidateId,
    node_ref: page.nodeRef,
    view_ref: page.viewRef,
    collection: "codegraph",
    status: "draft",
    candidate_type: "code-symbol",
    change: "remove",
    kind: page.kind,
    visibility: page.visibility,
    module: page.module,
    path: page.path,
    source_refs: [page.sourceRef],
    fingerprint: stableHash({
      change: "remove",
      candidate_id: page.candidateId,
      previous_fingerprint: page.candidateFingerprint,
      source_ref: page.sourceRef,
    }),
    review: {
      title: page.title,
      summary: `Remove ${page.title} because the symbol is no longer present in the selected code source.`,
      signals: ["codegraph deletion", `kind:${page.kind}`, "approved symbol missing from current extraction"],
      reason: "Previously approved code symbol is absent from the current deterministic extraction result.",
    },
  };
}

function rowWithoutUpdated(row: CandidateRecord): Omit<CandidateRecord, "updated"> {
  const rest: Partial<CandidateRecord> = { ...row };
  delete rest.updated;
  return rest as Omit<CandidateRecord, "updated">;
}

function sourceOwnsRow(row: CandidateRecord, sourceNames: ReadonlySet<string>): boolean {
  return row.source_refs.some((sourceRef) => {
    for (const sourceName of sourceNames) {
      if (sourceRef.startsWith(`repo:${sourceName}#`)) return true;
    }
    return false;
  });
}

export function mergeCandidates(input: {
  existing: readonly CandidateRecord[];
  candidates: readonly CandidateDraft[];
  approvedById: ReadonlyMap<string, ApprovedCodegraphPage>;
  rejectedDecisions: ReadonlyMap<string, string>;
  sourceNames: ReadonlySet<string>;
  collection: KnowledgeCollection;
  now: string;
}): {
  rows: CandidateRecord[];
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  snapshotCleanupIds: string[];
  skippedApprovedIds: string[];
  skippedApproved: number;
  skippedRejectedIds: string[];
  skippedRejected: number;
  decisionsToRemove: string[];
} {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const existingById = new Map(input.existing.map((row) => [row.candidate_id, row]));
  const rows: CandidateRecord[] = [];
  let removed = 0;
  const snapshotCleanupIds: string[] = [];
  const skippedApprovedIds: string[] = [];
  let skippedApproved = 0;
  const skippedRejectedIds: string[] = [];
  let skippedRejected = 0;
  const decisionsToRemove = new Set<string>();

  for (const row of input.existing) {
    if (row.collection === input.collection && sourceOwnsRow(row, input.sourceNames)) {
      if (!candidateById.has(row.candidate_id)) {
        removed++;
        snapshotCleanupIds.push(row.candidate_id);
        continue;
      }
    }
    rows.push(row);
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const candidate of input.candidates) {
    const approved = input.approvedById.get(candidate.candidate_id);
    if (candidate.change !== "remove" && approved?.candidateFingerprint === candidate.fingerprint) {
      if (input.rejectedDecisions.has(candidate.candidate_id)) decisionsToRemove.add(candidate.candidate_id);
      skippedApproved++;
      skippedApprovedIds.push(candidate.candidate_id);
      snapshotCleanupIds.push(candidate.candidate_id);
      const rowIndex = rows.findIndex((row) => row.candidate_id === candidate.candidate_id);
      if (rowIndex >= 0) rows.splice(rowIndex, 1);
      continue;
    }

    const existing = existingById.get(candidate.candidate_id);
    const rejectedFingerprint = input.rejectedDecisions.get(candidate.candidate_id);
    const rejected = rejectedFingerprint === candidate.fingerprint;
    if (rejectedFingerprint !== undefined && !rejected) decisionsToRemove.add(candidate.candidate_id);
    const status: CandidateStatus = rejected ? "rejected" : "draft";
    const next: CandidateRecord = {
      ...candidate,
      ...(approved !== undefined && candidate.change !== "remove" ? { change: "update" as const } : {}),
      status,
      updated: existing?.updated ?? input.now,
    };

    if (rejected) {
      skippedRejected++;
      skippedRejectedIds.push(candidate.candidate_id);
      snapshotCleanupIds.push(candidate.candidate_id);
      const rowIndex = rows.findIndex((row) => row.candidate_id === candidate.candidate_id);
      if (rowIndex < 0) rows.push(next);
      else rows[rowIndex] = existing?.fingerprint === candidate.fingerprint && existing.status === "rejected"
        ? existing
        : { ...next, updated: input.now };
      continue;
    }

    if (existing === undefined) {
      rows.push(next);
      added++;
      continue;
    }

    const rowIndex = rows.findIndex((row) => row.candidate_id === candidate.candidate_id);
    if (JSON.stringify(rowWithoutUpdated(existing)) === JSON.stringify(rowWithoutUpdated(next))) {
      unchanged++;
      if (rowIndex >= 0) rows[rowIndex] = existing;
      continue;
    }

    const changed = { ...next, updated: input.now };
    if (rowIndex < 0) rows.push(changed);
    else rows[rowIndex] = changed;
    updated++;
  }

  rows.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  return {
    rows,
    added,
    updated,
    unchanged,
    removed,
    snapshotCleanupIds,
    skippedApprovedIds,
    skippedApproved,
    skippedRejectedIds,
    skippedRejected,
    decisionsToRemove: [...decisionsToRemove].sort(),
  };
}

export { canonicalSourceRef, symbolShapeDigest };
