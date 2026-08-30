import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  portableIndexerPathSchema,
} from "./indexerProtocolCommon.js";

const exampleObservationSchema = z.object({
  observation_ref: indexerCanonicalRefSchema,
  example_ref: indexerCanonicalRefSchema,
  public_target_ref: indexerCanonicalRefSchema,
  scenario_key: indexerIdSchema,
  source_ref: indexerCanonicalRefSchema,
  module_ref: indexerCanonicalRefSchema.nullable(),
  full_relative_path: portableIndexerPathSchema,
  content_digest: indexerDigestSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerExampleInventorySchema = z.object({
  protocol: z.literal("context.indexer.example-inventory/v1"),
  source_scope_digest: indexerDigestSchema,
  observations: z.array(exampleObservationSchema),
  inventory_digest: indexerDigestSchema,
}).strict();

export type IndexerExampleObservation = z.infer<typeof exampleObservationSchema>;
export type IndexerExampleInventory = z.infer<typeof indexerExampleInventorySchema>;

export interface IndexerExampleObservationInput {
  public_target_ref: string;
  scenario_key: string;
  source_ref: string;
  module_ref: string | null;
  full_relative_path: string;
  content_digest: string;
  evidence_refs: readonly string[];
}

function canonicalUnique(values: readonly string[], field: string): string[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicate identities`);
  }
  return sorted;
}

export function normalizeIndexerExampleRelativePath(value: string): string {
  const normalized = value.normalize("NFC").replaceAll("\\", "/").replace(/^\.\//u, "");
  return portableIndexerPathSchema.parse(normalized);
}

export function indexerExampleRef(input: {
  public_target_ref: string;
  scenario_key: string;
  full_relative_path: string;
}): string {
  const identity = {
    public_target_ref: indexerCanonicalRefSchema.parse(input.public_target_ref),
    scenario_key: indexerIdSchema.parse(input.scenario_key),
    full_relative_path: normalizeIndexerExampleRelativePath(input.full_relative_path),
  };
  return `example:${indexerProtocolDigest(identity)}`;
}

export function indexerExampleObservationRef(input: {
  example_ref: string;
  source_ref: string;
  module_ref: string | null;
  content_digest: string;
}): string {
  return `example-observation:${indexerProtocolDigest(input)}`;
}

export function indexerExampleInventoryDigest(
  value: Omit<IndexerExampleInventory, "inventory_digest">,
): string {
  return indexerProtocolDigest(value);
}

function normalizeObservation(input: IndexerExampleObservationInput): IndexerExampleObservation {
  const fullRelativePath = normalizeIndexerExampleRelativePath(input.full_relative_path);
  const publicTargetRef = indexerCanonicalRefSchema.parse(input.public_target_ref);
  const scenarioKey = indexerIdSchema.parse(input.scenario_key);
  const sourceRef = indexerCanonicalRefSchema.parse(input.source_ref);
  const moduleRef = input.module_ref === null
    ? null
    : indexerCanonicalRefSchema.parse(input.module_ref);
  const contentDigest = indexerDigestSchema.parse(input.content_digest);
  const exampleRef = indexerExampleRef({
    public_target_ref: publicTargetRef,
    scenario_key: scenarioKey,
    full_relative_path: fullRelativePath,
  });
  return exampleObservationSchema.parse({
    observation_ref: indexerExampleObservationRef({
      example_ref: exampleRef,
      source_ref: sourceRef,
      module_ref: moduleRef,
      content_digest: contentDigest,
    }),
    example_ref: exampleRef,
    public_target_ref: publicTargetRef,
    scenario_key: scenarioKey,
    source_ref: sourceRef,
    module_ref: moduleRef,
    full_relative_path: fullRelativePath,
    content_digest: contentDigest,
    evidence_refs: canonicalUnique(input.evidence_refs, "example evidence_refs"),
  });
}

export function buildIndexerExampleInventory(input: {
  source_scope_digest: string;
  observations: readonly IndexerExampleObservationInput[];
}): IndexerExampleInventory {
  const byObservation = new Map<string, IndexerExampleObservation>();
  for (const observationInput of input.observations) {
    const observation = normalizeObservation(observationInput);
    const current = byObservation.get(observation.observation_ref);
    if (current === undefined) {
      byObservation.set(observation.observation_ref, observation);
      continue;
    }
    const currentCore = { ...current, evidence_refs: undefined };
    const nextCore = { ...observation, evidence_refs: undefined };
    if (canonicalIndexerJson(currentCore) !== canonicalIndexerJson(nextCore)) {
      throw new TypeError("example observation identity collision");
    }
    current.evidence_refs = [...new Set([
      ...current.evidence_refs,
      ...observation.evidence_refs,
    ])].sort(compareIndexerCanonicalText);
  }
  const observations = [...byObservation.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.observation_ref, right.observation_ref)
  );
  const payload: Omit<IndexerExampleInventory, "inventory_digest"> = {
    protocol: "context.indexer.example-inventory/v1",
    source_scope_digest: indexerDigestSchema.parse(input.source_scope_digest),
    observations,
  };
  return indexerExampleInventorySchema.parse({
    ...payload,
    inventory_digest: indexerExampleInventoryDigest(payload),
  });
}

export function validateIndexerExampleInventory(input: {
  value: unknown;
  expected_source_scope_digest?: string;
  known_evidence_refs?: readonly string[];
}): IndexerExampleInventory {
  const value = indexerExampleInventorySchema.parse(input.value);
  const rebuilt = buildIndexerExampleInventory({
    source_scope_digest: value.source_scope_digest,
    observations: value.observations,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(value)) {
    throw new TypeError("example inventory is non-canonical or has an invalid digest");
  }
  if (
    input.expected_source_scope_digest !== undefined &&
    value.source_scope_digest !== input.expected_source_scope_digest
  ) {
    throw new TypeError("example inventory belongs to another source scope");
  }
  if (input.known_evidence_refs !== undefined) {
    const known = new Set(canonicalUnique(input.known_evidence_refs, "known_evidence_refs"));
    if (value.observations.some((item) =>
      item.evidence_refs.some((evidenceRef) => !known.has(evidenceRef))
    )) {
      throw new TypeError("example inventory references unknown evidence");
    }
  }
  return value;
}
