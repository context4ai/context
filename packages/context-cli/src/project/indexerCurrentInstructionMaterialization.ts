import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  indexerProtocolDigest,
  loadIndexerProviderManifest,
} from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  MAX_INSTRUCTION_BYTES,
  materializationReceiptDigest,
  requestDigest,
  validateIndexerInstructionMaterializationRequest,
  type IndexerInstructionMaterializationRequest,
  type MaterializedIndexerInstructions,
} from "./indexerInstructionMaterialization.js";

interface CurrentInstructionDescriptor {
  kind: "provider" | "template" | "composer" | "customization-append";
  location: "staged" | "workspace";
  path: string;
  digest: string;
  resource_ref: string;
  bundle_root?: string;
}

export interface CurrentCliInstructionAuthority {
  bundle_root: string;
  bundle_files: readonly { path: string; digest: string }[];
  release_bundle: { manifest_digest: string };
  provider: { id: string; integrity: string };
  manifest: Awaited<ReturnType<typeof loadIndexerProviderManifest>>;
  profile: { id: string };
  primary_execution: { primary_execution_fingerprint: string };
  layers?: readonly {
    layer: { id: string; role: "primary" | "extension" };
    bundle_root: string;
    bundle_files: readonly { path: string; digest: string }[];
    manifest: Awaited<ReturnType<typeof loadIndexerProviderManifest>>;
  }[];
  indexer: {
    id: string;
    profile: {
      primary: { id: string; provider: string };
      additional?: readonly { id: string; provider: string }[] | undefined;
      composers?: readonly { id: string; provider: string }[] | undefined;
    };
  };
}

function currentCliInstructionDescriptors(input: {
  authority: CurrentCliInstructionAuthority;
  composerId: string | null;
  customization: IndexerCustomizationView;
}): CurrentInstructionDescriptor[] {
  const { authority, customization } = input;
  const layers = authority.layers ?? [{
    layer: { id: authority.provider.id, role: "primary" as const },
    bundle_root: authority.bundle_root,
    bundle_files: authority.bundle_files,
    manifest: authority.manifest,
  }];
  const profileBindings = [
    authority.indexer.profile.primary,
    ...(authority.indexer.profile.additional ?? []),
  ];
  const descriptors: CurrentInstructionDescriptor[] = [];
  for (const layer of layers) {
    const activeProfiles = profileBindings
      .filter((profile) => profile.provider === layer.layer.id)
      .map((profile) => profile.id);
    const fileByPath = new Map(layer.bundle_files.map((file) => [file.path, file]));
    descriptors.push(...(layer.manifest.provider.instructions ?? [])
      .filter((instruction) => instruction.profiles.some((id) => activeProfiles.includes(id)))
      .map((instruction) => {
        const file = fileByPath.get(instruction.path);
        if (file === undefined) {
          throw new TypeError(`current Provider has no declared instruction ${instruction.path}`);
        }
        return {
          kind: "provider" as const,
          location: "staged" as const,
          path: instruction.path,
          digest: file.digest,
          bundle_root: layer.bundle_root,
          resource_ref: `provider-instruction:${indexerProtocolDigest({
            provider: layer.manifest.id,
            version: layer.manifest.version,
            path: instruction.path,
          })}`,
        };
      }));
    descriptors.push(...(layer.manifest.provider.templates ?? [])
      .filter((template) => activeProfiles.includes(template.profile))
      .map((template) => {
        const override = layer.layer.role === "primary"
          ? customization.files.find((file) => file.path === `templates/${template.id}.md`)
          : undefined;
        const file = fileByPath.get(template.path);
        if (override === undefined && file === undefined) {
          throw new TypeError(`current Provider has no declared template ${template.path}`);
        }
        return override === undefined
          ? {
              kind: "template" as const,
              location: "staged" as const,
              path: template.path,
              digest: file!.digest,
              bundle_root: layer.bundle_root,
              resource_ref: `provider-template:${indexerProtocolDigest({
                provider: layer.manifest.id,
                version: layer.manifest.version,
                profile: template.profile,
                template: template.id,
                path: template.path,
              })}`,
            }
          : {
              kind: "template" as const,
              location: "workspace" as const,
              path: override.path,
              digest: override.digest,
              resource_ref:
                `customization-template:${customization.indexer_id}#${template.profile}/${template.id}`,
            };
      }));
  }
  if (input.composerId !== null) {
    const selected = authority.indexer.profile.composers?.filter((candidate) =>
      candidate.id === input.composerId
    ) ?? [];
    if (selected.length > 1) {
      throw new TypeError(`current Composer ${input.composerId} is ambiguous across Provider layers`);
    }
    const layer = layers.find((candidate) =>
      candidate.layer.id === (selected[0]?.provider ?? authority.provider.id)
    );
    const composer = layer?.manifest.provides.composers?.find((candidate) =>
      candidate.id === input.composerId
    );
    const instructionPath = composer?.contract?.instruction;
    const file = instructionPath === undefined
      ? undefined
      : layer?.bundle_files.find((candidate) => candidate.path === instructionPath);
    if (
      composer === undefined ||
      instructionPath === undefined ||
      !composer.supported_profiles.includes(authority.profile.id) ||
      file === undefined
    ) {
      throw new TypeError(
        `current CLI Provider composer ${input.composerId} has no instruction for ${authority.profile.id}`,
      );
    }
    descriptors.push({
      kind: "composer",
      location: "staged",
      path: instructionPath,
      digest: file.digest,
      bundle_root: layer!.bundle_root,
      resource_ref: `provider-composer-instruction:${indexerProtocolDigest({
        provider: layer!.manifest.id,
        version: layer!.manifest.version,
        composer: composer.id,
        path: instructionPath,
      })}`,
    });
  }
  const append = customization.files.find((file) => file.path === "instructions.md");
  if (append !== undefined) {
    descriptors.push({
      kind: "customization-append",
      location: "workspace",
      path: append.path,
      digest: append.digest,
      resource_ref: `customization-instruction:${customization.indexer_id}#${append.digest}`,
    });
  }
  if (descriptors.length === 0) {
    throw new TypeError(`Provider has no instructions for active profile ${authority.profile.id}`);
  }
  return descriptors.sort((left, right) => left.resource_ref.localeCompare(right.resource_ref));
}

export function buildCurrentIndexerInstructionMaterializationRequest(input: {
  authority: CurrentCliInstructionAuthority;
  customization: IndexerCustomizationView;
  requirementSetDigest: string;
  worksetDigest: string;
  composerId?: string;
}): IndexerInstructionMaterializationRequest {
  const descriptors = currentCliInstructionDescriptors({
    authority: input.authority,
    composerId: input.composerId ?? null,
    customization: input.customization,
  });
  const base: Omit<IndexerInstructionMaterializationRequest, "request_digest"> = {
    protocol: "context.indexer.materialize-request/v1",
    handler: "context.materialize-indexer-instructions/v1",
    resource_id: "resolved-indexer-instructions",
    indexer_id: input.authority.indexer.id,
    provider_id: input.authority.provider.id,
    provider_fingerprint:
      input.authority.primary_execution.primary_execution_fingerprint,
    provider_integrity: input.authority.provider.integrity,
    manifest_digest: input.authority.release_bundle.manifest_digest,
    requirement_set_digest: input.requirementSetDigest,
    workset_ref: `workset:${input.worksetDigest}`,
    workset_digest: input.worksetDigest,
    profile: input.authority.profile.id,
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

export async function materializeCurrentIndexerInstructions(input: {
  request: unknown;
  authority: CurrentCliInstructionAuthority;
  customization: IndexerCustomizationView;
  workspaceRoot: string;
}): Promise<MaterializedIndexerInstructions> {
  const request = validateIndexerInstructionMaterializationRequest(input.request);
  const expected = buildCurrentIndexerInstructionMaterializationRequest({
    authority: input.authority,
    customization: input.customization,
    requirementSetDigest: request.requirement_set_digest,
    worksetDigest: request.workset_digest,
    ...(request.composer_id === null ? {} : { composerId: request.composer_id }),
  });
  if (expected.request_digest !== request.request_digest) {
    throw new TypeError("instruction materialization request is stale for the current CLI Provider");
  }
  const descriptors = currentCliInstructionDescriptors({
    authority: input.authority,
    composerId: request.composer_id,
    customization: input.customization,
  });
  const resources: MaterializedIndexerInstructions["resources"] = [];
  let totalBytes = 0;
  for (const descriptor of descriptors) {
    const absolute = descriptor.location === "staged"
      ? join(descriptor.bundle_root ?? input.authority.bundle_root, descriptor.path)
      : join(input.workspaceRoot, "src", "indexer", request.indexer_id, descriptor.path);
    const bytes = await readFile(absolute);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_INSTRUCTION_BYTES) {
      throw new TypeError("materialized Indexer instructions exceed the fixed byte budget");
    }
    const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actualDigest !== descriptor.digest) {
      throw new TypeError(`Indexer instruction ${descriptor.resource_ref} changed after validation`);
    }
    resources.push({
      kind: descriptor.kind,
      resource_ref: descriptor.resource_ref,
      digest: descriptor.digest,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    });
  }
  const payloadDigest = indexerProtocolDigest({
    protocol: "context.indexer.materialized-instructions-payload/v1",
    request_digest: request.request_digest,
    provider_fingerprint: request.provider_fingerprint,
    resources,
  });
  const contextReceipt = {
    staged_receipt_digest: request.provider_integrity,
    provider_source_receipt_digest: request.manifest_digest,
    customization_fingerprint: request.customization_fingerprint,
    receipt_digest: materializationReceiptDigest({
      request_digest: request.request_digest,
      payload_digest: payloadDigest,
      staged_receipt_digest: request.provider_integrity,
      provider_source_receipt_digest: request.manifest_digest,
      customization_fingerprint: request.customization_fingerprint,
    }),
  };
  return {
    protocol: "context.indexer.materialized-resource/v1",
    request_digest: request.request_digest,
    provider_fingerprint: request.provider_fingerprint,
    resources,
    payload_digest: payloadDigest,
    context_receipt: contextReceipt,
  };
}
