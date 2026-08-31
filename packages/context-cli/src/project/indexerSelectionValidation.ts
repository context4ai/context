import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndexerProviderCompositionPlan,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerProtocolDigest,
  indexerRegistryDigests,
  loadIndexerProviderManifest,
  resolveIndexerBaseQuestionBindingAuthority,
  resolveIndexerOverlayQuestionBindingAuthority,
  resolveIndexerSubjectKeySchemas,
  resolvedProviderStableFingerprint,
  validateFinalizedIndexerRegistry,
  validateIndexerProviderContractReferences,
  validateIndexerProfileContract,
  type IndexerJson,
  type IndexerProviderManifest,
  type IndexerRegistry,
  type IndexerRegistryEntry,
  type IndexerOverlayQuestionAuthorityProof,
  type IndexerProviderCompositionPlan,
  type IndexerResolvedSubjectKeySchema,
  type IndexerSubjectKeyProviderAuthority,
  type IndexerSubjectKeyProfileSelection,
  type ResolvedProviderBundle,
} from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import { validateIndexerProviderConfig } from "./indexerConfigSchema.js";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import {
  validateStagedIndexerProviderBundle,
  type StagedIndexerProviderBundle,
} from "./indexerProviderStage.js";

export interface IndexerSelectionStaticReport {
  protocol: "context.indexer.selection-static-report/v1";
  requirement_set_digest: string;
  indexer_selection_digest: string;
  registry_digest: string;
  provider_requests: Array<{
    indexer_id: string;
    provider_id: string;
    skill: string;
    version: string;
    integrity: string;
    distribution: IndexerRegistryEntry["providers"][number]["distribution"];
    config_digest: string;
  }>;
  report_digest: string;
}

export interface IndexerResolvedSelectionInput {
  indexer_id: string;
  provider_id: string;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  execution_policy_digest: string | null;
}

export interface IndexerSelectionFinalReport {
  protocol: "context.indexer.selection-final-report/v1";
  static_report_digest: string;
  requirement_set_digest: string;
  indexer_selection_digest: string;
  question_authority_set_digest: string;
  subject_key_schema_set_digest: string;
  subject_key_schemas: IndexerResolvedSubjectKeySchema[];
  composition_plans: IndexerProviderCompositionPlan[];
  providers: Array<{
    indexer_id: string;
    provider_id: string;
    provider_fingerprint: string;
    bundle_integrity: string;
    manifest_digest: string;
    config_digest: string;
    customization_fingerprint: string;
    execution_policy_digest: string | null;
  }>;
  report_digest: string;
  runtime_receipts: Array<{
    indexer_id: string;
    provider_id: string;
    resolved_receipt_digest: string;
    staged_receipt_digest: string;
  }>;
}

function staticReportPayload(
  value: Omit<IndexerSelectionStaticReport, "report_digest">,
): Omit<IndexerSelectionStaticReport, "report_digest"> {
  return value;
}

function selectionKey(indexerId: string, providerId: string): string {
  return `${indexerId}\u0000${providerId}`;
}

function providerRequests(registry: IndexerRegistry): IndexerSelectionStaticReport["provider_requests"] {
  return registry.indexers.flatMap((indexer) =>
    indexer.providers.map((provider) => ({
      indexer_id: indexer.id,
      provider_id: provider.id,
      skill: provider.skill,
      version: provider.version,
      integrity: provider.integrity,
      distribution: provider.distribution,
      config_digest: indexerProtocolDigest(provider.config ?? {}),
    }))
  ).sort((left, right) => compareIndexerCanonicalText(
    selectionKey(left.indexer_id, left.provider_id),
    selectionKey(right.indexer_id, right.provider_id),
  ));
}

export function validateIndexerSelectionStatic(
  registry: IndexerRegistry,
): IndexerSelectionStaticReport {
  validateFinalizedIndexerRegistry(registry);
  const digests = indexerRegistryDigests(registry);
  const base: Omit<IndexerSelectionStaticReport, "report_digest"> = {
    protocol: "context.indexer.selection-static-report/v1",
    requirement_set_digest: digests.requirementSetDigest,
    indexer_selection_digest: digests.indexerSelectionDigest,
    registry_digest: digests.registryDigest,
    provider_requests: providerRequests(registry),
  };
  return { ...base, report_digest: indexerProtocolDigest(staticReportPayload(base)) };
}

function sameFiles(
  left: readonly { path: string; digest: string }[],
  right: readonly { path: string; digest: string }[],
): boolean {
  return left.length === right.length && left.every((file, index) =>
    file.path === right[index]?.path && file.digest === right[index]?.digest
  );
}

function findLayer(indexer: IndexerRegistryEntry, providerId: string) {
  const layer = indexer.providers.find((provider) => provider.id === providerId);
  if (layer === undefined) throw new TypeError(`Indexer ${indexer.id} has no Provider ${providerId}`);
  return layer;
}

function providerProfileBindings(indexer: IndexerRegistryEntry, providerId: string) {
  return [indexer.profile.primary, ...(indexer.profile.additional ?? [])]
    .filter((profile) => profile.provider === providerId);
}

function providerContractTargetProfiles(input: {
  indexer: IndexerRegistryEntry;
  providerId: string;
}): string[] {
  const profiles = providerProfileBindings(input.indexer, input.providerId)
    .map((profile) => profile.id);
  if ((input.indexer.profile.composers ?? []).some((composer) =>
    composer.provider === input.providerId
  )) {
    profiles.push(input.indexer.profile.primary.id);
  }
  return [...new Set(profiles)];
}

function assertExpectedEnvelope(input: {
  request: IndexerSelectionStaticReport["provider_requests"][number];
  resolved: IndexerResolvedSelectionInput;
}): void {
  const bundle = input.resolved.bundle;
  if (
    input.resolved.indexer_id !== input.request.indexer_id ||
    input.resolved.provider_id !== input.request.provider_id ||
    bundle.request.indexer_id !== input.request.indexer_id ||
    bundle.request.provider_id !== input.request.provider_id ||
    bundle.request.skill !== input.request.skill ||
    bundle.request.version !== input.request.version ||
    bundle.resolved.integrity !== input.request.integrity ||
    canonicalIndexerJson(bundle.request.distribution) !== canonicalIndexerJson(input.request.distribution)
  ) {
    throw new TypeError("resolved Provider does not match the static selection report");
  }
  validateStagedIndexerProviderBundle(input.resolved.staged, bundle);
}

function assertManifestBindings(input: {
  indexer: IndexerRegistryEntry;
  providerId: string;
  manifest: IndexerProviderManifest;
}): void {
  const layer = findLayer(input.indexer, input.providerId);
  if (input.manifest.id !== layer.skill || input.manifest.version !== layer.version) {
    throw new TypeError("staged Provider manifest identity does not match the registry layer");
  }
  const profileBindings = providerProfileBindings(input.indexer, layer.id);
  for (const profile of profileBindings) {
    if (!input.manifest.provides.profiles.includes(profile.id)) {
      throw new TypeError(`Provider ${layer.id} does not provide selected profile ${profile.id}`);
    }
    if ("kind" in profile) {
      if (profile.kind === "supporting" && layer.role !== "primary") {
        throw new TypeError("supporting profiles must use the primary Provider layer");
      }
      if (
        profile.kind === "extension" &&
        (layer.role !== "extension" ||
          !(input.manifest.composition?.extensions ?? []).some((item) => item.profile === profile.id))
      ) {
        throw new TypeError("extension profile lacks its exact extension Provider authority");
      }
    }
  }
  const composers = (input.indexer.profile.composers ?? [])
    .filter((composer) => composer.provider === layer.id);
  for (const composer of composers) {
    const declared = (input.manifest.provides.composers ?? [])
      .find((item) => item.id === composer.id);
    if (
      declared === undefined ||
      !declared.supported_profiles.includes(input.indexer.profile.primary.id)
    ) {
      throw new TypeError(`Provider ${layer.id} does not declare selected composer ${composer.id}`);
    }
  }
  if (layer.role === "primary") {
    const operations = new Set(input.manifest.provides.operations.map((operation) => operation.id));
    const missing = input.indexer.operations.find((operation) => !operations.has(operation));
    if (missing !== undefined) {
      throw new TypeError(`primary Provider does not provide enabled operation ${missing}`);
    }
  }
}

function assertExtensionFragments(input: {
  indexer: IndexerRegistryEntry;
  manifests: Map<string, IndexerProviderManifest>;
}): void {
  const primary = input.indexer.providers.find((provider) => provider.role === "primary")!;
  const primaryManifest = input.manifests.get(primary.id)!;
  const accepted = new Set(primaryManifest.provides.operations
    .filter((operation) => input.indexer.operations.includes(operation.id))
    .flatMap((operation) => operation.accepts_layer_fragments ?? []));
  for (const layer of input.indexer.providers.filter((provider) => provider.role === "extension")) {
    const manifest = input.manifests.get(layer.id)!;
    const unsupported = (manifest.provides.layer_fragments ?? []).find((fragment) =>
      fragment.phase === "pre-authority" && !accepted.has(fragment.kind)
    );
    if (unsupported !== undefined) {
      throw new TypeError(`primary Provider does not accept extension fragment ${unsupported.kind}`);
    }
  }
}

async function validateConfig(input: {
  layer: IndexerRegistryEntry["providers"][number];
  manifest: IndexerProviderManifest;
  staged: StagedIndexerProviderBundle;
}): Promise<void> {
  const config = input.layer.config ?? {};
  const hasConfig = Object.keys(config).length > 0;
  const schemaPath = input.manifest.provider.config_schema;
  if (schemaPath === undefined) {
    if (hasConfig) throw new TypeError(`Provider ${input.layer.id} has config but no config_schema`);
    return;
  }
  const ledger = input.staged.files.find((file) => file.path === schemaPath);
  if (ledger === undefined) throw new TypeError("Provider config schema is absent from its Bundle ledger");
  const raw = await readFile(join(input.staged.stage_path, schemaPath), "utf8");
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) {
    throw new TypeError("Provider config schema exceeds its fixed byte budget");
  }
  let schema: unknown;
  try {
    schema = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("Provider config schema is invalid JSON");
  }
  validateIndexerProviderConfig(schema, config as Record<string, IndexerJson>);
}

function assertCustomization(input: {
  indexer: IndexerRegistryEntry;
  view: IndexerCustomizationView;
  primaryManifest: IndexerProviderManifest;
}): void {
  const expectedMode = input.indexer.customization?.mode ?? "none";
  const primary = input.indexer.providers.find((provider) => provider.role === "primary")!;
  if (
    input.view.indexer_id !== input.indexer.id ||
    input.view.mode !== expectedMode ||
    input.view.provider.skill !== primary.skill ||
    input.view.provider.version !== primary.version ||
    input.view.provider.integrity !== primary.integrity ||
    input.primaryManifest.id !== primary.skill
  ) {
    throw new TypeError(`Indexer ${input.indexer.id} customization view is stale`);
  }
}

function finalReportPayload(value: Omit<IndexerSelectionFinalReport, "report_digest" | "runtime_receipts">) {
  return value;
}

export async function validateIndexerSelectionFinal(input: {
  registry: IndexerRegistry;
  static_report: IndexerSelectionStaticReport;
  resolved: readonly IndexerResolvedSelectionInput[];
  customizations: readonly IndexerCustomizationView[];
  operator_contract: unknown;
  profile_contract: unknown;
  overlay_question_authorities?: readonly IndexerOverlayQuestionAuthorityProof[];
}): Promise<IndexerSelectionFinalReport> {
  const profileContract = validateIndexerProfileContract(
    input.profile_contract,
    input.operator_contract,
  );
  const expectedStatic = validateIndexerSelectionStatic(input.registry);
  if (canonicalIndexerJson(expectedStatic) !== canonicalIndexerJson(input.static_report)) {
    throw new TypeError("final selection does not consume the current static validation report");
  }
  const resolvedByKey = new Map(input.resolved.map((item) => [
    selectionKey(item.indexer_id, item.provider_id),
    item,
  ]));
  if (resolvedByKey.size !== input.resolved.length ||
    resolvedByKey.size !== expectedStatic.provider_requests.length) {
    throw new TypeError("final selection requires exactly one resolved Bundle per Provider layer");
  }
  const customizationByIndexer = new Map(input.customizations.map((view) => [view.indexer_id, view]));
  if (customizationByIndexer.size !== input.registry.indexers.length) {
    throw new TypeError("final selection requires one customization view per Indexer");
  }
  const missingCustomization = input.registry.indexers.find((indexer) =>
    !customizationByIndexer.has(indexer.id)
  );
  if (missingCustomization !== undefined) {
    throw new TypeError(`final selection is missing customization view for ${missingCustomization.id}`);
  }
  const providerReports: IndexerSelectionFinalReport["providers"] = [];
  const runtimeReceipts: IndexerSelectionFinalReport["runtime_receipts"] = [];
  const manifestsByIndexer = new Map<string, Map<string, IndexerProviderManifest>>();
  const subjectKeyProviders: IndexerSubjectKeyProviderAuthority[] = [];
  for (const request of expectedStatic.provider_requests) {
    const resolved = resolvedByKey.get(selectionKey(request.indexer_id, request.provider_id));
    if (resolved === undefined) throw new TypeError("final selection is missing a resolved Provider");
    assertExpectedEnvelope({ request, resolved });
    const actualFiles = await collectIndexerBundleFiles(resolved.staged.stage_path);
    if (!sameFiles(actualFiles, resolved.staged.files)) {
      throw new TypeError("staged Provider changed before final selection validation");
    }
    const manifest = await loadIndexerProviderManifest(resolved.staged.stage_path);
    const indexer = input.registry.indexers.find((item) => item.id === request.indexer_id)!;
    assertManifestBindings({ indexer, providerId: request.provider_id, manifest });
    validateIndexerProviderContractReferences({
      manifest,
      selected_profiles: providerContractTargetProfiles({
        indexer,
        providerId: request.provider_id,
      }),
      profile_contract: profileContract,
      operator_contract: input.operator_contract,
    });
    const layer = findLayer(indexer, request.provider_id);
    await validateConfig({ layer, manifest, staged: resolved.staged });
    const hasExecutable = manifest.provider.program !== undefined ||
      manifest.activation.detector !== undefined || manifest.authoring_inspector !== undefined;
    if (hasExecutable !== (resolved.execution_policy_digest !== null)) {
      throw new TypeError("executable Provider resources require one exact execution policy digest");
    }
    const manifestMap = manifestsByIndexer.get(indexer.id) ?? new Map();
    manifestMap.set(layer.id, manifest);
    manifestsByIndexer.set(indexer.id, manifestMap);
    subjectKeyProviders.push({
      indexer_id: indexer.id,
      provider_layer_id: layer.id,
      provider_integrity: resolved.bundle.resolved.integrity,
      manifest_digest: resolved.bundle.resolved.manifest_digest,
      manifest,
    });
    providerReports.push({
      indexer_id: indexer.id,
      provider_id: layer.id,
      provider_fingerprint: resolvedProviderStableFingerprint(resolved.bundle),
      bundle_integrity: resolved.bundle.resolved.integrity,
      manifest_digest: resolved.bundle.resolved.manifest_digest,
      config_digest: request.config_digest,
      customization_fingerprint: customizationByIndexer.get(indexer.id)!.fingerprint,
      execution_policy_digest: resolved.execution_policy_digest,
    });
    runtimeReceipts.push({
      indexer_id: indexer.id,
      provider_id: layer.id,
      resolved_receipt_digest: resolved.bundle.receipt.receipt_digest,
      staged_receipt_digest: resolved.staged.receipt_digest,
    });
  }
  const subjectKeySelections: IndexerSubjectKeyProfileSelection[] = input.registry.indexers
    .flatMap((indexer) => [{
      indexer_id: indexer.id,
      profile: indexer.profile.primary.id,
      role: "primary" as const,
      provider_layer_id: indexer.profile.primary.provider,
    }, ...(indexer.profile.additional ?? []).map((profile) => ({
      indexer_id: indexer.id,
      profile: profile.id,
      role: profile.kind,
      provider_layer_id: profile.provider,
    }))]);
  const subjectKeySchemas = resolveIndexerSubjectKeySchemas({
    profile_contract: profileContract,
    operator_contract: input.operator_contract,
    selections: subjectKeySelections,
    providers: subjectKeyProviders,
  });
  const overlayProofs = input.overlay_question_authorities ?? [];
  const usedOverlayProofs = new Set<number>();
  const resolvedQuestions = input.registry.requirements.flatMap((requirement) =>
    (requirement.questions ?? []).map((binding) => {
      if (binding.authority.kind === "cli-base-contract") {
        return {
          requirement_id: requirement.id,
          question: resolveIndexerBaseQuestionBindingAuthority({
            registry: input.registry,
            requirement_id: requirement.id,
            binding,
            profile_contract: input.profile_contract,
            operator_contract: input.operator_contract,
          }),
        };
      }
      const matching = overlayProofs.flatMap((proof, index) => {
        const overlay = proof.overlay_validation.overlay;
        const authorityRef = `overlay:${overlay.id}/${overlay.version}`;
        return proof.requirement_id === requirement.id &&
          authorityRef === binding.authority.ref &&
          overlay.overlay_digest === binding.authority.digest
          ? [{ proof, index }]
          : [];
      });
      if (matching.length !== 1) {
        throw new TypeError("overlay question binding requires one exact current authority proof");
      }
      const currentProof = matching[0]!.proof;
      const overlayQuestion = currentProof.overlay_validation.overlay.additions
        .reader_question_contracts?.find((question) => question.ref === binding.ref);
      const owner = overlayQuestion === undefined
        ? undefined
        : input.registry.indexers.find((indexer) =>
            indexer.requirement_bindings.some((ownerBinding) =>
              ownerBinding.requirement_ref === requirement.id &&
              ownerBinding.role === "primary" &&
              ownerBinding.coverage_domains.includes(overlayQuestion.coverage_domain)
            )
          );
      const currentPrimary = owner === undefined
        ? undefined
        : resolvedByKey.get(selectionKey(owner.id, owner.profile.primary.provider));
      if (
        currentPrimary === undefined ||
        currentProof.provider_integrity !== currentPrimary.bundle.resolved.integrity
      ) {
        throw new TypeError("overlay question authority proof is stale for the current primary Provider");
      }
      usedOverlayProofs.add(matching[0]!.index);
      return {
        requirement_id: requirement.id,
        question: resolveIndexerOverlayQuestionBindingAuthority({
          registry: input.registry,
          binding,
          base_contract: input.profile_contract as Parameters<
            typeof resolveIndexerOverlayQuestionBindingAuthority
          >[0]["base_contract"],
          operator_contract: input.operator_contract as Parameters<
            typeof resolveIndexerOverlayQuestionBindingAuthority
          >[0]["operator_contract"],
          proof: matching[0]!.proof,
        }),
      };
    })
  ).sort((left, right) => compareIndexerCanonicalText(
    `${left.requirement_id}\u0000${left.question.ref}`,
    `${right.requirement_id}\u0000${right.question.ref}`,
  ));
  if (usedOverlayProofs.size !== overlayProofs.length) {
    throw new TypeError("final selection contains an unused or duplicate overlay question authority proof");
  }
  const compositionPlans: IndexerProviderCompositionPlan[] = [];
  for (const indexer of input.registry.indexers) {
    const manifests = manifestsByIndexer.get(indexer.id)!;
    assertExtensionFragments({ indexer, manifests });
    const primary = indexer.providers.find((provider) => provider.role === "primary")!;
    assertCustomization({
      indexer,
      view: customizationByIndexer.get(indexer.id)!,
      primaryManifest: manifests.get(primary.id)!,
    });
    const customization = customizationByIndexer.get(indexer.id)!;
    compositionPlans.push(buildIndexerProviderCompositionPlan({
      indexer,
      profile_contract: profileContract,
      resolved_layers: indexer.providers.map((layer) => {
        const resolved = resolvedByKey.get(selectionKey(indexer.id, layer.id))!;
        return {
          layer_id: layer.id,
          provider_integrity: resolved.bundle.resolved.integrity,
          manifest_digest: resolved.bundle.resolved.manifest_digest,
          manifest: manifests.get(layer.id)!,
        };
      }),
      customization: {
        mode: customization.mode,
        fingerprint: customization.fingerprint,
        files: customization.files,
        plan: customization.plan,
      },
    }));
  }
  providerReports.sort((left, right) => compareIndexerCanonicalText(
    selectionKey(left.indexer_id, left.provider_id),
    selectionKey(right.indexer_id, right.provider_id),
  ));
  runtimeReceipts.sort((left, right) => compareIndexerCanonicalText(
    selectionKey(left.indexer_id, left.provider_id),
    selectionKey(right.indexer_id, right.provider_id),
  ));
  compositionPlans.sort((left, right) => compareIndexerCanonicalText(
    left.indexer_id,
    right.indexer_id,
  ));
  const base = {
    protocol: "context.indexer.selection-final-report/v1" as const,
    static_report_digest: expectedStatic.report_digest,
    requirement_set_digest: expectedStatic.requirement_set_digest,
    indexer_selection_digest: expectedStatic.indexer_selection_digest,
    question_authority_set_digest: indexerProtocolDigest({
      questions: resolvedQuestions,
    }),
    subject_key_schema_set_digest: subjectKeySchemas.set_digest,
    subject_key_schemas: subjectKeySchemas.schemas,
    composition_plans: compositionPlans,
    providers: providerReports,
  };
  return {
    ...base,
    report_digest: indexerProtocolDigest(finalReportPayload(base)),
    runtime_receipts: runtimeReceipts,
  };
}
