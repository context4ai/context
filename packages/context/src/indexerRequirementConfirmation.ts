import { z } from "zod";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  INDEXER_EVIDENCE_KINDS,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  compareIndexRequirementContraction,
  type RequirementContractionComparatorOptions,
  type ResolvedQuestionContractView,
} from "./indexerRequirementComparison.js";
import { indexRequirementSchema, type IndexRequirement } from "./indexerRegistry.js";

const relationSchema = z.enum([
  "equivalent",
  "strengthening",
  "contraction",
  "incomparable",
]);

const questionContractViewSchema = z.object({
  ref: z.string().min(1),
  contractDigest: indexerDigestSchema,
  semanticId: z.string().min(1),
  coverageDomain: z.string().min(1),
  targetDomainId: z.string().min(1),
  selectorContractDigest: indexerDigestSchema,
  targetRefs: z.array(z.string().min(1)),
  evidence: z.object({
    acceptedKinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
    minimumItems: z.number().int().positive(),
    minimumDistinctSources: z.number().int().positive(),
    provenanceRequired: z.boolean(),
  }).strict(),
}).strict();

const comparatorInputsSchema = z.object({
  readerGoalImplications: z.record(z.array(z.string().min(1))),
  oldQuestionContracts: z.array(questionContractViewSchema),
  newQuestionContracts: z.array(questionContractViewSchema),
  selectorRelations: z.record(relationSchema),
}).strict();

const comparisonSchema = z.object({
  protocol: z.literal("context.indexer.requirement-contraction-comparison/v1"),
  requirementRef: z.string().min(1),
  relation: relationSchema,
  requiresHumanConfirmation: z.boolean(),
  evidenceSourceChange: z.enum(["unchanged", "expanded", "reduced", "changed"]),
  changes: z.array(z.object({
    area: z.enum([
      "target-scope",
      "reader-goals",
      "coverage-domain",
      "exclusions",
      "question",
      "question-semantic",
      "question-selector",
      "question-domain",
      "question-evidence",
    ]),
    path: z.string().min(1),
    relation: z.enum(["strengthening", "contraction", "incomparable"]),
    detail: z.string().min(1),
  }).strict()),
}).strict();

export const indexerRequirementChangeReportSchema = z.object({
  protocol: z.literal("context.indexer.requirement-change-report/v1"),
  project_ref: z.string().min(1),
  old_requirement: indexRequirementSchema,
  new_requirement: indexRequirementSchema,
  old_requirement_digest: indexerDigestSchema,
  new_requirement_digest: indexerDigestSchema,
  comparator_inputs: comparatorInputsSchema,
  comparison: comparisonSchema,
  comparison_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
}).strict();

export const indexerRequirementChangeConfirmationSchema = z.object({
  protocol: z.literal("context.indexer.requirement-change-confirmation/v1"),
  project_ref: z.string().min(1),
  gate: z.enum([
    "confirm-index-requirements",
    "confirm-index-requirement-contraction",
  ]),
  old_requirement_digest: indexerDigestSchema,
  new_requirement_digest: indexerDigestSchema,
  comparison_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
  authority: z.enum(["managed", "human"]),
  non_delegable: z.boolean(),
  confirmed_by: z.string().min(1),
  confirmed_at: z.string().datetime({ offset: true }),
  confirmation_digest: indexerDigestSchema,
}).strict();

export type IndexerRequirementChangeReport = z.infer<
  typeof indexerRequirementChangeReportSchema
>;
export type IndexerRequirementChangeConfirmation = z.infer<
  typeof indexerRequirementChangeConfirmationSchema
>;

function withoutDigest<T extends object, K extends keyof T>(
  value: T,
  field: K,
): Omit<T, K> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, field);
  return payload as Omit<T, K>;
}

function sortedUnique<T extends string>(values: readonly T[], field: string): T[] {
  const sorted = [...values].sort(compareIndexerCanonicalText);
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${field} must not contain duplicates`);
  }
  return sorted;
}

function normalizeQuestionViews(
  values: readonly ResolvedQuestionContractView[] | undefined,
  field: string,
): ResolvedQuestionContractView[] {
  const normalized = (values ?? []).map((view) => ({
    ...view,
    targetRefs: sortedUnique(view.targetRefs, `${field}.targetRefs`),
    evidence: {
      ...view.evidence,
      acceptedKinds: sortedUnique(
        view.evidence.acceptedKinds,
        `${field}.evidence.acceptedKinds`,
      ),
    },
  })).sort((left, right) => compareIndexerCanonicalText(
    `${left.ref}\u0000${left.contractDigest}`,
    `${right.ref}\u0000${right.contractDigest}`,
  ));
  const keys = normalized.map((view) => `${view.ref}\u0000${view.contractDigest}`);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError(`${field} must contain unique contract views`);
  }
  return normalized;
}

function normalizeImplications(
  value: RequirementContractionComparatorOptions["readerGoalImplications"],
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value ?? {}).map(([goal, implied]) => [
    goal,
    sortedUnique(implied, `readerGoalImplications.${goal}`),
  ]));
}

function normalizeComparatorInputs(
  options: RequirementContractionComparatorOptions,
): z.infer<typeof comparatorInputsSchema> {
  return comparatorInputsSchema.parse({
    readerGoalImplications: normalizeImplications(options.readerGoalImplications),
    oldQuestionContracts: normalizeQuestionViews(
      options.oldQuestionContracts,
      "oldQuestionContracts",
    ),
    newQuestionContracts: normalizeQuestionViews(
      options.newQuestionContracts,
      "newQuestionContracts",
    ),
    selectorRelations: { ...(options.selectorRelations ?? {}) },
  });
}

function comparatorOptions(
  inputs: z.infer<typeof comparatorInputsSchema>,
): RequirementContractionComparatorOptions {
  return {
    readerGoalImplications: inputs.readerGoalImplications,
    oldQuestionContracts: inputs.oldQuestionContracts,
    newQuestionContracts: inputs.newQuestionContracts,
    selectorRelations: inputs.selectorRelations,
  };
}

export function indexerRequirementChangeReportDigest(
  value: Omit<IndexerRequirementChangeReport, "report_digest">,
): string {
  return indexerProtocolDigest(value);
}

export function indexerRequirementChangeConfirmationDigest(
  value: Omit<IndexerRequirementChangeConfirmation, "confirmation_digest">,
): string {
  return indexerProtocolDigest(value);
}

function buildReportPayload(input: {
  project_ref: string;
  old_requirement: IndexRequirement;
  new_requirement: IndexRequirement;
  comparator_inputs: z.infer<typeof comparatorInputsSchema>;
}): Omit<IndexerRequirementChangeReport, "report_digest"> {
  const comparison = compareIndexRequirementContraction(
    input.old_requirement,
    input.new_requirement,
    comparatorOptions(input.comparator_inputs),
  );
  return {
    protocol: "context.indexer.requirement-change-report/v1",
    project_ref: input.project_ref,
    old_requirement: input.old_requirement,
    new_requirement: input.new_requirement,
    old_requirement_digest: indexerProtocolDigest(input.old_requirement),
    new_requirement_digest: indexerProtocolDigest(input.new_requirement),
    comparator_inputs: input.comparator_inputs,
    comparison,
    comparison_digest: indexerProtocolDigest(comparison),
  };
}

export function buildIndexerRequirementChangeReport(input: {
  project_ref: string;
  old_requirement: IndexRequirement;
  new_requirement: IndexRequirement;
  comparator_options?: RequirementContractionComparatorOptions;
}): IndexerRequirementChangeReport {
  const payload = buildReportPayload({
    project_ref: input.project_ref,
    old_requirement: indexRequirementSchema.parse(input.old_requirement),
    new_requirement: indexRequirementSchema.parse(input.new_requirement),
    comparator_inputs: normalizeComparatorInputs(input.comparator_options ?? {}),
  });
  return indexerRequirementChangeReportSchema.parse({
    ...payload,
    report_digest: indexerRequirementChangeReportDigest(payload),
  });
}

export function validateIndexerRequirementChangeReport(
  value: unknown,
): IndexerRequirementChangeReport {
  const report = indexerRequirementChangeReportSchema.parse(value);
  const normalizedInputs = normalizeComparatorInputs(
    comparatorOptions(report.comparator_inputs),
  );
  if (
    canonicalIndexerJson(normalizedInputs) !==
      canonicalIndexerJson(report.comparator_inputs)
  ) {
    throw new TypeError("requirement comparator inputs are not canonical");
  }
  const expected = buildReportPayload({
    project_ref: report.project_ref,
    old_requirement: report.old_requirement,
    new_requirement: report.new_requirement,
    comparator_inputs: normalizedInputs,
  });
  if (
    canonicalIndexerJson(expected) !==
      canonicalIndexerJson(withoutDigest(report, "report_digest")) ||
    indexerRequirementChangeReportDigest(expected) !== report.report_digest
  ) {
    throw new TypeError("requirement change report is stale or invalid");
  }
  return report;
}

export function confirmIndexerRequirementChange(input: {
  report: unknown;
  authority: "managed" | "human";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerRequirementChangeConfirmation {
  const report = validateIndexerRequirementChangeReport(input.report);
  const requiresHuman = report.comparison.requiresHumanConfirmation;
  if (requiresHuman && input.authority !== "human") {
    throw new TypeError("requirement contraction/incomparable Gate cannot be delegated");
  }
  const payload: Omit<IndexerRequirementChangeConfirmation, "confirmation_digest"> = {
    protocol: "context.indexer.requirement-change-confirmation/v1",
    project_ref: report.project_ref,
    gate: requiresHuman
      ? "confirm-index-requirement-contraction"
      : "confirm-index-requirements",
    old_requirement_digest: report.old_requirement_digest,
    new_requirement_digest: report.new_requirement_digest,
    comparison_digest: report.comparison_digest,
    report_digest: report.report_digest,
    authority: input.authority,
    non_delegable: requiresHuman,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  };
  return indexerRequirementChangeConfirmationSchema.parse({
    ...payload,
    confirmation_digest: indexerRequirementChangeConfirmationDigest(payload),
  });
}

export function validateIndexerRequirementChangeConfirmation(input: {
  report: unknown;
  confirmation: unknown;
}): IndexerRequirementChangeConfirmation {
  const report = validateIndexerRequirementChangeReport(input.report);
  const confirmation = indexerRequirementChangeConfirmationSchema.parse(
    input.confirmation,
  );
  const requiresHuman = report.comparison.requiresHumanConfirmation;
  const payload = withoutDigest(confirmation, "confirmation_digest");
  if (
    confirmation.project_ref !== report.project_ref ||
    confirmation.old_requirement_digest !== report.old_requirement_digest ||
    confirmation.new_requirement_digest !== report.new_requirement_digest ||
    confirmation.comparison_digest !== report.comparison_digest ||
    confirmation.report_digest !== report.report_digest ||
    confirmation.gate !== (requiresHuman
      ? "confirm-index-requirement-contraction"
      : "confirm-index-requirements") ||
    confirmation.non_delegable !== requiresHuman ||
    (requiresHuman && confirmation.authority !== "human") ||
    indexerRequirementChangeConfirmationDigest(payload) !== confirmation.confirmation_digest
  ) {
    throw new TypeError("requirement change confirmation is stale or invalid");
  }
  return confirmation;
}
