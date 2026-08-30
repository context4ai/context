import { z } from "zod";
import {
  buildIndexerArtifactBundle,
  indexerArtifactBundleSchema,
  resolveIndexerArtifactPolicyEligibility,
  validateIndexerArtifactBundlePolicy,
  type IndexerArtifactBundle,
  type IndexerArtifactPolicyEligibility,
} from "./indexerArtifactPolicy.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import type { IndexerOperatorContract, IndexerProfileContract } from "./indexerProfileContract.js";
import { indexerIdSchema } from "./indexerProtocolCommon.js";
import type { IndexerProviderManifest } from "./indexerProvider.js";
import { validateIndexerProviderContractReferences } from "./indexerProviderContractReferences.js";
import type { IndexerJson } from "./indexerRegistry.js";

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

export const indexerAuthoringFixtureSchema = z.object({
  protocol: z.literal("context.indexer.authoring-fixture/v1"),
  id: indexerIdSchema.refine((value) => value.startsWith("anonymous-"), {
    message: "authoring fixture id must use the anonymous- namespace",
  }),
  anonymized: z.literal(true),
  profile: indexerIdSchema,
  source_role: indexerIdSchema,
  logical_unit_id: indexerIdSchema,
  logical_unit_ref: indexerCanonicalRefSchema.refine(
    (value) => value.startsWith("node:anonymous-"),
    { message: "authoring fixture logical unit must use the anonymous Node namespace" },
  ),
  canonical_facts: z.record(canonicalJsonSchema),
  artifact_policy_variant: indexerIdSchema,
  artifacts: indexerArtifactBundleSchema.shape.artifacts,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export type IndexerAuthoringFixture = z.infer<typeof indexerAuthoringFixtureSchema>;

export interface ValidatedIndexerAuthoringFixture {
  fixture: IndexerAuthoringFixture;
  eligibility: IndexerArtifactPolicyEligibility;
  bundle: IndexerArtifactBundle;
}

function exactSortedUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length ||
    sorted.some((value, index) => value !== values[index])) {
    throw new TypeError(`${field} must be unique and canonically sorted`);
  }
  return sorted;
}

export function validateIndexerAuthoringFixture(input: {
  fixture: unknown;
  manifest: IndexerProviderManifest;
  profile_contract: IndexerProfileContract;
  operator_contract: IndexerOperatorContract;
}): ValidatedIndexerAuthoringFixture {
  const fixture = indexerAuthoringFixtureSchema.parse(input.fixture);
  validateIndexerProviderContractReferences({
    manifest: input.manifest,
    selected_profiles: [fixture.profile],
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
  });
  if (!input.manifest.provides.profiles.includes(fixture.profile)) {
    throw new TypeError(`authoring fixture references unprovided profile ${fixture.profile}`);
  }
  if (!(input.manifest.provides.source_roles ?? []).includes(fixture.source_role)) {
    throw new TypeError(`authoring fixture references unprovided source role ${fixture.source_role}`);
  }
  const logicalUnit = (input.manifest.provides.logical_units ?? []).find((unit) =>
    unit.id === fixture.logical_unit_id
  );
  if (logicalUnit?.artifacts === undefined) {
    throw new TypeError(`authoring fixture references unknown logical unit ${fixture.logical_unit_id}`);
  }
  const eligibility = resolveIndexerArtifactPolicyEligibility({
    profile_id: fixture.profile,
    canonical_facts: fixture.canonical_facts,
    provider_supported_variants: logicalUnit.artifacts.supported_policy_variants,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
  });
  if (!eligibility.eligible_variants.some((variant) =>
    variant.id === fixture.artifact_policy_variant
  )) {
    throw new TypeError("authoring fixture chooses an ineligible Artifact policy variant");
  }
  const evidenceRefs = exactSortedUnique(fixture.evidence_refs, "authoring fixture evidence refs");
  if (evidenceRefs.some((evidenceRef) => !evidenceRef.startsWith("evidence:anonymous-"))) {
    throw new TypeError("authoring fixture evidence must use the anonymous evidence namespace");
  }
  const usedEvidence = [...new Set(fixture.artifacts.flatMap((artifact) =>
    artifact.evidence_refs
  ))].sort();
  if (usedEvidence.length !== evidenceRefs.length ||
    usedEvidence.some((value, index) => value !== evidenceRefs[index])) {
    throw new TypeError("authoring fixture evidence inventory must exactly match its Artifacts");
  }
  const bundle = buildIndexerArtifactBundle({
    logical_unit_ref: fixture.logical_unit_ref,
    artifact_policy_variant: fixture.artifact_policy_variant,
    artifacts: fixture.artifacts,
  });
  const profile = input.profile_contract.profiles.find((item) => item.id === fixture.profile)!;
  validateIndexerArtifactBundlePolicy({
    bundle,
    eligibility,
    actual_artifacts: bundle.artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      evidence_refs: artifact.evidence_refs,
    })),
    allowed_question_refs: profile.reader_question_contracts.map((question) => question.ref),
    known_evidence_refs: evidenceRefs,
  });
  return { fixture, eligibility, bundle };
}
