import type { IndexerProfileContractEntry } from "@c4a/context";

type ReaderQuestionContract =
  IndexerProfileContractEntry["reader_question_contracts"][number];

interface ReaderQuestionDefinition {
  semantic: string;
  coverageDomain: ReaderQuestionContract["coverage_domain"];
  acceptedKinds: ReaderQuestionContract["evidence_contract"]["accepted_kinds"];
  exclusionReasonCodes: string[];
}

const QUESTION_DEFINITIONS = {
  "question:reader-purpose": {
    semantic:
      "What reader need does this subject address, and what behavior, meaning, and boundaries should the reader understand?",
    coverageDomain: "business-semantics",
    acceptedKinds: ["documentation", "decision-record", "contract"],
    exclusionReasonCodes: ["no-supported-purpose", "not-applicable"],
  },
  "question:reader-structure": {
    semantic:
      "What concepts, components, dependencies, and technical boundaries define this subject?",
    coverageDomain: "technical-structure",
    acceptedKinds: ["documentation", "contract", "configuration", "decision-record"],
    exclusionReasonCodes: ["no-technical-structure", "not-applicable"],
  },
  "question:reader-contract": {
    semantic:
      "Which interfaces, inputs, outputs, rules, constraints, or guarantees can the reader rely on?",
    coverageDomain: "public-contract",
    acceptedKinds: ["documentation", "contract", "decision-record", "test-result"],
    exclusionReasonCodes: ["no-public-contract", "not-applicable"],
  },
  "question:reader-operation": {
    semantic:
      "How should the reader perform, verify, troubleshoot, or recover the relevant task?",
    coverageDomain: "operations",
    acceptedKinds: [
      "documentation",
      "runbook",
      "configuration",
      "test-result",
      "runtime-observation",
    ],
    exclusionReasonCodes: ["no-operational-guidance", "not-applicable"],
  },
} as const satisfies Record<string, ReaderQuestionDefinition>;

export type BundledMarkdownReaderQuestionRef = keyof typeof QUESTION_DEFINITIONS;

function questionContract(
  ref: BundledMarkdownReaderQuestionRef,
): ReaderQuestionContract {
  const definition = QUESTION_DEFINITIONS[ref];
  return {
    ref,
    semantic: definition.semantic,
    version: 1,
    coverage_domain: definition.coverageDomain,
    target_domain_ref: "primary-subject",
    target_selector: {
      protocol: "context.indexer.selector/v1",
      expression: { op: "equals", fact: "target.eligible", value: true },
    },
    evidence_contract: {
      accepted_kinds: [...definition.acceptedKinds],
      minimum_items: 1,
      minimum_distinct_sources: 1,
      provenance_constraints: {
        protocol: "context.indexer.selector/v1",
        expression: { op: "equals", fact: "evidence.current", value: true },
      },
    },
    allowed_exclusion_reason_codes: [...definition.exclusionReasonCodes],
  };
}

export function bundledMarkdownReaderQuestionContracts(): ReaderQuestionContract[] {
  return (Object.keys(QUESTION_DEFINITIONS) as BundledMarkdownReaderQuestionRef[])
    .map(questionContract);
}

export function bundledMarkdownReaderQuestionRefs(): readonly BundledMarkdownReaderQuestionRef[] {
  return Object.keys(QUESTION_DEFINITIONS) as BundledMarkdownReaderQuestionRef[];
}
