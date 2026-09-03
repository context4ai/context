import type {
  IndexerParserCapability,
  IndexerSubjectDerivationOperator,
} from "@c4a/context";

export interface BundledIndexerProfileSpec {
  id: string;
  domain: "code" | "markdown";
  subjectKind: string;
  namespaceOperator: IndexerSubjectDerivationOperator;
  localKeyOperator: IndexerSubjectDerivationOperator;
  additionalSubjectKinds?: readonly {
    id: string;
    localKeyOperator: IndexerSubjectDerivationOperator;
  }[];
  parserCapabilities?: readonly IndexerParserCapability[];
  catalogHeavy?: boolean;
  variants?: ReadonlyArray<{
    id: string;
    values: readonly string[];
  }>;
}

const CODE_PROFILE_SPECS: readonly BundledIndexerProfileSpec[] = [
  {
    id: "monorepo-container",
    domain: "code",
    subjectKind: "project",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.rush",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    variants: [{
      id: "build_system",
      values: ["rush", "npm-workspaces", "nx", "turborepo", "bazel", "other"],
    }],
  },
  {
    id: "web-application",
    domain: "code",
    subjectKind: "application",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    additionalSubjectKinds: [{
      id: "capability",
      localKeyOperator: "canonical-export-family",
    }],
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.mdx",
      "parser.css",
      "parser.scss",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    variants: [{ id: "application_mode", values: ["spa", "mpa", "hybrid"] }],
  },
  {
    id: "component-library",
    domain: "code",
    subjectKind: "component",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-export-family",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.mdx",
      "parser.css",
      "parser.scss",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "sdk-library",
    domain: "code",
    subjectKind: "capability",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-export-family",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.mdx",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "cli-tool",
    domain: "code",
    subjectKind: "command-family",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    catalogHeavy: true,
  },
  {
    id: "plugin-extension",
    domain: "code",
    subjectKind: "extension",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.mdx",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "api-service",
    domain: "code",
    subjectKind: "service",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.openapi",
      "parser.graphql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    variants: [{ id: "transport", values: ["http", "rpc", "hybrid"] }],
  },
  {
    id: "gateway-facade",
    domain: "code",
    subjectKind: "gateway",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.openapi",
      "parser.graphql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    catalogHeavy: true,
  },
  {
    id: "domain-service",
    domain: "code",
    subjectKind: "domain-capability",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.sql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    variants: [{ id: "state_model", values: ["stateless", "stateful"] }],
  },
  {
    id: "background-runtime",
    domain: "code",
    subjectKind: "runtime",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    variants: [{
      id: "trigger_model",
      values: ["function", "scheduled-worker"],
    }],
  },
  {
    id: "event-consumer",
    domain: "code",
    subjectKind: "consumer",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "data-sync-reconciliation",
    domain: "code",
    subjectKind: "sync-pipeline",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.sql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "storage-repository",
    domain: "code",
    subjectKind: "store",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.sql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "adapter-integration",
    domain: "code",
    subjectKind: "adapter",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.openapi",
      "parser.graphql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
  },
  {
    id: "contract-source",
    domain: "code",
    subjectKind: "contract-family",
    namespaceOperator: "canonical-service-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.thrift",
      "parser.proto",
      "parser.openapi",
      "parser.graphql",
      "parser.json",
      "parser.yaml",
    ],
    catalogHeavy: true,
  },
  {
    id: "derived-generated-source",
    domain: "code",
    subjectKind: "generated-surface",
    namespaceOperator: "canonical-source-module-namespace",
    localKeyOperator: "canonical-module-identity",
    parserCapabilities: [
      "parser.typescript",
      "parser.javascript",
      "parser.go",
      "parser.thrift",
      "parser.proto",
      "parser.openapi",
      "parser.graphql",
      "parser.json",
      "parser.yaml",
      "parser.toml",
    ],
    catalogHeavy: true,
  },
];

const MARKDOWN_PROFILE_IDS = [
  "domain-reference",
  "product-requirements",
  "technical-guide",
  "user-and-developer-guide",
  "public-api-reference",
  "runbook",
  "faq-support",
  "standard-policy",
  "decision-record",
  "incident-review",
  "test-validation",
  "release-migration-guide",
  "documentation-site",
] as const;

const MARKDOWN_PROFILE_SPECS: readonly BundledIndexerProfileSpec[] =
  MARKDOWN_PROFILE_IDS.map((id) => ({
    id,
    domain: "markdown" as const,
    subjectKind: id === "documentation-site" ? "document-set" : "document-section",
    namespaceOperator: "canonical-source-module-namespace" as const,
    localKeyOperator: "canonical-module-identity" as const,
    catalogHeavy: id === "public-api-reference",
  }));

export const BUNDLED_INDEXER_PROFILE_SPECS = [
  ...CODE_PROFILE_SPECS,
  ...MARKDOWN_PROFILE_SPECS,
] as const;

export const BUNDLED_CODE_PROFILE_IDS = CODE_PROFILE_SPECS.map((profile) => profile.id);
export const BUNDLED_MARKDOWN_PROFILE_IDS = MARKDOWN_PROFILE_SPECS.map((profile) => profile.id);
