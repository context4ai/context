export const CONTEXT_CACHE_SCHEMA_VERSION = "context.cache.v1";
export const INCREMENTAL_SCHEMA_VERSION = "incremental.v1";
export const RETRIEVAL_SCHEMA_VERSION = "retrieval.v2";

// Incremental cache is never externally marked stale; external stale reasons
// are recorded on retrieval, while incremental rebuildability uses "unknown".
export type IncrementalCacheHealth = "ready" | "unknown";

export interface IncrementalInputSummary {
  workspace_root: string;
  sources_hash?: string;
  knowledge_hash?: string;
  archive_hash?: string;
  decisions_hash?: string;
  config_hash?: string;
  [key: string]: unknown;
}

export interface IncrementalCachePaths {
  projectId: string;
  workspaceRoot: string;
  cacheRoot: string;
  manifest: string;
  casIndex: string;
  sourceDigests: string;
  rawBlocks: string;
  sectionFingerprints: string;
  state: string;
  nodes: string;
  sections: string;
  sources: string;
  graph: string;
  terms: string;
  archives: string;
  decisions: string;
}

export interface IncrementalCacheCounts {
  content_hashes: number;
  snapshots: number;
  origins: number;
  source_digests: number;
  raw_blocks: number;
  section_fingerprints: number;
  state_unknown_inputs: number;
}

export interface IncrementalCacheManifest {
  schema_version: string;
  project_id: string;
  workspace_root: string;
  input_summary: IncrementalInputSummary;
  status: IncrementalCacheHealth;
  reason?: string;
  files: {
    cas_index: string;
    source_digests: string;
    raw_blocks: string;
    section_fingerprints: string;
    incremental_state: string;
  };
  counts: IncrementalCacheCounts;
  updated_at: string;
  incremental: IncrementalManifestSection;
  retrieval: RetrievalManifestSection;
  paths: ContextCacheManifestPaths;
}

export interface IncrementalManifestSection {
  schema: typeof INCREMENTAL_SCHEMA_VERSION;
  inputs: IncrementalInputSummary;
  counts: IncrementalCacheCounts;
  status: IncrementalCacheHealth;
  reason?: string;
  updated_at: string;
}

export interface RetrievalInputSummary {
  workspace_root: string;
  knowledge_hash?: string;
  sources_hash?: string;
  archive_hash?: string;
  decisions_hash?: string;
  [key: string]: unknown;
}

export interface RetrievalCacheCounts {
  nodes: number;
  sections: number;
  sources: number;
  graph_edges: number;
  terms: number;
  archives: number;
  decisions: number;
}

export type RetrievalCacheHealth = "ready" | "stale" | "unknown";

export interface RetrievalManifestSection {
  schema: typeof RETRIEVAL_SCHEMA_VERSION;
  inputs: RetrievalInputSummary;
  counts: RetrievalCacheCounts;
  status: RetrievalCacheHealth;
  reason?: string;
  updated_at: string;
}

export interface ContextCacheManifestPaths {
  cas_index: string;
  source_digests: string;
  raw_blocks: string;
  section_fingerprints: string;
  incremental_state: string;
  nodes: string;
  sections: string;
  sources: string;
  graph: string;
  terms: string;
  archives: string;
  decisions: string;
}

export type ContextCacheManifest = IncrementalCacheManifest;

export interface RawBlock {
  block_id?: string;
  block_locator_id: string;
  kind: "root" | "paragraph" | "list_item" | "relation" | "code" | "table" | "quote";
  heading_path: string[];
  line_start: number;
  line_end: number;
  line_range: string;
  block_hash: string;
  block_body_hash: string;
  text_preview: string;
  list_path?: string[];
  list_ordinal?: number;
  structural_parent_id?: string;
  is_oversized?: boolean;
}

export interface RawBlocksSnapshot {
  source_id: string;
  snapshot_file: string;
  content_hash: string;
  hash_id: string;
  structure_hash: string;
  blocks: RawBlock[];
}

export interface RawBlocksCache {
  schema_version: string;
  snapshots: Record<string, RawBlocksSnapshot>;
  unknown_inputs: Array<{
    source_id: string;
    snapshot_file?: string;
    reason: string;
  }>;
  updated_at: string;
}

export interface SourceDigestSnapshot {
  file: string;
  captured_at: string;
  content_hash: string;
  hash_id: string;
  structure_hash: string;
  block_index_hash: string;
}

export interface SourceDigestEntry {
  status: "active" | "dropped";
  snapshots: SourceDigestSnapshot[];
  origin_history: string[];
}

export interface SourceDigestsCache {
  schema_version: string;
  sources: Record<string, SourceDigestEntry>;
  unknown_inputs: Array<{
    source_id: string;
    snapshot_file?: string;
    reason: string;
  }>;
  updated_at: string;
}

export interface CasSourceRef {
  source_id: string;
  status: "active" | "dropped";
  hash_id: string;
  content_hash: string;
  captured_at: string;
  origin?: string;
  snapshot_file?: string;
}

export interface CasOriginRef {
  source_id: string;
  status: "active" | "dropped";
  hash_id: string;
  content_hash: string;
  origin: string;
  snapshot_file?: string;
}

export interface CasBlockRef {
  source_id: string;
  content_hash: string;
  snapshot_file?: string;
  block_locator_id: string;
  block_hash: string;
  block_body_hash: string;
  heading_path: string[];
  line_range: string;
  text_preview?: string;
}

export interface CasSectionOutputRef {
  view_ref: string;
  section_id: string;
  kind: string;
  source_ref?: string;
}

export interface CasIndex {
  schema_version: string;
  content_hash_index: Record<string, CasSourceRef[]>;
  origin_index: Record<string, CasOriginRef>;
  block_hash_index: Record<string, CasBlockRef[]>;
  block_body_hash_index: Record<string, CasBlockRef[]>;
  section_output_hash_index: Record<string, CasSectionOutputRef[]>;
  counts: {
    sources: number;
    snapshots: number;
    content_hashes: number;
    origins: number;
    raw_blocks: number;
    block_hashes: number;
    block_body_hashes: number;
    section_outputs: number;
    section_output_hashes: number;
  };
  updated_at: string;
}

export interface IncrementalSourceClassification {
  source_id: string;
  status:
    | "unchanged"
    | "new-snapshot"
    | "moved"
    | "duplicate"
    | "restored"
    | "new"
    | "content_changed_only"
    | "structure_changed"
    | "new_source"
    | "unknown";
  reason?: string;
  content_hash?: string;
}

export interface IncrementalPendingSummary {
  status: "none" | "pending" | "unknown";
  count: number;
  reason?: string;
  sources?: string[];
  nodes?: string[];
}

export interface IncrementalUnknownInput {
  scope: string;
  reason: string;
  detected_at: string;
  summary?: Record<string, unknown>;
}

export interface IncrementalState {
  schema_version: string;
  updated_at: string;
  source_classifications: IncrementalSourceClassification[];
  pending_align: IncrementalPendingSummary;
  pending_compile: IncrementalPendingSummary;
  unknown_inputs: IncrementalUnknownInput[];
}

export type SectionEvidenceOverlap = "full" | "partial";

export interface SectionEvidenceSpan {
  source_id: string;
  snapshot_hash: string;
  source_ref_anchor_or_range: string;
  block_locator_id: string;
  block_hash: string;
  overlap: SectionEvidenceOverlap;
}

export interface SectionFingerprintEntry {
  view_ref: string;
  section_id: string;
  kind: string;
  source_id?: string;
  source_ref?: string;
  evidence_set_hash: string;
  evidence_spans: SectionEvidenceSpan[];
  output_hash?: string;
  section_output_hash?: string;
  updated_at: string;
}

export interface SectionFingerprintsCache {
  schema_version: string;
  sections: SectionFingerprintEntry[];
  unknown_inputs?: Array<{
    view_ref?: string;
    section_id?: string;
    reason: string;
  }>;
  updated_at: string;
}
