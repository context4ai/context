import type { KnowledgeCollection } from "@c4a/context";
import type { DocumentCaptureFidelityReport, DocumentResourceMaterializationReport } from "@c4a/extract";
import type { ProjectCloseStatus } from "./close.js";
import type {
  DeclarationGraph,
  StructureCompileResolution,
} from "./declarationGraph.js";
import type { PackageFreshness } from "./packageBuilder.js";
import type { DocumentOptimizationStatus } from "./documentOptimization.js";
import type { PackageTemplateReviewStatus } from "./packageTemplateReview.js";
import type { ProseCompileBatchProgress } from "./proseCompileBatch.js";
import type { RepoSourceStatus } from "./repoSources.js";
import type { StructureDraftStatus } from "./statusReaders.js";
import type { StructureBatchStatus } from "./statusStructureBatch.js";
import type { ContextWorkflowStatus } from "./workflow/workflowTypes.js";
import type { ReviewPathIdentityConflictStatus } from "./reviewIdentityConflicts.js";
import type { ExtractionPreviewState } from "./extractionPreviewCache.js";

export type SourceFreshnessState = "ready" | "stale" | "unknown";
export type EvidenceWarningState = "none" | "degraded" | "stale" | "orphaned";
export type EvidenceStatus =
  | "pass"
  | "pass-with-unverifiable-evidence"
  | "fail";
export type HumanGateKind = string;

export interface ProjectRoutingCommand {
  command: string;
  availability: "immediate" | "after-human-confirmation";
}

export interface ProjectRouting {
  current_state: string;
  recommended_action: string;
  reason: string;
  alternatives: string[];
  human_gate: {
    required: boolean;
    kind: HumanGateKind;
    confirmation: "not-required" | "required-in-current-conversation";
    persistence:
      | "not-applicable"
      | "conversation-only"
      | "workspace-after-command"
      | "defined-by-resolution-action";
    resolution?: "managed-session";
  };
  commands_available: boolean;
  command_plan: ProjectRoutingCommand[];
  configuration?: {
    file: "src/index.ts";
    action: string;
  };
  downstream_impact: string;
  do_not: string[];
}

export interface DocumentSourceStatus {
  type: "file" | "lark";
  id?: string;
  name: string;
  local?: string;
  url?: string;
  materializedAt: string;
  manifest: string;
  snapshotReady: boolean;
  snapshotHash?: string;
  normalizerVersion?: string;
  captureFidelity?: DocumentCaptureFidelityReport;
  resourceMaterialization?: DocumentResourceMaterializationReport;
  diagnostics: string[];
  agent_hints: string[];
  workspaceDiagnostics: string[];
}

export interface UnclassifiedDocumentTarget {
  sourceKey: string;
  capturePhaseId: string;
  command: string;
}

export interface PendingStructureTarget {
  sourceKey: string;
  collection: string;
  alignPhaseId: string;
  command: string;
  payloadTarget: string;
  configurationGaps: Array<"compile" | "review">;
  suggestions: string[];
}

export interface AlignPhaseResolution {
  state: "resolved" | "resolved-multiple" | "ambiguous" | "unresolved";
  requestedSourceKeys: string[];
  requestedCollections: string[];
  requestedTargets: Array<{ sourceKey: string; collection: string }>;
  matches: Array<{
    phaseId: string;
    sourceKey: string;
    collection: string;
    command: string;
  }>;
  checked: Array<{
    phaseId: string;
    declaredSourceKey: string;
    sourceKey?: string;
    collection: string;
    matched: boolean;
    reason?: string;
  }>;
}

export interface ActiveStructuresStatus {
  state: "missing" | "ready" | "invalid";
  count: number;
  slotCount: number;
  sourceKeys: string[];
  collections: string[];
  structureDigests: string[];
  slots: Array<{
    sourceKey: string;
    collection: string;
    structureDigest: string;
    snapshotReady: boolean;
    snapshotCurrent: boolean;
    evidenceSnapshotHash?: string;
    currentSnapshotHash?: string;
    phaseCollection?: string;
  }>;
  diagnostics: string[];
}

export interface ProjectStatus {
  projectRoot: string;
  sourceCount: number;
  readySources: number;
  draftCandidates: number;
  approvedPages: number;
  approvedCollections: KnowledgeCollection[];
  distFiles: number;
  packageCount: number;
  state: string;
  next: string;
  executionMode?: {
    mode: "managed";
    scope: "current-conversation";
  };
  routing: ProjectRouting;
  workflow: ContextWorkflowStatus;
  sourceSummary: {
    repo: { total: number; ready: number };
    document: { total: number; captured: number };
    total: number;
    ready: number;
  };
  sources: RepoSourceStatus[];
  documentSources: DocumentSourceStatus[];
  phases: string[];
  packages: PackageFreshness[];
  documentOptimization: DocumentOptimizationStatus;
  packageTemplateReviews: PackageTemplateReviewStatus[];
  sourceFreshness: SourceFreshnessState;
  staleSourcePhases: string[];
  pendingExtractPhases: string[];
  extractionPreview: ExtractionPreviewState;
  pendingCapturePhases: string[];
  evidenceStatus: EvidenceStatus;
  evidenceWarnings: EvidenceWarningState;
  close: ProjectCloseStatus;
  stagedStructure: StructureDraftStatus;
  activeStructures: ActiveStructuresStatus;
  structureBatch: StructureBatchStatus;
  unclassifiedDocumentTargets: UnclassifiedDocumentTarget[];
  pendingStructureTargets: PendingStructureTarget[];
  declarationGraph: DeclarationGraph;
  configurationGaps: string[];
  alignPhaseResolution?: AlignPhaseResolution;
  compilePhaseResolution?: StructureCompileResolution;
  compileBatch?: ProseCompileBatchProgress;
  reviewIdentityConflicts: ReviewPathIdentityConflictStatus;
  pendingReview?: {
    scope: "collection" | "all";
    collections: KnowledgeCollection[];
    collection?: KnowledgeCollection;
    count: number;
    command: string;
    candidateSetDigest?: string;
    decisionSource: "user-review" | "managed-session";
  };
  verifyErrors: number;
  verifyWarnings: number;
  projectionRefreshIssues: number;
  diagnostics: string[];
}
