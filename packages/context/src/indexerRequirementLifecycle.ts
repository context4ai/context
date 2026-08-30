import { z } from "zod";
import {
  INDEXER_EVIDENCE_KINDS,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import {
  buildIndexerRequirementChangeReport,
  validateIndexerRequirementChangeReport,
  type IndexerRequirementChangeReport,
} from "./indexerRequirementConfirmation.js";
import type {
  RequirementContractionComparatorOptions,
  RequirementContractionRelation,
  ResolvedQuestionContractView,
} from "./indexerRequirementComparison.js";
import {
  indexRequirementSchema,
  indexRequirementSetSchema,
  type IndexRequirement,
  type IndexRequirementSet,
} from "./indexerRegistry.js";

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

const requirementSummarySchema = z.object({
  scenario: z.string().min(1),
  reader_goals: z.array(z.string().min(1)),
  capabilities: z.array(z.object({
    coverage_domain: z.string().min(1),
    obligation: z.enum(["required", "optional", "out-of-scope"]),
  }).strict()),
  evidence_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)),
  target_source_refs: z.array(z.string().min(1)),
  evidence_source_refs: z.array(z.string().min(1)),
}).strict();

export const indexerRequirementInspectionInputSchema = z.object({
  protocol: z.literal("context.indexer.requirement-inspection-input/v1"),
  project_ref: z.string().min(1),
  requirements: z.array(indexRequirementSchema).min(1),
  question_contracts: z.array(questionContractViewSchema).optional(),
}).strict();

export const indexerRequirementInspectionSchema = z.object({
  protocol: z.literal("context.indexer.requirement-inspection/v1"),
  project_ref: z.string().min(1),
  requirement_set: indexRequirementSetSchema,
  requirement_set_digest: indexerDigestSchema,
  source_boundary_digest: indexerDigestSchema,
  question_contracts: z.array(questionContractViewSchema),
  summary: z.array(requirementSummarySchema).min(1),
  inspection_digest: indexerDigestSchema,
}).strict();

const requirementChangeItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("added"),
    requirement_ref: z.string().min(1),
    relation: z.literal("strengthening"),
    target_requirement_digest: indexerDigestSchema,
  }).strict(),
  z.object({
    kind: z.literal("removed"),
    requirement_ref: z.string().min(1),
    relation: z.literal("contraction"),
    base_requirement_digest: indexerDigestSchema,
  }).strict(),
  z.object({
    kind: z.literal("changed"),
    requirement_ref: z.string().min(1),
    relation: relationSchema,
    report: indexerRequirementChangeReportSchemaReference(),
  }).strict(),
]);

function indexerRequirementChangeReportSchemaReference(): z.ZodType<IndexerRequirementChangeReport> {
  return z.custom<IndexerRequirementChangeReport>(
    (value) => {
      try {
        validateIndexerRequirementChangeReport(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "requirement change report is invalid" },
  );
}

export const indexerRequirementWorksetReportSchema = z.object({
  protocol: z.literal("context.indexer.requirement-workset-report/v1"),
  project_ref: z.string().min(1),
  base_requirement_set: indexRequirementSetSchema.nullable(),
  target_requirement_set: indexRequirementSetSchema,
  base_requirement_set_digest: indexerDigestSchema.nullable(),
  target_requirement_set_digest: indexerDigestSchema,
  source_boundary_digest: indexerDigestSchema,
  relation: relationSchema,
  requires_human_confirmation: z.boolean(),
  changes: z.array(requirementChangeItemSchema),
  workset_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
}).strict();

export const indexerRequirementWorksetConfirmationSchema = z.object({
  protocol: z.literal("context.indexer.requirement-workset-confirmation/v1"),
  project_ref: z.string().min(1),
  gate: z.enum([
    "confirm-index-requirements",
    "confirm-index-requirement-contraction",
  ]),
  workset_digest: indexerDigestSchema,
  report_digest: indexerDigestSchema,
  base_requirement_set_digest: indexerDigestSchema.nullable(),
  target_requirement_set_digest: indexerDigestSchema,
  authority: z.enum(["managed", "human"]),
  non_delegable: z.boolean(),
  confirmed_by: z.string().min(1),
  confirmed_at: z.string().datetime({ offset: true }),
  confirmation_digest: indexerDigestSchema,
}).strict();

export type IndexerRequirementInspectionInput = z.infer<
  typeof indexerRequirementInspectionInputSchema
>;
export type IndexerRequirementInspection = z.infer<
  typeof indexerRequirementInspectionSchema
>;
export type IndexerRequirementSummary = z.infer<typeof requirementSummarySchema>;
export type IndexerRequirementWorksetReport = z.infer<
  typeof indexerRequirementWorksetReportSchema
>;
export type IndexerRequirementWorksetConfirmation = z.infer<
  typeof indexerRequirementWorksetConfirmationSchema
>;

function sortedUnique(values: readonly string[], field: string): string[] {
  const result = [...values].sort(compareIndexerCanonicalText);
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${field} must not contain duplicates`);
  }
  return result;
}

function normalizeRequirement(requirement: IndexRequirement): IndexRequirement {
  const normalizeTargets = (targets: IndexRequirement["target_scope"]["targets"]) =>
    targets.map((target) => ({
      source_ref: target.source_ref,
      module_refs: sortedUnique(target.module_refs, "module_refs"),
    })).sort((left, right) => compareIndexerCanonicalText(
      left.source_ref,
      right.source_ref,
    ));
  return {
    id: requirement.id,
    reader_goals: sortedUnique(requirement.reader_goals, "reader_goals"),
    coverage_domains: Object.fromEntries(Object.entries(requirement.coverage_domains)
      .sort(([left], [right]) => compareIndexerCanonicalText(left, right))),
    ...(requirement.questions === undefined ? {} : {
      questions: [...requirement.questions].sort((left, right) =>
        compareIndexerCanonicalText(
          `${left.ref}\u0000${left.contract_digest}`,
          `${right.ref}\u0000${right.contract_digest}`,
        )),
    }),
    target_scope: { targets: normalizeTargets(requirement.target_scope.targets) },
    evidence_source_scope: {
      targets: normalizeTargets(requirement.evidence_source_scope.targets),
    },
    ...(requirement.exclusions === undefined ? {} : {
      exclusions: requirement.exclusions.map((exclusion) => ({
        ...exclusion,
        scope: { targets: normalizeTargets(exclusion.scope.targets) },
      })).sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
    }),
  };
}

export function normalizeIndexerRequirementSet(
  requirements: readonly IndexRequirement[],
): IndexRequirementSet {
  return indexRequirementSetSchema.parse({
    protocol: "context.indexer.requirement-set/v1",
    requirements: requirements.map(normalizeRequirement)
      .sort((left, right) => compareIndexerCanonicalText(left.id, right.id)),
  });
}

function normalizeQuestionContracts(
  values: readonly ResolvedQuestionContractView[],
): Array<z.infer<typeof questionContractViewSchema>> {
  return values.map((view) => ({
    ...view,
    targetRefs: sortedUnique(view.targetRefs, `${view.ref}.targetRefs`),
    evidence: {
      ...view.evidence,
      acceptedKinds: sortedUnique(
        view.evidence.acceptedKinds,
        `${view.ref}.evidence.acceptedKinds`,
      ) as Array<z.infer<typeof questionContractViewSchema>["evidence"]["acceptedKinds"][number]>,
    },
  })).sort((left, right) => compareIndexerCanonicalText(
    `${left.ref}\u0000${left.contractDigest}`,
    `${right.ref}\u0000${right.contractDigest}`,
  ));
}

function requirementSummary(
  requirement: IndexRequirement,
  questionContracts: ReadonlyMap<string, ResolvedQuestionContractView>,
): IndexerRequirementSummary {
  const evidenceKinds = new Set<string>();
  for (const question of requirement.questions ?? []) {
    const view = questionContracts.get(`${question.ref}\u0000${question.contract_digest}`);
    if (view === undefined) continue;
    for (const kind of view.evidence.acceptedKinds) evidenceKinds.add(kind);
  }
  return {
    scenario: requirement.id,
    reader_goals: [...requirement.reader_goals],
    capabilities: Object.entries(requirement.coverage_domains).map(([
      coverage_domain,
      obligation,
    ]) => ({ coverage_domain, obligation })),
    evidence_kinds: [...evidenceKinds].sort(compareIndexerCanonicalText) as
      IndexerRequirementSummary["evidence_kinds"],
    target_source_refs: requirement.target_scope.targets.map((target) => target.source_ref),
    evidence_source_refs: requirement.evidence_source_scope.targets
      .map((target) => target.source_ref),
  };
}

export function buildIndexerRequirementInspection(input: {
  value: unknown;
  source_boundary_digest: string;
}): IndexerRequirementInspection {
  const parsed = indexerRequirementInspectionInputSchema.parse(input.value);
  const requirementSet = normalizeIndexerRequirementSet(parsed.requirements);
  const questionContracts = normalizeQuestionContracts(parsed.question_contracts ?? []);
  const contractMap = new Map(questionContracts.map((view) => [
    `${view.ref}\u0000${view.contractDigest}`,
    view,
  ]));
  const payload: Omit<IndexerRequirementInspection, "inspection_digest"> = {
    protocol: "context.indexer.requirement-inspection/v1",
    project_ref: parsed.project_ref,
    requirement_set: requirementSet,
    requirement_set_digest: indexerProtocolDigest(requirementSet),
    source_boundary_digest: indexerDigestSchema.parse(input.source_boundary_digest),
    question_contracts: questionContracts,
    summary: requirementSet.requirements.map((requirement) =>
      requirementSummary(requirement, contractMap)),
  };
  return indexerRequirementInspectionSchema.parse({
    ...payload,
    inspection_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerRequirementInspection(
  value: unknown,
): IndexerRequirementInspection {
  const inspection = indexerRequirementInspectionSchema.parse(value);
  const rebuilt = buildIndexerRequirementInspection({
    value: {
      protocol: "context.indexer.requirement-inspection-input/v1",
      project_ref: inspection.project_ref,
      requirements: inspection.requirement_set.requirements,
      question_contracts: inspection.question_contracts,
    },
    source_boundary_digest: inspection.source_boundary_digest,
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(inspection)) {
    throw new TypeError("requirement inspection is stale or invalid");
  }
  return inspection;
}

function aggregateRelation(
  relations: readonly RequirementContractionRelation[],
): RequirementContractionRelation {
  const distinct = new Set(relations.filter((relation) => relation !== "equivalent"));
  if (distinct.size === 0) return "equivalent";
  if (distinct.has("incomparable") || distinct.size > 1) return "incomparable";
  return [...distinct][0]!;
}

export function buildIndexerRequirementWorksetReport(input: {
  inspection: unknown;
  base_requirement_set: IndexRequirementSet | null;
  comparator_options?: Readonly<Record<string, RequirementContractionComparatorOptions>>;
}): IndexerRequirementWorksetReport {
  const inspection = validateIndexerRequirementInspection(input.inspection);
  const base = input.base_requirement_set === null
    ? null
    : normalizeIndexerRequirementSet(input.base_requirement_set.requirements);
  const baseMap = new Map(base?.requirements.map((item) => [item.id, item]) ?? []);
  const targetMap = new Map(inspection.requirement_set.requirements.map((item) => [item.id, item]));
  const requirementRefs = [...new Set([...baseMap.keys(), ...targetMap.keys()])]
    .sort(compareIndexerCanonicalText);
  const changes: IndexerRequirementWorksetReport["changes"] = [];
  const relations: RequirementContractionRelation[] = [];
  for (const requirementRef of requirementRefs) {
    const oldRequirement = baseMap.get(requirementRef);
    const newRequirement = targetMap.get(requirementRef);
    if (oldRequirement === undefined) {
      const targetRequirementDigest = indexerProtocolDigest(newRequirement!);
      changes.push({
        kind: "added",
        requirement_ref: requirementRef,
        relation: "strengthening",
        target_requirement_digest: targetRequirementDigest,
      });
      relations.push("strengthening");
      continue;
    }
    if (newRequirement === undefined) {
      changes.push({
        kind: "removed",
        requirement_ref: requirementRef,
        relation: "contraction",
        base_requirement_digest: indexerProtocolDigest(oldRequirement),
      });
      relations.push("contraction");
      continue;
    }
    const comparatorOptions = input.comparator_options?.[requirementRef];
    const report = buildIndexerRequirementChangeReport({
      project_ref: inspection.project_ref,
      old_requirement: oldRequirement,
      new_requirement: newRequirement,
      ...(comparatorOptions === undefined ? {} : {
        comparator_options: comparatorOptions,
      }),
    });
    changes.push({
      kind: "changed",
      requirement_ref: requirementRef,
      relation: report.comparison.relation,
      report,
    });
    relations.push(report.comparison.relation);
  }
  const relation = aggregateRelation(relations);
  const baseDigest = base === null ? null : indexerProtocolDigest(base);
  const worksetPayload = {
    protocol: "context.indexer.requirement-workset/v1",
    project_ref: inspection.project_ref,
    base_requirement_set_digest: baseDigest,
    target_requirement_set_digest: inspection.requirement_set_digest,
    source_boundary_digest: inspection.source_boundary_digest,
    changes,
  };
  const worksetDigest = indexerProtocolDigest(worksetPayload);
  const payload: Omit<IndexerRequirementWorksetReport, "report_digest"> = {
    protocol: "context.indexer.requirement-workset-report/v1",
    project_ref: inspection.project_ref,
    base_requirement_set: base,
    target_requirement_set: inspection.requirement_set,
    base_requirement_set_digest: baseDigest,
    target_requirement_set_digest: inspection.requirement_set_digest,
    source_boundary_digest: inspection.source_boundary_digest,
    relation,
    requires_human_confirmation: relation === "contraction" || relation === "incomparable",
    changes,
    workset_digest: worksetDigest,
  };
  return indexerRequirementWorksetReportSchema.parse({
    ...payload,
    report_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerRequirementWorksetReport(
  value: unknown,
): IndexerRequirementWorksetReport {
  const report = indexerRequirementWorksetReportSchema.parse(value);
  const rebuilt = buildIndexerRequirementWorksetReport({
    inspection: buildIndexerRequirementInspection({
      value: {
        protocol: "context.indexer.requirement-inspection-input/v1",
        project_ref: report.project_ref,
        requirements: report.target_requirement_set.requirements,
      },
      source_boundary_digest: report.source_boundary_digest,
    }),
    base_requirement_set: report.base_requirement_set,
    comparator_options: Object.fromEntries(report.changes.flatMap((change) => {
      if (change.kind !== "changed") return [];
      const inputs = change.report.comparator_inputs;
      return [[change.requirement_ref, {
        readerGoalImplications: inputs.readerGoalImplications,
        oldQuestionContracts: inputs.oldQuestionContracts,
        newQuestionContracts: inputs.newQuestionContracts,
        selectorRelations: inputs.selectorRelations,
      }]];
    })),
  });
  if (canonicalIndexerJson(rebuilt) !== canonicalIndexerJson(report)) {
    throw new TypeError("requirement workset report is stale or invalid");
  }
  return report;
}

export function confirmIndexerRequirementWorkset(input: {
  report: unknown;
  authority: "managed" | "human";
  confirmed_by: string;
  confirmed_at: string;
}): IndexerRequirementWorksetConfirmation {
  const report = validateIndexerRequirementWorksetReport(input.report);
  if (report.requires_human_confirmation && input.authority !== "human") {
    throw new TypeError("requirement contraction/incomparable Gate cannot be delegated");
  }
  const payload: Omit<IndexerRequirementWorksetConfirmation, "confirmation_digest"> = {
    protocol: "context.indexer.requirement-workset-confirmation/v1",
    project_ref: report.project_ref,
    gate: report.requires_human_confirmation
      ? "confirm-index-requirement-contraction"
      : "confirm-index-requirements",
    workset_digest: report.workset_digest,
    report_digest: report.report_digest,
    base_requirement_set_digest: report.base_requirement_set_digest,
    target_requirement_set_digest: report.target_requirement_set_digest,
    authority: input.authority,
    non_delegable: report.requires_human_confirmation,
    confirmed_by: input.confirmed_by,
    confirmed_at: input.confirmed_at,
  };
  return indexerRequirementWorksetConfirmationSchema.parse({
    ...payload,
    confirmation_digest: indexerProtocolDigest(payload),
  });
}

export function validateIndexerRequirementWorksetConfirmation(input: {
  report: unknown;
  confirmation: unknown;
}): IndexerRequirementWorksetConfirmation {
  const report = validateIndexerRequirementWorksetReport(input.report);
  const confirmation = indexerRequirementWorksetConfirmationSchema.parse(input.confirmation);
  const expected = confirmIndexerRequirementWorkset({
    report,
    authority: confirmation.authority,
    confirmed_by: confirmation.confirmed_by,
    confirmed_at: confirmation.confirmed_at,
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(confirmation)) {
    throw new TypeError("requirement workset confirmation is stale or invalid");
  }
  return confirmation;
}
