import { z } from "zod";
import {
  canonicalIndexerJson,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
} from "./indexerProtocolCommon.js";
import {
  indexerArtifactPolicyVariantSchema,
  indexerInventoryDomainSchema,
  indexerMetricContractSchema,
  indexerProfileContractDigest,
  indexerQuestionTargetDomainSchema,
  indexerReaderQuestionContractSchema,
  validateIndexerProfileContract,
  validateIndexerOperatorContract,
  type IndexerMetricContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProfileContractEntry,
} from "./indexerProfileContract.js";

const minimumTighteningSchema = z.object({
  metric_ref: indexerIdSchema,
  direction: z.literal("minimum"),
  recommended_min: z.number().finite().optional(),
  hard_min: z.number().finite().optional(),
}).strict().superRefine((value, context) => {
  if (value.recommended_min === undefined && value.hard_min === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "minimum tightening must provide recommended_min or hard_min",
    });
  }
});

const maximumTighteningSchema = z.object({
  metric_ref: indexerIdSchema,
  direction: z.literal("maximum"),
  recommended_max: z.number().finite().nonnegative().optional(),
  hard_max: z.number().finite().nonnegative().optional(),
}).strict().superRefine((value, context) => {
  if (value.recommended_max === undefined && value.hard_max === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "maximum tightening must provide recommended_max or hard_max",
    });
  }
});

const metricTighteningSchema = z.union([
  minimumTighteningSchema,
  maximumTighteningSchema,
]);

const artifactPolicyThresholdTighteningSchema = z.object({
  variant_ref: indexerIdSchema,
  metric_ref: indexerIdSchema,
  recommended_max: z.number().finite().nonnegative(),
}).strict();

export const indexerContractOverlaySchema = z.object({
  protocol: z.literal("context.indexer.contract-overlay/v1"),
  id: indexerIdSchema,
  version: indexerSemverSchema,
  extends: z.object({
    profile: indexerIdSchema,
    version: indexerSemverSchema,
    contract_digest: indexerDigestSchema,
  }).strict(),
  operator_contract_version: indexerSemverSchema,
  operator_contract_digest: indexerDigestSchema,
  additions: z.object({
    inventory_domains: z.array(indexerInventoryDomainSchema).optional(),
    required_dispositions: z.array(indexerIdSchema).optional(),
    metrics: z.array(indexerMetricContractSchema).optional(),
    artifact_policy_variants: z.array(indexerArtifactPolicyVariantSchema).optional(),
    question_target_domains: z.array(indexerQuestionTargetDomainSchema).optional(),
    reader_question_contracts: z.array(indexerReaderQuestionContractSchema).optional(),
  }).strict(),
  metric_tightenings: z.array(metricTighteningSchema).optional(),
  artifact_policy_threshold_tightenings: z.array(
    artifactPolicyThresholdTighteningSchema,
  ).optional(),
  overlay_digest: indexerDigestSchema,
}).strict();

export type IndexerContractOverlay = z.infer<typeof indexerContractOverlaySchema>;

export function indexerContractOverlayDigest(
  overlay: Omit<IndexerContractOverlay, "overlay_digest">,
): string {
  return indexerProtocolDigest(overlay);
}

export interface IndexerOverlayConformanceReport {
  protocol: "context.indexer.overlay-conformance-report/v1";
  overlay_digest: string;
  base_contract_digest: string;
  operator_contract_digest: string;
  monotonic: true;
  added_refs: string[];
  tightened_metric_refs: string[];
  tightened_artifact_policy_refs: string[];
  report_digest: string;
}

function withoutFields<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const omitted = new Set<PropertyKey>(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  ) as Omit<T, K>;
}

function profileById(
  contract: IndexerProfileContract,
  profileId: string,
): IndexerProfileContractEntry {
  const profile = contract.profiles.find((item) => item.id === profileId);
  if (profile === undefined) {
    throw new TypeError(`overlay extends unknown base profile ${profileId}`);
  }
  return profile;
}

function duplicateIds(
  base: readonly string[],
  additions: readonly string[],
  field: string,
): void {
  const baseIds = new Set(base);
  const duplicate = additions.find((id, index) =>
    baseIds.has(id) || additions.indexOf(id) !== index
  );
  if (duplicate !== undefined) {
    throw new TypeError(`overlay ${field} cannot redefine ${duplicate}`);
  }
}

function tightenMetric(
  metric: IndexerMetricContract,
  tightening: z.infer<typeof metricTighteningSchema>,
): IndexerMetricContract {
  if (metric.threshold_policy !== "explicit" || metric.direction !== tightening.direction) {
    throw new TypeError(
      `overlay metric tightening is incompatible with ${tightening.metric_ref}`,
    );
  }
  if (metric.direction === "minimum" && tightening.direction === "minimum") {
    const recommended = tightening.recommended_min ?? metric.recommended_min;
    const hard = tightening.hard_min ?? metric.hard_min;
    if (recommended < metric.recommended_min || hard < metric.hard_min) {
      throw new TypeError(`overlay cannot lower minimum threshold ${metric.id}`);
    }
    return { ...metric, recommended_min: recommended, hard_min: hard };
  }
  if (metric.direction === "maximum" && tightening.direction === "maximum") {
    const recommended = tightening.recommended_max ?? metric.recommended_max;
    const hard = tightening.hard_max ?? metric.hard_max;
    if (recommended > metric.recommended_max || hard > metric.hard_max) {
      throw new TypeError(`overlay cannot raise maximum threshold ${metric.id}`);
    }
    return { ...metric, recommended_max: recommended, hard_max: hard };
  }
  throw new TypeError(`overlay metric tightening is incompatible with ${tightening.metric_ref}`);
}

function mergeOverlayProfile(
  base: IndexerProfileContractEntry,
  overlay: IndexerContractOverlay,
): IndexerProfileContractEntry {
  const additions = overlay.additions;
  duplicateIds(
    base.inventory_domains.map((item) => item.id),
    (additions.inventory_domains ?? []).map((item) => item.id),
    "inventory_domains",
  );
  duplicateIds(base.required_dispositions, additions.required_dispositions ?? [], "required_dispositions");
  duplicateIds(
    base.metrics.map((item) => item.id),
    (additions.metrics ?? []).map((item) => item.id),
    "metrics",
  );
  duplicateIds(
    base.artifact_policy_variants.map((item) => item.id),
    (additions.artifact_policy_variants ?? []).map((item) => item.id),
    "artifact_policy_variants",
  );
  duplicateIds(
    base.question_target_domains.map((item) => item.id),
    (additions.question_target_domains ?? []).map((item) => item.id),
    "question_target_domains",
  );
  duplicateIds(
    base.reader_question_contracts.map((item) => item.ref),
    (additions.reader_question_contracts ?? []).map((item) => item.ref),
    "reader_question_contracts",
  );
  const tightenings = new Map(
    (overlay.metric_tightenings ?? []).map((item) => [item.metric_ref, item]),
  );
  if (tightenings.size !== (overlay.metric_tightenings?.length ?? 0)) {
    throw new TypeError("overlay metric_tightenings must be unique by metric_ref");
  }
  const metrics = base.metrics.map((metric) => {
    const tightening = tightenings.get(metric.id);
    if (tightening === undefined) return metric;
    tightenings.delete(metric.id);
    return tightenMetric(metric, tightening);
  });
  if (tightenings.size > 0) {
    throw new TypeError(
      `overlay tightens unknown base metric ${[...tightenings.keys()][0]}`,
    );
  }
  const artifactTightenings = new Map(
    (overlay.artifact_policy_threshold_tightenings ?? []).map((item) => [
      `${item.variant_ref}\u0000${item.metric_ref}`,
      item,
    ]),
  );
  if (
    artifactTightenings.size !==
    (overlay.artifact_policy_threshold_tightenings?.length ?? 0)
  ) {
    throw new TypeError(
      "overlay artifact_policy_threshold_tightenings must be unique by variant and metric",
    );
  }
  const artifactPolicyVariants = base.artifact_policy_variants.map((variant) => {
    const thresholds = { ...variant.thresholds };
    for (const [metricRef, threshold] of Object.entries(variant.thresholds)) {
      const key = `${variant.id}\u0000${metricRef}`;
      const tightening = artifactTightenings.get(key);
      if (tightening === undefined) continue;
      if (tightening.recommended_max > threshold.recommended_max) {
        throw new TypeError(
          `overlay cannot raise artifact policy threshold ${variant.id}:${metricRef}`,
        );
      }
      thresholds[metricRef] = {
        recommended_max: tightening.recommended_max,
      };
      artifactTightenings.delete(key);
    }
    return { ...variant, thresholds };
  });
  if (artifactTightenings.size > 0) {
    const unresolved = [...artifactTightenings.values()][0]!;
    throw new TypeError(
      `overlay tightens unknown artifact policy threshold ${unresolved.variant_ref}:${unresolved.metric_ref}`,
    );
  }
  return {
    ...base,
    inventory_domains: [...base.inventory_domains, ...(additions.inventory_domains ?? [])],
    required_dispositions: [
      ...base.required_dispositions,
      ...(additions.required_dispositions ?? []),
    ],
    metrics: [...metrics, ...(additions.metrics ?? [])],
    artifact_policy_variants: [
      ...artifactPolicyVariants,
      ...(additions.artifact_policy_variants ?? []),
    ],
    question_target_domains: [
      ...base.question_target_domains,
      ...(additions.question_target_domains ?? []),
    ],
    reader_question_contracts: [
      ...base.reader_question_contracts,
      ...(additions.reader_question_contracts ?? []),
    ],
  };
}

function reportDigest(
  report: Omit<IndexerOverlayConformanceReport, "report_digest">,
): string {
  return indexerProtocolDigest(report);
}

export function validateIndexerContractOverlay(input: {
  overlay: unknown;
  baseContract: unknown;
  operatorContract: unknown;
}): {
  overlay: IndexerContractOverlay;
  effectiveProfile: IndexerProfileContractEntry;
  report: IndexerOverlayConformanceReport;
} {
  const base = validateIndexerProfileContract(input.baseContract, input.operatorContract);
  const operators = validateIndexerOperatorContract(input.operatorContract);
  const parsed = indexerContractOverlaySchema.safeParse(input.overlay);
  if (!parsed.success) {
    throw new TypeError(
      `contract overlay is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const overlay = parsed.data;
  const overlayPayload = withoutFields(overlay, ["overlay_digest"]);
  if (indexerContractOverlayDigest(overlayPayload) !== overlay.overlay_digest) {
    throw new TypeError("contract overlay digest does not match its canonical payload");
  }
  if (
    overlay.extends.version !== base.version ||
    overlay.extends.contract_digest !== base.contract_digest
  ) {
    throw new TypeError("contract overlay is bound to another base contract");
  }
  if (
    overlay.operator_contract_version !== operators.version ||
    overlay.operator_contract_digest !== operators.contract_digest
  ) {
    throw new TypeError("contract overlay is bound to another operator contract");
  }
  const baseProfile = profileById(base, overlay.extends.profile);
  const effectiveProfile = mergeOverlayProfile(baseProfile, overlay);
  const effectivePayload: Omit<IndexerProfileContract, "contract_digest"> = {
    ...withoutFields(base, ["contract_digest"]),
    profiles: base.profiles.map((profile) =>
      profile.id === effectiveProfile.id ? effectiveProfile : profile
    ),
  };
  const effectiveContract: IndexerProfileContract = {
    ...effectivePayload,
    contract_digest: indexerProfileContractDigest(effectivePayload),
  };
  validateIndexerProfileContract(effectiveContract, operators);
  const addedRefs = [
    ...(overlay.additions.inventory_domains ?? []).map((item) => `inventory:${item.id}`),
    ...(overlay.additions.required_dispositions ?? []).map((item) => `disposition:${item}`),
    ...(overlay.additions.metrics ?? []).map((item) => `metric:${item.id}`),
    ...(overlay.additions.artifact_policy_variants ?? []).map((item) => `artifact-policy:${item.id}`),
    ...(overlay.additions.question_target_domains ?? []).map((item) => `question-target:${item.id}`),
    ...(overlay.additions.reader_question_contracts ?? []).map((item) => item.ref),
  ].sort();
  const reportPayload: Omit<IndexerOverlayConformanceReport, "report_digest"> = {
    protocol: "context.indexer.overlay-conformance-report/v1",
    overlay_digest: overlay.overlay_digest,
    base_contract_digest: base.contract_digest,
    operator_contract_digest: operators.contract_digest,
    monotonic: true,
    added_refs: addedRefs,
    tightened_metric_refs: (overlay.metric_tightenings ?? [])
      .map((item) => item.metric_ref)
      .sort(),
    tightened_artifact_policy_refs:
      (overlay.artifact_policy_threshold_tightenings ?? [])
        .map((item) => `${item.variant_ref}:${item.metric_ref}`)
        .sort(),
  };
  return {
    overlay,
    effectiveProfile,
    report: { ...reportPayload, report_digest: reportDigest(reportPayload) },
  };
}

export const indexerOverlayValidationReceiptSchema = z.object({
  protocol: z.literal("context.indexer.overlay-validation-receipt/v1"),
  project_ref: z.string().min(1),
  overlay_digest: indexerDigestSchema,
  base_contract_digest: indexerDigestSchema,
  provider_integrity: indexerDigestSchema,
  operator_contract_digest: indexerDigestSchema,
  conformance_report_digest: indexerDigestSchema,
  receipt_digest: indexerDigestSchema,
}).strict();

export type IndexerOverlayValidationReceipt = z.infer<
  typeof indexerOverlayValidationReceiptSchema
>;

export function indexerOverlayValidationReceiptDigest(
  receipt: Omit<IndexerOverlayValidationReceipt, "receipt_digest">,
): string {
  return indexerProtocolDigest(receipt);
}

export function createIndexerOverlayValidationReceipt(input: {
  overlayValidation: ReturnType<typeof validateIndexerContractOverlay>;
  baseContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
  providerIntegrity: string;
  projectRef: string;
}): IndexerOverlayValidationReceipt {
  const projectRef = z.string().min(1).parse(input.projectRef);
  const providerIntegrity = indexerDigestSchema.parse(input.providerIntegrity);
  const validation = validateIndexerContractOverlay({
    overlay: input.overlayValidation.overlay,
    baseContract: input.baseContract,
    operatorContract: input.operatorContract,
  });
  if (
    canonicalIndexerJson(validation.report) !==
      canonicalIndexerJson(input.overlayValidation.report)
  ) {
    throw new TypeError("overlay conformance report is not the canonical current report");
  }
  const payload: Omit<IndexerOverlayValidationReceipt, "receipt_digest"> = {
    protocol: "context.indexer.overlay-validation-receipt/v1",
    project_ref: projectRef,
    overlay_digest: validation.overlay.overlay_digest,
    base_contract_digest: validation.report.base_contract_digest,
    provider_integrity: providerIntegrity,
    operator_contract_digest: validation.report.operator_contract_digest,
    conformance_report_digest: validation.report.report_digest,
  };
  return indexerOverlayValidationReceiptSchema.parse({
    ...payload,
    receipt_digest: indexerOverlayValidationReceiptDigest(payload),
  });
}

export function validateIndexerOverlayValidationReceipt(input: {
  value: unknown;
  overlayValidation: ReturnType<typeof validateIndexerContractOverlay>;
  baseContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
  providerIntegrity: string;
  projectRef: string;
}): IndexerOverlayValidationReceipt {
  const receipt = indexerOverlayValidationReceiptSchema.parse(input.value);
  const payload = withoutFields(receipt, ["receipt_digest"]);
  if (indexerOverlayValidationReceiptDigest(payload) !== receipt.receipt_digest) {
    throw new TypeError("overlay validation receipt digest is invalid");
  }
  const expected = createIndexerOverlayValidationReceipt({
    overlayValidation: input.overlayValidation,
    baseContract: input.baseContract,
    operatorContract: input.operatorContract,
    providerIntegrity: input.providerIntegrity,
    projectRef: input.projectRef,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(receipt)) {
    throw new TypeError("overlay validation receipt is stale or bound to another validation");
  }
  return receipt;
}
