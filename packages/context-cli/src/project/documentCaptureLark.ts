import { DOCUMENT_ACQUISITION_UNAVAILABLE } from "./documentCaptureContract.js";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { CaptureLarkPhaseDefinition, LarkSourceRegistryEntry } from "@c4a/context";
import {
  computeDocumentContentHash,
  createDocumentSnapshotManifest,
  normalizeMarkdownDocument,
  normalizeSnapshotRelativePath,
  type DocumentCaptureFidelityReport,
  type DocumentResourceMaterializationReport,
  type DocumentSnapshotAssetEntry,
  type DocumentSnapshotFileInput,
  type DocumentSnapshotManifestMetadata,
} from "@c4a/extract";
import { applyAtomicFileBatch, type AtomicFileBatchWrite } from "../lib/atomicFileBatch.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { detectExternalEnvironmentIssue } from "../lib/externalEnvironment.js";
import {
  DEFAULT_RESOURCE_POLICY,
  fetchFeishuDocSnapshot,
  LarkCliError,
  LarkCliNotInstalledError,
  type FetchFeishuDocAsset,
  type LarkRunner,
} from "../lib/feishu.js";
import { ExitCode } from "../types/exitCode.js";
import { documentSourceAddCommand, resolveDocumentPhaseSource } from "./documentRun.js";
import { larkSourceIdentities, larkSnapshotIdentityDiagnostic } from "./larkSourceIdentity.js";
import {
  renderDocumentManifestFile,
  updateDocumentManifestFile,
} from "./documentBatchManifest.js";
import { readDocumentManifestForCapture } from "./documentManifestRecovery.js";
import {
  workspaceRouteReevaluation,
  type WorkspaceRouteReevaluation,
} from "./workflow/workflowReceipt.js";
import { withProjectWriteLock } from "./writeLock.js";
import { sensitiveSourceLiteralCandidates } from "./sensitiveSourceLiteral.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "./documentCaptureContract.js";
import { assertSnapshotResourcePolicy, readLarkSnapshotBundle } from "./larkSnapshotBundle.js";
import { checkedLarkRevision, larkSnapshotComparable, larkSnapshotFingerprint, rememberCheckedLarkRevision } from "./larkCaptureFreshness.js";
import { documentSnapshotFidelityState, readDocumentSnapshotCaptureReport } from "./documentSnapshotFidelity.js";
import { beginFormatOnlyUpdate, invalidateFormatOnlyUpdate, recordFormatOnlyCapture } from "./formatOnlyUpdate.js";

export interface CaptureLarkRunResult {
  kind: "document.capture.lark.result";
  source: {
    type: "lark";
    name: string;
    identity: "url" | "docToken" | "wikiToken";
    title: string;
    url?: string;
  };
  access_identity: Awaited<ReturnType<typeof fetchFeishuDocSnapshot>>["accessIdentity"];
  identity_fallback: boolean;
  snapshot: {
    manifest: string;
    materializedAt: string;
    snapshot_hash: string;
    changed: boolean;
  };
  documents: Array<{
    path: string;
    title: string;
    line_count: number;
  }>;
  assets: Array<{
    path: string;
    media_type?: string;
    content_hash?: string;
  }>;
  fidelity: DocumentCaptureFidelityReport;
  resource_materialization: DocumentResourceMaterializationReport;
  diagnostics: string[];
  next_action: WorkspaceRouteReevaluation;
}

function titleFromMarkdown(markdown: string, fallbackPath: string): string {
  const heading = markdown.split("\n").find((line) => /^#\s+\S/u.test(line));
  if (heading !== undefined) {
    return heading.replace(/^#\s+/u, "").replace(/\s+#*\s*$/u, "").trim();
  }
  return basename(fallbackPath, extname(fallbackPath));
}

function countLines(markdown: string): number {
  if (markdown.length === 0) return 0;
  return markdown.endsWith("\n") ? markdown.split("\n").length - 1 : markdown.split("\n").length;
}

async function fileContentMatches(path: string, content: string | Uint8Array): Promise<boolean> {
  try {
    const current = await readFile(path);
    const expected = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    return current.equals(expected);
  } catch {
    return false;
  }
}

function sourceManifestPath(entry: LarkSourceRegistryEntry): string {
  return entry.snapshot?.manifest ?? join(entry.materializedAt, "manifest.json");
}

function larkRuntimeError(message: string, detail: Record<string, unknown>): ContextError {
  return new ContextError(ExitCode.ExternalToolError, message, {
    category: ErrorCategory.ExternalToolFailed,
    ...detail,
  });
}

function larkUserInputError(message: string, detail: Record<string, unknown>): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function toPosixPath(path: string): string {
  return path.split(/[\\/]+/u).filter((part) => part.length > 0).join("/");
}

function assertLarkSnapshotMaterializedAt(source: LarkSourceRegistryEntry): void {
  const { materializedAt, name: sourceName } = source;
  const normalized = toPosixPath(materializedAt);
  const base = `sources/lark/${source.namespace ?? sourceName}`;
  if (normalized === base || normalized.startsWith(`${base}/`)) return;
  throw larkUserInputError(`lark source ${sourceName} has invalid snapshot materializedAt: ${materializedAt}`, {
    sourceName,
    materializedAt,
    next: `fix sources/lark/index.yaml so ${sourceName}.materializedAt is under ${base}`,
  });
}

function larkTarget(entry: LarkSourceRegistryEntry): {
  kind: "url" | "docToken" | "wikiToken";
  value: string;
} {
  const identities = larkSourceIdentities(entry);
  if (identities.length === 1) return identities[0] as { kind: "url" | "docToken" | "wikiToken"; value: string };
  if (identities.length > 1) {
    throw larkUserInputError(`lark source ${entry.name} must declare exactly one of url, docToken, or wikiToken`, {
      sourceName: entry.name,
      next: `fix sources/lark/index.yaml so ${entry.name} has exactly one document identity`,
    });
  }
  throw new ContextError(ExitCode.UserError, `lark source ${entry.name} is missing url, docToken, or wikiToken`, {
    category: ErrorCategory.UserInputInvalid,
    sourceName: entry.name,
    next: documentSourceAddCommand("lark", entry.name),
  });
}

function larkErrorRecovery(error: unknown, sourceName: string): {
  reasonCode: string;
  next: string;
  execution?: {
    target: "agent-host";
    required_capabilities: string[];
  };
} {
  const message = error instanceof Error ? error.message : String(error);
  const localCliRecovery = `Install @larksuite/cli in a private directory with \`npm install --prefix "$HOME/.cache/context/lark-cli" @larksuite/cli@latest\`, then rerun \`CONTEXT_LARK_CLI_BIN="$HOME/.cache/context/lark-cli/node_modules/.bin/lark-cli" context run capture:lark:${sourceName}\`. Keep this variable on subsequent Context commands that access Lark; do not replace the global lark-cli.`;
  const environmentIssue = detectExternalEnvironmentIssue(message);
  if (environmentIssue !== undefined) {
    return {
      reasonCode: environmentIssue.reasonCode,
      next: "Retry the same Context command through the Agent host with credential-store access; do not downgrade credential protection automatically",
      execution: {
        target: "agent-host",
        required_capabilities: environmentIssue.requiredCapabilities,
      },
    };
  }
  if (error instanceof LarkCliNotInstalledError || /not installed|ENOENT/iu.test(message)) {
    return {
      reasonCode: "external.dependency-missing",
      next: localCliRecovery,
    };
  }
  if (/does not support --doc-format|api-version|deprecated|unsupported tool version|tool version unsupported/iu.test(message)) {
    return {
      reasonCode: "external.tool-version-unsupported",
      next: localCliRecovery,
    };
  }
  if (/empty|unsupported payload shape|not JSON|parse/iu.test(message)) {
    return {
      reasonCode: "external.response-invalid",
      next: `Inspect the Lark document shape or permissions, then rerun context run capture:lark:${sourceName}`,
    };
  }
  if (/auth|login|permission|forbidden|unauthori[sz]ed|scope/iu.test(message)) {
    return {
      reasonCode: "external.authorization-required",
      next: "Check the selected Lark identity and document access. For host-managed credentials use the host authorization flow; use lark-cli auth login only for a locally managed user login, then rerun capture",
    };
  }
  return {
    reasonCode: "external.tool-failed",
    next: `Check lark-cli access and rerun context run capture:lark:${sourceName}`,
  };
}

function redactSensitiveLarkText(value: string): string {
  return value
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s"'`,;]+/giu, "$1[redacted]")
    .replace(
      /\b(cookie|session|session[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?token|oauth[_-]?token|authorization)\b\s*[:=]\s*["']?[^"'\s,;]+/giu,
      "$1=[redacted]",
    );
}

function metadataForSource(input: {
  entry: LarkSourceRegistryEntry;
  fetchedTitle?: string;
  revisionId?: string;
  reportPath: string;
  fidelity: DocumentCaptureFidelityReport;
  resourceMaterialization: Awaited<ReturnType<typeof fetchFeishuDocSnapshot>>["resourceMaterialization"];
}): DocumentSnapshotManifestMetadata {
  return {
    source: {
      ...(input.entry.url !== undefined ? { url: input.entry.url } : {}),
      ...(input.entry.docToken !== undefined ? { docToken: input.entry.docToken } : {}),
      ...(input.entry.wikiToken !== undefined ? { wikiToken: input.entry.wikiToken } : {}),
      ...(input.entry.title !== undefined ? { title: input.entry.title } : input.fetchedTitle !== undefined ? { title: input.fetchedTitle } : {}),
      ...(input.revisionId !== undefined ? { revisionId: input.revisionId } : {}),
    },
    capture: {
      report: {
        path: input.reportPath,
        fidelityStatus: input.fidelity.status,
        evidenceStatus: input.fidelity.evidence_status,
        projectionStatus: input.fidelity.projection_status,
        resourceStatus: input.resourceMaterialization.status,
      },
    },
  };
}

function assetManifestEntry(asset: FetchFeishuDocAsset, assetRoot: string): {
  entry: DocumentSnapshotAssetEntry;
  bytes?: Uint8Array;
} {
  const rawPath = normalizeSnapshotRelativePath(asset.path);
  const relativePath = rawPath.startsWith("assets/") ? rawPath.slice("assets/".length) : rawPath;
  const path = normalizeSnapshotRelativePath(`${assetRoot}/${relativePath}`);
  return {
    entry: {
      path,
      ...(asset.bytes !== undefined ? { content_hash: computeDocumentContentHash(asset.bytes) } : {}),
      ...(asset.mediaType !== undefined ? { media_type: asset.mediaType } : {}),
      ...(asset.role !== undefined ? { role: asset.role } : {}),
      ...(asset.source !== undefined ? { source: asset.source } : {}),
    },
    ...(asset.bytes !== undefined ? { bytes: asset.bytes } : {}),
  };
}

async function listSnapshotAssetFiles(root: string, assetRoot: string): Promise<string[]> {
  const assetsRoot = join(root, assetRoot);
  const files: string[] = [];
  const visit = async (dir: string, prefix = assetRoot): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const relPath = `${prefix}/${entry.name}`;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(normalizeSnapshotRelativePath(relPath));
      }
    }
  };
  await visit(assetsRoot);
  return files;
}

async function staleSnapshotAssetPaths(input: {
  materializedAtAbsPath: string;
  assetRoot: string;
  currentPaths: ReadonlySet<string>;
}): Promise<string[]> {
  const existingPaths = await listSnapshotAssetFiles(input.materializedAtAbsPath, input.assetRoot);
  return existingPaths
    .filter((path) => !input.currentPaths.has(path))
    .map((path) => join(input.materializedAtAbsPath, path));
}

function normalizeLarkError(error: unknown, sourceName: string): ContextError {
  if (error instanceof ContextError) return error;
  const message = redactSensitiveLarkText(error instanceof Error ? error.message : String(error));
  const recovery = larkErrorRecovery(error, sourceName);
  const stderr = error instanceof LarkCliError && error.stderr.trim().length > 0
    ? { stderr: redactSensitiveLarkText(error.stderr.trim()).slice(0, 500) }
    : {};
  return larkRuntimeError(`lark capture failed for ${sourceName}: ${message}`, {
    sourceName,
    reason_code: recovery.reasonCode,
    next: recovery.next,
    ...(recovery.execution === undefined
      ? {}
      : { execution: recovery.execution }),
    ...stderr,
  });
}

function assertNoSensitiveLarkSource(input: {
  sourceName: string;
  documentPath: string;
  markdown: string;
  assets: readonly FetchFeishuDocAsset[];
}): void {
  const candidates = [
    ...sensitiveSourceLiteralCandidates(input.markdown).map((candidate) => ({
      path: input.documentPath,
      ...candidate,
    })),
    ...input.assets.flatMap((asset) => {
      if (asset.bytes === undefined || !/\.(?:xml|md|mdx|txt|json|ya?ml)$/iu.test(asset.path)) return [];
      return sensitiveSourceLiteralCandidates(new TextDecoder().decode(asset.bytes)).map((candidate) => ({
        path: normalizeSnapshotRelativePath(asset.path),
        ...candidate,
      }));
    }),
  ];
  if (candidates.length === 0) return;
  throw new ContextError(ExitCode.UserError, `lark source ${input.sourceName} contains likely credential literals and was not persisted`, {
    category: ErrorCategory.UserInputInvalid,
    code: "lark.capture.sensitive-source-content",
    sourceName: input.sourceName,
    candidates,
    next: "Remove or rotate real credential values in the source document, replace examples with explicit placeholders, then rerun the same capture command. Context does not redact committed evidence snapshots because redaction would invalidate source fidelity.",
  });
}

export function isCaptureLarkRunResult(value: unknown): value is CaptureLarkRunResult {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "document.capture.lark.result";
}

async function runCaptureLarkPhaseUnlocked(input: {
  projectRoot: string;
  phase: CaptureLarkPhaseDefinition;
  now?: Date;
  larkRunner?: LarkRunner;
  prefetched?: import("../lib/feishu.js").PrefetchedLarkDocument;
  snapshotDirectory?: string;
  refreshSources?: readonly string[];
}): Promise<CaptureLarkRunResult> {
  const resolved = await resolveDocumentPhaseSource({
    projectRoot: input.projectRoot,
    phase: input.phase,
  });
  if (resolved.sourceType !== "lark") {
    throw new ContextError(ExitCode.UserError, `document source type mismatch: ${resolved.sourceName} is ${resolved.sourceType}, expected lark`, {
      category: ErrorCategory.UserInputInvalid,
      sourceName: resolved.sourceName,
      expectedType: "lark",
      actualType: resolved.sourceType,
    });
  }

  const { assertSourceInputMutable } = await import("./sourceInputMutation.js");
  await assertSourceInputMutable(input.projectRoot, `lark:${resolved.sourceName}`);
  const entry = resolved.entry as LarkSourceRegistryEntry;
  assertLarkSnapshotMaterializedAt(entry);
  const target = larkTarget(entry);
  const manifestPath = sourceManifestPath(entry);
  const materializedAt = entry.materializedAt;
  const materializedAtAbsPath = join(input.projectRoot, materializedAt);
  const { current: currentManifestFile, previous: previousManifest, recovery } = await readDocumentManifestForCapture({
    projectRoot: input.projectRoot, manifestPath, sourceType: "lark", sourceName: resolved.sourceName,
  });
  const fingerprint = previousManifest === null || larkSnapshotIdentityDiagnostic(entry, previousManifest) !== null
    ? undefined : await larkSnapshotFingerprint(input.projectRoot, materializedAt, previousManifest);
  const refresh = input.refreshSources?.includes(`lark:${resolved.sourceName}`) === true;
  const previousRevision = (fingerprint === undefined ? undefined : await checkedLarkRevision(input.projectRoot, resolved.sourceName, fingerprint))
    ?? previousManifest?.metadata?.source?.revisionId;
  const unchangedRevisionId = !refresh && !input.prefetched && !recovery &&
    Object.entries(input.phase.resources ?? {}).every(([key, value]) => value === DEFAULT_RESOURCE_POLICY[key as keyof typeof DEFAULT_RESOURCE_POLICY]) &&
    previousManifest?.normalizer_version === LARK_DOCUMENT_NORMALIZER_VERSION && fingerprint !== undefined
    ? previousRevision : undefined;
  await beginFormatOnlyUpdate(input.projectRoot);
  let fetched: Awaited<ReturnType<typeof fetchFeishuDocSnapshot>>;
  let capturedAt = (input.now ?? new Date()).toISOString();
  try {
    if (input.snapshotDirectory !== undefined) {
      const snapshot = await readLarkSnapshotBundle(input.snapshotDirectory, target);
      assertSnapshotResourcePolicy(snapshot, input.phase.resources);
      fetched = snapshot.fetched;
      capturedAt = snapshot.capturedAt;
    } else fetched = await fetchFeishuDocSnapshot({
      url: target.value,
      resourcePolicy: input.phase.resources,
      requireCompleteBody: true,
      ...(typeof unchangedRevisionId === "string" ? { unchangedRevisionId } : {}),
      ...(input.prefetched === undefined ? {} : { prefetched: input.prefetched }),
    }, input.larkRunner);
  } catch (error) {
    if (error instanceof ContextError) throw error;
    const failure = normalizeLarkError(error, resolved.sourceName);
    if (failure.detail?.reason_code === "external.authorization-required" ||
        failure.detail?.reason_code === "external.tool-failed" && error instanceof LarkCliError && error.exitCode !== 0) {
      throw new ContextError(failure.code, failure.message, { ...failure.detail, reason_code: DOCUMENT_ACQUISITION_UNAVAILABLE, acquisition_cause: failure.detail?.reason_code });
    }
    throw failure;
  }

  if (fetched.fidelity.evidence_status === "error" || fetched.fidelity.projection_status === "error") {
    throw new ContextError(ExitCode.WorkspaceStateError, `lark source ${resolved.sourceName} returned an incomplete body; the existing snapshot was not changed`, {
      category: ErrorCategory.PartialFailure, reason_code: DOCUMENT_ACQUISITION_UNAVAILABLE,
      sourceName: resolved.sourceName, issues: fetched.fidelity.issues,
      next: `context run ${input.phase.id} --format json`,
    });
  }
  if (fetched.unchanged && previousManifest !== null) {
    const state = documentSnapshotFidelityState(previousManifest, readDocumentSnapshotCaptureReport({
      projectRoot: input.projectRoot, materializedAt, manifest: previousManifest,
    }));
    return {
      kind: "document.capture.lark.result", source: { type: "lark", name: resolved.sourceName,
        identity: target.kind, title: entry.title ?? fetched.title ?? previousManifest.files[0]?.title ?? resolved.sourceName,
        ...(entry.url === undefined ? {} : { url: entry.url }) },
      access_identity: fetched.accessIdentity, identity_fallback: fetched.identityFallback,
      snapshot: { manifest: manifestPath, materializedAt, snapshot_hash: previousManifest.snapshot_hash, changed: false },
      documents: previousManifest.files.map(file => ({ path: file.path, title: file.title ?? resolved.sourceName, line_count: file.line_count })),
      assets: previousManifest.assets ?? [], fidelity: state.report ?? fetched.fidelity,
      resource_materialization: state.resourceMaterialization ?? fetched.resourceMaterialization,
      diagnostics: [...state.blocking, ...state.warnings], next_action: workspaceRouteReevaluation(input.phase.id),
    };
  }

  // A retry must not replace previously captured resources with transient
  // failures. Keep the complete old snapshot; do not claim stale bytes are fresh.
  if (previousManifest && previousRevision !== undefined && fetched.revisionId === previousRevision) {
    const previous = documentSnapshotFidelityState(previousManifest, readDocumentSnapshotCaptureReport({
      projectRoot: input.projectRoot, materializedAt, manifest: previousManifest,
    }));
    const lost = fetched.resourceMaterialization.items.filter(item =>
      previous.resourceMaterialization?.items.some(old => old.kind === item.kind && old.locator === item.locator && old.status === "materialized" &&
        (item.status !== "materialized" || item.reason_code === "document.resource.preview" && old.reason_code !== "document.resource.preview")));
    if (lost.length) throw new ContextError(ExitCode.WorkspaceStateError,
      "Previously captured resources were degraded; the existing snapshot was preserved. Check resource policy and access before retrying the explicit refresh.",
      { category: ErrorCategory.PartialFailure, reason_code: DOCUMENT_ACQUISITION_UNAVAILABLE,
        resources: lost.map(item => ({ locator: item.locator, reason: item.reason })),
        next_action: { command: `context run ${input.phase.id} --input - --format json`,
          input: { refresh_sources: [`lark:${resolved.sourceName}`] } } });
  }

  let normalized = normalizeMarkdownDocument(fetched.markdown);
  if (normalized.trim().length === 0) {
    const recovery = larkErrorRecovery(new Error("empty document"), resolved.sourceName);
    throw larkRuntimeError(`lark source ${resolved.sourceName} produced an empty normalized snapshot`, {
      sourceName: resolved.sourceName,
      reason_code: recovery.reasonCode,
      next: recovery.next,
    });
  }

  const documentPath = normalizeSnapshotRelativePath(entry.module === undefined ? "index.md" : `${entry.module}.md`);
  const title = entry.title ?? fetched.title ?? titleFromMarkdown(normalized, documentPath);
  const locator = target.kind === "url" ? target.value : `${target.kind}:${target.value}`;
  const assetRoot = entry.module === undefined ? "assets" : `assets/${entry.module}`;
  const reportPath = normalizeSnapshotRelativePath(`${assetRoot}/capture-report.json`);
  const preparedAssets = fetched.assets.map((asset) => assetManifestEntry(asset, assetRoot));
  const assets = [...new Map(preparedAssets.map((asset) => [asset.entry.path, asset])).values()]
    .sort((left, right) => left.entry.path.localeCompare(right.entry.path));
  for (const asset of fetched.assets) {
    const rawPath = normalizeSnapshotRelativePath(asset.path);
    const sourcePath = rawPath.startsWith("assets/") ? rawPath : `assets/${rawPath}`;
    const relativePath = rawPath.startsWith("assets/") ? rawPath.slice("assets/".length) : rawPath;
    const targetPath = normalizeSnapshotRelativePath(`${assetRoot}/${relativePath}`);
    normalized = normalized.split(sourcePath).join(targetPath);
  }
  assertNoSensitiveLarkSource({
    sourceName: resolved.sourceName,
    documentPath,
    markdown: normalized,
    assets: fetched.assets,
  });
  const snapshotFiles: DocumentSnapshotFileInput[] = [{
    path: documentPath,
    bytes: normalized,
    title,
    locator,
  }];
  const manifestAbsPath = join(input.projectRoot, manifestPath);
  const manifest = createDocumentSnapshotManifest({
    sourceType: "lark",
    sourceName: resolved.sourceName,
    capturedAt,
    files: snapshotFiles,
    assets: assets.map((asset) => asset.entry),
    metadata: metadataForSource({
      entry,
      reportPath,
      fidelity: fetched.fidelity,
      resourceMaterialization: fetched.resourceMaterialization,
      ...(fetched.title !== undefined ? { fetchedTitle: fetched.title } : {}),
      ...(fetched.revisionId !== undefined ? { revisionId: fetched.revisionId } : {}),
    }),
    normalizerVersion: LARK_DOCUMENT_NORMALIZER_VERSION,
  });
  let changed = !!recovery || previousManifest === null || larkSnapshotComparable(previousManifest) !== larkSnapshotComparable(manifest);
  const manifestToWrite = changed || previousManifest === null
    ? manifest
    : {
        ...manifest,
        captured_at: previousManifest.captured_at,
      };
  const manifestContent = renderDocumentManifestFile(updateDocumentManifestFile({
    current: currentManifestFile,
    snapshot: manifestToWrite,
  }));
  let capturedFiles: Record<string, string | null> = {};
  const cacheDiagnostics: string[] = [];
  try {
    const requestedWrites: AtomicFileBatchWrite[] = [{
      path: join(materializedAtAbsPath, documentPath),
      bytes: normalized,
    }];
    for (const asset of assets) {
      if (asset.bytes !== undefined) {
        requestedWrites.push({
          path: join(materializedAtAbsPath, asset.entry.path),
          bytes: asset.bytes,
        });
      }
    }
    const writes: AtomicFileBatchWrite[] = [];
    for (const write of requestedWrites) {
      if (!await fileContentMatches(write.path, write.bytes)) writes.push(write);
    }
    const currentPaths = new Set([
        ...assets.map((asset) => asset.entry.path),
        ...(await listSnapshotAssetFiles(materializedAtAbsPath, assetRoot)).filter(path => normalized.includes(path)),
    ]);
    const removals = await staleSnapshotAssetPaths({
      materializedAtAbsPath, assetRoot, currentPaths,
    });
    changed ||= writes.length > 0 || removals.length > 0;
    if (!changed && fingerprint !== undefined && fetched.revisionId !== undefined) {
      await rememberCheckedLarkRevision(input.projectRoot, resolved.sourceName, fetched.revisionId, fingerprint);
    }
    if (changed && !await fileContentMatches(manifestAbsPath, manifestContent)) writes.push({ path: manifestAbsPath, bytes: manifestContent });
    capturedFiles = Object.fromEntries([
        ...requestedWrites.map(write => [write.path.slice(input.projectRoot.length + 1), `sha256:${createHash("sha256").update(write.bytes).digest("hex")}`]),
        ...removals.map(path => [path.slice(input.projectRoot.length + 1), null]),
    ]);
    for (const path of currentPaths) {
      const relativePath = `${materializedAt}/${path}`;
      if (relativePath in capturedFiles) continue;
      try { capturedFiles[relativePath] = `sha256:${createHash("sha256").update(await readFile(join(input.projectRoot, relativePath))).digest("hex")}`; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") capturedFiles[relativePath] = null; else throw error; }
    }
    await applyAtomicFileBatch({
      transactionRoot: join(input.projectRoot, ".tmp", "context-runtime", "capture-transactions"),
      writes,
      removals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ContextError(ExitCode.WorkspaceStateError, `lark source ${resolved.sourceName} snapshot write failed: ${message}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      sourceName: resolved.sourceName,
      materializedAt,
      manifest: manifestPath,
      next: `fix write permissions or restore ${materializedAt}, then rerun context run capture:lark:${resolved.sourceName}`,
    });
  }
  if (changed) {
    try { await recordFormatOnlyCapture(input.projectRoot, { source: `lark:${resolved.sourceName}`, manifestPath, snapshot: manifest, files: capturedFiles }); }
    catch (error) {
      try { await invalidateFormatOnlyUpdate(input.projectRoot); }
      catch (cleanupError) {
        throw new ContextError(ExitCode.WorkspaceStateError, "The document snapshot was saved, but its temporary format-only baseline could not be invalidated.", {
          category: ErrorCategory.PartialFailure, outcome: "committed", reason_code: "format-only-baseline-unavailable",
          next: "Restore write access to .tmp/context-runtime before continuing; do not repeat the completed capture.",
          cause: String(cleanupError),
        });
      }
      cacheDiagnostics.push(`format_only_unavailable: snapshot saved; normal version recording applies. ${String(error)}`);
    }
  }

  if (fetched.resourceMaterialization.status === "error") {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `lark source ${resolved.sourceName} audit snapshot was preserved, but required resources could not be materialized`,
      {
        category: ErrorCategory.PartialFailure,
        code: "lark.capture.resource-materialization-failed",
        sourceName: resolved.sourceName,
        snapshot: {
          manifest: manifestPath,
          materializedAt,
          snapshot_hash: manifest.snapshot_hash,
          changed,
        },
        resource_materialization: fetched.resourceMaterialization,
        next: "context status --format json",
      },
    );
  }

  return {
    kind: "document.capture.lark.result",
    source: {
      type: "lark",
      name: resolved.sourceName,
      identity: target.kind,
      title,
      ...(entry.url !== undefined ? { url: entry.url } : {}),
    },
    access_identity: fetched.accessIdentity,
    identity_fallback: fetched.identityFallback,
    snapshot: {
      manifest: manifestPath,
      materializedAt,
      snapshot_hash: manifest.snapshot_hash,
      changed,
    },
    documents: [{
      path: documentPath,
      title,
      line_count: countLines(normalized),
    }],
    assets: assets.map((asset) => ({
      path: asset.entry.path,
      ...(asset.entry.media_type !== undefined ? { media_type: asset.entry.media_type } : {}),
      ...(asset.entry.content_hash !== undefined ? { content_hash: asset.entry.content_hash } : {}),
    })),
    fidelity: fetched.fidelity,
    resource_materialization: fetched.resourceMaterialization,
    diagnostics: [
      ...cacheDiagnostics,
      ...(recovery === undefined ? [] : [recovery.diagnostic]),
      ...(fetched.identityFallback
        ? [`info: lark.capture.identity-fallback: capture used an identity fallback; document identity: ${fetched.accessIdentity}; embedded reads may use the fallback identity`]
        : []),
      ...fetched.fidelity.issues.map((issue) =>
        `${issue.severity}: ${issue.code}: ${issue.block_type} × ${issue.count}: ${issue.reason}`
      ),
      ...fetched.resourceMaterialization.items
        .filter((item) => item.status === "failed" || (item.kind === "poll" && item.reason?.includes("absent") === true))
        .map((item) => `${item.status}: lark.capture.resource-${item.status}: ${item.kind}: ${item.reason ?? item.locator}`),
    ],
    next_action: workspaceRouteReevaluation(input.phase.id),
  };
}

export async function runCaptureLarkPhase(input: {
  projectRoot: string;
  phase: CaptureLarkPhaseDefinition;
  now?: Date;
  larkRunner?: LarkRunner;
  prefetched?: import("../lib/feishu.js").PrefetchedLarkDocument;
  snapshotDirectory?: string;
  refreshSources?: readonly string[];
}): Promise<CaptureLarkRunResult> {
  return withProjectWriteLock(input.projectRoot, "capture-lark", () => runCaptureLarkPhaseUnlocked(input));
}
