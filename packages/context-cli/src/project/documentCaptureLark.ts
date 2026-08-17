import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { CaptureLarkPhaseDefinition, LarkSourceRegistryEntry } from "@c4a/context";
import {
  computeDocumentContentHash,
  createDocumentSnapshotManifest,
  normalizeMarkdownDocument,
  normalizeSnapshotRelativePath,
  type DocumentCaptureFidelityReport,
  type DocumentSnapshotAssetEntry,
  type DocumentSnapshotFileInput,
  type DocumentSnapshotManifestMetadata,
} from "@c4a/extract";
import { applyAtomicFileBatch, type AtomicFileBatchWrite } from "../lib/atomicFileBatch.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { detectExternalEnvironmentIssue } from "../lib/externalEnvironment.js";
import {
  fetchFeishuDocSnapshot,
  LarkCliError,
  LarkCliNotInstalledError,
  type FetchFeishuDocAsset,
  type LarkRunner,
} from "../lib/feishu.js";
import { ExitCode } from "../types/exitCode.js";
import { documentSourceAddCommand, resolveDocumentPhaseSource } from "./documentRun.js";
import { larkSourceIdentities } from "./larkSourceIdentity.js";
import {
  findDocumentSnapshotForSource,
  readDocumentManifestFile,
  renderDocumentManifestFile,
  updateDocumentManifestFile,
} from "./documentBatchManifest.js";
import {
  workspaceRouteReevaluation,
  type WorkspaceRouteReevaluation,
} from "./workflow/workflowReceipt.js";
import { withProjectWriteLock } from "./writeLock.js";
import { LARK_DOCUMENT_NORMALIZER_VERSION } from "./documentCaptureContract.js";

export interface CaptureLarkRunResult {
  kind: "document.capture.lark.result";
  source: {
    type: "lark";
    name: string;
    identity: "url" | "docToken" | "wikiToken";
    title?: string;
  };
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
  resource_materialization: Awaited<ReturnType<typeof fetchFeishuDocSnapshot>>["resourceMaterialization"];
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
      next: "Install lark-cli from https://github.com/larksuite/cli, then rerun capture",
    };
  }
  if (/update|api-version|deprecated|version/iu.test(message)) {
    return {
      reasonCode: "external.tool-version-unsupported",
      next: "Upgrade lark-cli and run lark-cli update, then rerun capture",
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
      next: "Run lark-cli auth login with an account that can read the document, then rerun capture",
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

  const entry = resolved.entry as LarkSourceRegistryEntry;
  assertLarkSnapshotMaterializedAt(entry);
  const target = larkTarget(entry);
  let fetched: Awaited<ReturnType<typeof fetchFeishuDocSnapshot>>;
  try {
    fetched = await fetchFeishuDocSnapshot({
      url: target.value,
      resourcePolicy: input.phase.resources,
    }, input.larkRunner);
  } catch (error) {
    throw normalizeLarkError(error, resolved.sourceName);
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
  const snapshotFiles: DocumentSnapshotFileInput[] = [{
    path: documentPath,
    bytes: normalized,
    title,
    locator,
  }];
  const manifestPath = sourceManifestPath(entry);
  const manifestAbsPath = join(input.projectRoot, manifestPath);
  const materializedAt = entry.materializedAt;
  const materializedAtAbsPath = join(input.projectRoot, materializedAt);
  const manifest = createDocumentSnapshotManifest({
    sourceType: "lark",
    sourceName: resolved.sourceName,
    capturedAt: (input.now ?? new Date()).toISOString(),
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
  const currentManifestFile = await readDocumentManifestFile(manifestAbsPath);
  const previousManifest = currentManifestFile === null
    ? null
    : findDocumentSnapshotForSource(currentManifestFile, resolved.sourceName);
  const changed = previousManifest?.snapshot_hash !== manifest.snapshot_hash;
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
    requestedWrites.push({ path: manifestAbsPath, bytes: manifestContent });
    const writes: AtomicFileBatchWrite[] = [];
    for (const write of requestedWrites) {
      if (!await fileContentMatches(write.path, write.bytes)) writes.push(write);
    }
    const removals = await staleSnapshotAssetPaths({
      materializedAtAbsPath,
      assetRoot,
      currentPaths: new Set(assets.filter((asset) => asset.bytes !== undefined).map((asset) => asset.entry.path)),
    });
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

  if (fetched.fidelity.evidence_status === "error") {
    throw new ContextError(
      ExitCode.WorkspaceStateError,
      `lark source ${resolved.sourceName} audit snapshot was preserved, but capture fidelity validation failed`,
      {
        category: ErrorCategory.PartialFailure,
        code: "lark.capture.fidelity-loss",
        sourceName: resolved.sourceName,
        snapshot: {
          manifest: manifestPath,
          materializedAt,
          snapshot_hash: manifest.snapshot_hash,
          changed,
        },
        issues: fetched.fidelity.issues.filter((issue) => issue.impact === "evidence"),
        next: "context status --format json",
      },
    );
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
      ...(entry.title !== undefined ? { title: entry.title } : fetched.title !== undefined ? { title: fetched.title } : {}),
    },
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
}): Promise<CaptureLarkRunResult> {
  return withProjectWriteLock(input.projectRoot, "capture-lark", () => runCaptureLarkPhaseUnlocked(input));
}
