import {
  extractionResultToEvidenceAdapterResult,
  type ExtractionEvidenceAdapterInvocation,
  type ExtractionResult,
} from "@c4a/extract";
import {
  materializeIndexerEvidenceAdapterResult,
  type IndexerEvidenceAdapterMaterialization,
  type IndexerEvidenceAdapterResult,
} from "@c4a/core";

/** Converts Go ExtractionResult v2 into the common Context Evidence ABI. */
export function goExtractionToEvidenceAdapterResult(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  if (extraction.meta.pluginId !== "c4a-extract-go") {
    throw new TypeError("Go evidence adapter requires c4a-extract-go output");
  }
  return extractionResultToEvidenceAdapterResult(extraction, invocation);
}

export function goExtractionToEvidenceAdapterMaterialization(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    goExtractionToEvidenceAdapterResult(extraction, invocation),
  );
}
