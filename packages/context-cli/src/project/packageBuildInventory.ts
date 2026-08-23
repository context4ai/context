import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { parse as parseYaml } from "yaml";
import { isKnowledgeCollection, okfRootForCollection } from "./okfTypes.js";
import { knowledgeInventory, type ApprovedKnowledgeFile } from "./packageIndexes.js";
import { packageNavigation } from "./packageNavigation.js";
import {
  packageOkfRootPath,
} from "./packageDistribution.js";
import { packageKind } from "./packageTemplateUtils.js";
import { validateStructureEdgeContract, type StructureEdgeContractResult } from "./structureEdgeContract.js";
import type { ProjectVerifyResult } from "./verifyTypes.js";
import { codegraphRelationshipCoverage } from "./codegraphRelationshipProjection.js";
import type { DocumentOptimizationStatus } from "./documentOptimization.js";

export const PACKAGE_BUILD_INVENTORY_PATH = "context-build-inventory.json";

export interface PackageSelectionReason {
  kind: "default" | "collection" | "okf_root" | "include";
  value: string;
}

export type SelectedApprovedKnowledgeFile = ApprovedKnowledgeFile & {
  selectedBy?: PackageSelectionReason[];
};

export interface KnowledgeStructureInfo {
  path: string;
  content: string | null;
  sha256: string | null;
  parsed: Record<string, unknown> | null;
  nodes: number;
  edges: number;
  edgeContract: StructureEdgeContractResult;
}

export function knowledgeStructurePath(projectRoot: string): string {
  return join(projectRoot, "knowledge", "structure.yaml");
}

async function readOptionalText(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
}

export async function readKnowledgeStructure(projectRoot: string): Promise<KnowledgeStructureInfo> {
  const path = "knowledge/structure.yaml";
  const content = await readOptionalText(knowledgeStructurePath(projectRoot));
  if (content === null) {
    return { path, content: null, sha256: null, parsed: null, nodes: 0, edges: 0, edgeContract: validateStructureEdgeContract(null) };
  }
  const parsed = parseYaml(content) as unknown;
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  return {
    path,
    content,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    parsed: record,
    nodes: Array.isArray(record?.nodes) ? record.nodes.length : 0,
    edges: Array.isArray(record?.edges) ? record.edges.length : 0,
    edgeContract: validateStructureEdgeContract(record),
  };
}

function addEndpointCollection(map: Map<string, Set<string>>, endpoint: unknown, collection: string | undefined): void {
  if (typeof endpoint !== "string" || endpoint.trim().length === 0 || collection === undefined || collection.length === 0) return;
  const existing = map.get(endpoint) ?? new Set<string>();
  existing.add(collection);
  map.set(endpoint, existing);
}

function collectionFromViewRef(value: string): string | undefined {
  const separator = value.indexOf(":");
  return separator > 0 ? value.slice(0, separator) : undefined;
}

type KnowledgeInventoryItem = ReturnType<typeof knowledgeInventory>["items"][number];

function selectedViewRecords(input: {
  items: ReadonlyArray<KnowledgeInventoryItem>;
  structure: Record<string, unknown> | null;
}): Record<string, unknown>[] {
  const selectedViewRefs = new Set(input.items.map((item) => item.view_ref).filter((ref) => ref.length > 0));
  const selectedPaths = new Set(input.items.map((item) => item.sourcePath));
  const records: Record<string, unknown>[] = [];
  if (!Array.isArray(input.structure?.views)) return records;
  for (const view of input.structure.views) {
    if (view === null || typeof view !== "object" || Array.isArray(view)) continue;
    const record = view as Record<string, unknown>;
    const viewRef = typeof record.view_ref === "string" ? record.view_ref : undefined;
    const path = typeof record.path === "string" ? record.path : undefined;
    if (
      (viewRef === undefined || !selectedViewRefs.has(viewRef)) &&
      (path === undefined || !selectedPaths.has(path))
    ) {
      continue;
    }
    records.push(record);
  }
  return records;
}

function selectedEndpointRefs(input: {
  items: ReadonlyArray<KnowledgeInventoryItem>;
  structure: Record<string, unknown> | null;
}): Set<string> {
  const refs = new Set<string>();
  for (const item of input.items) {
    if (item.node_ref.length > 0) refs.add(item.node_ref);
    if (item.view_ref.length > 0) refs.add(item.view_ref);
  }
  for (const record of selectedViewRecords(input)) {
    addEndpointRef(refs, record.node_ref);
    addEndpointRef(refs, record.view_ref);
    if (!Array.isArray(record.sections)) continue;
    for (const section of record.sections) {
      if (section === null || typeof section !== "object" || Array.isArray(section)) continue;
      addEndpointRef(refs, (section as Record<string, unknown>).section_ref);
    }
  }
  return refs;
}

function selectedEndpointCollections(input: {
  items: ReadonlyArray<KnowledgeInventoryItem>;
  structure: Record<string, unknown> | null;
}): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const item of input.items) {
    addEndpointCollection(map, item.node_ref, item.internalCollection);
    addEndpointCollection(map, item.view_ref, item.internalCollection);
  }
  for (const record of selectedViewRecords(input)) {
    const viewRef = typeof record.view_ref === "string" ? record.view_ref : undefined;
    const collection = typeof record.collection === "string"
      ? record.collection
      : viewRef !== undefined
        ? collectionFromViewRef(viewRef)
        : undefined;
    addEndpointCollection(map, record.node_ref, collection);
    addEndpointCollection(map, viewRef, collection);
    if (!Array.isArray(record.sections)) continue;
    for (const section of record.sections) {
      if (section === null || typeof section !== "object" || Array.isArray(section)) continue;
      addEndpointCollection(map, (section as Record<string, unknown>).section_ref, collection);
    }
  }
  return map;
}

function addEndpointRef(refs: Set<string>, endpoint: unknown): void {
  if (typeof endpoint === "string" && endpoint.trim().length > 0) refs.add(endpoint);
}

function edgeIsPackageVisible(edge: Record<string, unknown>, selectedEndpoints: ReadonlySet<string>): boolean {
  return typeof edge.from === "string" &&
    typeof edge.to === "string" &&
    selectedEndpoints.has(edge.from) &&
    selectedEndpoints.has(edge.to);
}

function collectionsForEdge(edge: Record<string, unknown>, endpoints: ReadonlyMap<string, Set<string>>): Set<string> {
  const collections = new Set<string>();
  for (const endpoint of [edge.from, edge.to]) {
    if (typeof endpoint !== "string") continue;
    const explicit = collectionFromViewRef(endpoint);
    if (explicit !== undefined) collections.add(explicit);
    for (const collection of endpoints.get(endpoint) ?? []) {
      collections.add(collection);
    }
  }
  return collections;
}

function edgesByCollection(input: {
  structure: Record<string, unknown> | null;
  endpointCollections: ReadonlyMap<string, Set<string>>;
  selectedEndpoints: ReadonlySet<string>;
}): Map<string, Record<string, unknown>[]> {
  const output = new Map<string, Record<string, unknown>[]>();
  const edges = Array.isArray(input.structure?.edges) ? input.structure.edges : [];
  for (const edge of edges) {
    if (edge === null || typeof edge !== "object" || Array.isArray(edge)) continue;
    const record = edge as Record<string, unknown>;
    if (!edgeIsPackageVisible(record, input.selectedEndpoints)) continue;
    for (const collection of collectionsForEdge(record, input.endpointCollections)) {
      const existing = output.get(collection) ?? [];
      existing.push(record);
      output.set(collection, existing);
    }
  }
  return output;
}

function edgeSourceRefs(edge: Record<string, unknown>): string[] {
  if (!Array.isArray(edge.source_refs)) return [];
  return edge.source_refs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0);
}

function packageVisibleEdgeRecords(input: {
  endpointCollections: ReadonlyMap<string, Set<string>>;
  structure: Record<string, unknown> | null;
  selectedEndpoints: ReadonlySet<string>;
}): Record<string, unknown>[] {
  const edges = Array.isArray(input.structure?.edges) ? input.structure.edges : [];
  return edges.flatMap((edge) => {
    if (edge === null || typeof edge !== "object" || Array.isArray(edge)) return [];
    const record = edge as Record<string, unknown>;
    if (!edgeIsPackageVisible(record, input.selectedEndpoints)) return [];
    const collections = [...collectionsForEdge(record, input.endpointCollections)].sort();
    const okfRoots = [...new Set(collections
      .filter(isKnowledgeCollection)
      .map((collection) => okfRootForCollection(collection)))]
      .sort();
    const output: Record<string, unknown> = {
      type: record.type,
      from: record.from,
      to: record.to,
      source_refs: edgeSourceRefs(record),
      collections,
      okf_roots: okfRoots,
    };
    if (typeof record.confidence === "string") output.confidence = record.confidence;
    if (typeof record.note === "string") output.note = record.note;
    if (typeof record.relationship_mode === "string") output.relationship_mode = record.relationship_mode;
    if (typeof record.relation_type === "string") output.relation_type = record.relation_type;
    return [output];
  });
}

function structureWithEdges(structure: Record<string, unknown> | null, edges: readonly Record<string, unknown>[]): Record<string, unknown> | null {
  if (structure === null) return null;
  return { ...structure, edges: [...edges] };
}

function structureEdges(structure: Record<string, unknown> | null): Record<string, unknown>[] {
  const edges = Array.isArray(structure?.edges) ? structure.edges : [];
  return edges.filter((edge): edge is Record<string, unknown> =>
    edge !== null && typeof edge === "object" && !Array.isArray(edge)
  );
}

function selectedNodes(input: {
  structure: Record<string, unknown>;
  nodeRefs: ReadonlySet<string>;
}): Record<string, unknown>[] {
  const nodes = Array.isArray(input.structure.nodes) ? input.structure.nodes : [];
  return nodes.filter((node): node is Record<string, unknown> => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
    const nodeRef = (node as Record<string, unknown>).node_ref;
    return typeof nodeRef === "string" && input.nodeRefs.has(nodeRef);
  });
}

function hashScopedStructure(parsed: Record<string, unknown> | null): string | null {
  if (parsed === null) return null;
  return createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
}

export function packageScopedKnowledgeStructure(input: {
  selected: readonly SelectedApprovedKnowledgeFile[];
  structure: KnowledgeStructureInfo;
}): KnowledgeStructureInfo {
  const parsed = input.structure.parsed;
  if (parsed === null) {
    return {
      ...input.structure,
      edgeContract: validateStructureEdgeContract(null),
    };
  }
  const inventory = knowledgeInventory(input.selected, "wikis/index.md");
  const views = selectedViewRecords({ items: inventory.items, structure: parsed });
  const nodeRefs = new Set<string>();
  for (const item of inventory.items) {
    if (item.node_ref.length > 0) nodeRefs.add(item.node_ref);
  }
  for (const view of views) {
    if (typeof view.node_ref === "string") nodeRefs.add(view.node_ref);
  }
  const selectedEndpoints = selectedEndpointRefs({ items: inventory.items, structure: parsed });
  const edges = structureEdges(parsed).filter((edge) => edgeIsPackageVisible(edge, selectedEndpoints));
  const scoped: Record<string, unknown> = {
    ...(typeof parsed.schema_version === "string" ? { schema_version: parsed.schema_version } : {}),
    scope: "selected-package",
    nodes: selectedNodes({ structure: parsed, nodeRefs }),
    views,
    edges,
    relationship_coverage: codegraphRelationshipCoverage({ views, edges }),
  };
  const sha256 = hashScopedStructure(scoped);
  return {
    path: input.structure.path,
    content: JSON.stringify(scoped),
    sha256,
    parsed: scoped,
    nodes: Array.isArray(scoped.nodes) ? scoped.nodes.length : 0,
    edges: edges.length,
    edgeContract: validateStructureEdgeContract(scoped),
  };
}

export function packageBuildInventory(input: {
  pkg: PackageDefinition;
  selected: readonly SelectedApprovedKnowledgeFile[];
  structure: KnowledgeStructureInfo;
  verifyEvidenceStatus: ProjectVerifyResult["evidenceStatus"] | null;
  documentOptimization?: DocumentOptimizationStatus;
}): Record<string, unknown> {
  const inventory = knowledgeInventory(
    input.selected,
    `${packageOkfRootPath(input.pkg, "wikis")}/index.md`,
    packageNavigation(input.pkg),
    input.pkg,
  );
  const selectedEndpoints = selectedEndpointRefs({
    items: inventory.items,
    structure: input.structure.parsed,
  });
  const selectedEndpointCollectionsMap = selectedEndpointCollections({
    items: inventory.items,
    structure: input.structure.parsed,
  });
  const collectionEdges = edgesByCollection({
    endpointCollections: selectedEndpointCollectionsMap,
    structure: input.structure.parsed,
    selectedEndpoints,
  });
  const packageEdgeRecords = packageVisibleEdgeRecords({
    endpointCollections: selectedEndpointCollectionsMap,
    structure: input.structure.parsed,
    selectedEndpoints,
  });
  const packageViewRecords = selectedViewRecords({
    items: inventory.items,
    structure: input.structure.parsed,
  });
  const sourceRefValidation = input.verifyEvidenceStatus === null
    ? { status: "not-run" }
    : { status: "verified-by-context-verify", evidence_status: input.verifyEvidenceStatus };
  const selectedByApprovedPath = new Map(input.selected.map((file) => [file.relPath, file.selectedBy ?? []]));
  const selectedByForApprovedPath = (path: string): PackageSelectionReason[] => selectedByApprovedPath.get(path) ?? [];
  const uniqueSelectedBy = (paths: readonly string[]): PackageSelectionReason[] => {
    const seen = new Set<string>();
    const reasons: PackageSelectionReason[] = [];
    for (const path of paths) {
      for (const reason of selectedByForApprovedPath(path)) {
        const key = `${reason.kind}\u0000${reason.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        reasons.push(reason);
      }
    }
    return reasons;
  };
  const collectionEdgeContract = (collection: string): Record<string, unknown> => {
    const edges = collectionEdges.get(collection) ?? [];
    const contract = validateStructureEdgeContract(structureWithEdges(input.structure.parsed, edges));
    return {
      validation_scope: "collection",
      valid: contract.valid,
      checked: contract.checked,
      allowed_types: contract.allowedTypes,
      allowed_confidence: contract.allowedConfidence,
      source_ref_validation: sourceRefValidation,
    };
  };
  const itemsByCollection = new Map<string, typeof inventory.items>();
  for (const item of inventory.items) {
    const existing = itemsByCollection.get(item.internalCollection) ?? [];
    existing.push(item);
    itemsByCollection.set(item.internalCollection, existing);
  }
  const collectionSummaries = [...itemsByCollection.entries()]
    .map(([collection, items]) => {
      const edgeCount = collectionEdges.get(collection)?.length ?? 0;
      return {
        collection,
        internal_collection: collection,
        okf_root: items[0]?.okf_root ?? collection,
        count: items.length,
        edge_count: edgeCount,
        selected_by: uniqueSelectedBy(items.map((item) => item.sourcePath)),
        edge_contract: collectionEdgeContract(collection),
      };
    })
    .sort((left, right) => left.collection.localeCompare(right.collection));
  return {
    schema_version: "context.package-build-inventory.v1",
    package: {
      name: input.pkg.name,
      kind: packageKind(input.pkg),
      out_dir: input.pkg.outDir,
      distribution: {
        layout: "flat",
        knowledge_namespace: null,
        roots: {
          wikis: packageOkfRootPath(input.pkg, "wikis"),
          guides: packageOkfRootPath(input.pkg, "guides"),
          rules: packageOkfRootPath(input.pkg, "rules"),
          feats: packageOkfRootPath(input.pkg, "feats"),
        },
      },
      select: input.pkg.select ?? null,
      navigation: input.pkg.kind === "package.kb" ? packageNavigation(input.pkg) : null,
    },
    approved_knowledge: {
      count: input.selected.length,
      files: inventory.items.map((item) => ({
        path: item.path,
        collection: item.internalCollection,
        internal_collection: item.internalCollection,
        okf_root: item.okf_root,
        okf_root_path: item.okf_root_path,
        approved_path: item.sourcePath,
        dist_path: item.path,
        selected_by: selectedByForApprovedPath(item.sourcePath),
        path_within_collection: item.pathWithinCollection,
        node_ref: item.node_ref,
        view_ref: item.view_ref,
        title: item.title,
        type: item.type,
        group: item.group,
        source: item.source,
        ...(item.production_metadata === undefined
          ? {}
          : { production_metadata: item.production_metadata }),
      })),
      groups: inventory.groups.map((group) => ({
        name: group.name,
        collection: group.collection,
        internal_collection: group.internalCollection,
        okf_root: group.okf_root,
        okf_root_path: group.okf_root_path,
        count: group.count,
        edge_count: collectionEdges.get(group.internalCollection)?.length ?? 0,
        has_index: group.hasIndex,
        index_path: group.hasIndex ? group.indexPath : null,
        selected_by: uniqueSelectedBy(group.items.map((item) => item.sourcePath)),
        edge_contract: collectionEdgeContract(group.internalCollection),
      })),
      collections: collectionSummaries,
    },
    ...(input.documentOptimization === undefined
      ? {}
      : {
          document_optimization: {
            enabled: input.documentOptimization.enabled,
            policy: input.documentOptimization.policy,
            current: input.documentOptimization.current,
            eligible_fragments: input.documentOptimization.eligible_fragments,
            optimized_fragments: input.documentOptimization.optimized_fragments,
            kept_fragments: input.documentOptimization.kept_fragments,
            override_fragments: input.documentOptimization.override_fragments,
          },
        }),
    structure: {
      path: input.structure.path,
      scope: "selected-package",
      present: input.structure.content !== null,
      sha256: input.structure.sha256,
      nodes: input.structure.nodes,
      edges: input.structure.edges,
      edge_records_scope: "selected-package",
      edge_records: packageEdgeRecords,
      relationship_coverage: codegraphRelationshipCoverage({
        views: packageViewRecords,
        edges: packageEdgeRecords,
      }),
      edge_contract: {
        validation_scope: input.structure.edgeContract.validationScope,
        valid: input.structure.edgeContract.valid,
        checked: input.structure.edgeContract.checked,
        allowed_types: input.structure.edgeContract.allowedTypes,
        allowed_confidence: input.structure.edgeContract.allowedConfidence,
        source_ref_validation: sourceRefValidation,
      },
    },
  };
}

export async function writePackageBuildInventory(input: {
  projectRoot: string;
  pkg: PackageDefinition;
  inventory: Record<string, unknown>;
}): Promise<number> {
  const outputPath = join(input.projectRoot, input.pkg.outDir, PACKAGE_BUILD_INVENTORY_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(input.inventory, null, 2)}\n`, "utf8");
  return 1;
}
