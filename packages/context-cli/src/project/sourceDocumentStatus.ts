import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FileSourceRegistryEntry,
  LarkSourceRegistryEntry,
} from "@c4a/context";
import { loadSourcesRegistry } from "@c4a/context";
import type { DocumentSourceType } from "@c4a/extract";
import { DEFAULT_FILE_SOURCE_INCLUDE, fileSourceIncludeMismatchDiagnostic } from "./documentCapture.js";
import { larkSnapshotIdentityDiagnostic } from "./larkSourceIdentity.js";
import {
  fileSourceAgentView,
  fileSourceDocumentSiteHint,
  larkSourceAgentView,
} from "./sourceCommandViews.js";
import { findDocumentSnapshotForSource } from "./documentBatchManifest.js";
import { documentSnapshotFidelityState, readDocumentSnapshotCaptureReport } from "./documentSnapshotFidelity.js";

function documentSourceManifestPath(source: FileSourceRegistryEntry | LarkSourceRegistryEntry): string {
  return source.snapshot?.manifest ?? join(source.materializedAt, "manifest.json");
}

async function documentSnapshotState(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  source: FileSourceRegistryEntry | LarkSourceRegistryEntry;
}): Promise<{
  snapshotReady: boolean;
  state: "needs-capture" | "ready" | "workspace-state-invalid";
  manifest: string;
  diagnostics: string[];
  next: string;
  captureFidelity?: NonNullable<ReturnType<typeof documentSnapshotFidelityState>["report"]>;
  resourceMaterialization?: NonNullable<ReturnType<typeof documentSnapshotFidelityState>["resourceMaterialization"]>;
  normalizerVersion?: string;
}> {
  const manifest = documentSourceManifestPath(input.source);
  const manifestPath = join(input.projectRoot, manifest);
  if (!existsSync(manifestPath)) {
    return {
      snapshotReady: false,
      state: "needs-capture",
      manifest,
      diagnostics: [`snapshot is missing: ${manifest}`],
      next: `context run capture:${input.sourceType}:${input.source.name}`,
    };
  }
  try {
    const parsed = findDocumentSnapshotForSource(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
      input.source.name,
    );
    if (parsed === null) {
      return {
        snapshotReady: false,
        state: "needs-capture",
        manifest,
        diagnostics: [`snapshot batch has no captured entry for ${input.source.name}`],
        next: `context run capture:${input.sourceType}:${input.source.name}`,
      };
    }
    if (parsed.source_type !== input.sourceType || parsed.source_name !== input.source.name) {
      return {
        snapshotReady: false,
        state: "workspace-state-invalid",
        manifest,
        diagnostics: [`snapshot manifest source does not match registry source: ${manifest}`],
        next: `rerun context run capture:${input.sourceType}:${input.source.name} or fix ${manifest}`,
      };
    }
    if (input.sourceType === "file") {
      const includeMismatch = fileSourceIncludeMismatchDiagnostic({
        manifest: parsed,
        source: input.source as FileSourceRegistryEntry,
        projectRoot: input.projectRoot,
        materializedAt: input.source.materializedAt,
      });
      if (includeMismatch !== null) {
        return {
          snapshotReady: false,
          state: "needs-capture",
          manifest,
          diagnostics: [includeMismatch],
          next: `context run capture:file:${input.source.name}`,
        };
      }
    }
    if (input.sourceType === "lark") {
      const identityMismatch = larkSnapshotIdentityDiagnostic(input.source as LarkSourceRegistryEntry, parsed);
      if (identityMismatch !== null) {
        return {
          snapshotReady: false,
          state: "needs-capture",
          manifest,
          diagnostics: [identityMismatch],
          next: `context run capture:lark:${input.source.name}`,
        };
      }
    }
    const captureReport = readDocumentSnapshotCaptureReport({
      projectRoot: input.projectRoot,
      materializedAt: input.source.materializedAt,
      manifest: parsed,
    });
    const fidelity = documentSnapshotFidelityState(parsed, captureReport);
    if (fidelity.blocking.length > 0) {
      return {
        snapshotReady: false,
        state: "needs-capture",
        manifest,
        diagnostics: fidelity.blocking,
        next: `context run capture:${input.sourceType}:${input.source.name}`,
        ...(fidelity.report !== undefined ? { captureFidelity: fidelity.report } : {}),
        ...(fidelity.resourceMaterialization !== undefined ? { resourceMaterialization: fidelity.resourceMaterialization } : {}),
      };
    }
    const missing = [
      ...parsed.files.map((file) => file.path),
      ...(parsed.assets ?? []).filter((asset) => asset.content_hash !== undefined).map((asset) => asset.path),
    ]
      .find((path) => !existsSync(join(input.projectRoot, input.source.materializedAt, path)));
    if (missing !== undefined) {
      return {
        snapshotReady: false,
        state: "needs-capture",
        manifest,
        diagnostics: [`snapshot file is missing: ${input.source.materializedAt}/${missing}`],
        next: `context run capture:${input.sourceType}:${input.source.name}`,
      };
    }
    return {
      snapshotReady: true,
      state: "ready",
      manifest,
      diagnostics: fidelity.warnings,
      next: "context status --format json",
      ...(fidelity.report !== undefined ? { captureFidelity: fidelity.report } : {}),
      ...(fidelity.resourceMaterialization !== undefined ? { resourceMaterialization: fidelity.resourceMaterialization } : {}),
      normalizerVersion: parsed.normalizer_version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      snapshotReady: false,
      state: "workspace-state-invalid",
      manifest,
      diagnostics: [`snapshot manifest is invalid: ${manifest}: ${message}`],
      next: `rerun context run capture:${input.sourceType}:${input.source.name} or fix ${manifest}`,
    };
  }
}

async function documentSourceStatusView(input: {
  projectRoot: string;
  sourceType: DocumentSourceType;
  source: FileSourceRegistryEntry | LarkSourceRegistryEntry;
}): Promise<Record<string, unknown>> {
  const snapshot = await documentSnapshotState(input);
  const documentSiteHint = input.sourceType === "file"
    ? await fileSourceDocumentSiteHint({
        projectRoot: input.projectRoot,
        source: input.source as FileSourceRegistryEntry,
      })
    : null;
  const base = input.sourceType === "file"
    ? {
        ...fileSourceAgentView(input.source as FileSourceRegistryEntry),
        include: (input.source as FileSourceRegistryEntry).include ?? DEFAULT_FILE_SOURCE_INCLUDE,
      }
    : larkSourceAgentView(input.source as LarkSourceRegistryEntry);
  return {
    ...base,
    status: snapshot.state,
    snapshotReady: snapshot.snapshotReady,
    manifest: snapshot.manifest,
    diagnostics: snapshot.diagnostics,
    ...(snapshot.captureFidelity !== undefined ? { captureFidelity: snapshot.captureFidelity } : {}),
    ...(snapshot.resourceMaterialization !== undefined ? { resourceMaterialization: snapshot.resourceMaterialization } : {}),
    ...(snapshot.normalizerVersion !== undefined ? { normalizerVersion: snapshot.normalizerVersion } : {}),
    ...(documentSiteHint !== null ? { agent_hints: [documentSiteHint] } : {}),
    next: snapshot.next,
  };
}

export async function documentSourcesForName(input: {
  projectRoot: string;
  name?: string;
}): Promise<Array<{ sourceType: DocumentSourceType; source: FileSourceRegistryEntry | LarkSourceRegistryEntry }>> {
  const registry = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const docs = [
    ...registry.files.map((source) => ({ sourceType: "file" as const, source })),
    ...registry.larks.map((source) => ({ sourceType: "lark" as const, source })),
  ];
  if (input.name === undefined) return docs;
  return docs.filter(({ source }) =>
    source.name === input.name || source.id === input.name || source.namespace === input.name
  );
}

export async function inspectDocumentSources(input: {
  projectRoot: string;
  name?: string;
}): Promise<Record<string, unknown>[]> {
  const selected = await documentSourcesForName(input);
  return Promise.all(selected.map(({ sourceType, source }) =>
    documentSourceStatusView({ projectRoot: input.projectRoot, sourceType, source })
  ));
}
