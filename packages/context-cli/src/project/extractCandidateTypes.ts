import type {
  CodeIndexCapability,
  CodeIndexCapabilityGap,
  CodeIndexCoverageKind,
  CodeIndexInspectionFinding,
  CodeIndexInspectionInventory,
  CodeIndexIdentityGroup,
  CodeIndexChainCandidate,
  CodeIndexChainCandidateDecision,
  CodeIndexModuleFacet,
  CodeIndexModuleType,
  CodeIndexOutputProfile,
  KnowledgeCollection,
} from "@c4a/context";
import type { SymbolInfo } from "@c4a/extract";
import type { RepoSourceRecord, RepoSourceStatus } from "./repoSources.js";
import type { CandidateRecord } from "./candidateLedger.js";

export interface CandidateDraft extends Omit<CandidateRecord, "status" | "updated"> {
  status: "draft";
}

export interface ExtractAgentHint {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  command?: string;
}

export interface ExtractRelationshipCoverage {
  mode: "source-backed-ast" | "source-backed-explicit";
  detected: number;
  emitted: number;
  omitted: {
    external: number;
    endpointNotSelected: number;
    ambiguousEndpoint: number;
  };
}

export interface ExtractTsRunResult {
  phaseId: string;
  collection: KnowledgeCollection;
  sources: string[];
  modules: number;
  extractedSymbols: number;
  relationships: ExtractRelationshipCoverage;
  candidates: {
    produced: number;
    added: number;
    updated: number;
    unchanged: number;
    removed: number;
    skippedApproved: number;
    skippedRejected: number;
  };
  changes: {
    added: number;
    updated: number;
    removed: number;
    unchangedApproved: number;
  };
  review: {
    required: boolean;
    pendingCandidates: number;
  };
  execution: {
    policy: "review" | "auto-promote";
    sourceState: "first-run" | "changed" | "unchanged";
  };
  next_action: {
    kind: "continue-code-index-batch" | "continue-automatically";
    command: string;
    message: string;
  };
  autoPromotion?: {
    applied: number;
    materialized: number;
    removed: number;
    close: "refreshed" | "current" | "not-required";
    verify: "passed";
  };
  moduleErrors: Array<{ source: string; module_path: string; error: string }>;
  agent_hints: ExtractAgentHint[];
  candidateFile: string;
}

export interface ExtractTsPhasePreview {
  kind: "context.extraction-phase-preview.v1";
  phaseKind: "phase.extract.ts";
  phaseId: string;
  collection: KnowledgeCollection;
  include: string[];
  mode: "exports" | "scan";
  entries?: string[];
  exportedOnly: boolean;
  indexUnits: ExtractionIndexUnitPreview[];
  knowledgeTree: string[];
  knowledgePathExamples: Array<{
    id: string;
    title: string;
    kind: string;
    source: string;
    module: string;
    path: string;
    source_ref: string;
  }>;
  sources: Array<{
    name: string;
    ref: string;
    head?: string;
    scopeHash: string;
    materializedAt: string;
    modules: Array<{
      name: string;
      path: string;
      version?: string;
      files: number;
      discoveredFiles: number;
      analyzedFiles: number;
      skippedFiles: number;
      skippedReasons: string[];
      entryFiles: string[];
      totalLines: number;
      symbols: number;
      exportedSymbols: number;
      internalSymbols: number;
      candidateKinds: Record<string, number>;
      relations: number;
      candidateEstimate: number;
    }>;
    moduleErrors: Array<{ module_path: string; error: string }>;
  }>;
  totals: {
    sources: number;
    modules: number;
    files: number;
    discoveredFiles: number;
    analyzedFiles: number;
    skippedFiles: number;
    symbols: number;
    relations: number;
    candidateEstimate: number;
    moduleErrors: number;
  };
  agent_hints: ExtractAgentHint[];
}

export interface ExtractCustomPhasePreview {
  kind: "context.extraction-phase-preview.v1";
  phaseKind: "phase.extract.custom";
  phaseId: string;
  collection: KnowledgeCollection;
  indexUnits: ExtractionIndexUnitPreview[];
  sources: Array<{
    name: string;
    ref: string;
    head?: string;
    scopeHash: string;
    materializedAt: string;
  }>;
  inspection: {
    findings: CodeIndexInspectionFinding[];
    capabilityGaps: CodeIndexCapabilityGap[];
    inventories: CodeIndexInspectionInventory[];
    structuralProbes: ExtractionStructuralProbe[];
  };
  totals: {
    sources: number;
    candidates: number;
    evidence: number;
    relations: number;
    contentBytes: number;
  };
  agent_hints: ExtractAgentHint[];
}

export type ExtractionPhasePreview = ExtractTsPhasePreview | ExtractCustomPhasePreview;

export type ExtractionScaleLevel = "normal" | "warning" | "blocked";

export type ExtractionStructuralCapability =
  | "typescript-symbols"
  | "react-router-routes"
  | "go-symbols"
  | "rush-workspace"
  | "protocol-schema";

export type ExtractionStructuralProbeKind =
  | "entry"
  | "implementation"
  | "route"
  | "workspace"
  | "protocol";

export interface ExtractionStructuralProbe {
  id: string;
  source: string;
  capability: ExtractionStructuralCapability;
  kind: ExtractionStructuralProbeKind;
  paths: string[];
  profiles: CodeIndexOutputProfile[];
  summary: string;
}

export interface ExtractionStructuralCoverage {
  required: number;
  covered: number;
  uncovered: Array<{
    id: string;
    capability: ExtractionStructuralCapability;
    kind: ExtractionStructuralProbeKind;
    source: string;
    expectedPaths: string[];
  }>;
}

export interface ExtractionSemanticCoverage {
  required: CodeIndexCoverageKind[];
  covered: CodeIndexCoverageKind[];
  uncovered: CodeIndexCoverageKind[];
}

export interface ExtractionIndexUnitPreview {
  id: string;
  inputSources: string[];
  outputOwner: string;
  moduleType: CodeIndexModuleType;
  moduleTypes: CodeIndexModuleType[];
  facets: CodeIndexModuleFacet[];
  moduleTypeEvidence: string[];
  documents: string[];
  outputProfile: CodeIndexOutputProfile;
  capability: CodeIndexCapability;
  plan: "declared" | "inferred";
  responsibility: string;
  entries: string[];
  protocols: string[];
  exclusions: string[];
  lifecycle: "authoritative" | "generated" | "mirrored" | "legacy" | "vendored";
  sourceOfTruth?: string;
  currentPageCount: number;
  projectedPageCount: number;
  candidateEstimate: number;
  changes: {
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
    exact: boolean;
  };
  scale: ExtractionScaleLevel;
  visibility: {
    exported: number;
    internal: number;
  };
  candidateKinds: Record<string, number>;
  topDirectories: Array<{ path: string; count: number }>;
  contentBytes: {
    total: number;
    max: number;
    sampled: boolean;
    topPages: Array<{ path: string; bytes: number }>;
  };
  inventory: ExtractionIndexInventoryPreview;
  structuralCoverage?: ExtractionStructuralCoverage;
  semanticCoverage?: ExtractionSemanticCoverage;
  risks: string[];
}

export interface ExtractionIndexInventoryPreview {
  basis: "ast" | "evidence-only";
  eligibleFiles: number;
  analyzedFiles: number;
  eligibleFileTargets: string[];
  analyzedFileTargets: string[];
  eligibleLoc: number;
  analyzedLoc: number;
  documentsDiscovered: number;
  documentsRead: number;
  documentTargets: string[];
  rootDocumentTargets: string[];
  readDocumentTargets: string[];
  referencedDocumentTargets: string[];
  symbolsDiscovered: number;
  symbolsAnalyzed: number;
  targetSymbols: number;
  exportedSymbols: number;
  targetSymbolIdentities: string[];
  exportedTargetIdentities: string[];
  entryTargets: string[];
  protocolTargets: string[];
  boundaryTargets: Array<{
    kind: "entry" | "export" | "route" | "operation" | "handler" | "downstream" | "command" | "event" | "plugin" | "handoff";
    identity: string;
  }>;
  coveredBoundaryTargets: Array<{
    kind: "entry" | "export" | "route" | "operation" | "handler" | "downstream" | "command" | "event" | "plugin" | "handoff";
    identity: string;
  }>;
  identityGroups: CodeIndexIdentityGroup[];
  chainCandidates: CodeIndexChainCandidate[];
  chainCandidateDecisions: CodeIndexChainCandidateDecision[];
  excludedFiles: number;
  excludedFileTargets: string[];
  excludedReasons: string[];
  parserSkippedFiles: number;
  parserSkippedFileTargets: string[];
}

export interface ExtractionBatchPreview {
  schema: "context.extraction-batch-preview.v1";
  digest: string;
  createdAt: string;
  phases: ExtractionPhasePreview[];
  totals: {
    phases: number;
    indexUnits: number;
    projectedPages: number;
    contentBytes: number;
    warnings: number;
    blocked: number;
  };
  advisories: string[];
  capabilityClear: boolean;
  ownershipClear: boolean;
  scaleClear: boolean;
  cache: {
    root: ".tmp/context-runtime/extract/previews";
    reusablePhases: number;
    hits: number;
    extractorInvocations: number;
    previewDurationMs: number;
  };
}

export interface SourceSelection {
  record: RepoSourceRecord;
  status: RepoSourceStatus;
}

export interface SourceSymbolSnapshot {
  candidate: CandidateDraft;
  source: RepoSourceRecord;
  symbol: SymbolInfo;
  markdown: string;
}

export interface ExtractTsPreparedRun {
  kind: "context.extract-ts-prepared.v1";
  phaseId: string;
  fingerprint: ExtractPhaseSourceFingerprintRecord;
  sources: SourceSelection[];
  candidates: CandidateDraft[];
  snapshots: SourceSymbolSnapshot[];
  symbolIndex: ExtractSourceSymbolIndexEntry[];
  modules: number;
  extractedSymbols: number;
  relationships: ExtractRelationshipCoverage;
  moduleErrors: Array<{ source: string; module_path: string; error: string }>;
  agent_hints: ExtractAgentHint[];
  preview: ExtractTsPhasePreview;
}

export interface ExtractPhaseSourceFingerprintRecord {
  phaseId: string;
  collection: KnowledgeCollection;
  fingerprint: string;
  sources: Array<{
    name: string;
    ref: string;
    head?: string;
    subpath?: string;
    scopeHash: string;
    materializedAt: string;
  }>;
  updatedAt: string;
}

export interface ExtractPhaseSourceFingerprintFile {
  version: 1;
  phases: Record<string, ExtractPhaseSourceFingerprintRecord>;
}

export interface ExtractSourceSymbolIndexEntry {
  source: string;
  file: string;
  name: string;
  kind: string;
  digest: string;
}

export interface ExtractSourceSymbolIndexFile {
  version: 2;
  phaseFingerprints: Record<string, string>;
  symbols: ExtractSourceSymbolIndexEntry[];
}
