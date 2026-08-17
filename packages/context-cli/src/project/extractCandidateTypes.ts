import type { KnowledgeCollection } from "@c4a/context";
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
  mode: "source-backed-ast";
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
    kind: "continue-codegraph-batch" | "continue-automatically";
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
  phaseId: string;
  collection: KnowledgeCollection;
  include: string[];
  mode: "exports" | "scan";
  entries?: string[];
  exportedOnly: boolean;
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
