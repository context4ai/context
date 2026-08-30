import {
  INDEXER_COVERAGE_DOMAINS,
  buildIndexerParserRequirement,
  indexerOperatorContractDigest,
  indexerProfileContractDigest,
  indexerProtocolDigest,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  type IndexerMetricContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerProfileContractEntry,
  type IndexerProfileSubjectKey,
  type KnowledgeCollection,
} from "@c4a/context";
import {
  BUNDLED_INDEXER_PROFILE_SPECS,
  type BundledIndexerProfileSpec,
} from "./indexerBaseContractCatalog.js";
import { bundledCodeReaderQuestionContracts } from "./indexerBaseCodeAuthoringCatalog.js";

const BASE_CONTRACT_VERSION = "1.0.0";
const EVIDENCE_ADAPTER_ABI = "context.indexer.evidence-adapter-result/v1";
const TYPESCRIPT_PARSER_REQUIREMENT = buildIndexerParserRequirement({
  capability: "parser.typescript",
  abi: EVIDENCE_ADAPTER_ABI,
  abi_digest: indexerProtocolDigest({ protocol: EVIDENCE_ADAPTER_ABI }),
  community_coordinate: {
    package: "@c4a/extract-ts",
    export: "typeScriptExtractionToEvidenceAdapterResult",
    version: "0.7.0",
  },
});
const CODE_SOURCE_ROLES = [
  "authoritative-source",
  "example-source",
  "operational-source",
  "public-contract-source",
];
const MARKDOWN_SOURCE_ROLES = [
  "authoritative-document",
  "decision-record",
  "operational-document",
  "supporting-document",
];
interface MarkdownSemanticProjection {
  documentKind: string;
  readerGoal: string;
  collection: KnowledgeCollection;
}

const MARKDOWN_SEMANTIC_PROJECTIONS = {
  domain: {
    documentKind: "domain-reference",
    readerGoal: "understand-domain",
    collection: "business",
  },
  product: {
    documentKind: "product-requirements",
    readerGoal: "understand-product-intent",
    collection: "product",
  },
  architecture: {
    documentKind: "technical-guide",
    readerGoal: "understand-technical-design",
    collection: "architecture",
  },
  procedure: {
    documentKind: "task-guide",
    readerGoal: "complete-reader-task",
    collection: "sop",
  },
  apiReference: {
    documentKind: "public-api-reference",
    readerGoal: "look-up-public-contract",
    collection: "architecture",
  },
  apiPolicy: {
    documentKind: "public-contract-policy",
    readerGoal: "follow-public-contract-policy",
    collection: "standards",
  },
  runbook: {
    documentKind: "runbook",
    readerGoal: "operate-or-recover-system",
    collection: "sop",
  },
  faq: {
    documentKind: "faq-support",
    readerGoal: "resolve-reader-question",
    collection: "faq",
  },
  policy: {
    documentKind: "standard-policy",
    readerGoal: "follow-standard-or-policy",
    collection: "standards",
  },
  decision: {
    documentKind: "decision-record",
    readerGoal: "understand-decision-and-tradeoffs",
    collection: "decision",
  },
  incident: {
    documentKind: "incident-review",
    readerGoal: "learn-from-incident",
    collection: "incident",
  },
  validation: {
    documentKind: "test-validation",
    readerGoal: "verify-behavior-or-acceptance",
    collection: "test",
  },
  release: {
    documentKind: "release-guide",
    readerGoal: "understand-release-change",
    collection: "architecture",
  },
  migration: {
    documentKind: "migration-guide",
    readerGoal: "complete-migration",
    collection: "sop",
  },
} as const satisfies Record<string, MarkdownSemanticProjection>;

const MARKDOWN_PROFILE_PROJECTIONS: Readonly<
  Record<string, readonly MarkdownSemanticProjection[]>
> = {
  "domain-reference": [MARKDOWN_SEMANTIC_PROJECTIONS.domain],
  "product-requirements": [MARKDOWN_SEMANTIC_PROJECTIONS.product],
  "technical-guide": [MARKDOWN_SEMANTIC_PROJECTIONS.architecture],
  "user-and-developer-guide": [
    MARKDOWN_SEMANTIC_PROJECTIONS.product,
    MARKDOWN_SEMANTIC_PROJECTIONS.architecture,
    MARKDOWN_SEMANTIC_PROJECTIONS.procedure,
  ],
  "public-api-reference": [
    MARKDOWN_SEMANTIC_PROJECTIONS.apiReference,
    MARKDOWN_SEMANTIC_PROJECTIONS.apiPolicy,
  ],
  runbook: [MARKDOWN_SEMANTIC_PROJECTIONS.runbook],
  "faq-support": [MARKDOWN_SEMANTIC_PROJECTIONS.faq],
  "standard-policy": [MARKDOWN_SEMANTIC_PROJECTIONS.policy],
  "decision-record": [MARKDOWN_SEMANTIC_PROJECTIONS.decision],
  "incident-review": [MARKDOWN_SEMANTIC_PROJECTIONS.incident],
  "test-validation": [MARKDOWN_SEMANTIC_PROJECTIONS.validation],
  "release-migration-guide": [
    MARKDOWN_SEMANTIC_PROJECTIONS.release,
    MARKDOWN_SEMANTIC_PROJECTIONS.migration,
  ],
  "documentation-site": Object.values(MARKDOWN_SEMANTIC_PROJECTIONS),
};

function profileLayoutMappings(
  spec: BundledIndexerProfileSpec,
): IndexerProfileContractEntry["layout_mappings"] {
  if (spec.domain === "code") {
    return [{
      source_roles: CODE_SOURCE_ROLES,
      document_kind: "code-reference",
      reader_goal: "understand-capability",
      artifact_kinds: ["content", "contract", "examples"],
      collection: "codeindex",
    }];
  }
  const projections = MARKDOWN_PROFILE_PROJECTIONS[spec.id];
  if (projections === undefined) throw new TypeError(`missing layout mapping for ${spec.id}`);
  return projections.map((projection) => ({
    source_roles: MARKDOWN_SOURCE_ROLES,
    document_kind: projection.documentKind,
    reader_goal: projection.readerGoal,
    artifact_kinds: ["content"],
    collection: projection.collection,
  }));
}

function commonMetrics(catalogHeavy: boolean): IndexerMetricContract[] {
  return [{
    id: "inventory-disposition-coverage",
    unit: "ratio",
    operator: "disposition-ratio",
    threshold_policy: "explicit",
    direction: "minimum",
    recommended_min: 1,
    hard_min: 1,
  }, {
    id: "duplicated-fact-target-ratio",
    unit: "ratio",
    operator: "duplicated-fact-ratio",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: 0.03,
    hard_max: 0.05,
  }, {
    id: "narrative-enumeration-ratio",
    unit: "ratio",
    operator: "narrative-enumeration-ratio",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: catalogHeavy ? 0.6 : 0.35,
    hard_max: catalogHeavy ? 0.75 : 0.53,
  }, {
    id: "normalized-template-repetition-ratio",
    unit: "ratio",
    operator: "template-repetition-ratio",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: 0.1,
    hard_max: 0.15,
  }, {
    id: "implementation-body-ratio",
    unit: "ratio",
    operator: "implementation-body-ratio",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: 0.1,
    hard_max: 0.15,
  }, {
    id: "reference-only-reader-targets",
    unit: "count",
    operator: "reference-only-count",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: 0,
    hard_max: 0,
  }, {
    id: "unresolved-ordinal-partitions",
    unit: "count",
    operator: "ordinal-partition-count",
    threshold_policy: "explicit",
    direction: "maximum",
    recommended_max: 0,
    hard_max: 0,
  }, {
    id: "discretionary-artifacts-per-logical-unit",
    unit: "count",
    operator: "discretionary-artifact-count",
    threshold_policy: "inflation-sensitive",
    direction: "maximum",
  }];
}

function codeExampleMetrics(): IndexerMetricContract[] {
  return [{
    id: "example-candidate-decision-coverage",
    unit: "ratio",
    operator: "example-candidate-decision-ratio",
    threshold_policy: "explicit",
    direction: "minimum",
    recommended_min: 1,
    hard_min: 1,
  }, {
    id: "example-representative-coverage",
    unit: "ratio",
    operator: "example-representative-ratio",
    threshold_policy: "explicit",
    direction: "minimum",
    recommended_min: 0.9,
    hard_min: 0.7,
  }, {
    id: "example-public-target-linkage",
    unit: "ratio",
    operator: "example-public-target-linkage-ratio",
    threshold_policy: "explicit",
    direction: "minimum",
    recommended_min: 0.95,
    hard_min: 0.8,
  }];
}

function profileQuestion(
  spec: BundledIndexerProfileSpec,
): IndexerProfileContractEntry["reader_question_contracts"][number] {
  if (spec.domain === "markdown") {
    return {
      ref: "question:source-authority",
      semantic: "Which current authoritative evidence supports this document claim?",
      version: 1,
      coverage_domain: "public-contract",
      target_domain_ref: "primary-subject",
      target_selector: {
        protocol: "context.indexer.selector/v1" as const,
        expression: { op: "equals" as const, fact: "target.eligible", value: true },
      },
      evidence_contract: {
        accepted_kinds: [
          "documentation",
          "decision-record",
          "runbook",
          "contract",
        ],
        minimum_items: 1,
        minimum_distinct_sources: 1,
        provenance_constraints: {
          protocol: "context.indexer.selector/v1" as const,
          expression: { op: "equals" as const, fact: "evidence.current", value: true },
        },
      },
      allowed_exclusion_reason_codes: ["not-applicable", "authority-unavailable"],
    };
  }
  return {
    ref: "question:failure-recovery",
    semantic: "How does this capability fail, recover, retry, or preserve consistency?",
    version: 1,
    coverage_domain: "operations",
    target_domain_ref: "primary-subject",
    target_selector: {
      protocol: "context.indexer.selector/v1" as const,
      expression: { op: "equals" as const, fact: "target.eligible", value: true },
    },
    evidence_contract: {
      accepted_kinds: [
        "code",
        "configuration",
        "documentation",
        "runbook",
        "test-result",
        "runtime-observation",
      ],
      minimum_items: 1,
      minimum_distinct_sources: 1,
      provenance_constraints: {
        protocol: "context.indexer.selector/v1" as const,
        expression: { op: "equals" as const, fact: "evidence.current", value: true },
      },
    },
    allowed_exclusion_reason_codes: ["not-applicable", "no-runtime-behavior"],
  };
}

function artifactPolicyVariants(
  spec: BundledIndexerProfileSpec,
): IndexerProfileContractEntry["artifact_policy_variants"] {
  const threshold = (recommendedMax: number) => ({
    "discretionary-artifacts-per-logical-unit": {
      recommended_max: recommendedMax,
    },
  });
  const standard: IndexerProfileContractEntry["artifact_policy_variants"][number] = {
    id: "standard",
    eligibility: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.eligible", value: true },
    },
    artifact_kinds: {
      required: ["content"],
      discretionary: spec.domain === "markdown" ? [] : ["contract", "examples"],
    },
    thresholds: threshold(spec.catalogHeavy === true ? 2 : 4),
  };
  if (spec.domain === "markdown") return [standard];
  return [{
    id: "compact",
    eligibility: {
      protocol: "context.indexer.selector/v1",
      expression: {
        op: "all",
        args: [
          { op: "equals", fact: "target.eligible", value: true },
          { op: "equals", fact: "target.bundle_compact_eligible", value: true },
        ],
      },
    },
    artifact_kinds: { required: ["content"], discretionary: [] },
    thresholds: threshold(0),
  }, standard, {
    id: "expanded",
    eligibility: {
      protocol: "context.indexer.selector/v1",
      expression: {
        op: "all",
        args: [
          { op: "equals", fact: "target.eligible", value: true },
          { op: "equals", fact: "target.bundle_expanded_eligible", value: true },
        ],
      },
    },
    artifact_kinds: { required: ["content"], discretionary: ["contract", "examples"] },
    thresholds: threshold(spec.catalogHeavy === true ? 4 : 6),
  }];
}

function profileEntry(spec: BundledIndexerProfileSpec): IndexerProfileContractEntry {
  return {
    id: spec.id,
    parser_requirements: spec.domain === "code" ? [TYPESCRIPT_PARSER_REQUIREMENT] : [],
    inventory_domains: [{
      id: "eligible-inventory",
      selector: { operator: "all-inventory" },
      disposition_required: true,
    }],
    required_dispositions: ["owned", "excluded", "unsupported"],
    metrics: [
      ...commonMetrics(spec.catalogHeavy ?? false),
      ...(spec.domain === "code" ? codeExampleMetrics() : []),
    ],
    artifact_policy_variants: artifactPolicyVariants(spec),
    question_target_domains: [{
      id: "primary-subject",
      selector: { operator: "all-inventory" },
      grouping_operator: "by-subject-key",
      subject_key_kind: spec.subjectKind,
      granularity: spec.domain === "markdown" ? "identity" : "module",
    }],
    reader_question_contracts: spec.domain === "code"
      ? bundledCodeReaderQuestionContracts(spec.id)
      : [profileQuestion(spec)],
    layout_mappings: profileLayoutMappings(spec),
    variant_schema: {
      axes: (spec.variants ?? []).map((axis) => ({
        id: axis.id,
        type: "enum" as const,
        values: [...axis.values],
        required: false,
      })),
    },
  };
}

function profileSubjectKeySchema(
  spec: BundledIndexerProfileSpec,
): IndexerProfileSubjectKey {
  return {
    profile: spec.id,
    version: 1,
    namespace: { operator: spec.namespaceOperator },
    kinds: [{
      id: spec.subjectKind,
      local_key: { operator: spec.localKeyOperator },
    }],
    normalization: ["trim", "unicode-nfc", "preserve-case"],
  };
}

export function bundledIndexerOperatorContract(): IndexerOperatorContract {
  const payload: Omit<IndexerOperatorContract, "contract_digest"> = {
    protocol: "context.indexer.operator-contract/v1",
    version: BASE_CONTRACT_VERSION,
    selector_operators: ["all-inventory", "eligible-standard"],
    grouping_operators: ["by-subject-key"],
    metric_operators: [
      "disposition-ratio",
      "duplicated-fact-ratio",
      "narrative-enumeration-ratio",
      "template-repetition-ratio",
      "implementation-body-ratio",
      "reference-only-count",
      "ordinal-partition-count",
      "discretionary-artifact-count",
      "example-candidate-decision-ratio",
      "example-representative-ratio",
      "example-public-target-linkage-ratio",
    ],
    threshold_operators: ["explicit", "inflation-sensitive"],
    selector_fact_paths: [
      "target.eligible",
      "target.bundle_compact_eligible",
      "target.bundle_expanded_eligible",
      "evidence.current",
    ],
  };
  return validateIndexerOperatorContract({
    ...payload,
    contract_digest: indexerOperatorContractDigest(payload),
  });
}

export function bundledIndexerProfileContract(
  operators = bundledIndexerOperatorContract(),
): IndexerProfileContract {
  const payload: Omit<IndexerProfileContract, "contract_digest"> = {
    protocol: "context.indexer.profile-contract/v1",
    version: BASE_CONTRACT_VERSION,
    operator_contract_version: operators.version,
    operator_contract_digest: operators.contract_digest,
    coverage_domains: [...INDEXER_COVERAGE_DOMAINS],
    profiles: BUNDLED_INDEXER_PROFILE_SPECS.map(profileEntry),
    subject_key_schemas: BUNDLED_INDEXER_PROFILE_SPECS.map(profileSubjectKeySchema),
  };
  return validateIndexerProfileContract({
    ...payload,
    contract_digest: indexerProfileContractDigest(payload),
  }, operators);
}

export const BUNDLED_INDEXER_METRIC_IDS = [
  "inventory-disposition-coverage",
  "duplicated-fact-target-ratio",
  "narrative-enumeration-ratio",
  "normalized-template-repetition-ratio",
  "implementation-body-ratio",
  "reference-only-reader-targets",
  "unresolved-ordinal-partitions",
  "discretionary-artifacts-per-logical-unit",
  "example-candidate-decision-coverage",
  "example-representative-coverage",
  "example-public-target-linkage",
] as const;
