import { z } from "zod";
import {
  validateIndexerAuthorDependencyView,
  type IndexerAuthorDependencyView,
} from "./indexerDependencyView.js";
import {
  indexerCanonicalRefSchema,
  validateIndexerLayerCompositionInput,
} from "./indexerLayerComposition.js";
import {
  canonicalIndexerInventoryMembers,
  indexerInventoryMembersDigest,
  type IndexerInventoryMember,
} from "./indexerInventoryDisposition.js";
import {
  validateIndexerMainRunRequest,
  type IndexerMainRunRequest,
} from "./indexerMainRunProtocol.js";
import {
  validateIndexerParserFactView,
  type IndexerParserFactView,
} from "./indexerParserFactView.js";
import {
  validateAuthorizedIndexerToolSnapshot,
  type ExpectedIndexerToolSnapshotRead,
} from "./indexerToolSnapshot.js";
import {
  addDuplicateIssues,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";

function isIndexerJson(
  value: unknown,
  ancestors = new WeakSet<object>(),
): value is IndexerJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value) || !isIndexerJson(value[index], ancestors)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every((item) =>
      isIndexerJson(item, ancestors)
    );
  } finally {
    ancestors.delete(value);
  }
}

const canonicalJsonSchema = z.custom<IndexerJson>(isIndexerJson, {
  message: "must be finite JSON data",
});

const provenanceSchema = z.object({
  protocol: z.string().min(1),
  digest: indexerDigestSchema,
  container_ref: indexerCanonicalRefSchema.optional(),
}).strict();

const itemPayloadSchema = z.object({
  ref: indexerCanonicalRefSchema,
  category: indexerIdSchema,
  provenance: provenanceSchema,
  value: canonicalJsonSchema,
}).strict();

export const indexerAuthorizedWorksetViewItemSchema = itemPayloadSchema.extend({
  item_digest: indexerDigestSchema,
}).strict();

export type IndexerAuthorizedWorksetViewItem = z.infer<
  typeof indexerAuthorizedWorksetViewItemSchema
>;

const authorizedWorksetViewSourceFields = {
  protocol: z.literal("context.indexer.authorized-workset-view-source/v1"),
  projection_kind: indexerIdSchema,
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  stage: z.enum(["partition", "author"]),
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  input_digests: z.array(indexerDigestSchema).min(1),
  items: z.array(indexerAuthorizedWorksetViewItemSchema),
};

const authorizedWorksetViewSourcePayloadSchema = z.object(
  authorizedWorksetViewSourceFields,
).strict();

export const indexerAuthorizedWorksetViewSourceSchema = z.object({
  ...authorizedWorksetViewSourceFields,
  source_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.input_digests, context, "input_digests");
  addDuplicateIssues(value.items.map((item) => item.ref), context, "items.ref");
});

export type IndexerAuthorizedWorksetViewSource = z.infer<
  typeof indexerAuthorizedWorksetViewSourceSchema
>;

const authorizedWorksetViewFields = {
  protocol: z.literal("context.indexer.authorized-workset-view/v1"),
  operation: z.literal("main-index"),
  stage: z.enum(["partition", "author"]),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  projection_input_digests: z.array(indexerDigestSchema).min(1),
  items: z.array(indexerAuthorizedWorksetViewItemSchema).min(1),
};

export const indexerAuthorizedWorksetViewSchema = z.object({
  ...authorizedWorksetViewFields,
  view_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.projection_input_digests,
    context,
    "projection_input_digests",
  );
  addDuplicateIssues(value.items.map((item) => item.ref), context, "items.ref");
});

export type IndexerAuthorizedWorksetView = z.infer<
  typeof indexerAuthorizedWorksetViewSchema
>;

export interface IndexerAuthorizedWorksetViewProjection {
  view: IndexerAuthorizedWorksetView;
}

type ViewPayload = Omit<IndexerAuthorizedWorksetView, "view_digest">;
type ItemPayload = Omit<IndexerAuthorizedWorksetViewItem, "item_digest">;
type SourcePayload = Omit<IndexerAuthorizedWorksetViewSource, "source_digest">;

export type IndexerAuthorizedWorksetViewSourceItemInput = ItemPayload;

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique values`);
  }
  return sorted;
}

function canonicalItem(value: ItemPayload): IndexerAuthorizedWorksetViewItem {
  const payload = itemPayloadSchema.parse(value);
  return indexerAuthorizedWorksetViewItemSchema.parse({
    ...payload,
    item_digest: indexerProtocolDigest({
      ref: payload.ref,
      value: readItemPayloadValue(payload),
    }),
  });
}

function canonicalSource(
  value: SourcePayload,
): IndexerAuthorizedWorksetViewSource {
  const payload = authorizedWorksetViewSourcePayloadSchema.parse({
    ...value,
    input_digests: canonicalUnique(value.input_digests, "source.input_digests"),
    items: canonicalItems(value.items),
  });
  return indexerAuthorizedWorksetViewSourceSchema.parse({
    ...payload,
    source_digest: indexerProtocolDigest(payload),
  });
}

function readItemPayloadValue(input: {
  category: string;
  provenance: z.infer<typeof provenanceSchema>;
  value: IndexerJson;
}): IndexerJson {
  return canonicalJsonSchema.parse({
    category: input.category,
    provenance: {
      protocol: input.provenance.protocol,
      digest: input.provenance.digest,
      ...(input.provenance.container_ref === undefined
        ? {}
        : { container_ref: input.provenance.container_ref }),
    },
    value: input.value,
  });
}

function parserViewMatchesWorkset(input: {
  view: IndexerParserFactView;
  request: IndexerMainRunRequest;
}): void {
  const workset = input.request.workset;
  const expectedModules = workset.module_ref === null ? [] : [workset.module_ref];
  if (
    input.view.authorized_scope.source_ref !== workset.source_ref ||
    input.view.authorized_scope.module_refs.length !== expectedModules.length ||
    input.view.authorized_scope.module_refs.some(
      (moduleRef, index) => moduleRef !== expectedModules[index],
    )
  ) {
    throw new TypeError("parser Fact View does not match the current workset source/module");
  }
}

function authorDependencyView(input: {
  request: IndexerMainRunRequest;
  dependency_view?: unknown;
}): IndexerAuthorDependencyView | null {
  if (input.request.workset.stage === "partition") {
    if (input.dependency_view !== undefined) {
      throw new TypeError("partition workset cannot carry an author dependency view");
    }
    return null;
  }
  if (input.dependency_view === undefined) {
    throw new TypeError("author workset requires its exact dependency view");
  }
  const view = validateIndexerAuthorDependencyView(input.dependency_view);
  const workset = input.request.workset;
  if (
    view.view_digest !== workset.group_dependency_view_digest ||
    view.source_ref !== workset.source_ref ||
    view.module_ref !== workset.module_ref ||
    view.logical_unit_ref !== workset.logical_unit_ref
  ) {
    throw new TypeError("author dependency view does not match the current workset");
  }
  return view;
}

function parserItems(input: {
  view: IndexerParserFactView;
  dependencyView: IndexerAuthorDependencyView | null;
}): IndexerAuthorizedWorksetViewItem[] {
  const selectedFactRefs = input.dependencyView === null
    ? null
    : new Set(input.dependencyView.positive_nodes.flatMap((node) =>
        node.kind === "selected-fact" ? [node.fact_ref] : []
      ));
  return input.view.files.flatMap((file) =>
    file.facts.flatMap((fact) =>
      selectedFactRefs !== null && !selectedFactRefs.has(fact.fact_ref)
        ? []
        : [canonicalItem({
            ref: fact.fact_ref,
            category: "fact",
            provenance: {
              protocol: input.view.protocol,
              digest: input.view.view_digest,
              container_ref: file.file_ref,
            },
            value: canonicalJsonSchema.parse(fact),
          })]
    )
  );
}

function dependencyItems(
  view: IndexerAuthorDependencyView | null,
): IndexerAuthorizedWorksetViewItem[] {
  if (view === null) return [];
  return [...view.positive_nodes, ...view.negative_nodes].map((node) =>
    canonicalItem({
      ref: node.node_ref,
      category: "dependency",
      provenance: {
        protocol: view.protocol,
        digest: view.view_digest,
        container_ref: view.logical_unit_ref,
      },
      value: canonicalJsonSchema.parse(node),
    })
  );
}

function compositionItems(
  request: IndexerMainRunRequest,
): IndexerAuthorizedWorksetViewItem[] {
  const composition = validateIndexerLayerCompositionInput(request.composition_input);
  return composition.accepted_fragments.flatMap((fragment) => {
    if (fragment.payload.protocol === "context.indexer.fragment.fact-enrichment/v1") {
      return fragment.payload.facts.map((fact) => {
        const ref = `layer-fact:${fragment.fragment_digest}/${fact.fact_id}`;
        return canonicalItem({
          ref,
          category: "fact",
          provenance: {
            protocol: composition.protocol,
            digest: composition.view_digest,
            container_ref: fragment.layer_ref,
          },
          value: canonicalJsonSchema.parse({
            fact_ref: ref,
            kind: fact.fact_id,
            payload: fact.value,
            source_fact_refs: fact.evidence_refs.map((item) => item.ref),
          }),
        });
      });
    }
    return [canonicalItem({
      ref: `layer-fragment:${fragment.fragment_digest}`,
      category: "provider-fragment",
      provenance: {
        protocol: composition.protocol,
        digest: composition.view_digest,
        container_ref: fragment.layer_ref,
      },
      value: canonicalJsonSchema.parse(fragment),
    })];
  });
}

function canonicalItems(
  values: readonly IndexerAuthorizedWorksetViewItem[],
): IndexerAuthorizedWorksetViewItem[] {
  const sorted = [...values].sort((left, right) =>
    compareIndexerCanonicalText(left.ref, right.ref)
  );
  if (new Set(sorted.map((item) => item.ref)).size !== sorted.length) {
    throw new TypeError("authorized workset projection contains duplicate item refs");
  }
  return sorted;
}

function sourcePayload(
  value: IndexerAuthorizedWorksetViewSource,
): SourcePayload {
  return {
    protocol: value.protocol,
    projection_kind: value.projection_kind,
    workset_digest: value.workset_digest,
    execution_request_digest: value.execution_request_digest,
    stage: value.stage,
    source_ref: value.source_ref,
    module_ref: value.module_ref,
    input_digests: value.input_digests,
    items: value.items,
  };
}

export function validateIndexerAuthorizedWorksetViewSource(
  value: unknown,
): IndexerAuthorizedWorksetViewSource {
  const source = indexerAuthorizedWorksetViewSourceSchema.parse(value);
  const rebuilt = canonicalSource(sourcePayload(source));
  if (rebuilt.source_digest !== source.source_digest) {
    throw new TypeError("authorized workset projection source digest is invalid");
  }
  if (
    rebuilt.input_digests.some((digest, index) =>
      digest !== source.input_digests[index]
    ) ||
    rebuilt.items.some((item, index) => item.ref !== source.items[index]?.ref)
  ) {
    throw new TypeError("authorized workset projection source must use canonical ordering");
  }
  return source;
}

export function buildIndexerAuthorizedWorksetViewSource(input: {
  request: unknown;
  projection_kind: string;
  input_digests: readonly string[];
  items: readonly IndexerAuthorizedWorksetViewSourceItemInput[];
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  return canonicalSource({
    protocol: "context.indexer.authorized-workset-view-source/v1",
    projection_kind: input.projection_kind,
    workset_digest: request.workset.workset_digest,
    execution_request_digest: request.execution_request_digest,
    stage: request.workset.stage,
    source_ref: request.workset.source_ref,
    module_ref: request.workset.module_ref,
    input_digests: [...input.input_digests],
    items: input.items.map((item) => canonicalItem({
      ref: item.ref,
      category: item.category,
      provenance: item.provenance,
      value: item.value,
    })),
  });
}

export function buildIndexerParserWorksetViewSource(input: {
  request: unknown;
  parser_fact_view: unknown;
  dependency_view?: unknown;
}): IndexerAuthorizedWorksetViewSource[] {
  const request = validateIndexerMainRunRequest(input.request);
  const parserFactView = validateIndexerParserFactView(input.parser_fact_view);
  parserViewMatchesWorkset({ view: parserFactView, request });
  const dependencyView = authorDependencyView({
    request,
    ...(input.dependency_view === undefined
      ? {}
      : { dependency_view: input.dependency_view }),
  });
  const sources = [buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "parser-facts",
    input_digests: [
      parserFactView.view_digest,
      ...(dependencyView === null ? [] : [dependencyView.view_digest]),
    ],
    items: parserItems({ view: parserFactView, dependencyView }),
  })];
  if (dependencyView !== null) {
    sources.push(buildIndexerAuthorDependencyWorksetViewSource({
      request,
      dependency_view: dependencyView,
    }));
  }
  return sources;
}

export function buildIndexerAuthorDependencyWorksetViewSource(input: {
  request: unknown;
  dependency_view: unknown;
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  const dependencyView = authorDependencyView({
    request,
    dependency_view: input.dependency_view,
  });
  if (dependencyView === null) {
    throw new TypeError("partition workset cannot project author dependencies");
  }
  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "author-dependencies",
    input_digests: [dependencyView.view_digest],
    items: dependencyItems(dependencyView),
  });
}

export function buildIndexerCompositionWorksetViewSource(input: {
  request: unknown;
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "provider-fragments",
    input_digests: [request.composition_input.view_digest],
    items: compositionItems(request),
  });
}

export function buildIndexerInventoryWorksetViewSource(input: {
  request: unknown;
  canonical_inventory_members: readonly IndexerInventoryMember[];
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  const members = canonicalIndexerInventoryMembers(input.canonical_inventory_members);
  const inventoryDigest = indexerInventoryMembersDigest(members);
  const expectedDigest = request.workset.stage === "partition"
    ? request.workset.partition_inventory_digest
    : request.workset.member_inventory_digest;
  if (inventoryDigest !== expectedDigest) {
    throw new TypeError("inventory member projection does not match the current workset");
  }
  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "inventory-members",
    input_digests: [inventoryDigest],
    items: members.map((member) => ({
      ref: `inventory-member:${indexerProtocolDigest(member)}`,
      category: "inventory-member",
      provenance: {
        protocol: request.workset.protocol,
        digest: inventoryDigest,
        container_ref: request.workset.source_ref,
      },
      value: member,
    })),
  });
}

export function buildIndexerToolSnapshotWorksetViewSource(input: {
  request: unknown;
  snapshot: unknown;
  read_receipt: unknown;
  expected_read: ExpectedIndexerToolSnapshotRead;
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  const { snapshot, receipt } = validateAuthorizedIndexerToolSnapshot({
    value: input.snapshot,
    receipt: input.read_receipt,
    expected: input.expected_read,
  });
  if (
    snapshot.source.source_ref !== request.workset.source_ref ||
    snapshot.source.module_ref !== request.workset.module_ref
  ) {
    throw new TypeError("tool snapshot does not match the current workset source/module");
  }
  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "tool-snapshots",
    input_digests: [
      snapshot.source.input_digest,
      snapshot.snapshot_digest,
      receipt.receipt_digest,
    ],
    items: [{
      ref: `tool-snapshot:${snapshot.snapshot_digest}`,
      category: "tool-snapshot",
      provenance: {
        protocol: snapshot.protocol,
        digest: snapshot.snapshot_digest,
        container_ref: snapshot.resource.identity,
      },
      value: canonicalJsonSchema.parse(snapshot),
    }],
  });
}

export function buildIndexerMainRunWorksetViewSources(input: {
  request: unknown;
  source_projection_sources: readonly unknown[];
  canonical_inventory_members: readonly IndexerInventoryMember[];
}): IndexerAuthorizedWorksetViewSource[] {
  const request = validateIndexerMainRunRequest(input.request);
  const sourceProjectionSources = input.source_projection_sources.map(
    validateIndexerAuthorizedWorksetViewSource,
  );
  if (sourceProjectionSources.length === 0) {
    throw new TypeError("main run workset View requires a source adapter projection");
  }
  return [
    ...sourceProjectionSources,
    buildIndexerInventoryWorksetViewSource({
      request,
      canonical_inventory_members: input.canonical_inventory_members,
    }),
    buildIndexerCompositionWorksetViewSource({ request: input.request }),
  ];
}

export function indexerAuthorizedWorksetViewDigest(value: ViewPayload): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerAuthorizedWorksetView(input: {
  request: unknown;
  projection_sources: readonly unknown[];
}): IndexerAuthorizedWorksetViewProjection {
  const request = validateIndexerMainRunRequest(input.request);
  const sources = input.projection_sources
    .map(validateIndexerAuthorizedWorksetViewSource)
    .sort((left, right) => compareIndexerCanonicalText(
      `${left.projection_kind}\u0000${left.source_digest}`,
      `${right.projection_kind}\u0000${right.source_digest}`,
    ));
  if (sources.length === 0) {
    throw new TypeError("authorized workset projection requires at least one source");
  }
  const sourceIdentities = sources.map((source) =>
    `${source.projection_kind}\u0000${source.source_digest}`
  );
  if (new Set(sourceIdentities).size !== sourceIdentities.length) {
    throw new TypeError("authorized workset projection contains duplicate sources");
  }
  for (const source of sources) {
    if (
      source.workset_digest !== request.workset.workset_digest ||
      source.execution_request_digest !== request.execution_request_digest ||
      source.stage !== request.workset.stage ||
      source.source_ref !== request.workset.source_ref ||
      source.module_ref !== request.workset.module_ref
    ) {
      throw new TypeError("authorized workset projection source escapes the current run");
    }
  }
  const items = canonicalItems(sources.flatMap((source) => source.items));
  if (items.length === 0) {
    throw new TypeError("authorized workset projection contains no readable evidence");
  }
  const projectionInputDigests = [...new Set(
    sources.flatMap((source) => [source.source_digest, ...source.input_digests]),
  )].sort(compareIndexerCanonicalText);
  const payload: ViewPayload = {
    protocol: "context.indexer.authorized-workset-view/v1",
    operation: "main-index",
    stage: request.workset.stage,
    workset_digest: request.workset.workset_digest,
    execution_request_digest: request.execution_request_digest,
    source_ref: request.workset.source_ref,
    module_ref: request.workset.module_ref,
    projection_input_digests: projectionInputDigests,
    items,
  };
  const view = indexerAuthorizedWorksetViewSchema.parse({
    ...payload,
    view_digest: indexerAuthorizedWorksetViewDigest(payload),
  });
  return { view };
}

export function validateIndexerAuthorizedWorksetView(
  value: unknown,
): IndexerAuthorizedWorksetView {
  const view = indexerAuthorizedWorksetViewSchema.parse(value);
  const projectionInputDigests = canonicalUnique(
    view.projection_input_digests,
    "projection_input_digests",
  );
  if (projectionInputDigests.some((digest, index) =>
    digest !== view.projection_input_digests[index]
  )) {
    throw new TypeError("projection_input_digests must use canonical ordering");
  }
  const items = canonicalItems(view.items.map((item) => {
    const payload: ItemPayload = {
      ref: item.ref,
      category: item.category,
      provenance: item.provenance,
      value: item.value,
    };
    const rebuilt = canonicalItem(payload);
    if (rebuilt.item_digest !== item.item_digest) {
      throw new TypeError(`authorized workset item digest is invalid: ${item.ref}`);
    }
    return rebuilt;
  }));
  if (items.some((item, index) => item.ref !== view.items[index]?.ref)) {
    throw new TypeError("authorized workset items must use canonical ordering");
  }
  const payload: ViewPayload = {
    protocol: view.protocol,
    operation: view.operation,
    stage: view.stage,
    workset_digest: view.workset_digest,
    execution_request_digest: view.execution_request_digest,
    source_ref: view.source_ref,
    module_ref: view.module_ref,
    projection_input_digests: view.projection_input_digests,
    items: view.items,
  };
  if (indexerAuthorizedWorksetViewDigest(payload) !== view.view_digest) {
    throw new TypeError("authorized workset View digest is invalid");
  }
  return view;
}

export function validateIndexerAuthorizedWorksetProjection(input: {
  request: unknown;
  view: unknown;
}): IndexerAuthorizedWorksetViewProjection {
  const request = validateIndexerMainRunRequest(input.request);
  const view = validateIndexerAuthorizedWorksetView(input.view);
  if (
    view.workset_digest !== request.workset.workset_digest ||
    view.execution_request_digest !== request.execution_request_digest ||
    view.stage !== request.workset.stage ||
    view.source_ref !== request.workset.source_ref ||
    view.module_ref !== request.workset.module_ref
  ) {
    throw new TypeError("authorized workset projection does not bind the current run request");
  }
  return { view };
}
