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
  buildCapturedDocumentWorksetViewSource,
  capturedDocumentIndexerRef,
} from "./indexerWorksetEvidenceProjection.js";
import { readDocumentSourcesRegistry } from "./documentSources.js";
import {
  type IndexerParserRuntimeExecutionReceipt,
  type IndexerParserRuntimeSourceBinding,
} from "./indexerParserRuntimeExecution.js";
import { ensureCurrentProjectIndexerParserExecution } from
  "./indexerParserCurrentExecution.js";

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
  execution: IndexerParserRuntimeExecutionReceipt;
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

export async function resolveProjectIndexerMainSourceBinding(input: {
  projectRoot: string;
  indexer_id: unknown;
  source_ref: unknown;
  module_ref: unknown;
  profile_contract_digest: unknown;
  parser_execution?: IndexerParserRuntimeExecutionReceipt;
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
  const execution = input.parser_execution ??
    await ensureCurrentProjectIndexerParserExecution({
      projectRoot: input.projectRoot,
      indexer_id: currentIndexerId,
    });
  if (execution.profile_contract_digest !== profileContractDigest) {
    throw new TypeError("main Indexer source targets another parser profile contract");
  }
  const binding = parserSourceBinding({
    execution,
    source_ref: sourceRef,
    module_ref: sourceModuleRef,
  });
  const factView = parserFactView({ execution, binding });
  return {
    adapter: "parser-facts",
    source_ref: sourceRef,
    module_ref: sourceModuleRef,
    profile_contract_digest: execution.profile_contract_digest,
    source_binding_digest: binding.binding_digest,
    source_snapshot_digest: binding.source_identity_inventory.source_input_digest,
    partition_inventory: buildIndexerPartitionInventoryFromParserFactView(factView),
    partition_input_digests: parserBindingInputDigests(binding),
    source_identity_inventory: binding.source_identity_inventory,
    execution,
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
  author_inventory_members?: readonly IndexerInventoryMember[];
  partition_inventory_members?: readonly IndexerInventoryMember[];
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
    if (dependencyView !== null) {
      if (request.workset.stage !== "author") {
        throw new TypeError("partition workset cannot carry an author dependency view");
      }
      if (
        dependencyView.view_digest !== request.workset.group_dependency_view_digest ||
        dependencyView.source_ref !== request.workset.source_ref ||
        dependencyView.module_ref !== request.workset.module_ref ||
        dependencyView.logical_unit_ref !== request.workset.logical_unit_ref
      ) {
        throw new TypeError("author dependency view does not match the current workset");
      }
    }
    const partitionMemberIds = new Set(
      input.partition_inventory_members === undefined
        ? []
        : canonicalIndexerInventoryMembers(input.partition_inventory_members)
          .map((member) => member.member_id),
    );
    const selectedFactRefs = dependencyView === null
      ? input.partition_inventory_members === undefined
        ? [...binding.parser_fact_index.keys()]
        : [...binding.parser_fact_index.keys()].filter((factRef) =>
            partitionMemberIds.has(factRef)
          )
      : dependencyView.positive_nodes.flatMap((node) =>
        node.kind === "selected-fact" ? [node.fact_ref] : []
      );
    const selectedFacts = selectedFactRefs.map((factRef) => {
      const indexed = binding.parser_fact_index.get(factRef);
      if (indexed === undefined) {
        throw new TypeError(`author dependency view selects an unknown parser Fact: ${factRef}`);
      }
      return indexed;
    });
    const authorMemberIds = new Set(
      input.author_inventory_members === undefined
        ? []
        : canonicalIndexerInventoryMembers(input.author_inventory_members)
          .map((member) => member.member_id),
    );
    const selectedFileDescriptors = binding.parser_fact_view.files.filter((file) =>
      request.workset.stage === "partition"
        ? input.partition_inventory_members === undefined ||
          partitionMemberIds.has(file.file_ref)
        : file.facts.length === 0 && authorMemberIds.has(file.file_ref)
    );
    const sources = [buildIndexerAuthorizedWorksetViewSource({
      request,
      projection_kind: "parser-facts",
      input_digests: dependencyView === null
        ? [binding.parser_fact_view.view_digest]
        : [dependencyView.view_digest],
      items: [
        ...selectedFacts.map(({ file_ref, fact }) => ({
          ref: fact.fact_ref,
          category: "fact",
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
          value: file,
        })),
      ],
    })];
    if (dependencyView !== null) {
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
  const scopedDocumentMembers = input.author_inventory_members ??
    input.partition_inventory_members;
  const authorizedDocumentPaths = scopedDocumentMembers === undefined
    ? input.binding.authorized_document_paths
    : canonicalIndexerInventoryMembers(scopedDocumentMembers).map((member) => {
        if (member.member_kind !== "document") {
          throw new TypeError("captured document author inventory contains a non-document member");
        }
        const path = documentsByRef.get(member.member_id);
        if (path === undefined) {
          throw new TypeError("captured document author inventory contains an unknown member");
        }
        return path;
      });
  const sources = [await buildCapturedDocumentWorksetViewSource({
    projectRoot: input.projectRoot,
    request: input.request,
    evidence: input.binding.evidence,
    authorized_document_paths: authorizedDocumentPaths,
  })];
  if (input.dependency_view !== undefined) {
    sources.push(buildIndexerAuthorDependencyWorksetViewSource({
      request: input.request,
      dependency_view: input.dependency_view,
    }));
  }
  return sources;
}
