import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadSourcesRegistry, type FileSourceRegistryEntry, type LarkSourceRegistryEntry } from "@c4a/context";
import {
  parseDocumentSourceLocator,
  parseSpanSourceRef,
  sourceSpanHashMatches,
  type DocumentSourceType,
} from "@c4a/extract";
import {
  buildCommittedEvidenceIndex,
  resolveProseSourceRef,
  type ResolvedProseSourceRef,
} from "./documentEvidenceIndex.js";
import {
  readLegacyExtractSourceFingerprints,
  readLegacyExtractSourceSymbolIndex,
  type LegacyExtractSourceSymbolIndexEntry,
} from "./legacyCodeIndexRead.js";
import {
  approvedContextSectionsInMarkdown,
  type ApprovedContextSectionEvidence,
} from "./verifyContextSections.js";
import type { ProjectVerifyIssue } from "./verifyTypes.js";
import {
  parseLocalCodeSymbolSourceRef,
  type LocalCodeSymbolSourceRef,
} from "./codeSymbolSourceRef.js";
import { canonicalizeKnowledgeAssetLinks } from "./knowledgeAssets.js";

const LOCAL_SPAN_SOURCE_REF = /^src-(\d+)(#span:.+)$/iu;
const CODE_SYMBOL_REF = /^[^|]+(?:\|[^|]+){2,3}$/u;
const execFileAsync = promisify(execFile);

export interface SymbolIndexLookup {
  bySource: ReadonlyMap<string, readonly LegacyExtractSourceSymbolIndexEntry[]> | null;
  unavailableCode?:
    | "extract-symbol-index-missing"
    | "extract-symbol-index-untrusted"
    | "extract-symbol-index-incomplete";
  unavailableMessage?: string;
}

type DocumentSourceRegistryEntry = Pick<FileSourceRegistryEntry | LarkSourceRegistryEntry, "id" | "name" | "materializedAt" | "snapshot">;

export interface SourceRegistryLookup {
  loaded: boolean;
  names: {
    repo: ReadonlySet<string>;
    file: ReadonlySet<string>;
    lark: ReadonlySet<string>;
  };
  documents: {
    file: ReadonlyMap<string, DocumentSourceRegistryEntry>;
    lark: ReadonlyMap<string, DocumentSourceRegistryEntry>;
  };
}

type CommittedEvidenceIndexResult = Awaited<ReturnType<typeof buildCommittedEvidenceIndex>>;

export interface EvidenceIndexCache {
  entries: Map<string, Promise<CommittedEvidenceIndexResult>>;
  ignoredPaths: Map<string, Promise<boolean>>;
}

interface CodeSymbolEntry {
  moduleSlug: string;
  symbolName: string;
  kind: string;
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).join("/");
}

function emptySourceRegistryLookup(loaded: boolean): SourceRegistryLookup {
  return {
    loaded,
    names: {
      repo: new Set(),
      file: new Set(),
      lark: new Set(),
    },
    documents: {
      file: new Map(),
      lark: new Map(),
    },
  };
}

function sourceEntryMap(entries: readonly DocumentSourceRegistryEntry[]): ReadonlyMap<string, DocumentSourceRegistryEntry> {
  const map = new Map<string, DocumentSourceRegistryEntry>();
  for (const entry of entries) {
    map.set(entry.name, entry);
    map.set(entry.id, entry);
  }
  return map;
}

function sourceRegistryIssuePath(message: string): string {
  if (message.includes("sources/file/index.yaml")) return "sources/file/index.yaml";
  if (message.includes("sources/lark/index.yaml")) return "sources/lark/index.yaml";
  if (message.includes("sources/repo/index.yaml")) return "sources/repo/index.yaml";
  return "sources";
}

export async function loadSourceRegistryLookup(projectRoot: string, issues: ProjectVerifyIssue[]): Promise<SourceRegistryLookup> {
  try {
    const registry = await loadSourcesRegistry({ rootDir: projectRoot });
    return {
      loaded: true,
      names: {
        repo: new Set(registry.repos.flatMap((source) => [source.name, source.id])),
        file: new Set(registry.files.flatMap((source) => [source.name, source.id])),
        lark: new Set(registry.larks.flatMap((source) => [source.name, source.id])),
      },
      documents: {
        file: sourceEntryMap(registry.files),
        lark: sourceEntryMap(registry.larks),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({
      severity: "error",
      code: "sources-registry-invalid",
      path: sourceRegistryIssuePath(message),
      message,
    });
    return emptySourceRegistryLookup(false);
  }
}

export function hasRegisteredSource(registry: SourceRegistryLookup, sourceType: "repo" | DocumentSourceType, sourceName: string): boolean {
  return registry.names[sourceType].has(sourceName);
}

export function registeredDocumentSource(
  registry: SourceRegistryLookup,
  sourceType: DocumentSourceType,
  sourceName: string,
): DocumentSourceRegistryEntry | undefined {
  return registry.documents[sourceType].get(sourceName);
}

export function defaultDocumentMaterializedAt(sourceType: DocumentSourceType, sourceName: string): string {
  return join("sources", sourceType, sourceName);
}

export function defaultDocumentManifest(materializedAt: string): string {
  return join(materializedAt, "manifest.json");
}

export function verbatimBodyMatchesSpanHash(body: string, spanHash: string): boolean {
  const fullHash = createHash("sha256").update(body).digest("hex");
  return sourceSpanHashMatches(spanHash, fullHash);
}

async function verbatimBodyMatchesSourceProjection(input: {
  projectRoot: string;
  materializedAt: string;
  documentPath: string;
  approvedRelPath: string;
  approvedBody: string;
  resolved: ResolvedProseSourceRef | null;
  manifest: CommittedEvidenceIndexResult["manifest"];
}): Promise<boolean> {
  if (input.resolved === null || !input.resolved.hashMatches) return false;
  const markdown = await readFile(join(
    input.projectRoot,
    input.materializedAt,
    input.documentPath,
  ), "utf8");
  const sourceBody = markdown
    .split(/\r?\n/u)
    .slice(input.resolved.span.line_start - 1, input.resolved.span.line_end)
    .join("\n");
  const source = canonicalizeKnowledgeAssetLinks({
    content: sourceBody,
    documentPath: input.documentPath,
    manifest: input.manifest,
  });
  const approved = canonicalizeKnowledgeAssetLinks({
    content: input.approvedBody,
    documentPath: input.documentPath,
    manifest: input.manifest,
    pageRelPath: `knowledge/${input.approvedRelPath}`,
  });
  return source.content === approved.content &&
    (source.rewritten > 0 || approved.rewritten > 0);
}

export async function getCommittedEvidenceIndex(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  sourceName: string;
  materializedAt: string;
  manifestPath: string;
  cache: EvidenceIndexCache;
}): Promise<CommittedEvidenceIndexResult> {
  const key = `${input.sourceType}:${input.sourceName}:${input.materializedAt}:${input.manifestPath}`;
  const existing = input.cache.entries.get(key);
  if (existing !== undefined) return existing;
  const promise = buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    materializedAt: input.materializedAt,
    manifestPath: input.manifestPath,
    writeRuntimeIndex: false,
  });
  input.cache.entries.set(key, promise);
  return promise;
}

export function validateCodeSymbols(input: {
  relPath: string;
  frontmatter: Record<string, unknown>;
  issues: ProjectVerifyIssue[];
}): void {
  const codeSymbols = input.frontmatter.code_symbols;
  if (!Array.isArray(codeSymbols) || codeSymbols.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-code-symbols-invalid",
      path: input.relPath,
      message: "frontmatter code_symbols must be a non-empty string array",
    });
    return;
  }
  for (const codeSymbol of codeSymbols) {
    if (typeof codeSymbol !== "string" || !CODE_SYMBOL_REF.test(codeSymbol)) {
      input.issues.push({
        severity: "error",
        code: "approved-code-symbol-invalid",
        path: input.relPath,
        message: `frontmatter code_symbols entry is invalid: ${String(codeSymbol)}`,
      });
    }
  }
}

function parseCodeSymbolEntry(value: string): CodeSymbolEntry | null {
  if (!CODE_SYMBOL_REF.test(value)) return null;
  const parts = value.split("|");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const moduleSlug = parts[0];
  const symbolName = parts[parts.length - 2];
  const kind = parts[parts.length - 1];
  if (moduleSlug === undefined || symbolName === undefined || kind === undefined) return null;
  return { moduleSlug, symbolName, kind };
}

function codeSymbolsExpressSourceRef(input: {
  codeSymbols: readonly string[];
  symbolName: string;
  kind: string;
}): boolean {
  return input.codeSymbols.some((entry) => {
    const parsed = parseCodeSymbolEntry(entry);
    return parsed !== null &&
      parsed.symbolName === input.symbolName &&
      parsed.kind === input.kind;
  });
}

export function proseStaleMessage(sourceRef: string, status: ResolvedProseSourceRef["status"] | undefined): string {
  if (status === "line-drift") {
    return `document source span line range changed for ${sourceRef}; re-pin if the approved text is still valid`;
  }
  if (status === "heading-drift") {
    return `document source span heading hint changed for ${sourceRef}; re-pin if the approved text is still valid`;
  }
  if (status === "content-drift") {
    return `document source span content changed for ${sourceRef}; create a replacement candidate because re-pin only updates evidence metadata when the approved body still matches the source span`;
  }
  return `document source span changed for ${sourceRef}; create a replacement candidate unless the approved body still matches a moved source span`;
}

export async function loadVerifiedSymbolIndex(
  projectRoot: string,
): Promise<SymbolIndexLookup> {
  const symbolIndex = await readLegacyExtractSourceSymbolIndex(projectRoot);
  if (symbolIndex === null) {
    return {
      bySource: null,
      unavailableCode: "extract-symbol-index-missing",
      unavailableMessage: "extract symbol index is missing; source_ref reverse lookup was skipped",
    };
  }
  const sourceFingerprints = await readLegacyExtractSourceFingerprints(projectRoot);
  const phaseEntries = Object.entries(symbolIndex.phaseFingerprints);
  if (phaseEntries.length === 0) {
    return {
      bySource: null,
      unavailableCode: "extract-symbol-index-untrusted",
      unavailableMessage: "extract symbol index has no phase fingerprint metadata; source_ref reverse lookup was skipped",
    };
  }
  const stalePhase = phaseEntries.find(([phaseId, fingerprint]) =>
    sourceFingerprints.phases[phaseId]?.fingerprint !== fingerprint
  );
  if (stalePhase !== undefined) {
    return {
      bySource: null,
      unavailableCode: "extract-symbol-index-untrusted",
      unavailableMessage: `extract symbol index does not match source fingerprint cache for phase ${stalePhase[0]}; source_ref reverse lookup was skipped`,
    };
  }
  const symbolIndexBySource = new Map<string, LegacyExtractSourceSymbolIndexEntry[]>();
  for (const symbol of symbolIndex.symbols) {
    const bucket = symbolIndexBySource.get(symbol.source) ?? [];
    bucket.push(symbol);
    symbolIndexBySource.set(symbol.source, bucket);
  }
  return { bySource: symbolIndexBySource };
}

async function isGitIgnored(
  projectRoot: string,
  relPath: string,
  cache: EvidenceIndexCache,
): Promise<boolean> {
  const path = toPosixPath(relPath);
  const existing = cache.ignoredPaths.get(path);
  if (existing !== undefined) return existing;
  const pending = isGitIgnoredUncached(projectRoot, path);
  cache.ignoredPaths.set(path, pending);
  return pending;
}

async function isGitIgnoredUncached(
  projectRoot: string,
  relPath: string,
): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "--quiet", relPath], { cwd: projectRoot });
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    return code === 0;
  }
}

export async function addSnapshotIgnoredWarning(input: {
  projectRoot: string;
  relPath: string;
  line: number;
  manifestPath: string;
  materializedAt: string;
  documentPath: string;
  cache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  context?: ApprovedViewIssueContext;
}): Promise<void> {
  const paths = [
    input.manifestPath,
    join(input.materializedAt, input.documentPath),
  ];
  for (const path of paths) {
    if (await isGitIgnored(input.projectRoot, path, input.cache)) {
      input.issues.push({
        severity: "warning",
        code: "approved-evidence-unverifiable",
        path: input.relPath,
        line: input.line,
        ...approvedViewIssueContext(input.context),
        message: `document snapshot path is ignored and may be unavailable in fresh clone / CI: ${toPosixPath(path)}`,
      });
      return;
    }
  }
}

export function snapshotRootExists(projectRoot: string, materializedAt: string): boolean {
  return existsSync(join(projectRoot, materializedAt));
}

async function validateProseSourceRef(input: {
  projectRoot: string;
  relPath: string;
  line: number;
  value: string;
  source: string;
  spanBody: string;
  verbatimBody?: string;
  sourceRegistry: SourceRegistryLookup;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  sourceOrphaned?: boolean;
  context?: ApprovedViewIssueContext;
}): Promise<void> {
  const locator = parseDocumentSourceLocator(input.source);
  if (locator === null) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-kind-mismatch",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `span source_ref must point to a file: or lark: source: ${input.value}`,
    });
    return;
  }
  if (input.sourceRegistry.loaded && !hasRegisteredSource(input.sourceRegistry, locator.sourceType, locator.sourceName)) {
    return;
  }
  const registryEntry = input.sourceRegistry.loaded
    ? registeredDocumentSource(input.sourceRegistry, locator.sourceType, locator.sourceName)
    : undefined;
  const materializedAt = registryEntry?.materializedAt ?? defaultDocumentMaterializedAt(locator.sourceType, locator.sourceName);
  const manifestPath = registryEntry?.snapshot?.manifest ?? defaultDocumentManifest(materializedAt);

  const parsedLocal = parseSpanSourceRef(input.spanBody);
  if (parsedLocal === null) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-invalid",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `invalid span source_ref: ${input.value}`,
    });
    return;
  }
  if (!existsSync(join(input.projectRoot, manifestPath)) && !snapshotRootExists(input.projectRoot, materializedAt)) {
    input.issues.push({
      severity: "warning",
      code: "approved-evidence-unavailable",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `document snapshot is unavailable for ${locator.sourceType}:${locator.sourceName}; evidence cannot be verified offline`,
    });
    return;
  }

  let indexResult: Awaited<ReturnType<typeof buildCommittedEvidenceIndex>>;
  try {
    indexResult = await getCommittedEvidenceIndex({
      projectRoot: input.projectRoot,
      sourceType: locator.sourceType,
      sourceName: locator.sourceName,
      materializedAt,
      manifestPath,
      cache: input.evidenceIndexCache,
    });
  } catch (error) {
    input.issues.push({
      severity: "error",
      code: "approved-evidence-snapshot-invalid",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!indexResult.index.documents.some((document) => document.path === locator.documentPath)) {
    input.issues.push({
      severity: input.sourceOrphaned === true ? "warning" : "error",
      code: input.sourceOrphaned === true
        ? "approved-source-orphaned"
        : "source-document-missing",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `source document is missing from current snapshot: ${locator.sourceType}:${locator.sourceName}/${locator.documentPath}; deprecate the page or keep it as source-orphaned knowledge`,
    });
    return;
  }

  await addSnapshotIgnoredWarning({
    projectRoot: input.projectRoot,
    relPath: input.relPath,
    line: input.line,
    manifestPath,
    materializedAt,
    documentPath: locator.documentPath,
    cache: input.evidenceIndexCache,
    issues: input.issues,
    ...(input.context !== undefined ? { context: input.context } : {}),
  });

  const canonicalRef = `${input.source}${input.spanBody}`;
  const resolved = await resolveProseSourceRef({
    projectRoot: input.projectRoot,
    index: indexResult.index,
    sourceRef: canonicalRef,
    snapshotMarkdownCache: indexResult.snapshotMarkdownCache,
  });
  if (input.verbatimBody !== undefined && !verbatimBodyMatchesSpanHash(input.verbatimBody, parsedLocal.span_hash)) {
    const projectedMatch = await verbatimBodyMatchesSourceProjection({
      projectRoot: input.projectRoot,
      materializedAt,
      documentPath: locator.documentPath,
      approvedRelPath: input.relPath,
      approvedBody: input.verbatimBody,
      resolved,
      manifest: indexResult.manifest,
    }).catch(() => false);
    if (!projectedMatch) {
      input.issues.push({
        severity: "error",
        code: "approved-verbatim-body-hash-mismatch",
        path: input.relPath,
        line: input.line,
        ...approvedViewIssueContext(input.context),
        message: `verbatim section body does not match source_ref span hash: ${input.value}`,
      });
    }
  }
  if (resolved === null || resolved.status !== "exact") {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-stale",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: proseStaleMessage(input.value, resolved?.status),
    });
  }
}

interface ApprovedSourceRefValidationState {
  symbolIndexUnavailableReported: boolean;
}

export interface ApprovedViewIssueContext {
  collection: string;
  view_ref: string;
  node_ref: string;
  source_keys?: string[];
}

export function approvedViewIssueContext(context: ApprovedViewIssueContext | undefined): Pick<ProjectVerifyIssue, "collection" | "view_ref" | "node_ref" | "source_keys"> {
  return context === undefined
    ? {}
    : {
        collection: context.collection,
        view_ref: context.view_ref,
        node_ref: context.node_ref,
        ...(context.source_keys === undefined
          ? {}
          : { source_keys: context.source_keys }),
      };
}

function validateApprovedSectionRefShape(input: {
  relPath: string;
  section: ApprovedContextSectionEvidence;
  issues: ProjectVerifyIssue[];
}): void {
  if (input.section.refs.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-section-source-ref-missing",
      path: input.relPath,
      line: input.section.line,
      message: "context section must include source_ref",
    });
    return;
  }
  if (input.section.contentMode === "verbatim" && input.section.refs.length !== 1) {
    input.issues.push({
      severity: "error",
      code: "approved-verbatim-source-ref-count-invalid",
      path: input.relPath,
      line: input.section.line,
      message: "verbatim context section must cite exactly one continuous source_ref",
    });
  }
}

function reportSymbolIndexUnavailableOnce(input: {
  state: ApprovedSourceRefValidationState;
  symbolIndex: SymbolIndexLookup;
  line: number;
  issues: ProjectVerifyIssue[];
  context?: ApprovedViewIssueContext;
}): void {
  if (input.state.symbolIndexUnavailableReported ||
    input.symbolIndex.unavailableCode === undefined ||
    input.symbolIndex.unavailableMessage === undefined) {
    return;
  }
  input.issues.push({
    severity: "warning",
    code: input.symbolIndex.unavailableCode,
    path: ".tmp/context-runtime/extract/source-symbols.json",
    line: input.line,
    ...approvedViewIssueContext(input.context),
    message: input.symbolIndex.unavailableMessage,
  });
  input.state.symbolIndexUnavailableReported = true;
}

function validateApprovedSymbolSourceRef(input: {
  relPath: string;
  line: number;
  value: string;
  source: string;
  parsed: LocalCodeSymbolSourceRef;
  codeSymbols: readonly string[] | null;
  symbolIndex: SymbolIndexLookup;
  state: ApprovedSourceRefValidationState;
  issues: ProjectVerifyIssue[];
  context?: ApprovedViewIssueContext;
}): void {
  const sourceMatch = /^repo:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/u.exec(input.source);
  const sourceName = sourceMatch?.[1];
  if (sourceName === undefined) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-kind-mismatch",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `symbol source_ref must point to a repo: source: ${input.value}`,
    });
    return;
  }
  const { file, symbol, kind, digest } = input.parsed;
  if (input.codeSymbols !== null && !codeSymbolsExpressSourceRef({
    codeSymbols: input.codeSymbols,
    symbolName: symbol,
    kind,
  })) {
    input.issues.push({
      severity: "error",
      code: "approved-code-symbols-missing-source-ref",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `frontmatter code_symbols must include an entry ending with |${symbol}|${kind} for source_ref ${input.value}`,
    });
  }
  if (input.symbolIndex.bySource === null) {
    reportSymbolIndexUnavailableOnce({
      state: input.state,
      symbolIndex: input.symbolIndex,
      line: input.line,
      issues: input.issues,
      ...(input.context !== undefined ? { context: input.context } : {}),
    });
    return;
  }
  const sourceSymbols = input.symbolIndex.bySource.get(sourceName) ?? [];
  const matches = sourceSymbols.filter((entry) =>
    (file === undefined || entry.file === file) &&
    entry.name === symbol && entry.kind === kind && entry.digest === digest
  );
  if (matches.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-stale",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `source_ref no longer matches the current extract symbol index: ${input.value}`,
    });
  } else if (matches.length > 1) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-ambiguous",
      path: input.relPath,
      line: input.line,
      ...approvedViewIssueContext(input.context),
      message: `file-aware source_ref matches duplicate entries in the current extract symbol index: ${input.value}`,
    });
  }
}

async function validateApprovedSectionSourceRef(input: {
  projectRoot: string;
  relPath: string;
  section: ApprovedContextSectionEvidence;
  value: string;
  sources: readonly string[] | null;
  codeSymbols: readonly string[] | null;
  sourceRegistry: SourceRegistryLookup;
  symbolIndex: SymbolIndexLookup;
  evidenceIndexCache: EvidenceIndexCache;
  state: ApprovedSourceRefValidationState;
  issues: ProjectVerifyIssue[];
  sourceOrphaned?: boolean;
  context?: ApprovedViewIssueContext;
}): Promise<void> {
  const symbolRef = parseLocalCodeSymbolSourceRef(input.value);
  const spanMatch = LOCAL_SPAN_SOURCE_REF.exec(input.value);
  if (symbolRef === undefined && spanMatch === null) {
    input.issues.push({ severity: "error", code: "approved-source-ref-invalid", path: input.relPath, line: input.section.line, message: `unsupported source_ref: ${input.value}` });
    return;
  }
  const index = symbolRef?.sourceIndex ?? Number(spanMatch?.[1]);
  if (input.sources === null || index < 1 || index > input.sources.length) {
    input.issues.push({ severity: "error", code: "approved-source-ref-source-missing", path: input.relPath, line: input.section.line, message: `source_ref ${input.value} does not resolve to frontmatter sources` });
    return;
  }
  const source = input.sources[index - 1];
  if (typeof source !== "string") return;
  if (spanMatch !== null) {
    await validateProseSourceRef({
      projectRoot: input.projectRoot,
      relPath: input.relPath,
      line: input.section.line,
      value: input.value,
      source,
      spanBody: spanMatch[2]!,
      ...(input.section.contentMode === "verbatim" && input.section.refs.length === 1 ? { verbatimBody: input.section.readerVisibleBody } : {}),
      sourceRegistry: input.sourceRegistry,
      evidenceIndexCache: input.evidenceIndexCache,
      issues: input.issues,
      ...(input.sourceOrphaned === undefined
        ? {}
        : { sourceOrphaned: input.sourceOrphaned }),
      ...(input.context !== undefined ? { context: input.context } : {}),
    });
    return;
  }
  if (symbolRef === undefined) return;
  validateApprovedSymbolSourceRef({
    relPath: input.relPath,
    line: input.section.line,
    value: input.value,
    source,
    parsed: symbolRef,
    codeSymbols: input.codeSymbols,
    symbolIndex: input.symbolIndex,
    state: input.state,
    issues: input.issues,
    ...(input.context !== undefined ? { context: input.context } : {}),
  });
}

export async function validateApprovedSourceRefs(input: {
  projectRoot: string;
  relPath: string;
  content: string;
  sources: readonly string[] | null;
  codeSymbols: readonly string[] | null;
  sourceRegistry: SourceRegistryLookup;
  symbolIndex: SymbolIndexLookup;
  evidenceIndexCache: EvidenceIndexCache;
  issues: ProjectVerifyIssue[];
  sourceOrphaned?: boolean;
  context?: ApprovedViewIssueContext;
}): Promise<void> {
  const sections = approvedContextSectionsInMarkdown(input.content);
  if (sections.length === 0) {
    input.issues.push({
      severity: "error",
      code: "approved-source-ref-missing",
      path: input.relPath,
      ...approvedViewIssueContext(input.context),
      message: "approved markdown must contain context section source_ref",
    });
    return;
  }
  for (const section of sections) {
    validateApprovedSectionRefShape({ relPath: input.relPath, section, issues: input.issues });
  }

  const state: ApprovedSourceRefValidationState = { symbolIndexUnavailableReported: false };
  for (const section of sections) {
    for (const value of section.refs) {
      await validateApprovedSectionSourceRef({ ...input, section, value, state });
    }
  }
}
