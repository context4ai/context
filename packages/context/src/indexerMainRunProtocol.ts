import { z } from "zod";
import {
  indexerArtifactResultSchema,
  validateIndexerArtifactResult,
  type IndexerArtifactResult,
} from "./indexerArtifactResult.js";
import {
  buildIndexerArtifactDependencySet,
  type IndexerArtifactDependencySet,
} from "./indexerArtifactDependencies.js";
import {
  buildIndexerGeneratedAuthoringAudit,
  type IndexerGeneratedAuthoringAudit,
} from "./indexerGeneratedAuthoringAudit.js";
import {
  indexerLayerCompositionInputSchema,
  validateIndexerLayerCompositionInput,
} from "./indexerLayerComposition.js";
import {
  indexerMainWorksetSchema,
  validateIndexerMainWorkset,
  type IndexerMainAuthorWorkset,
  type IndexerMainPartitionWorkset,
} from "./indexerMainWorkset.js";
import {
  indexerPartitionStrategyAttemptSchema,
  validateIndexerPartitionStrategyAttempt,
  type IndexerPartitionStrategyAttempt,
} from "./indexerPartitionConvergence.js";
import {
  indexerPartitionPlanSchema,
  validateIndexerPartitionPlan,
  type IndexerPartitionPlan,
  type IndexerPartitionStrategy,
} from "./indexerPartitionPlan.js";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  buildIndexerRunEnvelope,
  indexerRunEnvironmentSchema,
  validateIndexerRunEnvironmentBinding,
  validateIndexerRunEnvironment,
  type IndexerRunEnvelope,
  type IndexerRunEnvironment,
} from "./indexerRunEnvelope.js";
import { indexerRunFinalAuthoritySchema } from "./indexerRunProtocolCommon.js";
import type { IndexerInventoryMember } from "./indexerInventoryDisposition.js";
import {
  validateIndexerWorksetReadReceipt,
  type IndexerWorksetReadReceipt,
} from "./indexerWorksetRead.js";

export const indexerMainRunRequestSchema = z.object({
  protocol: z.literal("context.indexer.run-request/v2"),
  operation: z.literal("main-index"),
  workset: indexerMainWorksetSchema,
  composition_input: indexerLayerCompositionInputSchema,
  final_authority: indexerRunFinalAuthoritySchema,
  run_environment: indexerRunEnvironmentSchema,
  partition_strategy_attempt: indexerPartitionStrategyAttemptSchema.nullable(),
  execution_request_digest: indexerDigestSchema,
}).strict();

export type IndexerMainRunRequest = z.infer<typeof indexerMainRunRequestSchema>;

export function indexerMainRunRequestDigest(
  value: Omit<IndexerMainRunRequest, "execution_request_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerMainRunRequest(input: {
  workset: IndexerMainRunRequest["workset"];
  composition_input: IndexerMainRunRequest["composition_input"];
  final_authority: IndexerMainRunRequest["final_authority"];
  run_environment: IndexerRunEnvironment;
  partition_strategy_attempt?: IndexerPartitionStrategyAttempt | null;
}): IndexerMainRunRequest {
  const workset = validateIndexerMainWorkset(input.workset);
  const compositionInput = validateIndexerLayerCompositionInput(input.composition_input);
  const finalAuthority = indexerRunFinalAuthoritySchema.parse(input.final_authority);
  const runEnvironment = validateIndexerRunEnvironment(input.run_environment);
  validateIndexerRunEnvironmentBinding(workset, runEnvironment);
  if (
    runEnvironment.primary_execution_projection.config_digest !==
      finalAuthority.config_fingerprint
  ) {
    throw new TypeError("main run primary execution config does not match final authority");
  }
  if (
    compositionInput.workset_digest !== workset.workset_digest ||
    compositionInput.final_authority_layer_ref !== finalAuthority.layer_ref
  ) {
    throw new TypeError("main run composition input does not match workset/final authority");
  }
  const partitionStrategyAttempt = workset.stage === "partition"
    ? indexerPartitionStrategyAttemptSchema.parse(input.partition_strategy_attempt)
    : null;
  if (
    workset.stage === "author" &&
    input.partition_strategy_attempt !== undefined &&
    input.partition_strategy_attempt !== null
  ) {
    throw new TypeError("author main run cannot carry a partition strategy attempt");
  }
  const payload: Omit<IndexerMainRunRequest, "execution_request_digest"> = {
    protocol: "context.indexer.run-request/v2",
    operation: "main-index",
    workset,
    composition_input: compositionInput,
    final_authority: finalAuthority,
    run_environment: runEnvironment,
    partition_strategy_attempt: partitionStrategyAttempt,
  };
  return indexerMainRunRequestSchema.parse({
    ...payload,
    execution_request_digest: indexerMainRunRequestDigest(payload),
  });
}

export function validateIndexerMainRunRequest(value: unknown): IndexerMainRunRequest {
  const request = indexerMainRunRequestSchema.parse(value);
  const payload: Omit<IndexerMainRunRequest, "execution_request_digest"> = {
    protocol: request.protocol,
    operation: request.operation,
    workset: request.workset,
    composition_input: request.composition_input,
    final_authority: request.final_authority,
    run_environment: request.run_environment,
    partition_strategy_attempt: request.partition_strategy_attempt,
  };
  if (indexerMainRunRequestDigest(payload) !== request.execution_request_digest) {
    throw new TypeError("main run execution request digest is invalid");
  }
  buildIndexerMainRunRequest(request);
  return request;
}

const partitionMainResultSchema = z.object({
  protocol: z.literal("context.indexer.main-result/v1"),
  stage: z.literal("partition"),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  result: indexerPartitionPlanSchema,
}).strict();

const authorMainResultSchema = z.object({
  protocol: z.literal("context.indexer.main-result/v1"),
  stage: z.literal("author"),
  workset_digest: indexerDigestSchema,
  execution_request_digest: indexerDigestSchema,
  result: indexerArtifactResultSchema,
}).strict();

export const indexerMainRunResultSchema = z.object({
  protocol: z.literal("context.indexer.run-result/v1"),
  operation: z.literal("main-index"),
  consumed_input_view_digest: indexerDigestSchema,
  workset_read_receipt_digests: z.array(indexerDigestSchema).min(1),
  result: z.union([partitionMainResultSchema, authorMainResultSchema]),
}).strict();

export type IndexerMainRunResult = z.infer<typeof indexerMainRunResultSchema>;

interface PartitionValidationContext {
  stage: "partition";
  canonical_inventory_members: readonly IndexerInventoryMember[];
  authorized_source_refs: readonly string[];
  authorized_strategies: readonly {
    strategy_ref: IndexerPartitionStrategy;
    strategy_digest: string;
  }[];
  required_question_target_refs?: readonly string[];
}

interface AuthorValidationContext {
  stage: "author";
  dependency_view: unknown;
  expected_subject_key: unknown;
  artifact_policy_eligibility: unknown;
  allowed_source_roles: readonly string[];
  authorized_evidence_targets?: readonly {
    source_ref: string;
    module_refs: readonly string[];
  }[];
  source_identity_inventory?: unknown;
  authorized_declaration_carriers?: {
    catalog_refs?: readonly string[];
    manifest_refs?: readonly string[];
  };
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
}

export function validateIndexerMainRunResult(input: {
  request: unknown;
  result: unknown;
  workset_read_receipts: readonly unknown[];
  validation: PartitionValidationContext | AuthorValidationContext;
}): {
  request: IndexerMainRunRequest;
  result: IndexerMainRunResult;
  operation_result: IndexerPartitionPlan | IndexerArtifactResult;
  authoring_audit: IndexerGeneratedAuthoringAudit | null;
  artifact_dependency_set: IndexerArtifactDependencySet | null;
  run_envelope: IndexerRunEnvelope;
} {
  const request = validateIndexerMainRunRequest(input.request);
  const result = indexerMainRunResultSchema.parse(input.result);
  if (
    new Set(result.workset_read_receipt_digests).size !==
      result.workset_read_receipt_digests.length
  ) {
    throw new TypeError("workset read receipt digests must not contain duplicates");
  }
  const canonicalResultReceiptDigests = [
    ...result.workset_read_receipt_digests,
  ].sort();
  if (
    canonicalResultReceiptDigests.some(
      (digest, index) => digest !== result.workset_read_receipt_digests[index],
    )
  ) {
    throw new TypeError("workset read receipt digests must use canonical ordering");
  }
  const worksetReadReceipts: IndexerWorksetReadReceipt[] =
    input.workset_read_receipts.map(validateIndexerWorksetReadReceipt);
  const receiptDigests = worksetReadReceipts
    .map((receipt) => {
      if (receipt.workset_digest !== request.workset.workset_digest) {
        throw new TypeError("main run read receipt does not bind the current workset");
      }
      return receipt.receipt_digest;
    })
    .sort();
  if (
    receiptDigests.length !== result.workset_read_receipt_digests.length ||
    receiptDigests.some(
      (digest, index) => digest !== result.workset_read_receipt_digests[index],
    )
  ) {
    throw new TypeError("main run Result does not bind the CLI-issued read receipt set");
  }
  if (
    result.consumed_input_view_digest !== request.composition_input.view_digest ||
    result.result.workset_digest !== request.workset.workset_digest ||
    result.result.execution_request_digest !== request.execution_request_digest ||
    result.result.stage !== request.workset.stage ||
    input.validation.stage !== request.workset.stage
  ) {
    throw new TypeError("main run Result does not match its request/stage/input view");
  }
  let operationResult: IndexerPartitionPlan | IndexerArtifactResult;
  let authoringAudit: IndexerGeneratedAuthoringAudit | null = null;
  let artifactDependencySet: IndexerArtifactDependencySet | null = null;
  const runEnvelope = buildIndexerRunEnvelope({
    workset: request.workset,
    execution_request_digest: request.execution_request_digest,
    final_authority: request.final_authority,
    run_environment: request.run_environment,
  });
  if (
    request.workset.stage === "partition" &&
    result.result.stage === "partition" &&
    input.validation.stage === "partition"
  ) {
    const strategyAttempt = validateIndexerPartitionStrategyAttempt({
      attempt: request.partition_strategy_attempt,
      workset: request.workset,
      authorized_strategies: input.validation.authorized_strategies,
    });
    if (
      result.result.result.strategy_digest !== strategyAttempt.strategy_digest ||
      canonicalIndexerJson(result.result.result.strategy_ref) !==
        canonicalIndexerJson(strategyAttempt.strategy_ref)
    ) {
      throw new TypeError("partition Result does not match its selected strategy attempt");
    }
    operationResult = validateIndexerPartitionPlan({
      plan: result.result.result,
      workset: request.workset as IndexerMainPartitionWorkset,
      canonical_inventory_members: input.validation.canonical_inventory_members,
      authorized_source_refs: input.validation.authorized_source_refs,
      authorized_strategies: input.validation.authorized_strategies,
      ...(input.validation.required_question_target_refs === undefined
        ? {}
        : {
            required_question_target_refs:
              input.validation.required_question_target_refs,
          }),
    });
  } else if (
    request.workset.stage === "author" &&
    result.result.stage === "author" &&
    input.validation.stage === "author"
  ) {
    operationResult = validateIndexerArtifactResult({
      result: result.result.result,
      workset: request.workset as IndexerMainAuthorWorkset,
      expected_provider: request.final_authority,
      expected_input_digest: request.execution_request_digest,
      expected_subject_key: input.validation.expected_subject_key,
      artifact_policy_eligibility: input.validation.artifact_policy_eligibility,
      allowed_source_roles: input.validation.allowed_source_roles,
      ...(input.validation.authorized_evidence_targets === undefined
        ? {}
        : {
            authorized_evidence_targets:
              input.validation.authorized_evidence_targets,
          }),
      ...(input.validation.source_identity_inventory === undefined
        ? {}
        : { source_identity_inventory: input.validation.source_identity_inventory }),
      ...(input.validation.authorized_declaration_carriers === undefined
        ? {}
        : {
            authorized_declaration_carriers:
              input.validation.authorized_declaration_carriers,
          }),
      allowed_question_targets: input.validation.allowed_question_targets,
    });
    if (operationResult.source_role !== request.run_environment.source_role) {
      throw new TypeError("author Result source role does not match the run environment");
    }
    authoringAudit = buildIndexerGeneratedAuthoringAudit(operationResult);
    artifactDependencySet = buildIndexerArtifactDependencySet({
      result: operationResult,
      workset: request.workset as IndexerMainAuthorWorkset,
      run_envelope: runEnvelope,
      dependency_view: input.validation.dependency_view,
      ...(input.validation.authorized_evidence_targets === undefined
        ? {}
        : {
            authorized_evidence_targets:
              input.validation.authorized_evidence_targets,
          }),
    });
  } else {
    throw new TypeError("main run Result stage union is inconsistent");
  }
  return {
    request,
    result,
    operation_result: operationResult,
    authoring_audit: authoringAudit,
    artifact_dependency_set: artifactDependencySet,
    run_envelope: runEnvelope,
  };
}
