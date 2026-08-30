import {
  inspectIndexerMaterialAnswerReview,
  resolveIndexerMaterialAnswerReview,
} from "@c4a/context";
import { assertIndexerOutputSafe } from "@c4a/core";

export {
  buildIndexerMaterialAnswerReviewInspectionInput,
  buildIndexerMaterialAnswerReviewResolutionInput,
  indexerMaterialAnswerReviewInspectionInputSchema,
  indexerMaterialAnswerReviewInspectionResultSchema,
  indexerMaterialAnswerReviewResolutionInputSchema,
  indexerMaterialAnswerReviewResolutionResultSchema,
  validateIndexerMaterialAnswerReviewInspectionInput,
  validateIndexerMaterialAnswerReviewResolutionInput,
  type IndexerMaterialAnswerReviewInspectionInput,
  type IndexerMaterialAnswerReviewInspectionResult,
  type IndexerMaterialAnswerReviewResolutionInput,
  type IndexerMaterialAnswerReviewResolutionResult,
} from "@c4a/context";

export function inspectProjectIndexerMaterialAnswerReview(value: unknown) {
  const inspection = inspectIndexerMaterialAnswerReview(value);
  return assertIndexerOutputSafe({ channel: "review-sample", value: inspection });
}

export const resolveProjectIndexerMaterialAnswerReview =
  resolveIndexerMaterialAnswerReview;
