import type {
  Evaluation,
  JsonValue,
  ResourceReadReceiptSet,
  ResourceLocation,
} from "@c4a/agent-graph";
import type {
  KnowledgeCollection,
  PackageDefinition,
  PhaseDefinition,
} from "@c4a/context";
import type { PackageFreshness } from "../packageBuilder.js";
import type { PackageTemplateReviewStatus } from "../packageTemplateReview.js";
import type { ProjectCloseStatus } from "../close.js";
import type { DeclarationGraph, StructureCompileResolution } from "../declarationGraph.js";
import type { ProseCompileBatchProgress } from "../proseCompileBatch.js";
import type {
  ActiveStructuresStatus,
  AlignPhaseResolution,
  DocumentSourceStatus,
  EvidenceWarningState,
  PendingStructureTarget,
  SourceFreshnessState,
  UnclassifiedDocumentTarget,
} from "../statusTypes.js";
import type { StructureDraftStatus } from "../statusReaders.js";
import type { ProjectVerifyIssue } from "../verify.js";
import type { ReviewPathIdentityConflictStatus } from "../reviewIdentityConflicts.js";
import type { ExtractionPreviewState } from "../extractionPreviewCache.js";
import type { DocumentOptimizationStatus } from "../documentOptimization.js";

export const CONTEXT_WORKFLOW_PROVIDER_ID = "c4a/context";
export const CONTEXT_WORKFLOW_GRAPH_ID = "workspace";
export const CONTEXT_WORKFLOW_ENTRY = "context";

export const CONTEXT_WORKFLOW_AUTHORITIES = {
  evidenceMaintenance: "context.evidence-maintenance",
  repositoryRestore: "context.repository-restore",
  sourceRead: "context.source-read",
  extractionScope: "context.extraction-scope",
  documentClassification: "context.document-classification",
  structureConfirmation: "context.structure-confirmation",
  knowledgeReview: "context.knowledge-review",
  packageOutput: "context.package-output",
  packageTemplateReview: "context.package-template-review",
} as const;

export type ContextWorkflowAuthority =
  (typeof CONTEXT_WORKFLOW_AUTHORITIES)[keyof typeof CONTEXT_WORKFLOW_AUTHORITIES];

export interface ContextWorkflowFacts extends Record<string, JsonValue> {
  workspace: {
    project_entry_valid: boolean;
    state_valid: boolean;
  };
  verification: {
    blocking_clear: boolean;
  };
  evidence: {
    maintenance_clear: boolean;
  };
  gates: {
    evidence_maintenance_resolved: boolean;
    source_read_resolved: boolean;
    extraction_scope_resolved: boolean;
    document_classification_resolved: boolean;
    structure_confirmation_resolved: boolean;
    knowledge_review_resolved: boolean;
    package_output_resolved: boolean;
  };
  resume: {
    prose_declarations_complete: boolean;
    structure_refresh_required?: boolean;
    structure_confirmation_resolved: boolean;
    structure_confirmed: boolean;
    compile_complete: boolean;
    knowledge_review_resolved: boolean;
    review_gate_clear: boolean;
  };
  sources: {
    registered: boolean;
    repositories_ready: boolean;
  };
  capture: {
    declarations_complete: boolean;
    complete: boolean;
  };
  extract: {
    declarations_complete: boolean;
    plans_complete: boolean;
    capability_clear: boolean;
    preview_current: boolean;
    ownership_clear: boolean;
    scale_clear: boolean;
    batch_digest: string | null;
    complete: boolean;
  };
  documents: {
    classified: boolean;
  };
  prose: {
    declarations_complete: boolean;
  };
  align: {
    prepared: boolean;
  };
  structure: {
    confirmed: boolean;
  };
  compile: {
    complete: boolean;
  };
  review: {
    gate_clear: boolean;
    batch_resolved: boolean;
    identity_conflicts_present?: true;
    candidate_set_digest: string | null;
  };
  close: {
    current: boolean;
  };
  packages: {
    declared: boolean;
    templates_reviewed: boolean;
    current: boolean;
  };
  document_optimization: {
    enabled: boolean;
    current: boolean;
    pending_count: number;
    conflict_count: number;
    revision_requested?: true;
  };
  logs: {
    configured: boolean;
    final_pending?: true;
  };
}

export interface ContextWorkflowObservation {
  projectRoot: string;
  projectEntryValid: boolean;
  stateDiagnostics: string[];
  sourceCount: number;
  repoSources: Array<{ id: string; name: string }>;
  readyRepoSources: number;
  documentSources: DocumentSourceStatus[];
  capturedDocumentSources: number;
  phases: readonly PhaseDefinition[];
  packages: readonly PackageDefinition[];
  packageFreshness: readonly PackageFreshness[];
  packageTemplateReviews: readonly PackageTemplateReviewStatus[];
  documentOptimization?: DocumentOptimizationStatus;
  runtimeEvents?: {
    configured: boolean;
    pending_count: number;
    pending_kinds: string[];
  };
  sourceFreshness: SourceFreshnessState;
  staleSourcePhases: readonly string[];
  pendingExtractPhases: readonly string[];
  extractionPreview?: ExtractionPreviewState;
  pendingCaptureCommands: readonly string[];
  missingCaptureSources: readonly DocumentSourceStatus[];
  evidenceWarnings: EvidenceWarningState;
  verifyErrors: number;
  projectionRefreshIssues: number;
  verifyIssues: readonly ProjectVerifyIssue[];
  stagedStructure: StructureDraftStatus;
  activeStructures: ActiveStructuresStatus;
  declarationGraph: DeclarationGraph;
  alignPhaseResolution?: AlignPhaseResolution;
  compilePhaseResolution?: StructureCompileResolution;
  compileBatch?: ProseCompileBatchProgress;
  reviewIdentityConflicts: ReviewPathIdentityConflictStatus;
  unclassifiedDocumentTargets: readonly UnclassifiedDocumentTarget[];
  pendingStructureTargets: readonly PendingStructureTarget[];
  draftCandidates: number;
  rejectedCandidates: number;
  draftCollections: readonly KnowledgeCollection[];
  candidateSetDigest?: string;
  approvedPages: number;
  close: ProjectCloseStatus;
  alignDocumentValidateNext?: string;
  alignDocumentStructureSummaryNext?: string;
  alignDocumentConfirmNext?: string;
  compileDocumentNext?: string;
}

export interface ContextWorkflowSnapshot {
  observation: ContextWorkflowObservation;
  authorities: ContextWorkflowAuthority[];
  facts: ContextWorkflowFacts;
  evaluation: Evaluation;
  route?: ContextResolvedWorkflowRoute;
  rootDiagnostics: ContextWorkflowDiagnostic[];
  resourceReceipts?: ResourceReadReceiptSet;
}

export interface ContextWorkflowDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  count?: number;
  details_resource?: ContextWorkflowResource;
}

export interface ContextWorkflowCommand {
  command: string;
  effect: "read" | "write" | "external";
  availability: "immediate" | "after-human-confirmation";
  managed_execution: "automatic" | "agent-required";
  execution?: {
    target: "agent-host" | "subprocess";
    requires_network_access?: true;
  };
}

export interface ContextWorkflowResource {
  id: string;
  kind: ResourceLocation["kind"];
  media_type: string;
  digest?: string;
  path?: string;
  revision?: string;
  command?: string;
  read_state: "read-required" | "current";
}

export interface ContextResolvedWorkflowRoute {
  protocol: "context.workflow.route.v1";
  id: string;
  revision: string;
  node: string;
  reason_code: string;
  summary?: string;
  availability: "immediate" | "requires-user" | "blocked";
  commands: ContextWorkflowCommand[];
  action?: {
    id: string;
    effect: "read" | "write" | "external";
    skill?: ContextWorkflowResource;
    input_schema?: ContextWorkflowResource;
    output_schema?: ContextWorkflowResource;
  };
  batch?: {
    kind: "prose-structure";
    schema: "context.prose.structure-batch.v1";
    input_schema: ContextWorkflowResource;
    input: string;
    targets: Array<{
      phase_id: string;
      source_key: string;
      collection: string;
      input: string;
    }>;
    validate: ContextWorkflowCommand;
    stage: ContextWorkflowCommand;
  };
  configuration?: {
    file: "src/index.ts";
    action: string;
    contract?: {
      target: "package-output";
      choices: Array<{
        id: "agent-knowledge-base" | "llm-text" | "none";
        factory: "kbPackage" | "llmsPackage" | null;
        required: string[];
        defaults?: Record<string, string>;
      }>;
      reference_resources: string[];
      after_edit: string;
    };
  };
  resources: {
      required: ContextWorkflowResource[];
      recommended: ContextWorkflowResource[];
      after_read?: {
        required_count: number;
        command: string;
      };
    };
  gate?: {
    id: string;
    authority?: string;
    delegatable: boolean;
    resolution: "user" | "session-authority";
    inspection_action?: {
      id: string;
      effect: "read";
      skill?: ContextWorkflowResource;
      input_schema?: ContextWorkflowResource;
      output_schema?: ContextWorkflowResource;
    };
    resolution_action?: {
      id: string;
      effect: "write" | "external";
      skill?: ContextWorkflowResource;
      input_schema?: ContextWorkflowResource;
      output_schema?: ContextWorkflowResource;
    };
  };
  after_action: {
    evaluate: true;
  };
}

export interface ContextWorkflowStatus {
  protocol: "context.workflow.status.v1";
  revision: string;
  status: Evaluation["statusCode"];
  current?: ContextResolvedWorkflowRoute;
  alternatives: Array<{
    id: string;
    node: string;
    reason_code: string;
    availability: "immediate" | "requires-user" | "blocked";
  }>;
  diagnostics: ContextWorkflowDiagnostic[];
}
