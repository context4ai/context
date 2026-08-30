import type {
  IndexerProfileContractEntry,
} from "@c4a/context";

type ReaderQuestionContract = IndexerProfileContractEntry["reader_question_contracts"][number];

interface ReaderQuestionDefinition {
  semantic: string;
  coverageDomain: ReaderQuestionContract["coverage_domain"];
  acceptedKinds: ReaderQuestionContract["evidence_contract"]["accepted_kinds"];
  exclusionReasonCodes: string[];
}

const QUESTION_DEFINITIONS = {
  "question:responsibility-and-entry": {
    semantic: "What stable responsibility and entrypoints define this subject?",
    coverageDomain: "technical-structure",
    acceptedKinds: ["code", "configuration", "contract", "documentation"],
    exclusionReasonCodes: ["no-stable-entry", "not-applicable"],
  },
  "question:public-capability": {
    semantic: "Which public capabilities or operations are supported and how are they located?",
    coverageDomain: "public-contract",
    acceptedKinds: ["code", "contract", "documentation", "test-result"],
    exclusionReasonCodes: ["no-public-surface", "not-applicable"],
  },
  "question:dispatch-and-routing": {
    semantic: "How are inputs, triggers, routes, or commands dispatched to their handlers?",
    coverageDomain: "technical-structure",
    acceptedKinds: ["code", "configuration", "contract", "test-result"],
    exclusionReasonCodes: ["no-dispatch-boundary", "not-applicable"],
  },
  "question:state-and-consistency": {
    semantic: "What state, storage, transformation, or consistency boundaries affect behavior?",
    coverageDomain: "operations",
    acceptedKinds: ["code", "configuration", "contract", "documentation", "test-result"],
    exclusionReasonCodes: ["no-state-boundary", "not-applicable"],
  },
  "question:dependency-handoff": {
    semantic: "Where does responsibility hand off to another module, protocol, runtime, or store?",
    coverageDomain: "technical-structure",
    acceptedKinds: ["code", "configuration", "contract", "documentation"],
    exclusionReasonCodes: ["no-external-handoff", "not-applicable"],
  },
  "question:failure-recovery": {
    semantic: "How does this capability fail, recover, retry, or preserve consistency?",
    coverageDomain: "operations",
    acceptedKinds: [
      "code",
      "configuration",
      "contract",
      "documentation",
      "runbook",
      "test-result",
      "runtime-observation",
    ],
    exclusionReasonCodes: ["no-runtime-behavior", "not-applicable"],
  },
  "question:examples-and-usage": {
    semantic: "Which maintained examples demonstrate supported use and important combinations?",
    coverageDomain: "public-contract",
    acceptedKinds: ["code", "documentation", "test-result"],
    exclusionReasonCodes: ["no-maintained-example", "not-applicable"],
  },
  "question:development-and-delivery": {
    semantic: "How is this subject developed, tested, built, diagnosed, and delivered?",
    coverageDomain: "operations",
    acceptedKinds: ["code", "configuration", "documentation", "runbook", "test-result"],
    exclusionReasonCodes: ["outside-delivery-scope", "not-applicable"],
  },
  "question:authority-and-generation": {
    semantic: "Which source is authoritative and which outputs are generated projections?",
    coverageDomain: "public-contract",
    acceptedKinds: ["code", "configuration", "contract", "documentation", "tool-snapshot"],
    exclusionReasonCodes: ["authority-unavailable", "not-applicable"],
  },
  "question:compatibility-and-extension": {
    semantic: "What compatibility, lifecycle, and extension constraints govern consumers?",
    coverageDomain: "public-contract",
    acceptedKinds: ["code", "configuration", "contract", "documentation", "test-result"],
    exclusionReasonCodes: ["no-versioned-constraint", "not-applicable"],
  },
} as const satisfies Record<string, ReaderQuestionDefinition>;

export type BundledCodeReaderQuestionRef = keyof typeof QUESTION_DEFINITIONS;

const PROFILE_QUESTION_REFS: Readonly<Record<string, readonly BundledCodeReaderQuestionRef[]>> = {
  "monorepo-container": [
    "question:responsibility-and-entry",
    "question:dependency-handoff",
    "question:development-and-delivery",
    "question:failure-recovery",
  ],
  "web-application": [
    "question:responsibility-and-entry",
    "question:dispatch-and-routing",
    "question:state-and-consistency",
    "question:dependency-handoff",
    "question:failure-recovery",
    "question:development-and-delivery",
  ],
  "component-library": [
    "question:public-capability",
    "question:examples-and-usage",
    "question:compatibility-and-extension",
    "question:failure-recovery",
  ],
  "sdk-library": [
    "question:responsibility-and-entry",
    "question:public-capability",
    "question:examples-and-usage",
    "question:compatibility-and-extension",
    "question:failure-recovery",
    "question:development-and-delivery",
  ],
  "cli-tool": [
    "question:responsibility-and-entry",
    "question:dispatch-and-routing",
    "question:public-capability",
    "question:failure-recovery",
    "question:development-and-delivery",
  ],
  "plugin-extension": [
    "question:responsibility-and-entry",
    "question:public-capability",
    "question:dependency-handoff",
    "question:compatibility-and-extension",
    "question:failure-recovery",
  ],
  "api-service": [
    "question:responsibility-and-entry",
    "question:dispatch-and-routing",
    "question:public-capability",
    "question:dependency-handoff",
    "question:failure-recovery",
    "question:development-and-delivery",
  ],
  "gateway-facade": [
    "question:dispatch-and-routing",
    "question:public-capability",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
  "domain-service": [
    "question:responsibility-and-entry",
    "question:state-and-consistency",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
  "background-runtime": [
    "question:responsibility-and-entry",
    "question:dispatch-and-routing",
    "question:dependency-handoff",
    "question:failure-recovery",
    "question:development-and-delivery",
  ],
  "event-consumer": [
    "question:dispatch-and-routing",
    "question:state-and-consistency",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
  "data-sync-reconciliation": [
    "question:responsibility-and-entry",
    "question:state-and-consistency",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
  "storage-repository": [
    "question:responsibility-and-entry",
    "question:state-and-consistency",
    "question:public-capability",
    "question:failure-recovery",
  ],
  "adapter-integration": [
    "question:responsibility-and-entry",
    "question:public-capability",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
  "contract-source": [
    "question:public-capability",
    "question:authority-and-generation",
    "question:compatibility-and-extension",
    "question:failure-recovery",
  ],
  "derived-generated-source": [
    "question:public-capability",
    "question:authority-and-generation",
    "question:dependency-handoff",
    "question:failure-recovery",
  ],
};

function questionContract(ref: BundledCodeReaderQuestionRef): ReaderQuestionContract {
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

export function bundledCodeReaderQuestionContracts(
  profileId: string,
): ReaderQuestionContract[] {
  const refs = PROFILE_QUESTION_REFS[profileId];
  if (refs === undefined) throw new TypeError(`missing Code reader questions for ${profileId}`);
  return refs.map(questionContract);
}

export function bundledCodeReaderQuestionRefs(
  profileId: string,
): readonly BundledCodeReaderQuestionRef[] {
  const refs = PROFILE_QUESTION_REFS[profileId];
  if (refs === undefined) throw new TypeError(`missing Code reader questions for ${profileId}`);
  return refs;
}
