import { z } from "zod";
import {
  validateIndexerExampleDecisionSet,
  type IndexerExampleCandidateDecision,
} from "./indexerExampleDecision.js";
import {
  validateIndexerExampleInventory,
  type IndexerExampleInventory,
} from "./indexerExampleIdentity.js";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

export const INDEXER_EXAMPLE_METRIC_IDS = [
  "example-candidate-decision-coverage",
  "example-representative-coverage",
  "example-public-target-linkage",
] as const;

const exampleMetricSchema = z.object({
  metric_id: z.enum(INDEXER_EXAMPLE_METRIC_IDS),
  unit: z.literal("ratio"),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  actual: z.number().min(0).max(1).nullable(),
  covered_example_refs: z.array(indexerCanonicalRefSchema),
  missing_example_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerExampleLinkageAuditSchema = z.object({
  protocol: z.literal("context.indexer.example-linkage-audit/v1"),
  inventory_digest: indexerDigestSchema,
  decision_set_digest: indexerDigestSchema,
  metrics: z.array(exampleMetricSchema).length(INDEXER_EXAMPLE_METRIC_IDS.length),
  decision_closure_pass: z.boolean(),
  audit_digest: indexerDigestSchema,
}).strict();

export type IndexerExampleLinkageAudit = z.infer<
  typeof indexerExampleLinkageAuditSchema
>;

function uniqueExamples(inventory: IndexerExampleInventory): string[] {
  return [...new Set(inventory.observations.map((item) => item.example_ref))].sort(
    compareIndexerCanonicalText,
  );
}

function terminalDecision(input: {
  decision: IndexerExampleCandidateDecision;
  decisions: ReadonlyMap<string, IndexerExampleCandidateDecision>;
}): IndexerExampleCandidateDecision | undefined {
  let cursor: IndexerExampleCandidateDecision | undefined = input.decision;
  const visited = new Set<string>();
  while (cursor?.decision === "merge-scenario-variant") {
    if (visited.has(cursor.example_ref)) return undefined;
    visited.add(cursor.example_ref);
    cursor = input.decisions.get(cursor.canonical_example_ref);
  }
  return cursor;
}

function metric(input: {
  metric_id: typeof INDEXER_EXAMPLE_METRIC_IDS[number];
  denominator_refs: readonly string[];
  covered_refs: readonly string[];
}): z.infer<typeof exampleMetricSchema> {
  const denominatorRefs = [...input.denominator_refs].sort(compareIndexerCanonicalText);
  const coveredSet = new Set(input.covered_refs);
  const coveredRefs = denominatorRefs.filter((ref) => coveredSet.has(ref));
  const missingRefs = denominatorRefs.filter((ref) => !coveredSet.has(ref));
  return {
    metric_id: input.metric_id,
    unit: "ratio",
    numerator: coveredRefs.length,
    denominator: denominatorRefs.length,
    actual: denominatorRefs.length === 0 ? null : coveredRefs.length / denominatorRefs.length,
    covered_example_refs: coveredRefs,
    missing_example_refs: missingRefs,
  };
}

export function indexerExampleLinkageAuditDigest(
  value: Omit<IndexerExampleLinkageAudit, "audit_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerExampleLinkageAudit(input: {
  inventory: unknown;
  decision_set: unknown;
}): IndexerExampleLinkageAudit {
  const inventory = validateIndexerExampleInventory({ value: input.inventory });
  const decisionSet = validateIndexerExampleDecisionSet({
    value: input.decision_set,
    inventory,
  });
  const exampleRefs = uniqueExamples(inventory);
  const decisions = new Map(decisionSet.decisions.map((decision) => [
    decision.example_ref,
    decision,
  ]));
  const decidedRefs = [...decisions.keys()];
  const eligibleRefs = exampleRefs.filter((exampleRef) =>
    decisions.get(exampleRef)?.decision !== "excluded-with-reason"
  );
  const representativeRefs = eligibleRefs.filter((exampleRef) => {
    const decision = decisions.get(exampleRef);
    if (decision === undefined) return false;
    const terminal = terminalDecision({ decision, decisions });
    return terminal?.decision === "link-public-target" ||
      terminal?.decision === "documentation-example";
  });
  const publicTargetRefs = eligibleRefs.filter((exampleRef) => {
    const decision = decisions.get(exampleRef);
    if (decision === undefined) return false;
    return terminalDecision({ decision, decisions })?.decision === "link-public-target";
  });
  const metrics = [
    metric({
      metric_id: "example-candidate-decision-coverage",
      denominator_refs: exampleRefs,
      covered_refs: decidedRefs,
    }),
    metric({
      metric_id: "example-representative-coverage",
      denominator_refs: eligibleRefs,
      covered_refs: representativeRefs,
    }),
    metric({
      metric_id: "example-public-target-linkage",
      denominator_refs: eligibleRefs,
      covered_refs: publicTargetRefs,
    }),
  ];
  const payload: Omit<IndexerExampleLinkageAudit, "audit_digest"> = {
    protocol: "context.indexer.example-linkage-audit/v1",
    inventory_digest: inventory.inventory_digest,
    decision_set_digest: decisionSet.decision_set_digest,
    metrics,
    decision_closure_pass: metrics[0]!.denominator === metrics[0]!.numerator,
  };
  return indexerExampleLinkageAuditSchema.parse({
    ...payload,
    audit_digest: indexerExampleLinkageAuditDigest(payload),
  });
}

export function validateIndexerExampleLinkageAudit(input: {
  value: unknown;
  inventory: unknown;
  decision_set: unknown;
}): IndexerExampleLinkageAudit {
  const value = indexerExampleLinkageAuditSchema.parse(input.value);
  const rebuilt = buildIndexerExampleLinkageAudit({
    inventory: input.inventory,
    decision_set: input.decision_set,
  });
  if (canonicalIndexerJson(value) !== canonicalIndexerJson(rebuilt)) {
    throw new TypeError("example linkage audit does not match its current inputs");
  }
  return value;
}

export function assertIndexerExampleCandidateDecisionClosure(input: {
  value: unknown;
  inventory: unknown;
  decision_set: unknown;
}): IndexerExampleLinkageAudit {
  const audit = validateIndexerExampleLinkageAudit(input);
  if (!audit.decision_closure_pass) {
    const decisionMetric = audit.metrics[0]!;
    throw new TypeError(
      `example-candidate-decision-incomplete: ${decisionMetric.missing_example_refs.join(", ")}`,
    );
  }
  return audit;
}
