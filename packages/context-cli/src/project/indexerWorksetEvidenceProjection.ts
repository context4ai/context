import { join } from "node:path";
import {
  buildIndexerAuthorizedWorksetViewSource,
  indexerProtocolDigest,
  validateIndexerMainRunRequest,
  type IndexerAuthorizedWorksetViewSource,
} from "@c4a/context";
import {
  readCommittedSnapshotMarkdown,
  type BuildCommittedEvidenceIndexResult,
} from "./documentEvidenceIndex.js";
import {
  projectIndexerReadTargetAllows,
  projectIndexerReadTargets,
} from "./indexerReadScopeAuthorization.js";

function uniqueDocumentPaths(paths: readonly string[]): string[] {
  if (paths.length === 0) {
    throw new TypeError("captured document projection requires an explicit document allowlist");
  }
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    throw new TypeError("captured document projection allowlist contains duplicates");
  }
  return [...paths].sort();
}

export function capturedDocumentIndexerRef(input: {
  source_ref: string;
  path: string;
}): string {
  return `document:${indexerProtocolDigest({
    source_ref: input.source_ref,
    path: input.path,
  })}`;
}

async function capturedDocumentProjection(input: {
  projectRoot: string;
  evidence: BuildCommittedEvidenceIndexResult;
  authorized_document_paths: readonly string[];
}) {
  if (input.evidence.index.snapshot_hash !== input.evidence.manifest.snapshot_hash) {
    throw new TypeError("captured document evidence snapshot is stale");
  }
  const sourceRef = `${input.evidence.index.source_type}:${input.evidence.index.source_name}`;
  const documentsByPath = new Map(
    input.evidence.index.documents.map((document) => [document.path, document]),
  );
  const authorizedPaths = uniqueDocumentPaths(input.authorized_document_paths);
  const items = await Promise.all(authorizedPaths.map(async (path) => {
    const document = documentsByPath.get(path);
    if (document === undefined) {
      throw new TypeError(`captured document projection path is unavailable: ${path}`);
    }
    const markdown = await readCommittedSnapshotMarkdown({
      projectRoot: input.projectRoot,
      index: input.evidence.index,
      path,
      cache: input.evidence.snapshotMarkdownCache,
    });
    const outline = markdown.split(/\r?\n/u).flatMap((line) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
      return match === null ? [] : [match[2]!];
    });
    return {
      ref: capturedDocumentIndexerRef({ source_ref: sourceRef, path: document.path }),
      category: "document",
      provenance: {
        protocol: input.evidence.manifest.schema_version,
        digest: document.content_hash,
        container_ref: sourceRef,
      },
      value: {
        source_ref: sourceRef,
        path: document.path,
        ...(document.source_path === undefined ? {} : { source_path: document.source_path }),
        content_hash: document.content_hash,
        ...(document.line_count === undefined ? {} : { line_count: document.line_count }),
        ...(document.title === undefined ? {} : { title: document.title }),
        ...(document.locator === undefined ? {} : { locator: document.locator }),
        ...(document.route === undefined ? {} : { route: document.route }),
        content_path: join(input.evidence.index.materialized_at, document.path),
        outline,
      },
    };
  }));
  return { sourceRef, snapshotHash: input.evidence.index.snapshot_hash, items };
}

export async function buildCapturedDocumentWorksetViewSource(input: {
  projectRoot: string;
  request: unknown;
  evidence: BuildCommittedEvidenceIndexResult;
  authorized_document_paths: readonly string[];
}): Promise<IndexerAuthorizedWorksetViewSource> {
  const request = validateIndexerMainRunRequest(input.request);
  const projection = await capturedDocumentProjection(input);
  if (
    request.workset.source_ref !== projection.sourceRef ||
    request.workset.module_ref !== null
  ) {
    throw new TypeError("captured document evidence does not match the current workset source");
  }

  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "captured-documents",
    input_digests: [request.workset.stage === "author"
      ? request.workset.source_binding_digest
      : projection.snapshotHash],
    items: projection.items,
  });
}

export async function buildCapturedDocumentEnrichmentWorksetViewSource(input: {
  projectRoot: string;
  request: unknown;
  registry: unknown;
  evidence: BuildCommittedEvidenceIndexResult;
  authorized_document_paths: readonly string[];
}): Promise<IndexerAuthorizedWorksetViewSource> {
  const request = validateIndexerMainRunRequest(input.request);
  const projection = await capturedDocumentProjection(input);
  const readTargets = projectIndexerReadTargets({
    registry: input.registry,
    indexer_id: request.workset.indexer_id,
  });
  if (
    !projectIndexerReadTargetAllows({
      targets: readTargets,
      source_ref: projection.sourceRef,
      module_ref: null,
    })
  ) {
    throw new TypeError("captured document enrichment is outside Indexer read scope");
  }

  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "captured-document-enrichment",
    input_digests: [
      request.workset.primary_registry_projection_digest,
      projection.snapshotHash,
    ],
    items: projection.items,
  });
}
