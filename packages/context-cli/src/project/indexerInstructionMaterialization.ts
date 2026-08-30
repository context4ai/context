import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  hostActionInputDigest,
  hostActionOutputDigest,
  validateHostActionResult,
  type HostActionResult,
  type JsonValue,
  type ResourceLocationV2,
} from "@c4a/agent-graph";
import {
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  validateStagedIndexerProviderBundle,
  type StagedIndexerProviderBundle,
} from "./indexerProviderStage.js";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_INSTRUCTION_BYTES = 1024 * 1024;

export interface IndexerInstructionMaterializationRequest {
  protocol: "context.indexer.materialize-request/v1";
  handler: "context.materialize-indexer-instructions/v1";
  resource_id: "resolved-indexer-instructions";
  indexer_id: string;
  provider_id: string;
  provider_fingerprint: string;
  provider_integrity: string;
  manifest_digest: string;
  requirement_set_digest: string;
  workset_ref: string;
  workset_digest: string;
  profile: string;
  composer_id: string | null;
  instruction_set_digest: string;
  customization_fingerprint: string;
  request_digest: string;
}

export interface IndexerInstructionMaterializationAuthority {
  resource_id: "resolved-indexer-instructions";
  indexer_id: string;
  provider_id: string;
  requirement_set_digest: string;
  workset_ref: string;
  workset_digest: string;
  instruction_set_digest: string;
}

export interface MaterializedIndexerInstructions {
  protocol: "context.indexer.materialized-resource/v1";
  request_digest: string;
  provider_fingerprint: string;
  resources: Array<{
    kind: "provider" | "composer" | "customization-append";
    resource_ref: string;
    digest: string;
    content: string;
  }>;
  payload_digest: string;
  context_receipt: {
    staged_receipt_digest: string;
    provider_source_receipt_digest: string;
    customization_fingerprint: string;
    receipt_digest: string;
  };
}

interface InstructionDescriptor {
  kind: "provider" | "composer" | "customization-append";
  path: string;
  digest: string;
  resource_ref: string;
}

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

function requestDigest(
  value: Omit<IndexerInstructionMaterializationRequest, "request_digest"> |
    IndexerInstructionMaterializationRequest,
): string {
  return indexerProtocolDigest({
    protocol: value.protocol,
    handler: value.handler,
    resource_id: value.resource_id,
    indexer_id: value.indexer_id,
    provider_id: value.provider_id,
    provider_fingerprint: value.provider_fingerprint,
    provider_integrity: value.provider_integrity,
    manifest_digest: value.manifest_digest,
    requirement_set_digest: value.requirement_set_digest,
    workset_ref: value.workset_ref,
    workset_digest: value.workset_digest,
    profile: value.profile,
    composer_id: value.composer_id,
    instruction_set_digest: value.instruction_set_digest,
    customization_fingerprint: value.customization_fingerprint,
  });
}

export function validateIndexerInstructionMaterializationRequest(
  value: unknown,
): IndexerInstructionMaterializationRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer instruction materialization request must be an object");
  }
  const request = value as Partial<IndexerInstructionMaterializationRequest>;
  if (
    request.protocol !== "context.indexer.materialize-request/v1" ||
    request.handler !== "context.materialize-indexer-instructions/v1" ||
    request.resource_id !== "resolved-indexer-instructions"
  ) {
    throw new TypeError("Indexer instruction materialization request protocol is invalid");
  }
  for (const [field, candidate] of Object.entries({
    provider_fingerprint: request.provider_fingerprint,
    provider_integrity: request.provider_integrity,
    manifest_digest: request.manifest_digest,
    requirement_set_digest: request.requirement_set_digest,
    workset_digest: request.workset_digest,
    instruction_set_digest: request.instruction_set_digest,
    customization_fingerprint: request.customization_fingerprint,
    request_digest: request.request_digest,
  })) {
    if (typeof candidate !== "string" || !DIGEST_RE.test(candidate)) {
      throw new TypeError(`Indexer instruction materialization request ${field} is invalid`);
    }
  }
  if (
    request.composer_id !== null &&
    (typeof request.composer_id !== "string" ||
      request.composer_id.length === 0 ||
      request.composer_id.includes("\0"))
  ) {
    throw new TypeError("Indexer instruction materialization request composer_id is invalid");
  }
  for (const [field, candidate] of Object.entries({
    indexer_id: request.indexer_id,
    provider_id: request.provider_id,
    workset_ref: request.workset_ref,
    profile: request.profile,
  })) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
      throw new TypeError(`Indexer instruction materialization request ${field} is invalid`);
    }
  }
  const validated = request as IndexerInstructionMaterializationRequest;
  if (validated.request_digest !== requestDigest(validated)) {
    throw new TypeError("Indexer instruction materialization request digest is invalid");
  }
  return validated;
}

function assertCurrentMaterializationAuthority(input: {
  request: IndexerInstructionMaterializationRequest;
  current: IndexerInstructionMaterializationAuthority;
}): void {
  const fields = [
    "resource_id",
    "indexer_id",
    "provider_id",
    "requirement_set_digest",
    "workset_ref",
    "workset_digest",
    "instruction_set_digest",
  ] as const;
  const stale = fields.filter((field) =>
    input.request[field] !== input.current[field]
  );
  if (stale.length > 0) {
    throw new TypeError(
      `instruction materialization request is stale for current authority: ${stale.join(", ")}`,
    );
  }
}

function materializationReceiptDigest(value: {
  request_digest: string;
  payload_digest: string;
  staged_receipt_digest: string;
  provider_source_receipt_digest: string;
  customization_fingerprint: string;
}): string {
  return indexerProtocolDigest({
    protocol: "context.indexer.instruction-materialization-receipt/v1",
    ...value,
  });
}

async function instructionDescriptors(input: {
  staged: StagedIndexerProviderBundle;
  profile: string;
  composerId: string | null;
  customization: IndexerCustomizationView;
}): Promise<InstructionDescriptor[]> {
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  if (
    manifest.id !== input.customization.provider.skill ||
    manifest.version !== input.customization.provider.version
  ) {
    throw new TypeError("staged Provider manifest does not match the customization authority");
  }
  const descriptors: InstructionDescriptor[] = (manifest.provider.instructions ?? [])
    .filter((instruction) => instruction.profiles.includes(input.profile))
    .map((instruction) => {
      const file = input.staged.files.find((candidate) => candidate.path === instruction.path);
      if (file === undefined) {
        throw new TypeError(`staged Provider has no declared instruction ${instruction.path}`);
      }
      return {
        kind: "provider" as const,
        path: instruction.path,
        digest: file.digest,
        resource_ref: `provider-instruction:${indexerProtocolDigest({
          provider: manifest.id,
          version: manifest.version,
          path: instruction.path,
        })}`,
      };
    })
    .sort((left, right) => left.resource_ref < right.resource_ref ? -1 : 1);
  if (input.composerId !== null) {
    const composer = manifest.provides.composers?.find((candidate) =>
      candidate.id === input.composerId
    );
    if (
      composer?.contract === undefined ||
      !composer.supported_profiles.includes(input.profile)
    ) {
      throw new TypeError(
        `Provider composer ${input.composerId} has no contract for active profile ${input.profile}`,
      );
    }
    const file = input.staged.files.find((candidate) =>
      candidate.path === composer.contract!.instruction
    );
    if (file === undefined) {
      throw new TypeError(
        `staged Provider has no composer instruction ${composer.contract.instruction}`,
      );
    }
    descriptors.push({
      kind: "composer",
      path: composer.contract.instruction,
      digest: file.digest,
      resource_ref: `provider-composer-instruction:${indexerProtocolDigest({
        provider: manifest.id,
        version: manifest.version,
        composer: composer.id,
        path: composer.contract.instruction,
      })}`,
    });
  }
  const local = input.customization.files.find((file) => file.path === "instructions.md");
  if (local !== undefined) {
    descriptors.push({
      kind: "customization-append",
      path: local.path,
      digest: local.digest,
      resource_ref: `customization-instruction:${input.customization.indexer_id}#${local.digest}`,
    });
  }
  if (descriptors.length === 0) {
    throw new TypeError(`Provider has no instructions for active profile ${input.profile}`);
  }
  return descriptors;
}

async function assertStageCurrent(staged: StagedIndexerProviderBundle): Promise<void> {
  const actual = await collectIndexerBundleFiles(staged.stage_path);
  if (!sameFiles(actual, staged.files)) {
    throw new TypeError("staged Provider changed after validation");
  }
}

async function readInstructionResources(input: {
  descriptors: readonly InstructionDescriptor[];
  staged: StagedIndexerProviderBundle;
  workspaceRoot: string;
  customization: IndexerCustomizationView;
}): Promise<MaterializedIndexerInstructions["resources"]> {
  const resources: MaterializedIndexerInstructions["resources"] = [];
  let totalBytes = 0;
  for (const descriptor of input.descriptors) {
    const absolute = descriptor.kind !== "customization-append"
      ? join(input.staged.stage_path, descriptor.path)
      : join(input.workspaceRoot, "src", "indexer", input.customization.indexer_id, descriptor.path);
    const bytes = await readFile(absolute);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_INSTRUCTION_BYTES) {
      throw new TypeError("materialized Indexer instructions exceed the fixed byte budget");
    }
    const expectedDigest = descriptor.digest;
    const rawDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (rawDigest !== expectedDigest) {
      throw new TypeError(`Indexer instruction ${descriptor.resource_ref} changed after validation`);
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new TypeError(`Indexer instruction ${descriptor.resource_ref} is not valid UTF-8`);
    }
    if (content.includes("\0")) {
      throw new TypeError(`Indexer instruction ${descriptor.resource_ref} contains a NUL byte`);
    }
    resources.push({
      kind: descriptor.kind,
      resource_ref: descriptor.resource_ref,
      digest: descriptor.digest,
      content,
    });
  }
  return resources;
}

export async function buildIndexerInstructionMaterializationRequest(input: {
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  indexerId: string;
  providerId: string;
  requirementSetDigest: string;
  worksetRef: string;
  worksetDigest: string;
  profile: string;
  composerId?: string;
}): Promise<IndexerInstructionMaterializationRequest> {
  validateStagedIndexerProviderBundle(input.staged, input.bundle);
  await assertStageCurrent(input.staged);
  if (
    input.customization.indexer_id !== input.indexerId ||
    input.customization.provider.integrity !== input.bundle.resolved.integrity
  ) {
    throw new TypeError("instruction customization does not match the Provider request");
  }
  for (const value of [input.requirementSetDigest, input.worksetDigest]) {
    if (!DIGEST_RE.test(value)) throw new TypeError("instruction request requires canonical digests");
  }
  if (input.worksetRef.length === 0) throw new TypeError("instruction request requires a workset ref");
  const descriptors = await instructionDescriptors({
    staged: input.staged,
    profile: input.profile,
    composerId: input.composerId ?? null,
    customization: input.customization,
  });
  const base: Omit<IndexerInstructionMaterializationRequest, "request_digest"> = {
    protocol: "context.indexer.materialize-request/v1",
    handler: "context.materialize-indexer-instructions/v1",
    resource_id: "resolved-indexer-instructions",
    indexer_id: input.indexerId,
    provider_id: input.providerId,
    provider_fingerprint: input.staged.provider_fingerprint,
    provider_integrity: input.staged.bundle_integrity,
    manifest_digest: input.staged.manifest_digest,
    requirement_set_digest: input.requirementSetDigest,
    workset_ref: input.worksetRef,
    workset_digest: input.worksetDigest,
    profile: input.profile,
    composer_id: input.composerId ?? null,
    instruction_set_digest: indexerProtocolDigest(descriptors.map((descriptor) => ({
      kind: descriptor.kind,
      resource_ref: descriptor.resource_ref,
      digest: descriptor.digest,
    }))),
    customization_fingerprint: input.customization.fingerprint,
  };
  return { ...base, request_digest: requestDigest(base) };
}

export async function materializeIndexerInstructions(input: {
  request: IndexerInstructionMaterializationRequest;
  currentAuthority: IndexerInstructionMaterializationAuthority;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
}): Promise<MaterializedIndexerInstructions> {
  if (!isAbsolute(input.workspaceRoot)) throw new TypeError("workspace root must be absolute");
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  assertCurrentMaterializationAuthority({
    request,
    current: input.currentAuthority,
  });
  validateStagedIndexerProviderBundle(input.staged, input.bundle);
  await assertStageCurrent(input.staged);
  if (input.request.request_digest !== requestDigest(input.request)) {
    throw new TypeError("instruction materialization request digest does not match its semantic input");
  }
  if (
    input.request.provider_fingerprint !== input.staged.provider_fingerprint ||
    input.request.provider_integrity !== input.staged.bundle_integrity ||
    input.request.manifest_digest !== input.staged.manifest_digest ||
    input.request.customization_fingerprint !== input.customization.fingerprint ||
    input.request.indexer_id !== input.customization.indexer_id ||
    input.request.indexer_id !== input.bundle.request.indexer_id ||
    input.request.provider_id !== input.bundle.request.provider_id
  ) {
    throw new TypeError("instruction materialization request is stale");
  }
  const descriptors = await instructionDescriptors({
    staged: input.staged,
    profile: input.request.profile,
    composerId: input.request.composer_id,
    customization: input.customization,
  });
  const expectedSetDigest = indexerProtocolDigest(descriptors.map((descriptor) => ({
    kind: descriptor.kind,
    resource_ref: descriptor.resource_ref,
    digest: descriptor.digest,
  })));
  if (input.request.instruction_set_digest !== expectedSetDigest) {
    throw new TypeError("instruction materialization request resource set is stale");
  }
  const resources = await readInstructionResources({
    descriptors,
    staged: input.staged,
    workspaceRoot: input.workspaceRoot,
    customization: input.customization,
  });
  const payloadDigest = indexerProtocolDigest({
    protocol: "context.indexer.materialized-instructions-payload/v1",
    request_digest: input.request.request_digest,
    provider_fingerprint: input.staged.provider_fingerprint,
    resources,
  });
  const receipt = {
    staged_receipt_digest: input.staged.receipt_digest,
    provider_source_receipt_digest: input.staged.source_receipt_digest,
    customization_fingerprint: input.customization.fingerprint,
    receipt_digest: materializationReceiptDigest({
      request_digest: input.request.request_digest,
      payload_digest: payloadDigest,
      staged_receipt_digest: input.staged.receipt_digest,
      provider_source_receipt_digest: input.staged.source_receipt_digest,
      customization_fingerprint: input.customization.fingerprint,
    }),
  };
  return {
    protocol: "context.indexer.materialized-resource/v1",
    request_digest: input.request.request_digest,
    provider_fingerprint: input.staged.provider_fingerprint,
    resources,
    payload_digest: payloadDigest,
    context_receipt: receipt,
  };
}

export function validateMaterializedIndexerInstructions(
  value: MaterializedIndexerInstructions,
  request: IndexerInstructionMaterializationRequest,
): void {
  if (
    value.protocol !== "context.indexer.materialized-resource/v1" ||
    value.request_digest !== request.request_digest ||
    value.provider_fingerprint !== request.provider_fingerprint
  ) {
    throw new TypeError("materialized Indexer instructions do not match their request");
  }
  const payloadDigest = indexerProtocolDigest({
    protocol: "context.indexer.materialized-instructions-payload/v1",
    request_digest: value.request_digest,
    provider_fingerprint: value.provider_fingerprint,
    resources: value.resources,
  });
  if (value.payload_digest !== payloadDigest) {
    throw new TypeError("materialized Indexer instruction payload digest is invalid");
  }
  const resourceSetDigest = indexerProtocolDigest(value.resources.map((resource) => ({
    kind: resource.kind,
    resource_ref: resource.resource_ref,
    digest: resource.digest,
  })));
  if (resourceSetDigest !== request.instruction_set_digest) {
    throw new TypeError("materialized Indexer instruction resource set is invalid");
  }
  const receiptDigest = materializationReceiptDigest({
    request_digest: value.request_digest,
    payload_digest: value.payload_digest,
    staged_receipt_digest: value.context_receipt.staged_receipt_digest,
    provider_source_receipt_digest: value.context_receipt.provider_source_receipt_digest,
    customization_fingerprint: value.context_receipt.customization_fingerprint,
  });
  if (
    value.context_receipt.customization_fingerprint !== request.customization_fingerprint ||
    value.context_receipt.receipt_digest !== receiptDigest
  ) {
    throw new TypeError("materialized Indexer instruction receipt is invalid");
  }
}

export interface IndexerInstructionHostManagedOutput {
  ref: string;
  digest: string;
  value: unknown;
}

export function indexerInstructionHostLocation(
  value: unknown,
): ResourceLocationV2 {
  const request = validateIndexerInstructionMaterializationRequest(value);
  return {
    schema: "agent-graph.resource-location.v2",
    id: request.resource_id,
    kind: "procedure",
    mediaType: "text/markdown",
    revision: request.request_digest,
    materialize: {
      handler: request.handler,
      input: {
        schema: request.protocol,
        value: request as unknown as JsonValue,
      },
      output_schema: "context.indexer.materialized-resource/v1",
    },
  };
}

export async function materializeIndexerInstructionHostAction(input: {
  request: unknown;
  currentAuthority: IndexerInstructionMaterializationAuthority;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
  adapter: string;
  adapterVersion: string;
}): Promise<{ result: HostActionResult; materialized: MaterializedIndexerInstructions }> {
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  const location = indexerInstructionHostLocation(request);
  const materialized = await materializeIndexerInstructions({
    request,
    currentAuthority: input.currentAuthority,
    bundle: input.bundle,
    staged: input.staged,
    customization: input.customization,
    workspaceRoot: input.workspaceRoot,
  });
  const result: HostActionResult = {
    schema: "agent-graph.host-action-result.v1",
    handler: location.materialize.handler,
    input_digest: hostActionInputDigest(location),
    output: {
      schema: location.materialize.output_schema,
      inline: materialized as unknown as JsonValue,
    },
    receipt: {
      adapter: input.adapter,
      adapter_version: input.adapterVersion,
    },
  };
  await validateHostActionResult(location, result);
  return { result, materialized };
}

function materializedHostOutput(input: {
  result: HostActionResult;
  managed_output?: IndexerInstructionHostManagedOutput;
}): unknown {
  if ("inline" in input.result.output) return input.result.output.inline;
  if (input.managed_output === undefined) {
    throw new TypeError("Indexer instruction Host result requires its managed resource output");
  }
  if (
    input.managed_output.ref !== input.result.output.resource.ref ||
    input.managed_output.digest !== input.result.output.resource.digest
  ) {
    throw new TypeError("Indexer instruction managed resource does not match the Host result");
  }
  return input.managed_output.value;
}

export async function consumeIndexerInstructionHostResult(input: {
  request: unknown;
  currentAuthority: IndexerInstructionMaterializationAuthority;
  result: HostActionResult;
  managed_output?: IndexerInstructionHostManagedOutput;
}): Promise<{
  materialized: MaterializedIndexerInstructions;
  input_digest: string;
  output_digest: string;
  host_receipt: HostActionResult["receipt"];
}> {
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  assertCurrentMaterializationAuthority({
    request,
    current: input.currentAuthority,
  });
  const location = indexerInstructionHostLocation(request);
  await validateHostActionResult(location, input.result);
  const materialized = materializedHostOutput({
    result: input.result,
    ...(input.managed_output === undefined ? {} : { managed_output: input.managed_output }),
  }) as MaterializedIndexerInstructions;
  validateMaterializedIndexerInstructions(materialized, request);
  return {
    materialized,
    input_digest: input.result.input_digest,
    output_digest: hostActionOutputDigest(input.result),
    host_receipt: input.result.receipt,
  };
}
