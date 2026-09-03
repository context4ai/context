import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  inflationSensitiveHardMaximum,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
} from "./indexerProfileContract.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";
import { evaluateIndexerRestrictedSelector } from "./indexerRestrictedSelector.js";

const canonicalJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(canonicalJsonSchema),
    z.record(canonicalJsonSchema),
  ])
);

const artifactPolicyThresholdSchema = z.object({
  metric_id: indexerIdSchema,
  metric_operator: indexerIdSchema,
  unit: z.enum(["count", "ratio"]),
  recommended_max: z.number().finite().nonnegative(),
  hard_max: z.number().finite().nonnegative(),
}).strict();

const eligibleArtifactPolicyVariantSchema = z.object({
  id: indexerIdSchema,
  required_artifact_kinds: z.array(indexerIdSchema).min(1),
  discretionary_artifact_kinds: z.array(indexerIdSchema),
  thresholds: z.array(artifactPolicyThresholdSchema),
}).strict();

const artifactPolicyEligibilityPayloadSchema = z.object({
  protocol: z.literal("context.indexer.artifact-policy-eligibility/v1"),
  profile_id: indexerIdSchema,
  profile_contract_digest: indexerDigestSchema,
  operator_contract_digest: indexerDigestSchema,
  canonical_facts: z.array(z.object({
    path: z.string().min(1),
    value: canonicalJsonSchema,
  }).strict()),
  provider_supported_variants: z.array(indexerIdSchema).min(1),
  eligible_variants: z.array(eligibleArtifactPolicyVariantSchema).min(1),
}).strict();

export const indexerArtifactPolicyEligibilitySchema =
  artifactPolicyEligibilityPayloadSchema.extend({
    eligibility_digest: indexerDigestSchema,
  }).strict();

export type IndexerArtifactPolicyEligibility = z.infer<
  typeof indexerArtifactPolicyEligibilitySchema
>;

function uniqueSorted(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must contain unique values`);
  }
  return sorted;
}

function readFact(facts: Record<string, unknown>, path: string): unknown {
  let value: unknown = facts;
  for (const segment of path.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function canonicalFactEntries(input: {
  facts: Record<string, unknown>;
  allowedPaths: readonly string[];
}): IndexerArtifactPolicyEligibility["canonical_facts"] {
  return uniqueSorted(input.allowedPaths, "selector fact paths").flatMap((path) => {
    const value = readFact(input.facts, path);
    return value === undefined
      ? []
      : [{ path, value: canonicalJsonSchema.parse(value) }];
  });
}

function writeFact(target: Record<string, unknown>, path: string, value: IndexerJson): void {
  const segments = path.split(".");
  let cursor = target;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    const existing = cursor[segment];
    if (last) {
      if (existing !== undefined && canonicalIndexerJson(existing) !== canonicalIndexerJson(value)) {
        throw new TypeError(`canonical fact ${path} conflicts with another fact path`);
      }
      cursor[segment] = value;
      return;
    }
    if (existing === undefined) {
      cursor[segment] = {};
    } else if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      throw new TypeError(`canonical fact ${path} conflicts with a scalar parent`);
    }
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

function factsFromEntries(
  entries: IndexerArtifactPolicyEligibility["canonical_facts"],
): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const entry of entries) writeFact(facts, entry.path, entry.value);
  return facts;
}

function eligibilityPayload(
  value: IndexerArtifactPolicyEligibility,
): Omit<IndexerArtifactPolicyEligibility, "eligibility_digest"> {
  const { eligibility_digest: _digest, ...payload } = value;
  void _digest;
  return payload;
}

export function resolveIndexerArtifactPolicyEligibility(input: {
  profile_id: string;
  canonical_facts: Record<string, unknown>;
  provider_supported_variants: readonly string[];
  profile_contract: unknown;
  operator_contract: unknown;
}): IndexerArtifactPolicyEligibility {
  const operators = validateIndexerOperatorContract(input.operator_contract);
  const contract = validateIndexerProfileContract(input.profile_contract, operators);
  const profile = contract.profiles.find((item) => item.id === input.profile_id);
  if (profile === undefined) throw new TypeError(`unknown Indexer profile ${input.profile_id}`);
  const supported = uniqueSorted(
    input.provider_supported_variants,
    "Provider-supported Artifact policy variants",
  );
  const registered = new Set(profile.artifact_policy_variants.map((variant) => variant.id));
  const unknown = supported.find((variant) => !registered.has(variant));
  if (unknown !== undefined) {
    throw new TypeError(`Provider references unregistered Artifact policy variant ${unknown}`);
  }
  const canonicalFacts = canonicalFactEntries({
    facts: input.canonical_facts,
    allowedPaths: operators.selector_fact_paths,
  });
  const facts = factsFromEntries(canonicalFacts);
  const allowedFactPaths = new Set(operators.selector_fact_paths);
  const metricById = new Map(profile.metrics.map((metric) => [metric.id, metric]));
  const eligibleVariants = profile.artifact_policy_variants.flatMap((variant) => {
    if (
      !supported.includes(variant.id) ||
      !evaluateIndexerRestrictedSelector({
        selector: variant.eligibility,
        facts,
        allowed_fact_paths: allowedFactPaths,
      })
    ) {
      return [];
    }
    return [{
      id: variant.id,
      required_artifact_kinds: uniqueSorted(
        variant.artifact_kinds.required,
        `${variant.id} required Artifact kinds`,
      ),
      discretionary_artifact_kinds: uniqueSorted(
        variant.artifact_kinds.discretionary,
        `${variant.id} discretionary Artifact kinds`,
      ),
      thresholds: Object.entries(variant.thresholds).map(([metricId, threshold]) => {
        const metric = metricById.get(metricId)!;
        return {
          metric_id: metricId,
          metric_operator: metric.operator,
          unit: metric.unit,
          recommended_max: threshold.recommended_max,
          hard_max: inflationSensitiveHardMaximum(threshold.recommended_max, metric.unit),
        };
      }).sort((left, right) => compareIndexerCanonicalText(left.metric_id, right.metric_id)),
    }];
  }).sort((left, right) => compareIndexerCanonicalText(left.id, right.id));
  if (eligibleVariants.length === 0) {
    throw new TypeError("profile capability failure: no eligible Artifact policy variant");
  }
  const payload = artifactPolicyEligibilityPayloadSchema.parse({
    protocol: "context.indexer.artifact-policy-eligibility/v1",
    profile_id: profile.id,
    profile_contract_digest: contract.contract_digest,
    operator_contract_digest: operators.contract_digest,
    canonical_facts: canonicalFacts,
    provider_supported_variants: supported,
    eligible_variants: eligibleVariants,
  });
  return indexerArtifactPolicyEligibilitySchema.parse({
    ...payload,
    eligibility_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerArtifactPolicyEligibilityReport(
  value: unknown,
): IndexerArtifactPolicyEligibility {
  const report = indexerArtifactPolicyEligibilitySchema.parse(value);
  if (indexerProtocolDigest(eligibilityPayload(report)) !== report.eligibility_digest) {
    throw new TypeError("Artifact policy eligibility digest is invalid");
  }
  const sortedFacts = [...report.canonical_facts].sort((left, right) =>
    compareIndexerCanonicalText(left.path, right.path)
  );
  if (
    new Set(sortedFacts.map((entry) => entry.path)).size !== sortedFacts.length ||
    canonicalIndexerJson(sortedFacts) !== canonicalIndexerJson(report.canonical_facts) ||
    canonicalIndexerJson(uniqueSorted(
      report.provider_supported_variants,
      "Provider-supported Artifact policy variants",
    )) !== canonicalIndexerJson(report.provider_supported_variants) ||
    canonicalIndexerJson([...report.eligible_variants].sort((left, right) =>
      compareIndexerCanonicalText(left.id, right.id)
    )) !== canonicalIndexerJson(report.eligible_variants)
  ) {
    throw new TypeError("Artifact policy eligibility report is not canonical");
  }
  return report;
}

export function validateIndexerArtifactPolicyEligibility(input: {
  report: unknown;
  profile_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
}): IndexerArtifactPolicyEligibility {
  const report = validateIndexerArtifactPolicyEligibilityReport(input.report);
  const expected = resolveIndexerArtifactPolicyEligibility({
    profile_id: report.profile_id,
    canonical_facts: factsFromEntries(report.canonical_facts),
    provider_supported_variants: report.provider_supported_variants,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(report)) {
    throw new TypeError("Artifact policy eligibility report is stale or forged");
  }
  return report;
}

const artifactBundleBaseEntrySchema = z.object({
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  purpose: z.enum(["required", "discretionary"]),
  reader_question_refs: z.array(indexerCanonicalRefSchema),
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const artifactBundleSplitEntrySchema = z.object({
  artifact_id: indexerIdSchema,
  artifact_kind: indexerIdSchema,
  purpose: z.literal("semantic-split"),
  reader_question_refs: z.array(indexerCanonicalRefSchema),
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
  split_of: indexerIdSchema,
  boundary: z.object({
    axis: indexerIdSchema,
    start_key: z.string().min(1),
    end_key: z.string().min(1),
  }).strict(),
}).strict();

const artifactBundleEntrySchema = z.union([
  artifactBundleBaseEntrySchema,
  artifactBundleSplitEntrySchema,
]);

const artifactBundlePayloadSchema = z.object({
  protocol: z.literal("context.indexer.artifact-bundle/v1"),
  logical_unit_ref: indexerCanonicalRefSchema,
  artifact_policy_variant: indexerIdSchema,
  artifacts: z.array(artifactBundleEntrySchema).min(1),
  discretionary_artifact_count: z.number().int().nonnegative(),
  semantic_split_part_count: z.number().int().nonnegative(),
}).strict();

export const indexerArtifactBundleSchema = artifactBundlePayloadSchema.extend({
  bundle_digest: indexerDigestSchema,
}).strict();

export type IndexerArtifactBundle = z.infer<typeof indexerArtifactBundleSchema>;
export type IndexerArtifactBundleEntry = z.infer<typeof artifactBundleEntrySchema>;

function canonicalBundleEntry(entry: IndexerArtifactBundleEntry): IndexerArtifactBundleEntry {
  return artifactBundleEntrySchema.parse({
    ...entry,
    reader_question_refs: uniqueSorted(
      entry.reader_question_refs,
      `${entry.artifact_id} reader questions`,
    ),
    evidence_refs: uniqueSorted(entry.evidence_refs, `${entry.artifact_id} evidence refs`),
  });
}

function bundlePayload(
  bundle: IndexerArtifactBundle,
): Omit<IndexerArtifactBundle, "bundle_digest"> {
  const { bundle_digest: _digest, ...payload } = bundle;
  void _digest;
  return payload;
}

function assertSplitStructure(entries: readonly IndexerArtifactBundleEntry[]): void {
  const byId = new Map(entries.map((entry) => [entry.artifact_id, entry]));
  for (const entry of entries) {
    if (entry.purpose !== "semantic-split") continue;
    const parent = byId.get(entry.split_of);
    if (
      parent === undefined ||
      parent.purpose === "semantic-split" ||
      parent.artifact_kind !== entry.artifact_kind ||
      compareIndexerCanonicalText(entry.boundary.start_key, entry.boundary.end_key) > 0
    ) {
      throw new TypeError(`semantic split ${entry.artifact_id} has an invalid parent or range`);
    }
  }
  const splitGroups = new Map<string, IndexerArtifactBundleEntry[]>();
  for (const entry of entries) {
    if (entry.purpose !== "semantic-split") continue;
    const key = `${entry.split_of}\u0000${entry.boundary.axis}`;
    const group = splitGroups.get(key) ?? [];
    group.push(entry);
    splitGroups.set(key, group);
  }
  for (const group of splitGroups.values()) {
    const sorted = [...group].sort((left, right) => compareIndexerCanonicalText(
      left.purpose === "semantic-split" ? left.boundary.start_key : "",
      right.purpose === "semantic-split" ? right.boundary.start_key : "",
    ));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      if (
        previous.purpose === "semantic-split" &&
        current.purpose === "semantic-split" &&
        compareIndexerCanonicalText(current.boundary.start_key, previous.boundary.end_key) <= 0
      ) {
        throw new TypeError("semantic split ranges must be non-overlapping");
      }
    }
  }
}

export function buildIndexerArtifactBundle(input: {
  logical_unit_ref: string;
  artifact_policy_variant: string;
  artifacts: readonly IndexerArtifactBundleEntry[];
}): IndexerArtifactBundle {
  const artifacts = input.artifacts.map(canonicalBundleEntry).sort((left, right) =>
    compareIndexerCanonicalText(left.artifact_id, right.artifact_id)
  );
  if (new Set(artifacts.map((entry) => entry.artifact_id)).size !== artifacts.length) {
    throw new TypeError("Artifact Bundle artifact ids must be unique");
  }
  assertSplitStructure(artifacts);
  const payload = artifactBundlePayloadSchema.parse({
    protocol: "context.indexer.artifact-bundle/v1",
    logical_unit_ref: input.logical_unit_ref,
    artifact_policy_variant: input.artifact_policy_variant,
    artifacts,
    discretionary_artifact_count: artifacts.filter((entry) =>
      entry.purpose === "discretionary"
    ).length,
    semantic_split_part_count: artifacts.filter((entry) =>
      entry.purpose === "semantic-split"
    ).length,
  });
  return indexerArtifactBundleSchema.parse({
    ...payload,
    bundle_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerArtifactBundle(value: unknown): IndexerArtifactBundle {
  const bundle = indexerArtifactBundleSchema.parse(value);
  if (indexerProtocolDigest(bundlePayload(bundle)) !== bundle.bundle_digest) {
    throw new TypeError("Artifact Bundle digest is invalid");
  }
  const rebuilt = buildIndexerArtifactBundle(bundle);
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(bundle)) {
    throw new TypeError("Artifact Bundle is not canonical");
  }
  return bundle;
}

export function validateIndexerArtifactBundlePolicy(input: {
  bundle: unknown;
  eligibility: unknown;
  actual_artifacts: readonly {
    artifact_id: string;
    artifact_kind: string;
    evidence_refs: readonly string[];
  }[];
  allowed_question_refs: readonly string[];
  known_evidence_refs: readonly string[];
}): IndexerArtifactBundle {
  const bundle = validateIndexerArtifactBundle(input.bundle);
  const eligibility = validateIndexerArtifactPolicyEligibilityReport(input.eligibility);
  const variant = eligibility.eligible_variants.find((item) =>
    item.id === bundle.artifact_policy_variant
  );
  if (variant === undefined) throw new TypeError("Artifact Bundle uses an ineligible policy variant");
  if (bundle.artifacts.length !== input.actual_artifacts.length) {
    throw new TypeError("Artifact Bundle does not close the actual Artifact set");
  }
  const actualById = new Map(input.actual_artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  if (actualById.size !== input.actual_artifacts.length) {
    throw new TypeError("actual Artifact identities must be unique");
  }
  const allowedQuestions = new Set(input.allowed_question_refs);
  const knownEvidence = new Set(input.known_evidence_refs);
  for (const entry of bundle.artifacts) {
    const actual = actualById.get(entry.artifact_id);
    if (actual?.artifact_kind !== entry.artifact_kind) {
      throw new TypeError(`Artifact Bundle entry ${entry.artifact_id} is orphaned or has another kind`);
    }
    if (entry.reader_question_refs.some((ref) => !allowedQuestions.has(ref))) {
      throw new TypeError(`Artifact Bundle entry ${entry.artifact_id} uses an unknown reader question`);
    }
    if (entry.evidence_refs.some((ref) => !knownEvidence.has(ref))) {
      throw new TypeError(`Artifact Bundle entry ${entry.artifact_id} uses unknown evidence`);
    }
    if (
      canonicalIndexerJson(uniqueSorted(actual.evidence_refs, "actual Artifact evidence")) !==
      canonicalIndexerJson(entry.evidence_refs)
    ) {
      throw new TypeError(`Artifact Bundle entry ${entry.artifact_id} evidence is incomplete`);
    }
    const required = variant.required_artifact_kinds.includes(entry.artifact_kind);
    const discretionary = variant.discretionary_artifact_kinds.includes(entry.artifact_kind);
    if (
      entry.purpose === "required" ? !required :
      entry.purpose === "discretionary" ? !discretionary :
      !required && !discretionary
    ) {
      throw new TypeError(`Artifact ${entry.artifact_id} purpose/kind is outside its Bundle variant`);
    }
  }
  const missingKind = variant.required_artifact_kinds.find((kind) =>
    !bundle.artifacts.some((entry) => entry.purpose === "required" && entry.artifact_kind === kind)
  );
  if (missingKind !== undefined) {
    throw new TypeError(`Artifact Bundle is incomplete: missing required kind ${missingKind}`);
  }
  const fanOutThreshold = variant.thresholds.find((threshold) =>
    threshold.metric_operator === "discretionary-artifact-count"
  );
  if (fanOutThreshold === undefined || fanOutThreshold.unit !== "count") {
    throw new TypeError("Artifact Bundle variant lacks its discretionary fan-out threshold");
  }
  if (bundle.discretionary_artifact_count > fanOutThreshold.hard_max) {
    throw new TypeError("Artifact Bundle discretionary fan-out exceeds its CLI hard maximum");
  }
  return bundle;
}
