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

/** Converts TypeScript/JavaScript ExtractionResult v2 into the common Context Evidence ABI. */
export function typeScriptExtractionToEvidenceAdapterResult(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterResult {
  if (extraction.meta.pluginId !== "c4a-extract-ts") {
    throw new TypeError("TypeScript evidence adapter requires c4a-extract-ts output");
  }
  return extractionResultToEvidenceAdapterResult(extraction, invocation);
}

/** Builds the TypeScript/JavaScript wire result and its process-local fact sidecar. */
export function typeScriptExtractionToEvidenceAdapterMaterialization(
  extraction: ExtractionResult,
  invocation: ExtractionEvidenceAdapterInvocation,
): IndexerEvidenceAdapterMaterialization {
  return materializeIndexerEvidenceAdapterResult(
    typeScriptExtractionToEvidenceAdapterResult(extraction, invocation),
  );
}
