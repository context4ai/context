import {
  CODE_INDEX_COVERAGE_KINDS,
  type CodeIndexCoverageKind,
  type CustomCodeCandidateDraft,
  type CustomCodeCandidateSection,
  type CustomCodeEvidence,
  type ExtractCustomPhaseDefinition,
} from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { candidateIdFromCollectionNodeRef, viewRefFromCollectionNodeRef } from "./candidateIdentity.js";
import { knowledgeTargetPathForNode } from "./candidateLedger.js";
import { assertSafeEntityId } from "./entityId.js";
import { stableHash } from "./extractCandidateArtifacts.js";
import type {
  CandidateDraft,
  ExtractSourceSymbolIndexEntry,
} from "./extractCandidateTypes.js";

export interface BuiltCustomCandidate {
  candidate: CandidateDraft;
  markdown: string;
  primary: CustomCodeEvidence;
  symbols: ExtractSourceSymbolIndexEntry[];
  coverageKinds: CodeIndexCoverageKind[];
}

const COVERAGE_KIND_SET = new Set<CodeIndexCoverageKind>(CODE_INDEX_COVERAGE_KINDS);

export function customInputError(
  phaseId: string,
  message: string,
  detail: Record<string, unknown> = {},
): ContextError {
  return new ContextError(ExitCode.UserError, `custom extraction '${phaseId}' returned invalid candidates: ${message}`, {
    category: ErrorCategory.UserInputInvalid,
    code: "custom-extraction-result-invalid",
    phaseId,
    ...detail,
    next: "Fix the extractCustom result shape and rerun the phase.",
  });
}

function nonEmpty(value: string, field: string, phaseId: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw customInputError(phaseId, `${field} must be a non-empty string`, { field });
  return trimmed;
}

function suggestedEvidenceToken(value: string): string {
  return value
    .replace(/[@:]/gu, "-")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "symbol";
}

function validateEvidence(input: {
  phaseId: string;
  evidence: CustomCodeEvidence;
  sourceNames: ReadonlySet<string>;
  field: string;
}): CustomCodeEvidence {
  const source = nonEmpty(input.evidence.source, `${input.field}.source`, input.phaseId);
  const file = nonEmpty(input.evidence.file, `${input.field}.file`, input.phaseId).replaceAll("\\", "/");
  const symbol = nonEmpty(input.evidence.symbol, `${input.field}.symbol`, input.phaseId);
  const kind = nonEmpty(input.evidence.kind, `${input.field}.kind`, input.phaseId);
  const digest = nonEmpty(input.evidence.digest, `${input.field}.digest`, input.phaseId).toLowerCase();
  if (!input.sourceNames.has(source)) {
    throw customInputError(input.phaseId, `${input.field}.source is outside the phase source scope`, {
      field: `${input.field}.source`,
      source,
      available_sources: [...input.sourceNames],
    });
  }
  if (file.startsWith("/") || file.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw customInputError(input.phaseId, `${input.field}.file must be a normalized source-relative path`, {
      field: `${input.field}.file`,
      file,
    });
  }
  for (const [name, value] of [["symbol", symbol], ["kind", kind]] as const) {
    if (!value.includes(":") && !value.includes("@")) continue;
    throw customInputError(input.phaseId, `${input.field}.${name} cannot contain canonical source_ref delimiters`, {
      field: `${input.field}.${name}`,
      invalid_delimiters: [":", "@"].filter((delimiter) => value.includes(delimiter)),
      suggested_token: suggestedEvidenceToken(value),
      next: "Use a stable path-safe evidence token. Keep the exact reader-facing signature or qualified name in the Section body instead of the canonical source_ref token.",
    });
  }
  if (!/^[a-f0-9]{8,64}$/u.test(digest)) {
    throw customInputError(input.phaseId, `${input.field}.digest must be 8-64 lowercase hexadecimal characters`, {
      field: `${input.field}.digest`,
    });
  }
  if (input.evidence.line !== undefined && (!Number.isInteger(input.evidence.line) || input.evidence.line < 1)) {
    throw customInputError(input.phaseId, `${input.field}.line must be a positive integer`, {
      field: `${input.field}.line`,
    });
  }
  return {
    source,
    file,
    symbol,
    kind,
    digest,
    ...(input.evidence.line !== undefined ? { line: input.evidence.line } : {}),
  };
}

function sourceRef(evidence: CustomCodeEvidence): string {
  return `repo:${evidence.source}#symbol:${evidence.file}:${evidence.symbol}:${evidence.kind}@${evidence.digest}`;
}

function containsReaderHeading(markdown: string): boolean {
  let fence: "```" | "~~~" | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const marker = /^\s*(```|~~~)/u.exec(line)?.[1] as "```" | "~~~" | undefined;
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence === undefined && /^\s{0,3}#{1,6}\s+\S/u.test(line)) return true;
  }
  return false;
}

export function candidateFromCustom(input: {
  phase: ExtractCustomPhaseDefinition;
  draft: CustomCodeCandidateDraft;
  index: number;
  sourceNames: ReadonlySet<string>;
}): BuiltCustomCandidate {
  const field = `candidates[${input.index}]`;
  const nodeRef = nonEmpty(input.draft.nodeRef, `${field}.nodeRef`, input.phase.id);
  assertSafeEntityId(nodeRef);
  if (!Array.isArray(input.draft.evidence) || input.draft.evidence.length === 0) {
    throw customInputError(input.phase.id, `${field}.evidence must contain at least one source-backed symbol`, {
      field: `${field}.evidence`,
    });
  }
  const evidence = input.draft.evidence.map((item, index) => validateEvidence({
    phaseId: input.phase.id,
    evidence: item,
    sourceNames: input.sourceNames,
    field: `${field}.evidence[${index}]`,
  }));
  const draftSections = input.draft.sections;
  if (!Array.isArray(draftSections) || draftSections.length === 0) {
    throw customInputError(input.phase.id, `${field}.sections must contain at least one evidence-scoped section`, {
      field: `${field}.sections`,
    });
  }
  const allEvidence = [...evidence];
  const sectionIds = new Set<string>();
  const sections = (draftSections as readonly CustomCodeCandidateSection[]).map((section, sectionIndex) => {
    const sectionField = `${field}.sections[${sectionIndex}]`;
    const id = nonEmpty(section.id, `${sectionField}.id`, input.phase.id);
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id) || sectionIds.has(id)) {
      throw customInputError(input.phase.id, `${sectionField}.id must be a unique path-safe token`, {
        field: `${sectionField}.id`,
      });
    }
    sectionIds.add(id);
    if (!COVERAGE_KIND_SET.has(section.kind)) {
      throw customInputError(input.phase.id, `${sectionField}.kind must be a supported code-index coverage kind`, {
        field: `${sectionField}.kind`,
        allowed: CODE_INDEX_COVERAGE_KINDS,
      });
    }
    if (!Array.isArray(section.evidence) || section.evidence.length === 0) {
      throw customInputError(input.phase.id, `${sectionField}.evidence must contain source-backed evidence`, {
        field: `${sectionField}.evidence`,
      });
    }
    const sectionEvidence = section.evidence.map((item, evidenceIndex) => validateEvidence({
      phaseId: input.phase.id,
      evidence: item,
      sourceNames: input.sourceNames,
      field: `${sectionField}.evidence[${evidenceIndex}]`,
    }));
    const sectionMarkdown = nonEmpty(section.markdown, `${sectionField}.markdown`, input.phase.id);
    if (containsReaderHeading(sectionMarkdown)) {
      throw customInputError(input.phase.id, `${sectionField}.markdown must contain Section body content only`, {
        field: `${sectionField}.markdown`,
        next: "Remove Markdown headings from the Section body. Context renders the heading from section.title and omits absent Sections instead of preserving template headings.",
      });
    }
    allEvidence.push(...sectionEvidence);
    const refs = [...new Set(sectionEvidence.map(sourceRef))].sort();
    return {
      id,
      kind: section.kind,
      title: nonEmpty(section.title, `${sectionField}.title`, input.phase.id),
      body: sectionMarkdown,
      source_ref: refs[0]!,
      source_refs: refs,
    };
  });
  const codeEdges = (input.draft.edges ?? []).map((edge, edgeIndex) => {
    if (
      edge === null || typeof edge !== "object" ||
      (edge.type !== "contains" && edge.type !== "depends_on") ||
      !Array.isArray(edge.evidence) || edge.evidence.length === 0
    ) {
      throw customInputError(input.phase.id, `${field}.edges[${edgeIndex}] must have a supported type and source-backed evidence`, {
        field: `${field}.edges[${edgeIndex}]`,
      });
    }
    const edgeEvidence = edge.evidence.map((item, evidenceIndex) => validateEvidence({
      phaseId: input.phase.id,
      evidence: item,
      sourceNames: input.sourceNames,
      field: `${field}.edges[${edgeIndex}].evidence[${evidenceIndex}]`,
    }));
    allEvidence.push(...edgeEvidence);
    const from = nonEmpty(edge.from, `${field}.edges[${edgeIndex}].from`, input.phase.id);
    const to = nonEmpty(edge.to, `${field}.edges[${edgeIndex}].to`, input.phase.id);
    if (from !== nodeRef) {
      throw customInputError(input.phase.id, `${field}.edges[${edgeIndex}].from must equal nodeRef`, {
        field: `${field}.edges[${edgeIndex}].from`,
        expected: nodeRef,
      });
    }
    return {
      type: edge.type,
      from,
      to,
      source_refs: [...new Set(edgeEvidence.map(sourceRef))].sort(),
      relation_type: nonEmpty(edge.relationType, `${field}.edges[${edgeIndex}].relationType`, input.phase.id),
    };
  });
  const review = input.draft.review;
  if (review === null || typeof review !== "object" || !Array.isArray(review.signals) || review.signals.length === 0) {
    throw customInputError(input.phase.id, `${field}.review.signals must contain at least one signal`, {
      field: `${field}.review.signals`,
    });
  }
  const markdown = [
    `# ${nonEmpty(review.title, `${field}.review.title`, input.phase.id)}`,
    "",
    ...sections.flatMap((section) => [`## ${section.title}`, "", section.body ?? "", ""]),
  ].join("\n").trim();
  const sourceRefs = [...new Set(allEvidence.map(sourceRef))].sort();
  const candidateId = candidateIdFromCollectionNodeRef(input.phase.collection, nodeRef);
  const viewRef = viewRefFromCollectionNodeRef(input.phase.collection, nodeRef);
  const candidate: CandidateDraft = {
    candidate_id: candidateId,
    node_ref: nodeRef,
    view_ref: viewRef,
    collection: input.phase.collection,
    status: "draft",
    candidate_type: "code-symbol",
    relationship_mode: "source-backed-explicit",
    change: "add",
    kind: nonEmpty(input.draft.kind, `${field}.kind`, input.phase.id),
    visibility: nonEmpty(input.draft.visibility, `${field}.visibility`, input.phase.id),
    module: nonEmpty(input.draft.module, `${field}.module`, input.phase.id),
    path: knowledgeTargetPathForNode(input.phase.collection, nodeRef),
    source_refs: sourceRefs,
    sections,
    ...(codeEdges.length > 0 ? { code_edges: codeEdges } : {}),
    fingerprint: stableHash({
      candidate_id: candidateId,
      node_ref: nodeRef,
      view_ref: viewRef,
      collection: input.phase.collection,
      kind: input.draft.kind,
      visibility: input.draft.visibility,
      module: input.draft.module,
      source_refs: sourceRefs,
      relationship_mode: "source-backed-explicit",
      code_edges: codeEdges,
      sections,
      markdown,
    }),
    review: {
      title: nonEmpty(review.title, `${field}.review.title`, input.phase.id),
      summary: nonEmpty(review.summary, `${field}.review.summary`, input.phase.id),
      ...(review.behaviorSummary !== undefined
        ? { behavior_summary: nonEmpty(review.behaviorSummary, `${field}.review.behaviorSummary`, input.phase.id) }
        : {}),
      ...(review.edgeSummary !== undefined
        ? { edge_summary: nonEmpty(review.edgeSummary, `${field}.review.edgeSummary`, input.phase.id) }
        : {}),
      signals: review.signals.map((signal, index) =>
        nonEmpty(signal, `${field}.review.signals[${index}]`, input.phase.id)
      ),
      reason: nonEmpty(review.reason, `${field}.review.reason`, input.phase.id),
    },
  };
  return {
    candidate,
    markdown,
    primary: evidence[0]!,
    symbols: allEvidence.map((item) => ({
      source: item.source,
      file: item.file,
      name: item.symbol,
      kind: item.kind,
      digest: item.digest,
    })),
    coverageKinds: [...new Set(sections.map((section) => section.kind))],
  };
}
