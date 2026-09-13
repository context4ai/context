import type {
  IndexerParserCapability,
} from "@c4a/context";

export interface BundledIndexerProfileSpec {
  id: string;
  domain: "code" | "markdown";

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
    parserCapabilities: [
      "parser.typescript", "parser.javascript", "parser.mdx", "parser.css",
      "parser.scss", "parser.json", "parser.yaml", "parser.toml",
    ],
    variants: [{ id: "application_mode", values: ["spa", "mpa", "hybrid"] }],
  },
  {
    id: "component-library",
    domain: "code",

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
    parserCapabilities: [
      "parser.typescript", "parser.javascript", "parser.go", "parser.thrift",
      "parser.proto", "parser.sql", "parser.json", "parser.yaml", "parser.toml",
    ],
    variants: [{ id: "state_model", values: ["stateless", "stateful"] }],
  },
  {
    id: "background-runtime",
    domain: "code",
    parserCapabilities: [
      "parser.typescript", "parser.javascript", "parser.go",
      "parser.json", "parser.yaml", "parser.toml",
    ],
    variants: [{
      id: "trigger_model",
      values: ["function", "scheduled-worker"],
    }],
  },
  {
    id: "event-consumer",
    domain: "code",

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

    catalogHeavy: id === "public-api-reference",
  }));

export const BUNDLED_INDEXER_PROFILE_SPECS = [
  ...CODE_PROFILE_SPECS,
  ...MARKDOWN_PROFILE_SPECS,
] as const;

export const BUNDLED_CODE_PROFILE_IDS = CODE_PROFILE_SPECS.map((profile) => profile.id);
export const BUNDLED_MARKDOWN_PROFILE_IDS = MARKDOWN_PROFILE_SPECS.map((profile) => profile.id);
