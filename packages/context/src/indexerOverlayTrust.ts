import { createPublicKey, verify } from "node:crypto";
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

const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u);

export const indexerOverlayAttestationSchema = z.object({
  protocol: z.literal("context.indexer.overlay-attestation/v1"),
  overlay: z.object({
    protocol: z.literal("context.indexer.contract-overlay/v1"),
    id: indexerIdSchema,
    version: indexerSemverSchema,
    digest: indexerDigestSchema,
  }).strict(),
  base: z.object({
    profile: indexerIdSchema,
    version: indexerSemverSchema,
    contract_digest: indexerDigestSchema,
  }).strict(),
  operator_contract: z.object({
    version: indexerSemverSchema,
    digest: indexerDigestSchema,
  }).strict(),
  issuer: indexerIdSchema,
  key_id: indexerIdSchema,
  algorithm: z.literal("ed25519"),
  signature: base64Schema,
  attestation_digest: indexerDigestSchema,
}).strict();

export type IndexerOverlayAttestation = z.infer<typeof indexerOverlayAttestationSchema>;

export function indexerOverlayAttestationSigningPayload(
  attestation: Omit<IndexerOverlayAttestation, "signature" | "attestation_digest">,
): string {
  return canonicalIndexerJson(attestation);
}

export function indexerOverlayAttestationDigest(
  attestation: Omit<IndexerOverlayAttestation, "attestation_digest">,
): string {
  return indexerProtocolDigest(attestation);
}

const trustKeySchema = z.object({
  key_id: indexerIdSchema,
  algorithm: z.literal("ed25519"),
  public_key: base64Schema,
  not_before: z.string().datetime({ offset: true }),
  not_after: z.string().datetime({ offset: true }),
}).strict();

export const indexerOverlayTrustBundleSchema = z.object({
  protocol: z.literal("context.indexer.overlay-trust-bundle/v1"),
  policy_id: indexerIdSchema,
  policy_version: indexerSemverSchema,
  issuers: z.array(z.object({
    id: indexerIdSchema,
    keys: z.array(trustKeySchema).min(1),
  }).strict()).min(1),
  revocations: z.array(z.object({
    issuer: indexerIdSchema,
    key_id: indexerIdSchema,
    revoked_at: z.string().datetime({ offset: true }),
  }).strict()),
  policy_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  const issuerIds = new Set<string>();
  const trustedKeys = new Set<string>();
  value.issuers.forEach((issuer, issuerIndex) => {
    if (issuerIds.has(issuer.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate issuer ${issuer.id}`,
        path: ["issuers", issuerIndex, "id"],
      });
    }
    issuerIds.add(issuer.id);
    const keyIds = new Set<string>();
    issuer.keys.forEach((key, keyIndex) => {
      if (keyIds.has(key.key_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate key ${issuer.id}:${key.key_id}`,
          path: ["issuers", issuerIndex, "keys", keyIndex, "key_id"],
        });
      }
      keyIds.add(key.key_id);
      trustedKeys.add(`${issuer.id}\u0000${key.key_id}`);
      if (Date.parse(key.not_before) >= Date.parse(key.not_after)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "key not_before must precede not_after",
          path: ["issuers", issuerIndex, "keys", keyIndex, "not_after"],
        });
      }
    });
  });
  const revocations = new Set<string>();
  value.revocations.forEach((revocation, index) => {
    const ref = `${revocation.issuer}\u0000${revocation.key_id}`;
    if (!trustedKeys.has(ref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "revocation references an unknown trusted key",
        path: ["revocations", index],
      });
    }
    if (revocations.has(ref)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate revocation",
        path: ["revocations", index],
      });
    }
    revocations.add(ref);
  });
});

export type IndexerOverlayTrustBundle = z.infer<typeof indexerOverlayTrustBundleSchema>;

export function indexerOverlayTrustBundleDigest(
  bundle: Omit<IndexerOverlayTrustBundle, "policy_digest">,
): string {
  return indexerProtocolDigest(bundle);
}

export const indexerOverlayTrustBundleEnvelopeSchema = z.object({
  protocol: z.literal("context.indexer.overlay-trust-bundle-envelope/v1"),
  adapter: indexerIdSchema,
  adapter_version: indexerSemverSchema,
  management_authority_digest: indexerDigestSchema,
  bundle: indexerOverlayTrustBundleSchema,
}).strict();

export type IndexerOverlayTrustBundleEnvelope = z.infer<
  typeof indexerOverlayTrustBundleEnvelopeSchema
>;

const enterpriseTrustReceiptSchema = z.object({
  protocol: z.literal("context.indexer.overlay-trust-receipt/v1"),
  trust_class: z.literal("enterprise-signed"),
  project_ref: z.null(),
  overlay_digest: indexerDigestSchema,
  attestation_digest: indexerDigestSchema,
  base_contract_digest: indexerDigestSchema,
  provider_integrity: indexerDigestSchema,
  operator_contract_digest: indexerDigestSchema,
  conformance_report_digest: indexerDigestSchema,
  trust_adapter: indexerIdSchema,
  trust_adapter_version: indexerSemverSchema,
  trust_management_authority_digest: indexerDigestSchema,
  trust_policy_digest: indexerDigestSchema,
  authorization_receipt_digest: z.null(),
  receipt_digest: indexerDigestSchema,
}).strict();

const projectTrustReceiptSchema = z.object({
  protocol: z.literal("context.indexer.overlay-trust-receipt/v1"),
  trust_class: z.literal("project-authorized-exact-digest"),
  project_ref: z.string().min(1),
  overlay_digest: indexerDigestSchema,
  attestation_digest: indexerDigestSchema.nullable(),
  base_contract_digest: indexerDigestSchema,
  provider_integrity: indexerDigestSchema,
  operator_contract_digest: indexerDigestSchema,
  conformance_report_digest: indexerDigestSchema,
  trust_adapter: z.null(),
  trust_adapter_version: z.null(),
  trust_management_authority_digest: z.null(),
  trust_policy_digest: z.null(),
  authorization_receipt_digest: indexerDigestSchema,
  receipt_digest: indexerDigestSchema,
}).strict();

export const indexerOverlayTrustReceiptSchema = z.discriminatedUnion("trust_class", [
  enterpriseTrustReceiptSchema,
  projectTrustReceiptSchema,
]);

export type IndexerOverlayTrustReceipt = z.infer<typeof indexerOverlayTrustReceiptSchema>;

export function indexerOverlayTrustReceiptDigest(
  receipt: Omit<IndexerOverlayTrustReceipt, "receipt_digest">,
): string {
  return indexerProtocolDigest(receipt);
}

export function validateIndexerOverlayAttestation(
  value: unknown,
  overlay: IndexerContractOverlay,
  base: IndexerProfileContract,
  operators: IndexerOperatorContract,
): IndexerOverlayAttestation {
  const parsed = indexerOverlayAttestationSchema.parse(value);
  const payload = withoutFields(parsed, ["attestation_digest"]);
  if (indexerOverlayAttestationDigest(payload) !== parsed.attestation_digest) {
    throw new TypeError("overlay attestation digest does not match its canonical payload");
  }
  if (
    parsed.overlay.id !== overlay.id ||
    parsed.overlay.version !== overlay.version ||
    parsed.overlay.digest !== overlay.overlay_digest ||
    parsed.base.profile !== overlay.extends.profile ||
    parsed.base.version !== base.version ||
    parsed.base.contract_digest !== base.contract_digest ||
    parsed.operator_contract.version !== operators.version ||
    parsed.operator_contract.digest !== operators.contract_digest
  ) {
    throw new TypeError("overlay attestation is bound to another contract payload");
  }
  return parsed;
}

export function validateIndexerOverlayTrustBundleEnvelope(
  value: unknown,
): IndexerOverlayTrustBundleEnvelope {
  const envelope = indexerOverlayTrustBundleEnvelopeSchema.parse(value);
  const payload = withoutFields(envelope.bundle, ["policy_digest"]);
  if (indexerOverlayTrustBundleDigest(payload) !== envelope.bundle.policy_digest) {
    throw new TypeError("overlay trust bundle digest does not match its canonical payload");
  }
  return envelope;
}

function revalidateOverlayResult(input: {
  overlayValidation: ReturnType<typeof validateIndexerContractOverlay>;
  base: IndexerProfileContract;
  operators: IndexerOperatorContract;
}): ReturnType<typeof validateIndexerContractOverlay> {
  const validation = validateIndexerContractOverlay({
    overlay: input.overlayValidation.overlay,
    baseContract: input.base,
    operatorContract: input.operators,
  });
  if (validation.report.report_digest !== input.overlayValidation.report.report_digest) {
    throw new TypeError("overlay conformance report is not the canonical current report");
  }
  return validation;
}

export function verifyEnterpriseIndexerOverlayTrust(input: {
  overlayValidation: ReturnType<typeof validateIndexerContractOverlay>;
  baseContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
  providerIntegrity: string;
  attestation: unknown;
  trustBundleEnvelope: unknown;
  now?: Date;
}): IndexerOverlayTrustReceipt {
  const now = input.now ?? new Date();
  const operators = validateIndexerOperatorContract(input.operatorContract);
  const base = validateIndexerProfileContract(input.baseContract, operators);
  const validation = revalidateOverlayResult({
    overlayValidation: input.overlayValidation,
    base,
    operators,
  });
  const attestation = validateIndexerOverlayAttestation(
    input.attestation,
    validation.overlay,
    base,
    operators,
  );
  const trustEnvelope = validateIndexerOverlayTrustBundleEnvelope(
    input.trustBundleEnvelope,
  );
  const issuer = trustEnvelope.bundle.issuers.find((item) => item.id === attestation.issuer);
  const key = issuer?.keys.find((item) => item.key_id === attestation.key_id);
  if (key === undefined) {
    throw new TypeError("overlay attestation issuer or key is not trusted");
  }
  const nowMs = now.getTime();
  if (Date.parse(key.not_before) > nowMs || Date.parse(key.not_after) <= nowMs) {
    throw new TypeError("overlay attestation key is outside its validity window");
  }
  const revoked = trustEnvelope.bundle.revocations.some((revocation) =>
    revocation.issuer === attestation.issuer &&
    revocation.key_id === attestation.key_id &&
    Date.parse(revocation.revoked_at) <= nowMs
  );
  if (revoked) throw new TypeError("overlay attestation key has been revoked");
  const signingPayload = withoutFields(attestation, ["signature", "attestation_digest"]);
  const publicKey = createPublicKey({
    key: Buffer.from(key.public_key, "base64"),
    format: "der",
    type: "spki",
  });
  const verified = verify(
    null,
    Buffer.from(indexerOverlayAttestationSigningPayload(signingPayload)),
    publicKey,
    Buffer.from(attestation.signature, "base64"),
  );
  if (!verified) throw new TypeError("overlay attestation signature is invalid");
  const receiptPayload: Omit<IndexerOverlayTrustReceipt, "receipt_digest"> = {
    protocol: "context.indexer.overlay-trust-receipt/v1",
    trust_class: "enterprise-signed",
    project_ref: null,
    overlay_digest: validation.overlay.overlay_digest,
    attestation_digest: attestation.attestation_digest,
    base_contract_digest: base.contract_digest,
    provider_integrity: input.providerIntegrity,
    operator_contract_digest: operators.contract_digest,
    conformance_report_digest: validation.report.report_digest,
    trust_adapter: trustEnvelope.adapter,
    trust_adapter_version: trustEnvelope.adapter_version,
    trust_management_authority_digest: trustEnvelope.management_authority_digest,
    trust_policy_digest: trustEnvelope.bundle.policy_digest,
    authorization_receipt_digest: null,
  };
  return indexerOverlayTrustReceiptSchema.parse({
    ...receiptPayload,
    receipt_digest: indexerOverlayTrustReceiptDigest(receiptPayload),
  });
}

export const indexerOverlayProjectAuthorizationSchema = z.object({
  protocol: z.literal("context.indexer.overlay-project-authorization/v1"),
  project_ref: z.string().min(1),
  overlay_digest: indexerDigestSchema,
  attestation_digest: indexerDigestSchema.nullable(),
  base_contract_digest: indexerDigestSchema,
  provider_integrity: indexerDigestSchema,
  operator_contract_digest: indexerDigestSchema,
  conformance_report_digest: indexerDigestSchema,
  authority_ref: z.string().min(1),
  authority_scope_digest: indexerDigestSchema,
  authorization_receipt_digest: indexerDigestSchema,
}).strict();

export type IndexerOverlayProjectAuthorization = z.infer<
  typeof indexerOverlayProjectAuthorizationSchema
>;

export function indexerOverlayProjectAuthorizationDigest(
  authorization: Omit<IndexerOverlayProjectAuthorization, "authorization_receipt_digest">,
): string {
  return indexerProtocolDigest(authorization);
}

export function authorizeProjectIndexerOverlay(input: {
  overlayValidation: ReturnType<typeof validateIndexerContractOverlay>;
  baseContract: IndexerProfileContract;
  operatorContract: IndexerOperatorContract;
  providerIntegrity: string;
  projectRef: string;
  declaredAttestationDigest: string | null;
  authorization: unknown;
}): IndexerOverlayTrustReceipt {
  const operators = validateIndexerOperatorContract(input.operatorContract);
  const base = validateIndexerProfileContract(input.baseContract, operators);
  const validation = revalidateOverlayResult({
    overlayValidation: input.overlayValidation,
    base,
    operators,
  });
  const authorization = indexerOverlayProjectAuthorizationSchema.parse(input.authorization);
  const payload = withoutFields(authorization, ["authorization_receipt_digest"]);
  if (indexerOverlayProjectAuthorizationDigest(payload) !== authorization.authorization_receipt_digest) {
    throw new TypeError("overlay project authorization receipt digest is invalid");
  }
  const expected = {
    project_ref: input.projectRef,
    overlay_digest: validation.overlay.overlay_digest,
    attestation_digest: input.declaredAttestationDigest,
    base_contract_digest: base.contract_digest,
    provider_integrity: input.providerIntegrity,
    operator_contract_digest: operators.contract_digest,
    conformance_report_digest: validation.report.report_digest,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (authorization[field as keyof typeof authorization] !== value) {
      throw new TypeError(`overlay project authorization does not match ${field}`);
    }
  }
  const receiptPayload: Omit<IndexerOverlayTrustReceipt, "receipt_digest"> = {
    protocol: "context.indexer.overlay-trust-receipt/v1",
    trust_class: "project-authorized-exact-digest",
    project_ref: input.projectRef,
    overlay_digest: input.overlayValidation.overlay.overlay_digest,
    attestation_digest: input.declaredAttestationDigest,
    base_contract_digest: base.contract_digest,
    provider_integrity: input.providerIntegrity,
    operator_contract_digest: operators.contract_digest,
    conformance_report_digest: input.overlayValidation.report.report_digest,
    trust_adapter: null,
    trust_adapter_version: null,
    trust_management_authority_digest: null,
    trust_policy_digest: null,
    authorization_receipt_digest: authorization.authorization_receipt_digest,
  };
  return indexerOverlayTrustReceiptSchema.parse({
    ...receiptPayload,
    receipt_digest: indexerOverlayTrustReceiptDigest(receiptPayload),
  });
}
