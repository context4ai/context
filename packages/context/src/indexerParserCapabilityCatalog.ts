import {
  buildIndexerParserRequirement,
  type IndexerParserRequirement,
} from "./indexerParserCoordinate.js";
import { indexerProtocolDigest } from "./indexerProtocolCommon.js";

export const INDEXER_EVIDENCE_ADAPTER_ABI =
  "context.indexer.evidence-adapter-result/v1";

export type IndexerParserAuthorityDomain =
  | "code-catalog"
  | "configuration-semantics"
  | "protocol-contract"
  | "query-semantics"
  | "style-semantics"
  | "workspace-structure";

export interface IndexerParserCapabilitySpec {
  capability: string;
  package: string;
  export: string;
  extensions: readonly string[];
  authority_domain: IndexerParserAuthorityDomain;
  coverage_tier: "ast-catalog" | "lightweight-evidence";
  release_metadata: boolean;
}

export const INDEXER_PARSER_CAPABILITY_SPECS = [{
  capability: "parser.typescript",
  package: "@c4a/extract-ts",
  export: "typeScriptExtractionToEvidenceAdapterMaterialization",
  extensions: [".cts", ".mts", ".ts", ".tsx"],
  authority_domain: "code-catalog",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.javascript",
  package: "@c4a/extract-ts",
  export: "typeScriptExtractionToEvidenceAdapterMaterialization",
  extensions: [".cjs", ".js", ".jsx", ".mjs"],
  authority_domain: "code-catalog",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.go",
  package: "@c4a/extract-go",
  export: "goExtractionToEvidenceAdapterMaterialization",
  extensions: [".go"],
  authority_domain: "code-catalog",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.rush",
  package: "@c4a/extract-rush",
  export: "rushWorkspaceIndexToEvidenceAdapterMaterialization",
  extensions: ["rush.json"],
  authority_domain: "workspace-structure",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.mdx",
  package: "@c4a/extract-mdx",
  export: "mdxSourcesToEvidenceAdapterMaterialization",
  extensions: [".mdx"],
  authority_domain: "code-catalog",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.thrift",
  package: "@c4a/extract-thrift",
  export: "thriftSourcesToEvidenceAdapterMaterialization",
  extensions: [".thrift"],
  authority_domain: "protocol-contract",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.proto",
  package: "@c4a/extract-proto",
  export: "protoSourcesToEvidenceAdapterMaterialization",
  extensions: [".proto"],
  authority_domain: "protocol-contract",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.openapi",
  package: "@c4a/extract-contract",
  export: "contractSourcesToEvidenceAdapterMaterialization",
  extensions: [".json", ".yaml", ".yml"],
  authority_domain: "protocol-contract",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.graphql",
  package: "@c4a/extract-contract",
  export: "contractSourcesToEvidenceAdapterMaterialization",
  extensions: [".gql", ".graphql"],
  authority_domain: "protocol-contract",
  coverage_tier: "ast-catalog",
  release_metadata: true,
}, {
  capability: "parser.css",
  package: "@c4a/extract-style",
  export: "styleSourcesToEvidenceAdapterMaterialization",
  extensions: [".css"],
  authority_domain: "style-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}, {
  capability: "parser.scss",
  package: "@c4a/extract-style",
  export: "styleSourcesToEvidenceAdapterMaterialization",
  extensions: [".scss"],
  authority_domain: "style-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}, {
  capability: "parser.sql",
  package: "@c4a/extract-sql",
  export: "sqlSourcesToEvidenceAdapterMaterialization",
  extensions: [".sql"],
  authority_domain: "query-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}, {
  capability: "parser.json",
  package: "@c4a/extract",
  export: "configSourcesToEvidenceAdapterMaterialization",
  extensions: [".json"],
  authority_domain: "configuration-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}, {
  capability: "parser.yaml",
  package: "@c4a/extract",
  export: "configSourcesToEvidenceAdapterMaterialization",
  extensions: [".yaml", ".yml"],
  authority_domain: "configuration-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}, {
  capability: "parser.toml",
  package: "@c4a/extract",
  export: "configSourcesToEvidenceAdapterMaterialization",
  extensions: [".toml"],
  authority_domain: "configuration-semantics",
  coverage_tier: "lightweight-evidence",
  release_metadata: true,
}] as const satisfies readonly IndexerParserCapabilitySpec[];

export type IndexerParserCapability =
  typeof INDEXER_PARSER_CAPABILITY_SPECS[number]["capability"];

export function indexerParserCapabilitySpec(
  capability: string,
): IndexerParserCapabilitySpec {
  const spec = INDEXER_PARSER_CAPABILITY_SPECS.find((candidate) =>
    candidate.capability === capability
  );
  if (spec === undefined) {
    throw new TypeError(`unknown parser capability ${capability}`);
  }
  return spec;
}

export function buildIndexerParserCapabilityRequirements(
  packageVersion: string,
): IndexerParserRequirement[] {
  const abiDigest = indexerProtocolDigest({ protocol: INDEXER_EVIDENCE_ADAPTER_ABI });
  return INDEXER_PARSER_CAPABILITY_SPECS.map((spec) =>
    buildIndexerParserRequirement({
      capability: spec.capability,
      abi: INDEXER_EVIDENCE_ADAPTER_ABI,
      abi_digest: abiDigest,
      community_coordinate: {
        package: spec.package,
        export: spec.export,
        version: packageVersion,
      },
    })
  );
}
