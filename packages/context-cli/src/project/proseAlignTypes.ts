import {
  DOC_MAINLINE_COLLECTIONS,
  DOCUMENT_STRUCTURE_SCHEMA_VERSION,
  type DocumentMainlineCollection,
} from "@c4a/context";
import type { DocumentSourceType } from "@c4a/extract";
import { createHash } from "node:crypto";
import { slugify } from "../lib/normalize.js";
import type { RuntimeEvidenceDocument, RuntimeEvidenceIndex, SnapshotMarkdownCache } from "./documentEvidenceIndex.js";
import { semanticRuleSet, type SemanticRuleSet } from "./semanticRules.js";
import {
  PROSE_SECTION_KIND_PRIORITY,
  PROSE_SECTION_KINDS,
  proseSectionKindMountMatrix,
} from "./proseSectionKinds.js";

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._:/=-]+$/u.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export const ALIGN_GATE_SCHEMA_VERSION = "context.prose-align-gate.v1";
export const STRUCTURE_SCHEMA_VERSION = DOCUMENT_STRUCTURE_SCHEMA_VERSION;
export const STRUCTURE_EDGE_TYPES = [
  "is_a",
  "contains",
  "depends_on",
  "corresponds_to",
  "causes",
  "triggers",
  "prerequisite",
  "applies_to",
  "verified_by",
  "supersedes",
] as const;
export const STRUCTURE_EDGE_CONFIDENCES = ["possible", "hypothesis"] as const;
export const STRUCTURE_NODE_TYPES = ["entity", "domain", "action"] as const;
export const ENTITY_TAG_A = ["app", "service", "lib", "cli", "module", "symbol"] as const;
export const ENTITY_TAG_B = ["application", "system"] as const;
export const ENTITY_TAGS = ["term", ...ENTITY_TAG_A, ...ENTITY_TAG_B] as const;
export const ACTION_KINDS = ["user-story", "runbook", "howto", "roadmap", "scenario", "incident"] as const;
export const STRUCTURE_VIEW_INPUT_CONTRACT = {
  required_fields: ["view_ref", "node_ref", "collection", "slug", "sections"],
  defaulted_fields: {
    title: "Referenced node title.",
    node_type: "Referenced node node_type.",
    containment: "root",
  },
  derived_fields: {
    path: "<collection>/<slug>.md when containment is root; otherwise <collection>/<containment>/<slug>.md.",
    section_ref: "<view_ref>#<section.id>.",
  },
  optional_fields: ["generated", "summary", "ownership"],
  value_constraints: {
    view_ref: "Must equal <collection>:<node_ref>.",
    slug: "A safe filename slug without path separators.",
    path: "Omit it, or provide the exact CLI-derived value.",
    section_ref: "Omit it, or provide the exact CLI-derived value.",
  },
} as const;
export const ALIGN_VIEWS = [
  "read-plan",
  "source-index",
  "existing-knowledge",
  "structure-summary",
  "source-bundle",
  "chunks",
  "windows",
  "span-detail",
  "span-text",
  "full-text",
  "source-mapping",
  "diagnostics",
  "semantic-rules",
  "minimal",
  "schema",
] as const;
export const PROSE_SEMANTIC_ISSUE_FAMILIES = [
  "schema",
  "source_ref",
  "edge",
  "duplicate",
  "stale",
  "lifecycle",
  "ownership",
  "support",
  "weak_evidence",
  "scope_omit",
  "conflict",
  "node_quality",
  "tags",
] as const;
export function alignSemanticRules(diagnostics: readonly AlignDiagnostic[] = []): SemanticRuleSet {
  const required = [
    { id: "structure-planning", reason: "Core node, section, ownership, and structure decisions." },
    { id: "align-gates", reason: "Core node type, relationship, and tag gates." },
    { id: "density-profile", reason: "Source density determines page and section granularity." },
  ];
  const needsCandidateResolution = diagnostics.some((diagnostic) =>
    diagnostic.code.includes("duplicate") ||
    diagnostic.code.includes("conflict") ||
    diagnostic.code.includes("stable") ||
    diagnostic.code.includes("unresolved")
  );
  if (needsCandidateResolution) {
    required.push({
      id: "candidate-resolution",
      reason: "Current diagnostics involve duplicate, conflict, stable identity, or unresolved handling.",
    });
  }
  return semanticRuleSet({ scope: "align", required });
}

export type AlignView = typeof ALIGN_VIEWS[number];
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ProseAlignRunOptions {
  view?: string;
  schema?: boolean;
  validate?: boolean;
  stage?: boolean;
  confirm?: boolean;
  managed?: boolean;
  input?: string;
  source?: string;
  chunk?: string;
  span?: string;
  range?: string;
  readCursor?: string;
  rule?: string;
  pageSize?: string;
  pageToken?: string;
  tokenBudget?: string;
  byteBudget?: string;
  compact?: boolean;
  query?: string;
  collection?: string;
  nodeType?: string;
  replace?: string;
}

export interface AlignSourceContext {
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt: string;
  manifestPath?: string;
}

export interface ProseEvidencePhase {
  id: string;
  collection?: DocumentMainlineCollection;
}

export interface EvidenceContext {
  source: AlignSourceContext;
  index: RuntimeEvidenceIndex;
  snapshotMarkdownCache: SnapshotMarkdownCache;
  documents: EvidenceDocument[];
  chunks: EvidenceChunk[];
  windows: EvidenceWindow[];
}

export interface EvidenceDocument {
  document: RuntimeEvidenceDocument;
  markdown: string;
  locator: string;
  token_estimate: number;
  heading_tree: Array<{
    level: number;
    line: number;
    title: string;
    path: string[];
  }>;
  relation_hints: EvidenceRelationRef[];
}

export interface EvidenceRelationRef {
  relation_kind: "parent" | "children" | "related" | "relations";
  line: number;
  line_range?: string;
  source_ref?: string;
  quote: string;
  target_title: string;
  target_href?: string;
  target_ref_kind: "local_markdown" | "external_or_unknown";
  target_slug_hint?: string;
}

export interface EvidenceChunk {
  chunk_id: string;
  source_type: DocumentSourceType;
  source_name: string;
  document_path: string;
  locator: string;
  kind: string;
  boundary_role: "markdown-ast-block";
  section_candidate: true;
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  source_ref: string;
  text: string;
  text_preview: string;
  token_estimate: number;
  char_count: number;
  link_count: number;
  code_fence_count: number;
  table_row_count: number;
  relation_hints?: EvidenceRelationRef[];
}

export interface EvidenceWindow {
  window_id: string;
  document_path: string;
  locator: string;
  chunk_ids: string[];
  heading_path: string[];
  heading_paths?: string[][];
  multi_subsection?: boolean;
  line_start: number;
  line_end: number;
  line_range: string;
  source_refs: string[];
  text_preview: string;
  token_estimate: number;
}

export interface AlignDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  family: string;
  message: string;
  candidate_id?: string;
  field?: string;
  source_ref?: string;
  repair?: Record<string, unknown>;
}

export type StructureEdgeType = typeof STRUCTURE_EDGE_TYPES[number];
export type StructureEdgeConfidence = typeof STRUCTURE_EDGE_CONFIDENCES[number];
export type StructureLifecycleState = "draft" | "confirmed" | "frozen";

export interface StructureSectionPlan {
  id: string;
  kind: string;
  section_ref: string;
  summary?: string;
  ownership?: string;
  source_refs: string[];
}

export interface StructureNodePlan {
  node_ref: string;
  title: string;
  node_type: string;
  summary?: string;
  ownership?: string;
  tags?: string[];
}

export interface StructureViewPlan {
  view_ref: string;
  node_ref: string;
  collection: DocumentMainlineCollection;
  generated?: "parent_index";
  title: string;
  node_type: string;
  containment: string;
  slug: string;
  path: string;
  summary?: string;
  ownership?: string;
  sections: StructureSectionPlan[];
}

export interface StructureUserOrAgentHints {
  preferred_nodes?: Array<{
    node_ref: string;
    reason?: string;
  }>;
  grouping_notes?: string[];
  do_not_force?: string[];
}

export interface StructureEdgePlan {
  type: StructureEdgeType;
  from: string;
  to: string;
  source_refs: string[];
  confidence?: StructureEdgeConfidence;
  note?: string;
}

export interface StructureUnresolvedIssue {
  issue: string;
  note?: string;
  source_refs?: string[];
}

export interface StructureLifecycle {
  state: StructureLifecycleState;
  phase_collection?: string;
  confirmed_by?: string;
  confirmed_at?: string;
  structure_digest?: string;
  frozen_at?: string | null;
  frozen_snapshot_hash?: string | null;
}

export interface AlignPayload {
  schema_version: typeof STRUCTURE_SCHEMA_VERSION;
  sources: string[];
  nodes: StructureNodePlan[];
  views: StructureViewPlan[];
  edges: StructureEdgePlan[];
  unresolved: StructureUnresolvedIssue[];
  user_or_agent_hints?: StructureUserOrAgentHints;
  lifecycle: StructureLifecycle;
  evidence_snapshot_hash: string;
  payload_digest: string;
  structure_digest: string;
}

export interface AlignWarningLifecycle {
  scope: "align-quality";
  count: number;
  blocking_count: number;
  disposition: "blocks-structure-confirmation" | "pending-structure-confirmation" | "accepted-by-structure-confirmation";
  verify_scope: "not-carried-to-verify";
}

export interface ValidateResult {
  kind: "prose.align.validate.result";
  schema_version: typeof ALIGN_GATE_SCHEMA_VERSION;
  payload_schema: typeof STRUCTURE_SCHEMA_VERSION;
  state: "invalid" | "repair-required" | "ready";
  valid: boolean;
  error_free: boolean;
  phase_collection: DocumentMainlineCollection | string;
  collections: string[];
  nodes: number;
  views: number;
  edges: number;
  unresolved: number;
  lifecycle_state: StructureLifecycleState | "unknown";
  structure_digest: string;
  diagnostics: AlignDiagnostic[];
  diagnostics_view: Record<string, unknown>;
  repair_hints: Array<Record<string, unknown>>;
  allowed_actions: string[];
  next_action: Record<string, unknown>;
  confirmation_ready: boolean;
  confirmation_blockers: AlignDiagnostic[];
  warning_lifecycle: AlignWarningLifecycle;
  semantic_issue_families: string[];
  semantic_rules: SemanticRuleSet;
  semantic_reference_files: SemanticRuleSet["required"];
  review_notice?: Record<string, unknown>;
  structure_report?: Record<string, unknown>;
  structure_summary_compact?: Record<string, unknown>;
  structure_summary?: Record<string, unknown>;
  self_healed?: {
    kind: "suggested-splits";
    input_sections: number;
    sections_split: number;
    output_sections: number;
    reasons: Array<{
      code: string;
      sections: number;
    }>;
  };
}

export type AlignSelfHealSummary = NonNullable<ValidateResult["self_healed"]>;

export interface StageResult {
  kind: "prose.align.structure-write.result";
  operation: "staged" | "confirmed" | "confirmation-restored";
  schema_version: typeof ALIGN_GATE_SCHEMA_VERSION;
  source: { type: DocumentSourceType; name: string };
  phase_collection: DocumentMainlineCollection | string;
  collections: string[];
  payload_digest: string;
  previous_structure_digest?: string;
  structure_digest_changed?: boolean;
  confirmation_restored?: boolean;
  nodes: number;
  views: number;
  edges: number;
  unresolved: number;
  structure_digest: string;
  lifecycle_state: StructureLifecycleState;
  structureFile: string;
  review_notice?: Record<string, unknown>;
  structure_report?: Record<string, unknown>;
  structure_summary_compact?: Record<string, unknown>;
  warning_lifecycle?: AlignWarningLifecycle;
  self_healed?: AlignSelfHealSummary;
  next_action: Record<string, unknown>;
  structure_summary?: Record<string, unknown>;
}

export type AlignViewEnvelope = Record<string, unknown> & {
  kind: "prose.align.view.result";
  schema_version: typeof ALIGN_GATE_SCHEMA_VERSION;
};

export type AlignViewResult = AlignViewEnvelope & {
  view: AlignView;
};

export type ProseAlignRunResult = AlignViewResult | ValidateResult | StageResult | import("./semanticRulesView.js").SemanticRulesViewResult | import("./diagnosticsView.js").DiagnosticsViewResult;

export function isProseAlignRunResult(value: unknown): value is ProseAlignRunResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    typeof value.kind === "string" &&
    value.kind.startsWith("prose.align.");
}

export function alignCommand(phaseId: string, args: readonly string[]): string {
  return ["context", "run", phaseId, ...args].map((part) =>
    /^<[^>]+>$/u.test(part) ? part : shellQuote(part)
  ).join(" ");
}

function suggestedPayloadStem(phaseId: string): string {
  const fullSlug = slugify(phaseId, Number.MAX_SAFE_INTEGER);
  return fullSlug.length <= 120
    ? fullSlug
    : `${fullSlug.slice(0, 111).replace(/-+$/u, "")}-${createHash("sha256").update(phaseId).digest("hex").slice(0, 8)}`;
}

export function suggestedAlignPayloadPath(phaseId: string): string {
  return `.tmp/agent-payloads/${suggestedPayloadStem(phaseId)}-structure.yaml`;
}

export function suggestedCompilePayloadPath(phaseId: string): string {
  return `.tmp/agent-payloads/${suggestedPayloadStem(phaseId)}-compile.yaml`;
}

export function payloadSchema(
  snapshotHash?: string,
  source?: AlignSourceContext,
  collection: DocumentMainlineCollection = "architecture",
): Record<string, unknown> {
  const sourceId = source === undefined ? "<source-type>:<source-name>" : `${source.sourceType}:${source.sourceName}`;
  const sourceSlug = source?.sourceName ?? "source-name";
  const nodeRef = `entity/${sourceSlug}`;
  const viewRef = `${collection}:${nodeRef}`;
  const documentPath = source?.sourceType === "lark" ? "<document-id-or-title>.md" : "<document-path>.md";
  const sourceRef = `${sourceId}/${documentPath}#span:<heading-hint> L<start>-<end>@<span-hash>`;
  return {
    schema_version: STRUCTURE_SCHEMA_VERSION,
    sources: [sourceId],
    evidence_snapshot_hash: snapshotHash ?? "<copy read-plan.snapshot.snapshot_hash>",
    legal_collections: DOC_MAINLINE_COLLECTIONS,
    non_targets: {
      codegraph: "codegraph is produced by AST extraction, not prose align.",
      feats: "feats is an OKF output namespace and is not a prose align target.",
    },
    legal_section_kinds: PROSE_SECTION_KINDS,
    section_kind_priority: PROSE_SECTION_KIND_PRIORITY,
    section_kind_mount_matrix: proseSectionKindMountMatrix(),
    node_contract: {
      legal_node_types: STRUCTURE_NODE_TYPES,
      node_ref_prefix_must_match_node_type: true,
      node_ref_is_identity_not_path: true,
    },
    node_tag_contract: {
      entity: {
        required: true,
        allowed_tags: ENTITY_TAGS,
        group_a_at_most_one: ENTITY_TAG_A,
        group_b_at_most_one: ENTITY_TAG_B,
        term_mutually_exclusive_with_group_a_b: true,
      },
      domain: {
        tags_allowed: false,
      },
      action: {
        exactly_one_action_kind: ACTION_KINDS,
      },
    },
    view_input_contract: STRUCTURE_VIEW_INPUT_CONTRACT,
    parent_index_template: {
      description: "Use this shape when one navigation/container page should be generated from child views instead of mirroring its own source body.",
      parent_view: {
        view_ref: `${collection}:entity/${sourceSlug}`,
        node_ref: `entity/${sourceSlug}`,
        collection,
        generated: "parent_index",
        title: "Getting Started",
        containment: "getting-started",
        slug: sourceSlug,
        sections: [],
      },
      child_view: {
        view_ref: `${collection}:entity/${sourceSlug}/overview`,
        node_ref: `entity/${sourceSlug}/overview`,
        collection,
        title: "Getting Started Overview",
        containment: `getting-started/${sourceSlug}`,
        slug: "overview",
        sections: [{
          id: "overview",
          kind: "description",
          source_refs: [sourceRef],
        }],
      },
      edge: {
        type: "contains",
        from: `${collection}:entity/${sourceSlug}`,
        to: `${collection}:entity/${sourceSlug}/overview`,
        source_refs: [sourceRef],
      },
    },
    nodes: [{
      node_ref: nodeRef,
      title: "Getting Started",
      node_type: "entity",
      summary: "One sentence structure summary.",
      ownership: "Owns getting-started source spans.",
      tags: ["lib"],
    }],
    views: [{
      view_ref: viewRef,
      node_ref: nodeRef,
      collection,
      title: "Getting Started",
      containment: "root",
      slug: sourceSlug,
      summary: "Decision-style summary of this collection view.",
      ownership: "Owns getting-started source spans for this collection view.",
      sections: [{
        id: "overview",
        kind: "description",
        ownership: "Overview source span.",
        summary: "Mirror the overview span during compile.",
        source_refs: [sourceRef],
      }],
    }],
    edges: [],
    unresolved: [{
      issue: "weak_evidence",
      note: "Keep uncertain relationships unresolved until evidence supports them.",
    }],
    user_or_agent_hints: {
      preferred_nodes: [{
        node_ref: nodeRef,
        reason: "Optional user preference; must still be backed by evidence.",
      }],
      grouping_notes: ["Optional grouping preference, not evidence."],
      do_not_force: ["Do not materialize unsupported relationships."],
    },
    lifecycle: {
      state: "draft",
    },
  };
}

export function commonEnvelope(input: {
  phase: ProseEvidencePhase;
  source: AlignSourceContext;
  diagnostics?: AlignDiagnostic[];
}): AlignViewEnvelope {
  const phaseId = input.phase.id;
  const classificationOnly = input.phase.collection === undefined;
  const payloadPath = suggestedAlignPayloadPath(phaseId);
  const semanticRules = classificationOnly ? undefined : alignSemanticRules(input.diagnostics);
  const viewPurpose: Record<AlignView, string> = {
    "read-plan": "Inspect snapshot state, available evidence views, and payload schema with the current evidence snapshot hash.",
    "source-index": "Read a compact index of documents, headings, source spans, and budgets without body text.",
    "existing-knowledge": "Look up approved NodeRefs and ViewRefs before authoring new structure identities.",
    "structure-summary": "Summarize a context.structure.v1 payload, print confirmation counts, and write a temporary structure review report.",
    "source-bundle": "Read budgeted source evidence in document order before drafting the structure.",
    chunks: "List temporary reading chunks and canonical source_refs for citation.",
    windows: "Read neighboring chunks as larger context windows.",
    "span-detail": "Read exact evidence for a specific source_ref, chunk, or source line range.",
    "span-text": "Read exact source lines for a chunk, source_ref, or source plus line range.",
    "full-text": "Read one snapshot document through paged full-text output without inspecting sources/ directly.",
    "source-mapping": "Map documents and chunks to canonical source_ref values.",
    diagnostics: "Read validation diagnostics through a stable severity-first page sequence.",
    "semantic-rules": "Resolve only the required digest-checked semantic Markdown resources for this operation.",
    minimal: "Return only the minimal payload commands and schema pointer.",
    schema: "Return the context.structure.v1 payload schema.",
  };
  const viewOptions: Partial<Record<AlignView, string[]>> = {
    "source-index": ["--compact", "--byte-budget <n>", "--page-size <n>", "--page-token <token>", "--source <document>"],
    "existing-knowledge": ["--query <title-or-ref>", "--collection <collection>", "--node-type <node-type>", "--page-size <n>", "--page-token <token>"],
    "structure-summary": ["--input <structure.yaml>"],
    "source-bundle": ["--token-budget <n>", "--byte-budget <n>", "--page-size <n>", "--page-token <token>", "--source <document>"],
    chunks: ["--token-budget <n>", "--byte-budget <n>", "--page-size <n>", "--page-token <token>", "--source <document>"],
    windows: ["--token-budget <n>", "--byte-budget <n>", "--page-size <n>", "--page-token <token>", "--source <document>"],
    "span-detail": ["--chunk <chunk-id>", "--span <source-ref>", "--source <document> --range L<start>-<end>", "--page-size <n>", "--read-cursor <cursor>", "--byte-budget <n>"],
    "span-text": ["--chunk <chunk-id>", "--span <source-ref>", "--source <document> --range L<start>-<end>", "--page-size <n>", "--read-cursor <cursor>", "--byte-budget <n>"],
    "full-text": ["--source <document>", "--range L<start>-<end>", "--page-size <n>", "--read-cursor <cursor>", "--byte-budget <n>"],
    "source-mapping": ["--byte-budget <n>", "--page-size <n>", "--page-token <token>", "--source <document>"],
    diagnostics: ["--input <structure.yaml>", "--page-size <n>", "--page-token <token>"],
    "semantic-rules": ["--rule <id>"],
  };
  const unavailableClassificationViews = new Set([
    "schema",
    "minimal",
    "structure-summary",
    "diagnostics",
    "semantic-rules",
    "existing-knowledge",
  ]);
  return {
    kind: "prose.align.view.result",
    schema_version: ALIGN_GATE_SCHEMA_VERSION,
    phase_id: phaseId,
    source: { type: input.source.sourceType, name: input.source.sourceName },
    ...(input.phase.collection !== undefined ? { collection: input.phase.collection } : {}),
    document_mainline_collections: DOC_MAINLINE_COLLECTIONS,
    ...(classificationOnly ? {
      investigation_mode: "collection-neutral",
      classification_state: {
        required: true,
        reason_code: "route.document.classification-required",
      },
    } : {}),
    ...(!classificationOnly ? {
      payload_target: {
        path: payloadPath,
        policy: "recommended",
        lifecycle: "transient",
        retention: "discard-after-successful-stage",
      },
    } : {}),
    state: (input.diagnostics ?? []).some((diagnostic) => diagnostic.severity === "error")
      ? "needs-repair"
      : "evidence-ready",
    allowed_actions: classificationOnly ? ["view", "propose_collection"] : ["view", "validate", "stage_structure", "confirm_structure"],
    views: ALIGN_VIEWS.filter((view) => !classificationOnly || !unavailableClassificationViews.has(view)).map((view) => ({
      id: view,
      command: alignCommand(phaseId, ["--view", view, "--format", "json"]),
      purpose: viewPurpose[view],
      options: viewOptions[view] ?? [],
      budgeted: view === "source-index" || view === "source-bundle" || view === "chunks" || view === "windows" || view === "span-detail" || view === "span-text" || view === "full-text" || view === "source-mapping",
      next_page: "Use returned next_action.command or page/span_text/span_detail/full_text next_command exactly; do not compose continuation commands yourself.",
    })),
    diagnostics: input.diagnostics ?? [],
    ...(semanticRules !== undefined ? {
      semantic_rules: semanticRules,
      semantic_reference_files: semanticRules.required,
    } : {}),
  };
}
