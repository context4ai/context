import type {
  Evaluation,
  HostActionResult,
  JsonValue,
  ResourceReadReceiptSet,
  ResourceLocation,
  HostActionResourceLocation,
  RouteAction,
} from "@c4a/agent-graph";
import type {
  KnowledgeCollection,
  PackageDefinition,
  PhaseDefinition,
} from "@c4a/context";
import type { PackageFreshness } from "../packageBuilder.js";
import type { PackageTemplateReviewStatus } from "../packageTemplateReview.js";
import type { ProjectCloseStatus } from "../close.js";
import type {
  DocumentSourceStatus,
  EvidenceWarningState,
} from "../statusTypes.js";
import type { ProjectVerifyIssue } from "../verify.js";

export const CONTEXT_WORKFLOW_PROVIDER_ID = "c4a/context";
export const CONTEXT_WORKFLOW_GRAPH_ID = "workspace";
export const CONTEXT_WORKFLOW_ENTRY = "context";

export const CONTEXT_WORKFLOW_AUTHORITIES = {
  indexerDependencyInstall: "context.indexer-dependency-install",
  indexerProgramExecution: "context.indexer-program-execution",
  indexerProjectConfirmation: "context.indexer-project-confirmation",
  evidenceMaintenance: "context.evidence-maintenance",
  repositoryRestore: "context.repository-restore",
  sourceRead: "context.source-read",
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
  indexer: {
    lifecycle_current: boolean;
    registry_state: "missing" | "pending" | "current" | "invalid";
  };
  gates: {
    evidence_maintenance_resolved: boolean;
    source_read_resolved: boolean;
    knowledge_review_resolved: boolean;
    package_output_resolved: boolean;
  };
  sources: {
    registered: boolean;
    repositories_ready: boolean;
  };
  capture: {
    declarations_complete: boolean;
    complete: boolean;
  };
  review: {
    gate_clear: boolean;
    batch_resolved: boolean;
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
  runtimeEvents?: {
    configured: boolean;
    pending_count: number;
    pending_kinds: string[];
  };
  pendingCaptureCommands: readonly string[];
  missingCaptureSources: readonly DocumentSourceStatus[];
  evidenceWarnings: EvidenceWarningState;
  verifyErrors: number;
  projectionRefreshIssues: number;
  verifyIssues: readonly ProjectVerifyIssue[];
  draftCandidates: number;
  rejectedCandidates: number;
  draftCollections: readonly KnowledgeCollection[];
  candidateSetDigest?: string;
  approvedPages: number;
  close: ProjectCloseStatus;
  indexerRegistry: {
    state: "missing" | "pending" | "current" | "invalid";
    sourceRefs: string[];
    diagnostic?: string;
  };
  indexerCandidateCompile: {
    state: "missing" | "current" | "stale" | "invalid";
  };
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

export type ContextWorkflowHostMaterialization = HostActionResourceLocation["materialize"];

export type ContextWorkflowHostResourceLocation = HostActionResourceLocation;

export type ContextWorkflowResourceLocation =
  | ResourceLocation
  | ContextWorkflowHostResourceLocation;

export type ContextWorkflowHostInlineOutput = Extract<
  HostActionResult["output"],
  { inline: JsonValue }
>;

export type ContextWorkflowHostManagedOutput = Extract<
  HostActionResult["output"],
  { resource: unknown }
>;

export type ContextWorkflowHostActionResult = HostActionResult;

export interface ContextWorkflowRouteActionSource {
  id: string;
  runner: RouteAction["runner"];
  effect: RouteAction["effect"];
  handler?: string;
  skill?: ContextWorkflowResourceLocation;
  inputSchema?: ContextWorkflowResourceLocation;
  outputSchema?: ContextWorkflowResourceLocation;
  input?: JsonValue;
}

export interface ContextWorkflowResource {
  id: string;
  kind: ResourceLocation["kind"];
  media_type: string;
  digest?: string;
  path?: string;
  revision?: string;
  command?: string;
  materialize?: ContextWorkflowHostMaterialization;
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
    runner: RouteAction["runner"];
    effect: "read" | "write" | "external";
    handler?: string;
    skill?: ContextWorkflowResource;
    input_schema?: ContextWorkflowResource;
    output_schema?: ContextWorkflowResource;
    input?: JsonValue;
  };
  configuration?: {
    file: "src/index.ts" | "src/indexers.yaml";
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
      runner: RouteAction["runner"];
      effect: "read";
      handler?: string;
      skill?: ContextWorkflowResource;
      input_schema?: ContextWorkflowResource;
      output_schema?: ContextWorkflowResource;
    };
    resolution_action?: {
      id: string;
      runner: RouteAction["runner"];
      effect: "write" | "external";
      handler?: string;
      skill?: ContextWorkflowResource;
      input_schema?: ContextWorkflowResource;
      output_schema?: ContextWorkflowResource;
      input?: JsonValue;
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
