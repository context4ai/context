import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  hostActionInputDigest,
  validateHostActionResult,
  type HostActionResourceLocation,
  type HostActionResult,
  type JsonValue,
} from "@c4a/agent-graph";
import {
  buildIndexerAuthorizedWorksetView,
  buildIndexerAuthorizedWorksetViewSource,
  buildIndexerInspectorWorksetViewSource,
  buildIndexerMainRunWorksetViewSources,
  canonicalIndexerInventoryMembers,
  canonicalIndexerJson,
  indexerInventoryMembersDigest,
  indexerProtocolDigest,
  loadIndexerRegistry,
  validateIndexerAuthorizedWorksetProjection,
  type IndexerAuthorizedWorksetView,
  type IndexerAuthorizedWorksetViewProjection,
  type IndexerAuthorizedWorksetViewSource,
  type IndexerInventoryMember,
  type IndexerJson,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import {
  assertProjectIndexerMainSourceBinding,
  buildProjectIndexerMainSourceViewSources,
  resolveProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { normalizeRunSpec } from "./indexerMainRunStoreRecords.js";
import { INDEXER_WORKSET_VIEW_RUNTIME_ROOT } from "./lifecyclePaths.js";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE_ID = "authorized-indexer-workset-view" as const;
const HANDLER = "context.materialize-indexer-workset-view/v1" as const;
const REQUEST_PROTOCOL = "context.indexer.workset-view-materialization-request/v1" as const;
const OUTPUT_SCHEMA = "context.indexer.authorized-workset-view/v1" as const;

function authorAuthorityValue(spec: ReturnType<typeof normalizeRunSpec>): IndexerJson {
  const fields = [
    "expected_subject_key",
    "allowed_source_roles",
    "artifact_policy_eligibility",
    "allowed_artifact_intents",
    "allowed_question_targets",
  ] as const;
  for (const field of fields) {
    if (spec.validation[field] === undefined) {
      throw new TypeError(`author run spec is missing ${field}`);
    }
  }
  const workset = spec.request.workset;
  return JSON.parse(canonicalIndexerJson({
    expected_subject_key: spec.validation.expected_subject_key,
    allowed_source_roles: spec.validation.allowed_source_roles,
    artifact_policy_eligibility: spec.validation.artifact_policy_eligibility,
    allowed_artifact_intents: spec.validation.allowed_artifact_intents,
    allowed_question_targets: (spec.validation.allowed_question_targets as Array<{
      question_target_key: string;
      question_ref: string;
    }>).map((target, index) => ({
      alias: `question-target:${index + 1}`,
      question: target.question_ref,
    })),
    target_resolutions: workset.stage === "author" &&
        workset.target_resolution_view !== undefined
      ? workset.target_resolution_view.entries.map((entry, index) => ({
          alias: `target-resolution:${index + 1}`,
          state: entry.state,
          ...(entry.state === "resolved" ? { subject_key: entry.subject_key } : {}),
        }))
      : [],
  })) as IndexerJson;
}

export interface IndexerWorksetViewMaterializationRequest {
  protocol: typeof REQUEST_PROTOCOL;
  handler: typeof HANDLER;
  resource_id: typeof RESOURCE_ID;
  workset_digest: string;
  execution_request_digest: string;
  view_digest: string;
  payload_digest: string;
  request_digest: string;
}

export interface PreparedIndexerWorksetViewMaterialization {
  request: IndexerWorksetViewMaterializationRequest;
  projection: IndexerAuthorizedWorksetViewProjection;
}

export interface IndexerInspectorWorksetViewMaterialization {
  inspector_request: unknown;
  inspector_result: unknown;
}

export interface IndexerWorksetViewManagedOutput {
  ref: string;
  digest: string;
  file_path: string;
  value: IndexerAuthorizedWorksetView;
}

function requestDigest(
  value: Omit<IndexerWorksetViewMaterializationRequest, "request_digest"> |
    IndexerWorksetViewMaterializationRequest,
): string {
  return indexerProtocolDigest({
    protocol: value.protocol,
    handler: value.handler,
    resource_id: value.resource_id,
    workset_digest: value.workset_digest,
    execution_request_digest: value.execution_request_digest,
    view_digest: value.view_digest,
    payload_digest: value.payload_digest,
  });
}

export function validateIndexerWorksetViewMaterializationRequest(
  value: unknown,
): IndexerWorksetViewMaterializationRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer workset View materialization request must be an object");
  }
  const request = value as Partial<IndexerWorksetViewMaterializationRequest>;
  if (
    request.protocol !== REQUEST_PROTOCOL ||
    request.handler !== HANDLER ||
    request.resource_id !== RESOURCE_ID
  ) {
    throw new TypeError("Indexer workset View materialization request protocol is invalid");
  }
  for (const [field, candidate] of Object.entries({
    workset_digest: request.workset_digest,
    execution_request_digest: request.execution_request_digest,
    view_digest: request.view_digest,
    payload_digest: request.payload_digest,
    request_digest: request.request_digest,
  })) {
    if (typeof candidate !== "string" || !DIGEST_RE.test(candidate)) {
      throw new TypeError(`Indexer workset View materialization request ${field} is invalid`);
    }
  }
  const validated = request as IndexerWorksetViewMaterializationRequest;
  if (validated.request_digest !== requestDigest(validated)) {
    throw new TypeError("Indexer workset View materialization request digest is invalid");
  }
  return validated;
}

function assertRequestProjectionBinding(input: {
  request: IndexerWorksetViewMaterializationRequest;
  projection: IndexerAuthorizedWorksetViewProjection;
}): void {
  const payloadDigest = indexerProtocolDigest(input.projection.view);
  if (
    input.request.workset_digest !== input.projection.view.workset_digest ||
    input.request.execution_request_digest !==
      input.projection.view.execution_request_digest ||
    input.request.view_digest !== input.projection.view.view_digest ||
    input.request.payload_digest !== payloadDigest
  ) {
    throw new TypeError("Indexer workset View materialization request is stale");
  }
}

export function prepareIndexerWorksetViewMaterialization(input: {
  run_request: unknown;
  projection_sources: readonly unknown[];
}): PreparedIndexerWorksetViewMaterialization {
  const projection = buildIndexerAuthorizedWorksetView({
    request: input.run_request,
    projection_sources: input.projection_sources,
  });
  const payload: Omit<IndexerWorksetViewMaterializationRequest, "request_digest"> = {
    protocol: REQUEST_PROTOCOL,
    handler: HANDLER,
    resource_id: RESOURCE_ID,
    workset_digest: projection.view.workset_digest,
    execution_request_digest: projection.view.execution_request_digest,
    view_digest: projection.view.view_digest,
    payload_digest: indexerProtocolDigest(projection.view),
  };
  return {
    projection,
    request: { ...payload, request_digest: requestDigest(payload) },
  };
}

export async function prepareProjectIndexerWorksetViewMaterialization(input: {
  projectRoot: string;
  run_spec: unknown;
  inspector_materializations?: readonly IndexerInspectorWorksetViewMaterialization[];
  additional_projection_sources?: readonly IndexerAuthorizedWorksetViewSource[];
}): Promise<PreparedIndexerWorksetViewMaterialization> {
  const spec = normalizeRunSpec(input.run_spec);
  const request = spec.request;
  const loadedRegistry = await loadIndexerRegistry(input.projectRoot);
  if (loadedRegistry.requirementSetDigest !== request.workset.requirement_set_digest) {
    throw new TypeError("main Indexer workset targets a stale Requirement set");
  }
  const requirementId = request.workset.requirement_ref.slice("requirement:".length);
  const requirement = loadedRegistry.registry.requirements.find((candidate) =>
    candidate.id === requirementId
  );
  if (requirement === undefined) {
    throw new TypeError("main Indexer workset references an unknown Requirement");
  }
  const requirementProjection = buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "index-requirement",
    input_digests: [loadedRegistry.requirementSetDigest],
    items: [{
      ref: request.workset.requirement_ref,
      category: "index-requirement",
      provenance: {
        protocol: loadedRegistry.requirementSet.protocol,
        digest: loadedRegistry.requirementSetDigest,
      },
      value: {
        id: requirement.id,
        reader_goals: requirement.reader_goals,
        coverage_domains: requirement.coverage_domains,
        target_scope: requirement.target_scope,
        evidence_source_scope: requirement.evidence_source_scope,
        ...(requirement.questions === undefined
          ? {}
          : { questions: requirement.questions }),
        ...(requirement.exclusions === undefined
          ? {}
          : { exclusions: requirement.exclusions }),
      },
    }],
  });
  const authorAuthorityProjection = request.workset.stage === "author"
    ? buildIndexerAuthorizedWorksetViewSource({
        request,
        projection_kind: "author-authority",
        input_digests: [spec.spec_digest],
        items: [{
          ref: `author-authority:${request.workset.workset_digest}`,
          category: "author-authority",
          provenance: {
            protocol: spec.protocol,
            digest: spec.spec_digest,
            container_ref: request.workset.logical_unit_ref,
          },
          value: authorAuthorityValue(spec),
        }],
      })
    : null;
  const partitionAuthorityProjection = request.workset.stage === "partition"
    ? buildIndexerAuthorizedWorksetViewSource({
        request,
        projection_kind: "partition-authority",
        input_digests: [spec.spec_digest],
        items: [{
          ref: `partition-authority:${request.workset.workset_digest}`,
          category: "partition-authority",
          provenance: {
            protocol: spec.protocol,
            digest: spec.spec_digest,
          },
          value: {
            base_subject_key: request.workset.partition_subject_key,
            ...(spec.validation.subject_key_contract === undefined
              ? {}
              : {
                  subject_key_contract:
                    spec.validation.subject_key_contract as IndexerJson,
                }),
          },
        }],
      })
    : null;
  const repairProjection = request.workset.repair_intent !== undefined
    ? buildIndexerAuthorizedWorksetViewSource({
        request,
        projection_kind: "repair-intent",
        input_digests: [request.workset.repair_intent.intent_digest],
        items: [{
          ref: `repair-intent:${request.workset.repair_intent.intent_digest}`,
          category: "repair-intent",
          provenance: {
            protocol: "context.indexer.repair-intent/v1",
            digest: request.workset.repair_intent.intent_digest,
            container_ref: request.workset.repair_intent.target_ref,
          },
          value: {
            target_ref: request.workset.repair_intent.target_ref,
            instruction: request.workset.repair_intent.instruction,
          },
        }],
      })
    : null;
  const binding = await resolveProjectIndexerMainSourceBinding({
    projectRoot: input.projectRoot,
    indexer_id: request.workset.indexer_id,
    source_ref: request.workset.source_ref,
    module_ref: request.workset.module_ref,
    profile_contract_digest: request.workset.profile_contract_digest,
  });
  assertProjectIndexerMainSourceBinding({
    workset: request.workset,
    binding,
    ...(request.workset.stage === "author"
      ? { dependency_view: spec.validation.dependency_view }
      : {}),
  });
  const runInventory = spec.validation.canonical_inventory_members;
  if (!Array.isArray(runInventory)) {
    throw new TypeError("main run spec is missing its exact inventory members");
  }
  const inventoryMembers = canonicalIndexerInventoryMembers(
    runInventory as readonly IndexerInventoryMember[],
  );
  if (
    request.workset.stage === "partition" &&
    indexerInventoryMembersDigest(inventoryMembers) !==
      request.workset.partition_inventory_digest
  ) {
    throw new TypeError("partition workset View uses stale inventory members");
  }
  if (
    request.workset.stage === "author" &&
    indexerInventoryMembersDigest(inventoryMembers) !==
      request.workset.member_inventory_digest
  ) {
    throw new TypeError("author workset View uses stale inventory members");
  }
  const sourceProjectionSources = await buildProjectIndexerMainSourceViewSources({
    projectRoot: input.projectRoot,
    request,
    binding,
    ...(request.workset.stage === "author"
      ? { dependency_view: spec.validation.dependency_view }
      : {}),
    ...(request.workset.stage === "author"
      ? { author_inventory_members: inventoryMembers }
      : {}),
    ...(request.workset.stage === "partition"
      ? { partition_inventory_members: inventoryMembers }
      : {}),
  });
  const storedInspectorMaterializations = Array.isArray(spec.validation.inspector_materializations)
    ? spec.validation.inspector_materializations as unknown as IndexerInspectorWorksetViewMaterialization[]
    : [];
  const inspectorProjectionSources = [
    ...storedInspectorMaterializations,
    ...(input.inspector_materializations ?? []),
  ].map(
    (materialization) => buildIndexerInspectorWorksetViewSource({
      request,
      inspector_request: materialization.inspector_request,
      inspector_result: materialization.inspector_result,
    }),
  );
  return prepareIndexerWorksetViewMaterialization({
    run_request: request,
    projection_sources: buildIndexerMainRunWorksetViewSources({
      request,
      source_projection_sources: [
        requirementProjection,
        ...(partitionAuthorityProjection === null ? [] : [partitionAuthorityProjection]),
        ...(authorAuthorityProjection === null ? [] : [authorAuthorityProjection]),
        ...(repairProjection === null ? [] : [repairProjection]),
        ...sourceProjectionSources,
        ...inspectorProjectionSources,
        ...(input.additional_projection_sources ?? []),
      ],
      canonical_inventory_members: inventoryMembers,
    }),
  });
}

export function indexerWorksetViewHostLocation(
  value: unknown,
): HostActionResourceLocation {
  const request = validateIndexerWorksetViewMaterializationRequest(value);
  return {
    schema: "agent-graph.resource-location.host-action.v1",
    id: request.resource_id,
    kind: "procedure",
    mediaType: "application/json",
    revision: request.request_digest,
    materialize: {
      handler: request.handler,
      input: {
        schema: request.protocol,
        value: request as unknown as JsonValue,
      },
      output_schema: OUTPUT_SCHEMA,
    },
  };
}

export function indexerWorksetViewRuntimePath(input: {
  workspaceRoot: string;
  payloadDigest: string;
}): string {
  if (!DIGEST_RE.test(input.payloadDigest)) {
    throw new TypeError("Indexer workset View payload digest is invalid");
  }
  return join(
    input.workspaceRoot,
    INDEXER_WORKSET_VIEW_RUNTIME_ROOT,
    `${input.payloadDigest.slice("sha256:".length)}.json`,
  );
}

async function writeManagedView(input: {
  workspaceRoot: string;
  request: IndexerWorksetViewMaterializationRequest;
  view: IndexerAuthorizedWorksetView;
}): Promise<IndexerWorksetViewManagedOutput> {
  const filePath = indexerWorksetViewRuntimePath({
    workspaceRoot: input.workspaceRoot,
    payloadDigest: input.request.payload_digest,
  });
  await atomicWriteFile(filePath, canonicalIndexerJson(input.view));
  return {
    ref: pathToFileURL(filePath).href,
    digest: input.request.payload_digest,
    file_path: filePath,
    value: input.view,
  };
}

export async function materializeIndexerWorksetViewHostAction(input: {
  request: unknown;
  run_request: unknown;
  projection: IndexerAuthorizedWorksetViewProjection;
  workspaceRoot: string;
  adapter: string;
  adapterVersion: string;
}): Promise<{
  result: HostActionResult;
  managed_output: IndexerWorksetViewManagedOutput;
}> {
  const request = validateIndexerWorksetViewMaterializationRequest(input.request);
  const projection = validateIndexerAuthorizedWorksetProjection({
    request: input.run_request,
    view: input.projection.view,
  });
  assertRequestProjectionBinding({ request, projection });
  const location = indexerWorksetViewHostLocation(request);
  const managedOutput = await writeManagedView({
    workspaceRoot: input.workspaceRoot,
    request,
    view: projection.view,
  });
  const result: HostActionResult = {
    schema: "agent-graph.host-action-result.v1",
    handler: location.materialize.handler,
    input_digest: hostActionInputDigest(location),
    output: {
      schema: location.materialize.output_schema,
      resource: {
        ref: managedOutput.ref,
        digest: managedOutput.digest,
      },
    },
    receipt: {
      adapter: input.adapter,
      adapter_version: input.adapterVersion,
    },
  };
  await validateHostActionResult(location, result);
  return {
    result,
    managed_output: managedOutput,
  };
}

export async function clearIndexerWorksetViewRuntime(
  workspaceRoot: string,
): Promise<void> {
  await rm(join(workspaceRoot, INDEXER_WORKSET_VIEW_RUNTIME_ROOT), {
    recursive: true,
    force: true,
  });
}
