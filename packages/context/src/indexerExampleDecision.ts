import { z } from "zod";
import {
  validateIndexerExampleInventory,
  type IndexerExampleInventory,
} from "./indexerExampleIdentity.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const nonEmptyTextSchema = z.string().min(1).refine((value) => !value.includes("\0"));

const extractedFacetSchema = z.object({
  state: z.literal("extracted"),
  fact_refs: z.array(indexerCanonicalRefSchema).min(1),
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const inapplicableFacetSchema = z.object({
  state: z.literal("not-applicable"),
  reason_code: indexerIdSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const representationFacetSchema = z.discriminatedUnion("state", [
  extractedFacetSchema,
  inapplicableFacetSchema,
]);

export const indexerExampleRepresentationSchema = z.object({
  setup: representationFacetSchema,
  key_calls: representationFacetSchema,
  parameters: representationFacetSchema,
  expected_behavior: representationFacetSchema,
}).strict();

const commonDecisionFields = {
  example_ref: indexerCanonicalRefSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
};

const publicTargetDecisionSchema = z.object({
  ...commonDecisionFields,
  decision: z.literal("link-public-target"),
  public_target_ref: indexerCanonicalRefSchema,
  landing_ref: indexerCanonicalRefSchema,
  representation: indexerExampleRepresentationSchema,
}).strict();

const scenarioVariantDecisionSchema = z.object({
  ...commonDecisionFields,
  decision: z.literal("merge-scenario-variant"),
  canonical_example_ref: indexerCanonicalRefSchema,
}).strict();

const documentationDecisionSchema = z.object({
  ...commonDecisionFields,
  decision: z.literal("documentation-example"),
  document_ref: indexerCanonicalRefSchema,
  landing_ref: indexerCanonicalRefSchema,
  representation: indexerExampleRepresentationSchema,
}).strict();

const excludedDecisionSchema = z.object({
  ...commonDecisionFields,
  decision: z.literal("excluded-with-reason"),
  reason_code: indexerIdSchema,
  rationale: nonEmptyTextSchema,
}).strict();

const requestMaterialDecisionSchema = z.object({
  ...commonDecisionFields,
  decision: z.literal("request-material"),
  material_request_ref: indexerCanonicalRefSchema,
  missing_facts: z.array(indexerIdSchema).min(1),
  source_hints: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerExampleCandidateDecisionSchema = z.discriminatedUnion("decision", [
  publicTargetDecisionSchema,
  scenarioVariantDecisionSchema,
  documentationDecisionSchema,
  excludedDecisionSchema,
  requestMaterialDecisionSchema,
]);

export const indexerExampleDecisionSetSchema = z.object({
  protocol: z.literal("context.indexer.example-decision-set/v1"),
  inventory_digest: indexerDigestSchema,
  decisions: z.array(indexerExampleCandidateDecisionSchema),
  decision_set_digest: indexerDigestSchema,
}).strict();

export type IndexerExampleRepresentation = z.infer<
  typeof indexerExampleRepresentationSchema
>;
export type IndexerExampleCandidateDecision = z.infer<
  typeof indexerExampleCandidateDecisionSchema
>;
export type IndexerExampleDecisionSet = z.infer<typeof indexerExampleDecisionSetSchema>;

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

function canonicalFacet(
  value: z.infer<typeof representationFacetSchema>,
  field: string,
): z.infer<typeof representationFacetSchema> {
  if (value.state === "extracted") {
    return {
      state: value.state,
      fact_refs: canonicalUnique(value.fact_refs, `${field}.fact_refs`),
      evidence_refs: canonicalUnique(value.evidence_refs, `${field}.evidence_refs`),
    };
  }
  return {
    state: value.state,
    reason_code: value.reason_code,
    evidence_refs: canonicalUnique(value.evidence_refs, `${field}.evidence_refs`),
  };
}

function canonicalRepresentation(
  value: IndexerExampleRepresentation,
): IndexerExampleRepresentation {
  return {
    setup: canonicalFacet(value.setup, "representation.setup"),
    key_calls: canonicalFacet(value.key_calls, "representation.key_calls"),
    parameters: canonicalFacet(value.parameters, "representation.parameters"),
    expected_behavior: canonicalFacet(
      value.expected_behavior,
      "representation.expected_behavior",
    ),
  };
}

function canonicalDecision(
  value: IndexerExampleCandidateDecision,
): IndexerExampleCandidateDecision {
  const evidenceRefs = canonicalUnique(value.evidence_refs, "decision.evidence_refs");
  if (value.decision === "link-public-target") {
    return { ...value, evidence_refs: evidenceRefs, representation: canonicalRepresentation(value.representation) };
  }
  if (value.decision === "documentation-example") {
    return { ...value, evidence_refs: evidenceRefs, representation: canonicalRepresentation(value.representation) };
  }
  if (value.decision === "request-material") {
    return {
      ...value,
      evidence_refs: evidenceRefs,
      missing_facts: canonicalUnique(value.missing_facts, "decision.missing_facts"),
      source_hints: canonicalUnique(value.source_hints, "decision.source_hints"),
    };
  }
  return { ...value, evidence_refs: evidenceRefs };
}

function uniqueExamples(inventory: IndexerExampleInventory): Map<
  string,
  IndexerExampleInventory["observations"][number]
> {
  const result = new Map<string, IndexerExampleInventory["observations"][number]>();
  for (const observation of inventory.observations) {
    if (result.has(observation.example_ref)) {
      throw new TypeError("example decisions require a collision-free example inventory");
    }
    result.set(observation.example_ref, observation);
  }
  return result;
}

function decisionEvidenceRefs(
  decision: IndexerExampleCandidateDecision,
): string[] {
  const refs = [...decision.evidence_refs];
  if (
    decision.decision === "link-public-target" ||
    decision.decision === "documentation-example"
  ) {
    for (const facet of Object.values(decision.representation)) {
      refs.push(...facet.evidence_refs);
    }
  }
  return refs;
}

function validateDecisionBindings(input: {
  decisions: readonly IndexerExampleCandidateDecision[];
  examples: ReadonlyMap<string, IndexerExampleInventory["observations"][number]>;
}): void {
  const decisionRefs = input.decisions.map((decision) => decision.example_ref);
  if (new Set(decisionRefs).size !== decisionRefs.length) {
    throw new TypeError("example candidate decisions must contain at most one decision per example");
  }
  const decisionsByRef = new Map(input.decisions.map((decision) => [
    decision.example_ref,
    decision,
  ]));
  for (const decision of input.decisions) {
    const example = input.examples.get(decision.example_ref);
    if (example === undefined) {
      throw new TypeError(`example decision references unknown candidate ${decision.example_ref}`);
    }
    const availableEvidence = new Set(example.evidence_refs);
    if (decisionEvidenceRefs(decision).some((ref) => !availableEvidence.has(ref))) {
      throw new TypeError(`example decision ${decision.example_ref} references unrelated evidence`);
    }
    if (
      decision.decision === "link-public-target" &&
      decision.public_target_ref !== example.public_target_ref
    ) {
      throw new TypeError("example public target link does not match candidate identity");
    }
    if (decision.decision !== "merge-scenario-variant") continue;
    const canonical = input.examples.get(decision.canonical_example_ref);
    if (canonical === undefined) {
      throw new TypeError("scenario variant references an unknown canonical example");
    }
    if (decision.canonical_example_ref === decision.example_ref) {
      throw new TypeError("scenario variant cannot merge into itself");
    }
    if (
      canonical.public_target_ref !== example.public_target_ref ||
      canonical.scenario_key !== example.scenario_key
    ) {
      throw new TypeError("scenario variants must share public target and scenario");
    }
  }
  for (const decision of input.decisions) {
    if (decision.decision !== "merge-scenario-variant") continue;
    const visited = new Set([decision.example_ref]);
    let cursor: IndexerExampleCandidateDecision | undefined = decision;
    while (cursor?.decision === "merge-scenario-variant") {
      if (visited.has(cursor.canonical_example_ref)) {
        throw new TypeError("scenario variant decisions must not contain merge cycles");
      }
      visited.add(cursor.canonical_example_ref);
      cursor = decisionsByRef.get(cursor.canonical_example_ref);
    }
  }
}

export function indexerExampleDecisionSetDigest(
  value: Omit<IndexerExampleDecisionSet, "decision_set_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerExampleDecisionSet(input: {
  inventory: unknown;
  decisions: readonly IndexerExampleCandidateDecision[];
}): IndexerExampleDecisionSet {
  const inventory = validateIndexerExampleInventory({ value: input.inventory });
  const examples = uniqueExamples(inventory);
  const decisions = input.decisions.map((decision) =>
    canonicalDecision(indexerExampleCandidateDecisionSchema.parse(decision))
  ).sort((left, right) => compareIndexerCanonicalText(left.example_ref, right.example_ref));
  validateDecisionBindings({ decisions, examples });
  const payload: Omit<IndexerExampleDecisionSet, "decision_set_digest"> = {
    protocol: "context.indexer.example-decision-set/v1",
    inventory_digest: inventory.inventory_digest,
    decisions,
  };
  return indexerExampleDecisionSetSchema.parse({
    ...payload,
    decision_set_digest: indexerExampleDecisionSetDigest(payload),
  });
}

export function validateIndexerExampleDecisionSet(input: {
  value: unknown;
  inventory: unknown;
}): IndexerExampleDecisionSet {
  const value = indexerExampleDecisionSetSchema.parse(input.value);
  const rebuilt = buildIndexerExampleDecisionSet({
    inventory: input.inventory,
    decisions: value.decisions,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("example decision set is stale, non-canonical, or has an invalid digest");
  }
  return value;
}
