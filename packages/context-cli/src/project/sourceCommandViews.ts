import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FileSourceRegistryEntry,
  LarkSourceRegistryEntry,
} from "@c4a/context";
import type { DocumentSourceType } from "@c4a/extract";
import {
  detectDocumentSiteFiles,
  documentSiteConfigHint,
  manifestUsesMdxJsonDocs,
  projectUsesMdxJsonDocsForSource,
} from "./documentSiteDetection.js";
import { larkSourceIdentities } from "./larkSourceIdentity.js";
import type { RepoSourceRecord } from "./repoSources.js";
import { loadContextProjectModule } from "./workspace.js";
import { parseDocumentSnapshotForSource } from "./documentBatchManifest.js";
import {
  workspaceRouteReevaluation,
  type WorkspaceRouteReevaluation,
} from "./workflow/workflowReceipt.js";

export function repoSourceAgentView(source: RepoSourceRecord): Record<string, unknown> {
  return {
    id: source.id ?? source.name,
    name: source.name,
    namespace: source.namespace,
    module: source.module,
    type: "repo",
    status: "active",
    ...(source.local !== undefined ? { local: source.local } : {}),
    ...(source.subpath !== undefined ? { subpath: source.subpath } : {}),
    materializedAt: source.materializedAt ?? `sources/repo/${source.namespace}/${source.module}`,
    remote: source.git.remote,
    ref: source.git.ref,
  };
}

export function fileSourceAgentView(source: FileSourceRegistryEntry): Record<string, unknown> {
  return {
    id: source.id,
    name: source.name,
    ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
    ...(source.module !== undefined ? { module: source.module } : {}),
    type: "file",
    status: "registered",
    materializedAt: source.materializedAt,
    ...(source.local !== undefined ? { local: source.local } : {}),
    ...(source.include !== undefined ? { include: source.include } : {}),
    ...(source.snapshot !== undefined ? { snapshot: source.snapshot } : {}),
  };
}

export function larkSourceAgentView(source: LarkSourceRegistryEntry): Record<string, unknown> {
  const identities = larkSourceIdentities(source);
  const identity = identities.length === 1 ? identities[0]?.kind : identities.length === 0 ? "missing" : "invalid";
  return {
    id: source.id,
    name: source.name,
    ...(source.namespace !== undefined ? { namespace: source.namespace } : {}),
    ...(source.module !== undefined ? { module: source.module } : {}),
    type: "lark",
    status: "registered",
    materializedAt: source.materializedAt,
    identity,
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.snapshot !== undefined ? { snapshot: source.snapshot } : {}),
  };
}

function documentSourceAddNextAction(
  sourceType: DocumentSourceType,
  sourceName: string,
): WorkspaceRouteReevaluation {
  return workspaceRouteReevaluation(`source.add.${sourceType}:${sourceName}`);
}

export async function fileSourceAgentViewWithNextAction(input: {
  projectRoot: string;
  source: FileSourceRegistryEntry;
}): Promise<Record<string, unknown>> {
  const documentSiteHint = await fileSourceDocumentSiteHint({
    projectRoot: input.projectRoot,
    source: input.source,
  });
  return {
    ...fileSourceAgentView(input.source),
    ...(documentSiteHint !== null ? { agent_hints: [documentSiteHint] } : {}),
    next_action: documentSourceAddNextAction("file", input.source.name),
  };
}

function documentSourceManifestPath(source: FileSourceRegistryEntry | LarkSourceRegistryEntry): string {
  return source.snapshot?.manifest ?? join(source.materializedAt, "manifest.json");
}

export async function fileSourceDocumentSiteHint(input: {
  projectRoot: string;
  source: FileSourceRegistryEntry;
}): Promise<string | null> {
  const detection = await detectDocumentSiteFiles({
    projectRoot: input.projectRoot,
    local: input.source.local,
  });
  let snapshotConfigured = false;
  const manifest = documentSourceManifestPath(input.source);
  try {
    const parsed = parseDocumentSnapshotForSource(
      JSON.parse(await readFile(join(input.projectRoot, manifest), "utf8")) as unknown,
      input.source.name,
    );
    snapshotConfigured = manifestUsesMdxJsonDocs(parsed);
  } catch {
    snapshotConfigured = false;
  }
  let processorConfigured = false;
  try {
    const loaded = await loadContextProjectModule(input.projectRoot);
    processorConfigured = projectUsesMdxJsonDocsForSource({
      phases: loaded.project.phases,
      source: input.source,
    });
  } catch {
    processorConfigured = false;
  }
  return documentSiteConfigHint({
    sourceName: input.source.name,
    detection,
    processorConfigured,
    snapshotConfigured,
  });
}

export async function larkSourceAgentViewWithNextAction(input: {
  projectRoot: string;
  source: LarkSourceRegistryEntry;
}): Promise<Record<string, unknown>> {
  return {
    ...larkSourceAgentView(input.source),
    next_action: documentSourceAddNextAction("lark", input.source.name),
  };
}
