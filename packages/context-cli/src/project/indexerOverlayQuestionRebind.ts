import {
  canonicalIndexerJson,
  buildIndexerOverlayQuestionAmendment,
  indexerProtocolDigest,
  indexerRegistryDigests,
  validateFinalizedIndexerRegistry,
  validateIndexerOverlayQuestionAmendment,
  validateIndexerRequirementAmendmentConfirmation,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerOverlayValidationReceipt,
  type IndexerRegistry,
} from "@c4a/context";
import type { IndexerCustomizationView } from "./indexerCustomization.js";
import {
  validateIndexerSelectionFinal,
  validateIndexerSelectionStatic,
  type IndexerResolvedSelectionInput,
  type IndexerSelectionFinalReport,
  type IndexerSelectionStaticReport,
} from "./indexerSelectionValidation.js";

export interface IndexerOverlayQuestionRebindReceipt {
  protocol: "context.indexer.overlay-question-rebind-receipt/v1";
  amendment_digest: string;
  confirmation_digest: string;
  base_requirement_set_digest: string;
  target_requirement_set_digest: string;
  base_static_report_digest: string;
  target_static_report: IndexerSelectionStaticReport;
  target_final_report: IndexerSelectionFinalReport;
  reused_provider_set_digest: string;
  receipt_digest: string;
}

function withoutQuestions<T extends { questions?: unknown }>(value: T): Omit<T, "questions"> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, "questions");
  return payload as Omit<T, "questions">;
}

function assertOnlyTargetQuestionsChanged(input: {
  base: IndexerRegistry;
  target: IndexerRegistry;
  requirementId: string;
}): void {
  if (canonicalIndexerJson(input.base.indexers) !== canonicalIndexerJson(input.target.indexers)) {
    throw new TypeError("overlay question rebind cannot change Indexer selection or authority");
  }
  const baseById = new Map(input.base.requirements.map((requirement) => [requirement.id, requirement]));
  const targetById = new Map(input.target.requirements.map((requirement) => [requirement.id, requirement]));
  if (baseById.size !== targetById.size) {
    throw new TypeError("overlay question rebind cannot add or remove requirements");
  }
  for (const [id, baseRequirement] of baseById) {
    const targetRequirement = targetById.get(id);
    if (targetRequirement === undefined) {
      throw new TypeError("overlay question rebind cannot replace requirement identity");
    }
    if (id === input.requirementId) {
      if (
        canonicalIndexerJson(withoutQuestions(baseRequirement)) !==
          canonicalIndexerJson(withoutQuestions(targetRequirement))
      ) {
        throw new TypeError("overlay question amendment may change only question bindings");
      }
    } else if (canonicalIndexerJson(baseRequirement) !== canonicalIndexerJson(targetRequirement)) {
      throw new TypeError("overlay question rebind changed an unrelated requirement");
    }
  }
}

function stableFinalReport(report: IndexerSelectionFinalReport) {
  const payload: Partial<IndexerSelectionFinalReport> = { ...report };
  Reflect.deleteProperty(payload, "runtime_receipts");
  return payload;
}

function sameProviderRequests(
  left: IndexerSelectionStaticReport,
  right: IndexerSelectionStaticReport,
): boolean {
  return canonicalIndexerJson(left.provider_requests) ===
    canonicalIndexerJson(right.provider_requests) &&
    left.indexer_selection_digest === right.indexer_selection_digest;
}

export async function rebindIndexerSelectionToOverlayRequirement(input: {
  base_registry: IndexerRegistry;
  amendment: unknown;
  confirmation: unknown;
  base_static_report: IndexerSelectionStaticReport;
  base_final_report: IndexerSelectionFinalReport;
  resolved: readonly IndexerResolvedSelectionInput[];
  customizations: readonly IndexerCustomizationView[];
  operator_contract: IndexerOperatorContract;
  profile_contract: IndexerProfileContract;
  provider_integrity: string;
  overlay_validation: Parameters<typeof buildIndexerOverlayQuestionAmendment>[0]["overlay_validation"];
  validation_receipt: IndexerOverlayValidationReceipt;
}): Promise<IndexerOverlayQuestionRebindReceipt> {
  validateFinalizedIndexerRegistry(input.base_registry);
  const amendment = validateIndexerOverlayQuestionAmendment(input.amendment);
  const confirmation = validateIndexerRequirementAmendmentConfirmation({
    amendment,
    confirmation: input.confirmation,
  });
  const expectedAmendment = buildIndexerOverlayQuestionAmendment({
    project_ref: amendment.project_ref,
    registry: input.base_registry,
    requirement_id: amendment.requirement_id,
    overlay_validation: input.overlay_validation,
    base_contract: input.profile_contract,
    operator_contract: input.operator_contract,
    provider_integrity: input.provider_integrity,
    validation_receipt: input.validation_receipt,
  });
  if (canonicalIndexerJson(expectedAmendment) !== canonicalIndexerJson(amendment)) {
    throw new TypeError("overlay question amendment is stale after conformance revalidation");
  }
  const baseDigests = indexerRegistryDigests(input.base_registry);
  if (baseDigests.requirementSetDigest !== amendment.base_requirement_set_digest) {
    throw new TypeError("overlay question amendment is stale against the base requirement set");
  }
  const baseRequirement = input.base_registry.requirements.find((requirement) =>
    requirement.id === amendment.requirement_id
  );
  if (
    baseRequirement === undefined ||
    indexerProtocolDigest(baseRequirement) !== amendment.base_requirement_digest
  ) {
    throw new TypeError("overlay question amendment is stale against its base requirement");
  }
  assertOnlyTargetQuestionsChanged({
    base: input.base_registry,
    target: amendment.target_registry,
    requirementId: amendment.requirement_id,
  });
  const expectedBaseStatic = validateIndexerSelectionStatic(input.base_registry);
  if (canonicalIndexerJson(expectedBaseStatic) !== canonicalIndexerJson(input.base_static_report)) {
    throw new TypeError("overlay question rebind requires the exact current base static report");
  }
  const expectedBaseFinal = await validateIndexerSelectionFinal({
    registry: input.base_registry,
    static_report: expectedBaseStatic,
    resolved: input.resolved,
    customizations: input.customizations,
    operator_contract: input.operator_contract,
    profile_contract: input.profile_contract,
  });
  if (
    canonicalIndexerJson(expectedBaseFinal) !==
      canonicalIndexerJson(input.base_final_report)
  ) {
    throw new TypeError("overlay question rebind requires the exact current base final report");
  }
  const targetStatic = validateIndexerSelectionStatic(amendment.target_registry);
  if (!sameProviderRequests(expectedBaseStatic, targetStatic)) {
    throw new TypeError("overlay question rebind cannot change Provider requests or selection");
  }
  const targetFinal = await validateIndexerSelectionFinal({
    registry: amendment.target_registry,
    static_report: targetStatic,
    resolved: input.resolved,
    customizations: input.customizations,
    operator_contract: input.operator_contract,
    profile_contract: input.profile_contract,
    overlay_question_authorities: [{
      project_ref: amendment.project_ref,
      requirement_id: amendment.requirement_id,
      provider_integrity: input.provider_integrity,
      overlay_validation: input.overlay_validation,
      validation_receipt: input.validation_receipt,
    }],
  });
  if (
    targetFinal.requirement_set_digest !== amendment.target_requirement_set_digest ||
    canonicalIndexerJson(targetFinal.providers) !==
      canonicalIndexerJson(expectedBaseFinal.providers) ||
    targetFinal.subject_key_schema_set_digest !==
      expectedBaseFinal.subject_key_schema_set_digest ||
    canonicalIndexerJson(targetFinal.subject_key_schemas) !==
      canonicalIndexerJson(expectedBaseFinal.subject_key_schemas)
  ) {
    throw new TypeError("rebound final selection changed Provider or SubjectKey authority");
  }
  const reusedProviderSetDigest = indexerProtocolDigest({
    providers: expectedBaseFinal.providers,
    subject_key_schema_set_digest: expectedBaseFinal.subject_key_schema_set_digest,
  });
  const payload: Omit<IndexerOverlayQuestionRebindReceipt, "receipt_digest"> = {
    protocol: "context.indexer.overlay-question-rebind-receipt/v1",
    amendment_digest: amendment.amendment_digest,
    confirmation_digest: confirmation.confirmation_digest,
    base_requirement_set_digest: amendment.base_requirement_set_digest,
    target_requirement_set_digest: amendment.target_requirement_set_digest,
    base_static_report_digest: expectedBaseStatic.report_digest,
    target_static_report: targetStatic,
    target_final_report: targetFinal,
    reused_provider_set_digest: reusedProviderSetDigest,
  };
  if (
    canonicalIndexerJson(stableFinalReport(expectedBaseFinal).providers) !==
      canonicalIndexerJson(stableFinalReport(targetFinal).providers)
  ) {
    throw new TypeError("overlay question rebind changed stable Provider selection");
  }
  return { ...payload, receipt_digest: indexerProtocolDigest(payload) };
}

export function validateIndexerOverlayQuestionRebindReceipt(input: {
  receipt: IndexerOverlayQuestionRebindReceipt;
  amendment_digest: string;
  confirmation_digest: string;
}): IndexerOverlayQuestionRebindReceipt {
  const receipt = input.receipt;
  const payload: Partial<IndexerOverlayQuestionRebindReceipt> = { ...receipt };
  Reflect.deleteProperty(payload, "receipt_digest");
  if (
    receipt.protocol !== "context.indexer.overlay-question-rebind-receipt/v1" ||
    receipt.amendment_digest !== input.amendment_digest ||
    receipt.confirmation_digest !== input.confirmation_digest ||
    indexerProtocolDigest(payload as Omit<IndexerOverlayQuestionRebindReceipt, "receipt_digest">) !==
      receipt.receipt_digest
  ) {
    throw new TypeError("overlay question rebind receipt is stale or invalid");
  }
  return receipt;
}
