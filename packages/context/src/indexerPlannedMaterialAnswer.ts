import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  indexerCanonicalMaterialAnswerEvidenceSchema,
  indexerEvidenceItemRef,
  type IndexerCanonicalMaterialAnswerEvidence,
} from "./indexerMaterialAnswer.js";
import {
  canonicalIndexerJson,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";

const plannedMaterialAnswerPayloadSchema = z.object({
  protocol: z.literal("context.indexer.planned-material-answer/v1"),
  question_key: indexerCanonicalRefSchema,
  question_revision_digest: indexerDigestSchema,
  answer_landing_ref: indexerCanonicalRefSchema,
  binding_digest: indexerDigestSchema,
  evidence_items: z.array(indexerCanonicalMaterialAnswerEvidenceSchema).min(1),
  evidence_set_digest: indexerDigestSchema,
}).strict();

export const indexerPlannedMaterialAnswerSchema =
  plannedMaterialAnswerPayloadSchema.extend({
    planned_answer_digest: indexerDigestSchema,
  }).strict();

export type IndexerPlannedMaterialAnswer = z.infer<
  typeof indexerPlannedMaterialAnswerSchema
>;

function validateEvidenceItem(
  evidence: IndexerCanonicalMaterialAnswerEvidence,
): void {
  const itemRef = indexerEvidenceItemRef({
    kind: evidence.kind,
    source_origin_ref: evidence.source_origin_ref,
    source_input_digest: evidence.source_input_digest,
    source_spans: evidence.source_spans,
    evidence_digest: evidence.evidence_digest,
  });
  if (itemRef !== evidence.evidence_item_ref) {
    throw new TypeError("planned material answer evidence item ref is invalid");
  }
  for (let index = 0; index < evidence.source_spans.length; index += 1) {
    const span = evidence.source_spans[index]!;
    const previous = evidence.source_spans[index - 1];
    if (
      previous !== undefined &&
      (span.unit !== previous.unit || span.start < previous.end_exclusive)
    ) {
      throw new TypeError("planned material answer spans are not canonical");
    }
  }
}

export function buildIndexerPlannedMaterialAnswerProjection(input: {
  question_key: string;
  question_revision_digest: string;
  answer_landing_ref: string;
  binding_digest: string;
  evidence_items: readonly IndexerCanonicalMaterialAnswerEvidence[];
}): IndexerPlannedMaterialAnswer {
  const evidenceItems = input.evidence_items.map((item) =>
    indexerCanonicalMaterialAnswerEvidenceSchema.parse(item)
  );
  const payload = plannedMaterialAnswerPayloadSchema.parse({
    protocol: "context.indexer.planned-material-answer/v1",
    question_key: input.question_key,
    question_revision_digest: input.question_revision_digest,
    answer_landing_ref: input.answer_landing_ref,
    binding_digest: input.binding_digest,
    evidence_items: evidenceItems,
    evidence_set_digest: indexerProtocolDigest({ evidence_items: evidenceItems }),
  });
  return indexerPlannedMaterialAnswerSchema.parse({
    ...payload,
    planned_answer_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerPlannedMaterialAnswer(
  value: unknown,
): IndexerPlannedMaterialAnswer {
  const planned = indexerPlannedMaterialAnswerSchema.parse(value);
  const { planned_answer_digest: _digest, ...payload } = planned;
  void _digest;
  if (indexerProtocolDigest(payload) !== planned.planned_answer_digest) {
    throw new TypeError("planned material answer digest is invalid");
  }
  const evidenceRefs = planned.evidence_items.map((item) => item.evidence_item_ref);
  if (
    new Set(evidenceRefs).size !== evidenceRefs.length ||
    canonicalIndexerJson(evidenceRefs) !== canonicalIndexerJson([...evidenceRefs].sort()) ||
    planned.evidence_set_digest !== indexerProtocolDigest({
      evidence_items: planned.evidence_items,
    })
  ) {
    throw new TypeError("planned material answer evidence is not canonical");
  }
  planned.evidence_items.forEach(validateEvidenceItem);
  return planned;
}
