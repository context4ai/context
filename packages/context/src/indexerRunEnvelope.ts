import { z } from "zod";
import type { IndexerMainWorkset } from "./indexerMainWorkset.js";
import {
  indexerRunFinalAuthoritySchema,
  type IndexerRunFinalAuthority,
} from "./indexerRunProtocolCommon.js";
import {
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  indexerPrimaryExecutionProjectionSchema,
  validateIndexerPrimaryExecutionProjection,
} from "./indexerPrimaryProjection.js";
import {
  indexerSharedArtifactFingerprintSchema,
  validateIndexerSharedArtifactFingerprint,
} from "./indexerSharedArtifactFingerprint.js";

const indexerRunEnvironmentPayloadSchema = z.object({
  protocol: z.literal("context.indexer.run-environment/v2"),
  source_snapshot_digest: indexerDigestSchema,
  source_dependency_fingerprint: indexerDigestSchema,
  source_role: indexerIdSchema,
  source_precedence_digest: indexerDigestSchema,
  metric_set_digest: indexerDigestSchema,
  dependency_view_digest: indexerDigestSchema.nullable(),
  primary_execution_projection: indexerPrimaryExecutionProjectionSchema,
}).strict();

export const indexerRunEnvironmentSchema = indexerRunEnvironmentPayloadSchema.extend({
  environment_digest: indexerDigestSchema,
}).strict();

export type IndexerRunEnvironment = z.infer<typeof indexerRunEnvironmentSchema>;

export function indexerRunEnvironmentDigest(
  value: Omit<IndexerRunEnvironment, "environment_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerRunEnvironment(
  input: Omit<IndexerRunEnvironment, "protocol" | "environment_digest">,
): IndexerRunEnvironment {
  const primaryExecutionProjection = validateIndexerPrimaryExecutionProjection(
    input.primary_execution_projection,
  );
  const payload = indexerRunEnvironmentPayloadSchema.parse({
    protocol: "context.indexer.run-environment/v2",
    ...input,
    primary_execution_projection: primaryExecutionProjection,
  });
  return indexerRunEnvironmentSchema.parse({
    ...payload,
    environment_digest: indexerRunEnvironmentDigest(payload),
  });
}

export function validateIndexerRunEnvironment(value: unknown): IndexerRunEnvironment {
  const environment = indexerRunEnvironmentSchema.parse(value);
  validateIndexerPrimaryExecutionProjection(environment.primary_execution_projection);
  const { environment_digest: _digest, ...payload } = environment;
  void _digest;
  if (indexerRunEnvironmentDigest(payload) !== environment.environment_digest) {
    throw new TypeError("Indexer run environment digest is invalid");
  }
  return environment;
}

const indexerRunEnvelopePayloadSchema = z.object({
  protocol: z.literal("context.indexer.run-envelope/v2"),
  stage: z.enum(["partition", "author"]),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  source_ref: z.string().min(1),
  module_ref: z.string().min(1).nullable(),
  logical_unit_ref: z.string().min(1).nullable(),
  source_snapshot_digest: indexerDigestSchema,
  requirement_set_digest: indexerDigestSchema,
  indexer_id: indexerIdSchema,
  provider_layer_ref: z.string().min(1),
  provider_integrity: indexerDigestSchema,
  provider_bundle_digest: indexerDigestSchema,
  config_fingerprint: indexerDigestSchema,
  customization_fingerprint: indexerDigestSchema.nullable(),
  plan_binding_digest: indexerDigestSchema,
  runtime_fingerprint: indexerDigestSchema,
  resource_binding_digest: indexerDigestSchema,
  shared_artifact_fingerprint: indexerSharedArtifactFingerprintSchema,
  source_dependency_fingerprint: indexerDigestSchema,
  source_role: indexerIdSchema,
  source_precedence_digest: indexerDigestSchema,
  metric_set_digest: indexerDigestSchema,
  dependency_view_digest: indexerDigestSchema.nullable(),
  run_environment_digest: indexerDigestSchema,
}).strict();

export const indexerRunEnvelopeSchema = indexerRunEnvelopePayloadSchema.extend({
  envelope_digest: indexerDigestSchema,
}).strict();

export type IndexerRunEnvelope = z.infer<typeof indexerRunEnvelopeSchema>;

export function indexerRunEnvelopeDigest(
  value: Omit<IndexerRunEnvelope, "envelope_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function validateIndexerRunEnvironmentBinding(
  workset: IndexerMainWorkset,
  environment: IndexerRunEnvironment,
): void {
  const execution = validateIndexerPrimaryExecutionProjection(
    environment.primary_execution_projection,
  );
  if (
    environment.source_dependency_fingerprint !== workset.source_binding_digest ||
    execution.indexer_id !== workset.indexer_id ||
    execution.primary_registry_projection_digest !==
      workset.primary_registry_projection_digest ||
    execution.primary_execution_fingerprint !==
      workset.primary_execution_fingerprint ||
    execution.primary_resource_binding_digest !==
      workset.primary_resource_binding_digest ||
    execution.profile_contract_digest !== workset.profile_contract_digest
  ) {
    throw new TypeError(
      "run environment source or primary execution projection does not match its workset",
    );
  }
  if (workset.stage === "author") {
    if (environment.dependency_view_digest !== workset.group_dependency_view_digest) {
      throw new TypeError("author run environment does not bind the current dependency view");
    }
    return;
  }
  if (environment.dependency_view_digest !== null) {
    throw new TypeError("partition run environment cannot bind an author dependency view");
  }
}

export function buildIndexerRunEnvelope(input: {
  workset: IndexerMainWorkset;
  execution_request_digest: string;
  final_authority: IndexerRunFinalAuthority;
  run_environment: IndexerRunEnvironment;
}): IndexerRunEnvelope {
  const authority = indexerRunFinalAuthoritySchema.parse(input.final_authority);
  const environment = validateIndexerRunEnvironment(input.run_environment);
  validateIndexerRunEnvironmentBinding(input.workset, environment);
  const payload = indexerRunEnvelopePayloadSchema.parse({
    protocol: "context.indexer.run-envelope/v2",
    stage: input.workset.stage,
    workset_digest: input.workset.workset_digest,
    execution_request_digest: input.execution_request_digest,
    source_ref: input.workset.source_ref,
    module_ref: input.workset.module_ref,
    logical_unit_ref: input.workset.stage === "author"
      ? input.workset.logical_unit_ref
      : null,
    source_snapshot_digest: environment.source_snapshot_digest,
    requirement_set_digest: input.workset.requirement_set_digest,
    indexer_id: input.workset.indexer_id,
    provider_layer_ref: authority.layer_ref,
    provider_integrity: authority.integrity,
    provider_bundle_digest: authority.bundle_digest,
    config_fingerprint: authority.config_fingerprint,
    customization_fingerprint: authority.customization_fingerprint,
    plan_binding_digest: input.workset.stage === "author"
      ? input.workset.partition_plan_binding_digest
      : input.workset.strategy_set_digest,
    runtime_fingerprint: input.workset.primary_execution_fingerprint,
    resource_binding_digest: input.workset.primary_resource_binding_digest,
    shared_artifact_fingerprint:
      environment.primary_execution_projection.shared_artifact_fingerprint,
    source_dependency_fingerprint: environment.source_dependency_fingerprint,
    source_role: environment.source_role,
    source_precedence_digest: environment.source_precedence_digest,
    metric_set_digest: environment.metric_set_digest,
    dependency_view_digest: environment.dependency_view_digest,
    run_environment_digest: environment.environment_digest,
  });
  return indexerRunEnvelopeSchema.parse({
    ...payload,
    envelope_digest: indexerRunEnvelopeDigest(payload),
  });
}

export function validateIndexerRunEnvelope(value: unknown): IndexerRunEnvelope {
  const envelope = indexerRunEnvelopeSchema.parse(value);
  const { envelope_digest: _digest, ...payload } = envelope;
  void _digest;
  if (indexerRunEnvelopeDigest(payload) !== envelope.envelope_digest) {
    throw new TypeError("Indexer run envelope digest is invalid");
  }
  if ((envelope.stage === "author") !== (envelope.logical_unit_ref !== null)) {
    throw new TypeError("Indexer run envelope logical-unit binding is inconsistent");
  }
  if ((envelope.stage === "author") !== (envelope.dependency_view_digest !== null)) {
    throw new TypeError("Indexer run envelope dependency-view binding is inconsistent");
  }
  const sharedFingerprint = validateIndexerSharedArtifactFingerprint(
    envelope.shared_artifact_fingerprint,
  );
  if (sharedFingerprint.indexer_id !== envelope.indexer_id) {
    throw new TypeError("Indexer run envelope shared Artifact fingerprint is inconsistent");
  }
  return envelope;
}
