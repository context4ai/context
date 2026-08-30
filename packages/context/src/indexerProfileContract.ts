import { z } from "zod";
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from "./contracts.js";
import {
  INDEXER_COVERAGE_DOMAINS,
  INDEXER_EVIDENCE_KINDS,
  INDEXER_SUBJECT_DERIVATION_OPERATORS,
  INDEXER_SUBJECT_NORMALIZATIONS,
  addDuplicateIssues,
  formatIndexerSchemaIssues,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
  indexerSemverSchema,
  indexerSnakeCaseIdSchema,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";
import {
  indexerParserRequirementSchema,
  validateIndexerParserRequirement,
} from "./indexerParserCoordinate.js";
import {
  indexerRestrictedSelectorSchema,
  indexerSelectorFactPathSchema,
  validateIndexerRestrictedSelector,
} from "./indexerRestrictedSelector.js";

const canonicalParametersSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(canonicalParametersSchema),
    z.record(canonicalParametersSchema),
  ])
);

export const indexerOperatorContractSchema = z.object({
  protocol: z.literal("context.indexer.operator-contract/v1"),
  version: indexerSemverSchema,
  selector_operators: z.array(indexerIdSchema),
  grouping_operators: z.array(indexerIdSchema),
  metric_operators: z.array(indexerIdSchema),
  threshold_operators: z.array(indexerIdSchema),
  selector_fact_paths: z.array(indexerSelectorFactPathSchema),
  contract_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.selector_operators, context, "selector_operators");
  addDuplicateIssues(value.grouping_operators, context, "grouping_operators");
  addDuplicateIssues(value.metric_operators, context, "metric_operators");
  addDuplicateIssues(value.threshold_operators, context, "threshold_operators");
  addDuplicateIssues(value.selector_fact_paths, context, "selector_fact_paths");
});

const selectorSchema = z.object({
  operator: indexerIdSchema,
  parameters: z.record(canonicalParametersSchema).optional(),
}).strict();

function addMetricValueIssues(input: {
  unit: "count" | "ratio";
  values: readonly number[];
  context: z.RefinementCtx;
}): void {
  input.values.forEach((value, index) => {
    if (input.unit === "count" && (!Number.isSafeInteger(value) || value < 0)) {
      input.context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "count thresholds must be non-negative safe integers",
        path: [index],
      });
    }
    if (input.unit === "ratio" && (value < 0 || value > 1)) {
      input.context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ratio thresholds must be between 0 and 1",
        path: [index],
      });
    }
  });
}

const explicitMinimumMetricSchema = z.object({
  id: indexerIdSchema,
  unit: z.enum(["count", "ratio"]),
  operator: indexerIdSchema,
  threshold_policy: z.literal("explicit"),
  direction: z.literal("minimum"),
  recommended_min: z.number().finite(),
  hard_min: z.number().finite(),
}).strict().superRefine((value, context) => {
  addMetricValueIssues({
    unit: value.unit,
    values: [value.recommended_min, value.hard_min],
    context,
  });
  if (value.hard_min > value.recommended_min) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "hard_min must not exceed recommended_min",
      path: ["hard_min"],
    });
  }
});

const explicitMaximumMetricSchema = z.object({
  id: indexerIdSchema,
  unit: z.enum(["count", "ratio"]),
  operator: indexerIdSchema,
  threshold_policy: z.literal("explicit"),
  direction: z.literal("maximum"),
  recommended_max: z.number().finite().nonnegative(),
  hard_max: z.number().finite().nonnegative(),
}).strict().superRefine((value, context) => {
  addMetricValueIssues({
    unit: value.unit,
    values: [value.recommended_max, value.hard_max],
    context,
  });
  if (value.hard_max < value.recommended_max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "hard_max must not be lower than recommended_max",
      path: ["hard_max"],
    });
  }
});

const inflationSensitiveMetricSchema = z.object({
  id: indexerIdSchema,
  unit: z.enum(["count", "ratio"]),
  operator: indexerIdSchema,
  threshold_policy: z.literal("inflation-sensitive"),
  direction: z.literal("maximum"),
}).strict();

export const indexerMetricContractSchema = z.union([
  explicitMinimumMetricSchema,
  explicitMaximumMetricSchema,
  inflationSensitiveMetricSchema,
]);

const variantAxisSchema = z.object({
  id: indexerSnakeCaseIdSchema,
  type: z.literal("enum"),
  values: z.array(indexerIdSchema).min(1),
  required: z.boolean(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.values, context, "values");
});

const profileVariantSchema = z.object({
  axes: z.array(variantAxisSchema),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.axes.map((axis) => axis.id), context, "axes");
});

const subjectKeySchemaBase = z.object({
  version: z.number().int().positive(),
  namespace: z.object({
    operator: z.enum(INDEXER_SUBJECT_DERIVATION_OPERATORS),
  }).strict(),
  kinds: z.array(z.object({
    id: indexerIdSchema,
    local_key: z.object({
      operator: z.enum(INDEXER_SUBJECT_DERIVATION_OPERATORS),
    }).strict(),
  }).strict()).min(1),
  normalization: z.array(z.enum(INDEXER_SUBJECT_NORMALIZATIONS)).optional(),
}).strict();

function addSubjectKeySchemaIssues(
  value: z.infer<typeof subjectKeySchemaBase>,
  context: z.RefinementCtx,
): void {
  addDuplicateIssues(value.kinds.map((kind) => kind.id), context, "kinds");
  addDuplicateIssues(value.normalization ?? [], context, "normalization");
  if (
    value.normalization?.includes("preserve-case") === true &&
    value.normalization.includes("lowercase")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "preserve-case and lowercase normalization are mutually exclusive",
      path: ["normalization"],
    });
  }
}

export const indexerSubjectKeyContractSchema = subjectKeySchemaBase.superRefine(
  addSubjectKeySchemaIssues,
);

export const indexerProfileSubjectKeySchema = subjectKeySchemaBase.extend({
  profile: indexerIdSchema,
}).superRefine(addSubjectKeySchemaIssues);

export const indexerInventoryDomainSchema = z.object({
  id: indexerIdSchema,
  selector: selectorSchema,
  disposition_required: z.literal(true),
}).strict();

export const indexerQuestionTargetDomainSchema = z.object({
  id: indexerIdSchema,
  selector: selectorSchema,
  grouping_operator: indexerIdSchema,
  subject_key_kind: indexerIdSchema,
  granularity: z.enum(["module", "identity"]),
}).strict();

export const indexerReaderQuestionContractSchema = z.object({
  ref: z.string().regex(/^question:[A-Za-z0-9][A-Za-z0-9._~:/#-]*$/u),
  semantic: z.string().min(1).refine(
    (value) => value.normalize("NFC") === value,
    "semantic must use Unicode NFC normalization",
  ),
  version: z.number().int().positive(),
  coverage_domain: indexerIdSchema,
  target_domain_ref: indexerIdSchema,
  target_selector: indexerRestrictedSelectorSchema,
  evidence_contract: z.object({
    accepted_kinds: z.array(z.enum(INDEXER_EVIDENCE_KINDS)).min(1),
    minimum_items: z.number().int().positive(),
    minimum_distinct_sources: z.number().int().positive(),
    provenance_constraints: indexerRestrictedSelectorSchema.optional(),
  }).strict(),
  allowed_exclusion_reason_codes: z.array(indexerIdSchema).optional(),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.evidence_contract.accepted_kinds,
    context,
    "evidence_contract.accepted_kinds",
  );
  addDuplicateIssues(
    value.allowed_exclusion_reason_codes ?? [],
    context,
    "allowed_exclusion_reason_codes",
  );
  if (
    value.evidence_contract.minimum_distinct_sources >
    value.evidence_contract.minimum_items
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "minimum_distinct_sources must not exceed minimum_items",
      path: ["evidence_contract", "minimum_distinct_sources"],
    });
  }
});

export const indexerArtifactPolicyVariantSchema = z.object({
  id: indexerIdSchema,
  eligibility: indexerRestrictedSelectorSchema,
  artifact_kinds: z.object({
    required: z.array(indexerIdSchema).min(1),
    discretionary: z.array(indexerIdSchema),
  }).strict().superRefine((value, context) => {
    addDuplicateIssues(value.required, context, "required");
    addDuplicateIssues(value.discretionary, context, "discretionary");
    const overlap = value.required.find((kind) => value.discretionary.includes(kind));
    if (overlap !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Artifact kind ${overlap} cannot be both required and discretionary`,
        path: ["discretionary"],
      });
    }
  }),
  thresholds: z.record(indexerIdSchema, z.object({
    recommended_max: z.number().finite().nonnegative(),
  }).strict()),
}).strict();

const indexerKnowledgeCollectionSchema = z.custom<KnowledgeCollection>(
  (value) => typeof value === "string" &&
    (KNOWLEDGE_COLLECTIONS as readonly string[]).includes(value),
  { message: "collection must be a registered package/query collection" },
);

export const indexerLayoutMappingSchema = z.object({
  source_roles: z.array(indexerIdSchema).min(1),
  document_kind: indexerIdSchema,
  reader_goal: indexerIdSchema,
  artifact_kinds: z.array(indexerIdSchema).min(1),
  collection: indexerKnowledgeCollectionSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.source_roles, context, "source_roles");
  addDuplicateIssues(value.artifact_kinds, context, "artifact_kinds");
});

export const indexerProfileContractEntrySchema = z.object({
  id: indexerIdSchema,
  parser_requirements: z.array(indexerParserRequirementSchema),
  inventory_domains: z.array(indexerInventoryDomainSchema).min(1),
  required_dispositions: z.array(indexerIdSchema).min(1),
  metrics: z.array(indexerMetricContractSchema),
  artifact_policy_variants: z.array(indexerArtifactPolicyVariantSchema),
  question_target_domains: z.array(indexerQuestionTargetDomainSchema),
  reader_question_contracts: z.array(indexerReaderQuestionContractSchema),
  layout_mappings: z.array(indexerLayoutMappingSchema),
  variant_schema: profileVariantSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(
    value.parser_requirements.map((requirement) => requirement.capability),
    context,
    "parser_requirements",
  );
  addDuplicateIssues(value.inventory_domains.map((domain) => domain.id), context, "inventory_domains");
  addDuplicateIssues(value.required_dispositions, context, "required_dispositions");
  addDuplicateIssues(value.metrics.map((metric) => metric.id), context, "metrics");
  addDuplicateIssues(
    value.artifact_policy_variants.map((variant) => variant.id),
    context,
    "artifact_policy_variants",
  );
  addDuplicateIssues(
    value.question_target_domains.map((domain) => domain.id),
    context,
    "question_target_domains",
  );
  addDuplicateIssues(
    value.reader_question_contracts.map((question) => question.ref),
    context,
    "reader_question_contracts",
  );
  const layoutKeys = value.layout_mappings.flatMap((mapping) =>
    mapping.source_roles.flatMap((sourceRole) =>
      mapping.artifact_kinds.map((artifactKind) =>
        [sourceRole, mapping.document_kind, mapping.reader_goal, artifactKind].join("\u0000")
      )
    )
  );
  addDuplicateIssues(layoutKeys, context, "layout_mappings");
});

export const indexerProfileContractSchema = z.object({
  protocol: z.literal("context.indexer.profile-contract/v1"),
  version: indexerSemverSchema,
  operator_contract_version: indexerSemverSchema,
  operator_contract_digest: indexerDigestSchema,
  coverage_domains: z.array(z.enum(INDEXER_COVERAGE_DOMAINS)).length(
    INDEXER_COVERAGE_DOMAINS.length,
  ),
  profiles: z.array(indexerProfileContractEntrySchema).min(1),
  subject_key_schemas: z.array(indexerProfileSubjectKeySchema).min(1),
  contract_digest: indexerDigestSchema,
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.coverage_domains, context, "coverage_domains");
  for (const domain of INDEXER_COVERAGE_DOMAINS) {
    if (!value.coverage_domains.includes(domain)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `coverage_domains must contain ${domain}`,
        path: ["coverage_domains"],
      });
    }
  }
  addDuplicateIssues(value.profiles.map((profile) => profile.id), context, "profiles");
  addDuplicateIssues(
    value.subject_key_schemas.map((schema) => schema.profile),
    context,
    "subject_key_schemas",
  );
  const profileIds = new Set(value.profiles.map((profile) => profile.id));
  value.subject_key_schemas.forEach((schema, index) => {
    if (!profileIds.has(schema.profile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `subject_key_schemas references unknown community profile ${schema.profile}`,
        path: ["subject_key_schemas", index, "profile"],
      });
    }
  });
  value.profiles.forEach((profile) => {
    if (!value.subject_key_schemas.some((schema) => schema.profile === profile.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `community profile ${profile.id} requires exactly one subject_key_schema`,
        path: ["subject_key_schemas"],
      });
    }
  });
});

export type IndexerOperatorContract = z.infer<typeof indexerOperatorContractSchema>;
export type IndexerMetricContract = z.infer<typeof indexerMetricContractSchema>;
export type IndexerArtifactPolicyVariant = z.infer<
  typeof indexerArtifactPolicyVariantSchema
>;
export type IndexerLayoutMapping = z.infer<typeof indexerLayoutMappingSchema>;
export type IndexerReaderQuestionContract = z.infer<
  typeof indexerReaderQuestionContractSchema
>;
export type IndexerSubjectKeyContract = z.infer<typeof indexerSubjectKeyContractSchema>;
export type IndexerProfileSubjectKey = z.infer<typeof indexerProfileSubjectKeySchema>;
export type IndexerProfileContractEntry = z.infer<typeof indexerProfileContractEntrySchema>;
export type IndexerProfileContract = z.infer<typeof indexerProfileContractSchema>;

export function indexerOperatorContractDigest(
  contract: Omit<IndexerOperatorContract, "contract_digest">,
): string {
  return indexerProtocolDigest(contract);
}

export function indexerProfileContractDigest(
  contract: Omit<IndexerProfileContract, "contract_digest">,
): string {
  return indexerProtocolDigest(contract);
}

function withoutContractDigest<T extends { contract_digest: string }>(
  value: T,
): Omit<T, "contract_digest"> {
  const payload: Partial<T> = { ...value };
  Reflect.deleteProperty(payload, "contract_digest");
  return payload as Omit<T, "contract_digest">;
}

function assertOperator(
  operator: string,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  if (!allowed.has(operator)) {
    throw new TypeError(`${field} references unregistered operator ${operator}`);
  }
}

export function validateIndexerOperatorContract(value: unknown): IndexerOperatorContract {
  const parsed = indexerOperatorContractSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `operator contract is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const payload = withoutContractDigest(parsed.data);
  if (indexerOperatorContractDigest(payload) !== parsed.data.contract_digest) {
    throw new TypeError("operator contract digest does not match its canonical payload");
  }
  return parsed.data;
}

export function validateIndexerProfileContract(
  value: unknown,
  operatorContractValue: unknown,
): IndexerProfileContract {
  const operators = validateIndexerOperatorContract(operatorContractValue);
  const parsed = indexerProfileContractSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `profile contract is invalid: ${formatIndexerSchemaIssues(parsed.error.issues)}`,
    );
  }
  const contract = parsed.data;
  if (
    contract.operator_contract_version !== operators.version ||
    contract.operator_contract_digest !== operators.contract_digest
  ) {
    throw new TypeError("profile contract is bound to another operator contract");
  }
  const payload = withoutContractDigest(contract);
  if (indexerProfileContractDigest(payload) !== contract.contract_digest) {
    throw new TypeError("profile contract digest does not match its canonical payload");
  }
  const selectors = new Set(operators.selector_operators);
  const groupings = new Set(operators.grouping_operators);
  const metrics = new Set(operators.metric_operators);
  const selectorFacts = new Set(operators.selector_fact_paths);
  const coverageDomains: ReadonlySet<string> = new Set(contract.coverage_domains);
  const subjectKeySchemas = new Map(
    contract.subject_key_schemas.map((schema) => [schema.profile, schema]),
  );
  for (const profile of contract.profiles) {
    for (const requirement of profile.parser_requirements) {
      validateIndexerParserRequirement(requirement);
    }
    const subjectKeySchema = subjectKeySchemas.get(profile.id)!;
    for (const domain of profile.inventory_domains) {
      assertOperator(domain.selector.operator, selectors, `${profile.id}.inventory_domains.${domain.id}`);
    }
    for (const metric of profile.metrics) {
      assertOperator(metric.operator, metrics, `${profile.id}.metrics.${metric.id}`);
    }
    const metricMap = new Map(profile.metrics.map((metric) => [metric.id, metric]));
    for (const variant of profile.artifact_policy_variants) {
      validateIndexerRestrictedSelector(variant.eligibility, selectorFacts);
      for (const metricId of Object.keys(variant.thresholds)) {
        const metric = metricMap.get(metricId);
        if (metric?.threshold_policy !== "inflation-sensitive") {
          throw new TypeError(
            `${profile.id}.artifact_policy_variants.${variant.id} can only bind inflation-sensitive metrics`,
          );
        }
        const recommendedMaximum = variant.thresholds[metricId]!.recommended_max;
        if (
          (metric.unit === "count" && !Number.isSafeInteger(recommendedMaximum)) ||
          (metric.unit === "ratio" && recommendedMaximum > 1)
        ) {
          throw new TypeError(
            `${profile.id}.artifact_policy_variants.${variant.id} has an invalid ${metric.unit} threshold`,
          );
        }
      }
      const missingInflationThreshold = profile.metrics.find((metric) =>
        metric.threshold_policy === "inflation-sensitive" &&
        variant.thresholds[metric.id] === undefined
      );
      if (missingInflationThreshold !== undefined) {
        throw new TypeError(
          `${profile.id}.artifact_policy_variants.${variant.id} is missing threshold ${missingInflationThreshold.id}`,
        );
      }
    }
    const registeredArtifactKinds = new Set(profile.artifact_policy_variants.flatMap((variant) => [
      ...variant.artifact_kinds.required,
      ...variant.artifact_kinds.discretionary,
    ]));
    for (const mapping of profile.layout_mappings) {
      const unknownKind = mapping.artifact_kinds.find((kind) =>
        !registeredArtifactKinds.has(kind)
      );
      if (unknownKind !== undefined) {
        throw new TypeError(
          `${profile.id}.layout_mappings references unregistered Artifact kind ${unknownKind}`,
        );
      }
    }
    const unmappedKind = [...registeredArtifactKinds].find((kind) =>
      !profile.layout_mappings.some((mapping) => mapping.artifact_kinds.includes(kind))
    );
    if (unmappedKind !== undefined) {
      throw new TypeError(`${profile.id} has no layout mapping for Artifact kind ${unmappedKind}`);
    }
    const targetDomains = new Set(profile.question_target_domains.map((domain) => domain.id));
    for (const domain of profile.question_target_domains) {
      assertOperator(domain.selector.operator, selectors, `${profile.id}.question_target_domains.${domain.id}`);
      assertOperator(domain.grouping_operator, groupings, `${profile.id}.question_target_domains.${domain.id}`);
      if (!subjectKeySchema.kinds.some((kind) => kind.id === domain.subject_key_kind)) {
        throw new TypeError(
          `${profile.id}.question_target_domains.${domain.id} references unknown SubjectKey kind`,
        );
      }
    }
    for (const question of profile.reader_question_contracts) {
      if (!coverageDomains.has(question.coverage_domain)) {
        throw new TypeError(`${profile.id}.${question.ref} references unknown coverage domain`);
      }
      if (!targetDomains.has(question.target_domain_ref)) {
        throw new TypeError(`${profile.id}.${question.ref} references unknown target domain`);
      }
      validateIndexerRestrictedSelector(question.target_selector, selectorFacts);
      if (question.evidence_contract.provenance_constraints !== undefined) {
        validateIndexerRestrictedSelector(
          question.evidence_contract.provenance_constraints,
          selectorFacts,
        );
      }
    }
  }
  return contract;
}

export function inflationSensitiveHardMaximum(
  recommendedMaximum: number,
  unit: "count" | "ratio" = "count",
): number {
  if (!Number.isFinite(recommendedMaximum) || recommendedMaximum < 0) {
    throw new TypeError("recommended maximum must be a finite non-negative number");
  }
  if (unit === "count") {
    if (!Number.isSafeInteger(recommendedMaximum)) {
      throw new TypeError("count recommended maximum must be a safe integer");
    }
    return Math.ceil(recommendedMaximum * 1.5);
  }
  if (recommendedMaximum > 1) {
    throw new TypeError("ratio recommended maximum must not exceed 1");
  }
  return Math.min(1, Math.ceil(recommendedMaximum * 150) / 100);
}
