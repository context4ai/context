import {
  buildIndexerAuthorDependencyWorksetViewSource,
  buildIndexerAuthorizedWorksetViewSource,
  buildIndexerPartitionInventoryFromParserFactView,
  buildIndexerSourceIdentityInventory,
  canonicalIndexerInventoryMembers,
  indexerInventoryMembersDigest,
  indexerProtocolDigest,
  validateIndexerAuthorDependencyView,
  validateIndexerMainRunRequest,
  type IndexerAuthorizedWorksetViewSource,
  type IndexerInventoryMember,
  type IndexerParserFact,
  type IndexerParserFactView,
  type IndexerSourceIdentityInventory,
} from "@c4a/context";
import {
  buildCommittedEvidenceIndex,
  type BuildCommittedEvidenceIndexResult,
} from "./documentEvidenceIndex.js";
import {
  buildCapturedDocumentEnrichmentWorksetViewSource,
  buildCapturedDocumentWorksetViewSource,
  capturedDocumentIndexerRef,
} from "./indexerWorksetEvidenceProjection.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import {
  type IndexerParserRuntimeExecutionReceipt,
  type IndexerParserRuntimeSourceBinding,
} from "./indexerParserRuntimeExecution.js";
import { ensureCurrentProjectIndexerParserSourceSlice, ensureCurrentProjectIndexerParserSourceIdentity } from
  "./indexerParserCurrentExecution.js";
import {
  validateIndexerConsumerWorksetProjection,
  type IndexerConsumerWorksetProjection,
} from "./indexerConsumerWorksetPlanner.js";
import type { IndexerParserSourceSelection } from "./indexerParserRuntimeIndex.js";
import { buildProjectIndexerAuthorSourceText } from "./indexerAuthorSourceText.js";

interface ProjectIndexerMainSourceBindingBase {
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
  source_binding_digest: string;
  source_snapshot_digest: string;
  partition_inventory: IndexerInventoryMember[];
  partition_input_digests: string[];
  source_identity_inventory: IndexerSourceIdentityInventory;
}

export interface ProjectIndexerParserFactsSourceBinding
  extends ProjectIndexerMainSourceBindingBase {
  adapter: "parser-facts";
  parser_binding: IndexerParserRuntimeSourceBinding;
  parser_fact_view: IndexerParserFactView;
  parser_fact_index: ReadonlyMap<string, {
    file_ref: string;
    fact: IndexerParserFact;
  }>;
}

export interface ProjectIndexerCapturedDocumentsSourceBinding
  extends ProjectIndexerMainSourceBindingBase {
  adapter: "captured-documents";
  evidence: BuildCommittedEvidenceIndexResult;
  authorized_document_paths: string[];
}

export type ProjectIndexerMainSourceBinding =
  | ProjectIndexerParserFactsSourceBinding
  | ProjectIndexerCapturedDocumentsSourceBinding;

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function moduleRef(value: unknown): string | null {
  if (value === null) return null;
  return requiredText(value, "main Indexer source module_ref");
}

function parserSourceBinding(input: {
  execution: IndexerParserRuntimeExecutionReceipt;
  source_ref: string;
  module_ref: string | null;
}): IndexerParserRuntimeSourceBinding {
  const matches = input.execution.source_bindings.filter((binding) =>
    binding.source_ref === input.source_ref && binding.module_ref === input.module_ref
  );
  if (matches.length !== 1) {
    throw new TypeError("main Indexer source requires one exact parser source binding");
  }
  return matches[0]!;
}

function parserFactView(input: {
  execution: IndexerParserRuntimeExecutionReceipt;
  binding: IndexerParserRuntimeSourceBinding;
}): IndexerParserFactView {
  const expectedModules = input.binding.module_ref === null
    ? []
    : [input.binding.module_ref];
  const matches = input.execution.fact_views.filter((view) =>
    view.authorized_scope.source_ref === input.binding.source_ref &&
    view.authorized_scope.module_refs.length === expectedModules.length &&
    view.authorized_scope.module_refs.every(
      (candidate, index) => candidate === expectedModules[index],
    )
  );
  if (matches.length !== 1) {
    throw new TypeError("main Indexer source requires one exact parser Fact View");
  }
  return matches[0]!;
}

function parserBindingInputDigests(
  binding: IndexerParserRuntimeSourceBinding,
): string[] {
  return [
    binding.eligible_inventory_digest,
    binding.source_merge_digest,
    binding.source_toolchain_digest,
    binding.source_identity_inventory.inventory_digest,
  ].sort();
}

function parserFactIndex(view: IndexerParserFactView): ReadonlyMap<string, {
  file_ref: string;
  fact: IndexerParserFact;
}> {
  const index = new Map<string, { file_ref: string; fact: IndexerParserFact }>();
  for (const file of view.files) {
    for (const fact of file.facts) index.set(fact.fact_ref, { file_ref: file.file_ref, fact });
  }
  return index;
}

function capturedDocumentCoordinates(sourceRef: string): {
  sourceType: "file" | "lark";
  sourceName: string;
} | null {
  const separator = sourceRef.indexOf(":");
  if (separator < 1) return null;
  const sourceType = sourceRef.slice(0, separator);
  if (sourceType !== "file" && sourceType !== "lark") return null;
  const sourceName = sourceRef.slice(separator + 1);
  if (sourceName.length === 0) {
    throw new TypeError("captured document source_ref requires a source name");
  }
  return { sourceType, sourceName };
}

async function capturedDocumentsBinding(input: {
  projectRoot: string;
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
}): Promise<ProjectIndexerCapturedDocumentsSourceBinding> {
  const coordinates = capturedDocumentCoordinates(input.source_ref);
  if (coordinates === null) {
    throw new TypeError("main Indexer source is not a captured document source");
  }
  if (input.module_ref !== null) {
    throw new TypeError("captured document main Indexer source cannot bind a code module");
  }
  const registry = await readDocumentSourcesRegistry(input.projectRoot);
  const entries = coordinates.sourceType === "file" ? registry.files : registry.larks;
  const matchingEntries = entries.filter((entry) =>
    entry.name === coordinates.sourceName || entry.id === coordinates.sourceName
  );
  if (matchingEntries.length !== 1) {
    throw new TypeError(
      `captured document main Indexer source must resolve exactly once in sources/${coordinates.sourceType}/index.yaml`,
    );
  }
  const source = matchingEntries[0]!;
  const evidence = await buildCommittedEvidenceIndex({
    projectRoot: input.projectRoot,
    sourceType: coordinates.sourceType,
    sourceName: source.name,
    materializedAt: source.materializedAt,
    manifestPath: source.snapshot?.manifest ?? `${source.materializedAt}/manifest.json`,
  });
  const authorizedDocumentPaths = evidence.index.documents
    .map((document) => document.path)
    .sort();
  if (authorizedDocumentPaths.length === 0) {
    throw new TypeError("captured document main Indexer source contains no documents");
  }
  const sourceInputDigest = indexerProtocolDigest({
    adapter: "captured-documents",
    source_ref: input.source_ref,
    snapshot_hash: evidence.index.snapshot_hash,
    documents: evidence.index.documents.map((document) => ({
      path: document.path,
      ...(document.source_path === undefined
        ? {}
        : { source_path: document.source_path }),
      content_hash: document.content_hash,
      canonical_locator: document.canonical_locator,
    })),
  });
  const sourceIdentityInventory = buildIndexerSourceIdentityInventory({
    source_ref: input.source_ref,
    module_ref: null,
    source_input_digest: sourceInputDigest,
    files: evidence.index.documents.map((document) => ({
      normalized_path: document.path,
      content_digest: document.content_hash,
      facts: [],
    })),
  });
  const partitionInventory = canonicalIndexerInventoryMembers(
    evidence.index.documents.map((document) => ({
      member_id: capturedDocumentIndexerRef({
        source_ref: input.source_ref,
        path: document.path,
      }),
      member_kind: "document" as const,
    })),
  );
  const partitionInventoryDigest = indexerInventoryMembersDigest(partitionInventory);
  const sourceBindingDigest = indexerProtocolDigest({
    adapter: "captured-documents",
    source_ref: input.source_ref,
    module_ref: null,
    source_input_digest: sourceInputDigest,
    source_identity_inventory_digest: sourceIdentityInventory.inventory_digest,
    partition_inventory_digest: partitionInventoryDigest,
  });
  return {
    adapter: "captured-documents",
    source_ref: input.source_ref,
    module_ref: null,
    profile_contract_digest: input.profile_contract_digest,
    source_binding_digest: sourceBindingDigest,
    source_snapshot_digest: evidence.index.snapshot_hash,
    partition_inventory: partitionInventory,
    partition_input_digests: [
      sourceInputDigest,
      sourceIdentityInventory.inventory_digest,
      partitionInventoryDigest,
    ].sort(),
    source_identity_inventory: sourceIdentityInventory,
    evidence,
    authorized_document_paths: authorizedDocumentPaths,
  };
}

export async function resolveProjectIndexerMainSourceIdentity(input: {
  projectRoot: string;
  indexer_id: string;
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
}): Promise<IndexerSourceIdentityInventory> {
  return capturedDocumentCoordinates(input.source_ref) !== null
    ? (await capturedDocumentsBinding(input)).source_identity_inventory
    : ensureCurrentProjectIndexerParserSourceIdentity(input);
}

export async function resolveProjectIndexerMainSourceBinding(input: {
  projectRoot: string;
  indexer_id: unknown;
  source_ref: unknown;
  module_ref: unknown;
  profile_contract_digest: unknown;
  parser_execution?: IndexerParserRuntimeExecutionReceipt;
  parser_selection?: IndexerParserSourceSelection;
}): Promise<ProjectIndexerMainSourceBinding> {
  const currentIndexerId = requiredText(input.indexer_id, "main Indexer indexer_id");
  const sourceRef = requiredText(input.source_ref, "main Indexer source_ref");
  const sourceModuleRef = moduleRef(input.module_ref);
  const profileContractDigest = requiredText(
    input.profile_contract_digest,
    "main Indexer profile_contract_digest",
  );
  if (capturedDocumentCoordinates(sourceRef) !== null) {
    return capturedDocumentsBinding({
      projectRoot: input.projectRoot,
      source_ref: sourceRef,
      module_ref: sourceModuleRef,
      profile_contract_digest: profileContractDigest,
    });
  }
  const slice = input.parser_execution === undefined
    ? await ensureCurrentProjectIndexerParserSourceSlice({
      projectRoot: input.projectRoot,
      indexer_id: currentIndexerId,
      source_ref: sourceRef,
      module_ref: sourceModuleRef,
      profile_contract_digest: profileContractDigest,
      ...(input.parser_selection === undefined ? {} : { selection: input.parser_selection }),
    })
    : (() => {
        if (input.parser_execution!.profile_contract_digest !== profileContractDigest) {
          throw new TypeError("main Indexer source targets another parser profile contract");
        }
        const sourceBinding = parserSourceBinding({
          execution: input.parser_execution!,
          source_ref: sourceRef,
          module_ref: sourceModuleRef,
        });
        return {
          source_binding: sourceBinding,
          fact_view: parserFactView({
            execution: input.parser_execution!,
            binding: sourceBinding,
          }),
        };
      })();
  const binding = slice.source_binding;
  const factView = slice.fact_view;
  return {
    adapter: "parser-facts",
    source_ref: sourceRef,
    module_ref: sourceModuleRef,
    profile_contract_digest: profileContractDigest,
    source_binding_digest: binding.binding_digest,
    source_snapshot_digest: binding.source_identity_inventory.source_input_digest,
    partition_inventory: buildIndexerPartitionInventoryFromParserFactView(factView),
    partition_input_digests: parserBindingInputDigests(binding),
    source_identity_inventory: binding.source_identity_inventory,
    parser_binding: binding,
    parser_fact_view: factView,
    parser_fact_index: parserFactIndex(factView),
  };
}

export function assertProjectIndexerMainSourceBinding(input: {
  workset: Record<string, unknown>;
  binding: ProjectIndexerMainSourceBinding;
  dependency_view?: unknown;
}): void {
  const authorDependencyView = input.workset.stage === "author"
    ? validateIndexerAuthorDependencyView(input.dependency_view)
    : null;
  if (
    input.workset.source_ref !== input.binding.source_ref ||
    input.workset.module_ref !== input.binding.module_ref ||
    input.workset.profile_contract_digest !== input.binding.profile_contract_digest ||
    input.workset.source_binding_digest !== (
      authorDependencyView?.view_digest ?? input.binding.source_binding_digest
    )
  ) {
    throw new TypeError("main Indexer workset targets a stale source adapter binding");
  }
  if (input.workset.stage === "partition") {
    const supplied = new Set(
      Array.isArray(input.workset.partition_input_digests)
        ? input.workset.partition_input_digests
        : [],
    );
    if (input.binding.partition_input_digests.some((digest) => !supplied.has(digest))) {
      throw new TypeError("partition workset omits source adapter input digests");
    }
  }
}

export async function buildProjectIndexerMainSourceViewSources(input: {
  projectRoot: string;
  request: unknown;
  binding: ProjectIndexerMainSourceBinding;
  dependency_view?: unknown;
  registry?: unknown;
  supplementary?: boolean;
  author_inventory_members?: readonly IndexerInventoryMember[];
  partition_inventory_members?: readonly IndexerInventoryMember[];
  partition_projection?: unknown;
}): Promise<IndexerAuthorizedWorksetViewSource[]> {
  if (input.binding.adapter === "parser-facts") {
    const binding = input.binding;
    const request = validateIndexerMainRunRequest(input.request);
    const dependencyView = input.dependency_view === undefined
      ? null
      : validateIndexerAuthorDependencyView(input.dependency_view);
    if (request.workset.stage === "partition" && dependencyView !== null) {
      throw new TypeError("partition workset cannot carry an author dependency view");
    }
    if (request.workset.stage === "author" && dependencyView === null) {
      throw new TypeError("author workset requires its exact dependency view");
    }
    if (request.workset.stage === "partition" && input.partition_projection === undefined) {
      throw new TypeError("partition workset requires its consumer projection");
    }
    if (dependencyView !== null) {
      if (request.workset.stage !== "author") {
        throw new TypeError("partition workset cannot carry an author dependency view");
      }
      if (
        dependencyView.view_digest !== request.workset.group_dependency_view_digest ||
        dependencyView.logical_unit_ref !== request.workset.logical_unit_ref ||
        dependencyView.source_ref !== request.workset.source_ref ||
        dependencyView.module_ref !== request.workset.module_ref
      ) {
        throw new TypeError("author dependency view does not match the current workset");
      }
      if (
        input.supplementary === true &&
        !dependencyView.positive_nodes.some((node) =>
          node.kind === "source-span" && node.source_ref === binding.source_ref &&
          node.module_ref === binding.module_ref
        )
      ) {
        throw new TypeError("supplementary source is absent from the author dependency view");
      }
    }
    const partitionProjection: IndexerConsumerWorksetProjection | null =
      request.workset.stage === "partition"
        ? validateIndexerConsumerWorksetProjection({
            value: input.partition_projection,
            factView: binding.parser_fact_view,
            inventory: input.partition_inventory_members ?? [],
          })
        : null;
    const selectedFactItems = (dependencyView === null
      ? partitionProjection!.fact_items.filter((item) =>
          partitionProjection!.unresolved || item.role === "consumer-anchor"
        )
      : dependencyView.positive_nodes.flatMap((node) =>
        node.kind === "selected-fact"
          ? [{ fact_ref: node.fact_ref, role: "supporting-fact" as const }]
          : []
      )).filter((item) => binding.parser_fact_index.has(item.fact_ref));
    const selectedFacts = selectedFactItems.map((item) => {
      const factRef = item.fact_ref;
      const indexed = binding.parser_fact_index.get(factRef);
      if (indexed === undefined) {
        throw new TypeError(`source projection selects an unknown parser Fact: ${factRef}`);
      }
      return { ...indexed, role: item.role };
    });
    const authorSourcePaths = new Set(dependencyView?.positive_nodes.flatMap((node) =>
      node.kind === "source-span" && node.source_ref === binding.source_ref &&
          node.module_ref === binding.module_ref
        ? [node.locator.path]
        : []
    ) ?? []);
    const partitionFileRefs = new Set(partitionProjection?.file_refs ?? []);
    const selectedFileDescriptors = binding.parser_fact_view.files.filter((file) =>
      request.workset.stage === "partition"
        ? partitionFileRefs.has(file.file_ref)
        : file.facts.length === 0 && authorSourcePaths.has(file.normalized_path)
    );
    const sources = [buildIndexerAuthorizedWorksetViewSource({
      request,
      projection_kind: "parser-facts",
      input_digests: dependencyView === null
        ? [binding.parser_fact_view.view_digest]
        : [dependencyView.view_digest],
      items: [
        ...selectedFacts.map(({ file_ref, fact, role }) => ({
          ref: fact.fact_ref,
          category: request.workset.stage === "author" ? "fact" : role,
          provenance: {
            protocol: binding.parser_fact_view.protocol,
            digest: dependencyView?.view_digest ?? binding.parser_fact_view.view_digest,
            container_ref: file_ref,
          },
          value: fact,
        })),
        ...selectedFileDescriptors.map((file) => ({
          ref: file.file_ref,
          category: "parser-file",
          provenance: {
            protocol: binding.parser_fact_view.protocol,
            digest: dependencyView?.view_digest ?? binding.parser_fact_view.view_digest,
          },
          value: {
            file_ref: file.file_ref,
            source_ref: file.source_ref,
            module_ref: file.module_ref,
            normalized_path: file.normalized_path,
            disposition: file.disposition,
            fact_count: file.facts.length,
          },
        })),
      ],
    })];
    if (dependencyView !== null) {
      sources.push(await buildProjectIndexerAuthorSourceText({
        projectRoot: input.projectRoot, request, indexer_id: request.workset.indexer_id,
        registry: input.registry, binding, dependency_view: dependencyView,
      }));
    }
    if (dependencyView !== null && input.supplementary !== true) {
      sources.push(buildIndexerAuthorDependencyWorksetViewSource({
        request,
        dependency_view: dependencyView,
      }));
    }
    return sources;
  }
  const documentsByRef = new Map(input.binding.evidence.index.documents.map((document) => [
    capturedDocumentIndexerRef({
      source_ref: input.binding.source_ref,
      path: document.path,
    }),
    document.path,
  ]));
  const dependencyView = input.dependency_view === undefined
    ? null
    : validateIndexerAuthorDependencyView(input.dependency_view);
  const scopedDocumentMembers = input.partition_inventory_members;
  const authorizedDocumentPaths = dependencyView !== null
    ? dependencyView.positive_nodes.flatMap((node) =>
        node.kind === "source-span" && node.source_ref === input.binding.source_ref &&
            node.module_ref === null
          ? [node.locator.path]
          : []
      )
    : scopedDocumentMembers === undefined
    ? input.binding.authorized_document_paths
    : canonicalIndexerInventoryMembers(scopedDocumentMembers).map((member) => {
        if (member.member_kind !== "document") {
          throw new TypeError("captured document partition inventory contains a non-document member");
        }
        const path = documentsByRef.get(member.member_id);
        if (path === undefined) {
          throw new TypeError("captured document author inventory contains an unknown member");
        }
        return path;
      });
  if (authorizedDocumentPaths.length === 0) {
    throw new TypeError("captured document source has no dependency spans in the author workset");
  }
  const source = input.supplementary === true
    ? await buildCapturedDocumentEnrichmentWorksetViewSource({
        projectRoot: input.projectRoot,
        request: input.request,
        registry: input.registry,
        evidence: input.binding.evidence,
        authorized_document_paths: authorizedDocumentPaths,
      })
    : await buildCapturedDocumentWorksetViewSource({
        projectRoot: input.projectRoot,
        request: input.request,
        evidence: input.binding.evidence,
        authorized_document_paths: authorizedDocumentPaths,
      });
  const sources = [source];
  if (input.dependency_view !== undefined && input.supplementary !== true) {
    sources.push(buildIndexerAuthorDependencyWorksetViewSource({
      request: input.request,
      dependency_view: input.dependency_view,
    }));
  }
  return sources;
}
