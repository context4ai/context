import type { IndexerComposerContract } from "@c4a/context";
import { BUNDLED_CODE_PROFILE_IDS } from "./indexerBaseContractCatalog.js";

export interface BundledIndexerComposerSpec {
  id: string;
  supportedProfiles: readonly string[];
  contract: IndexerComposerContract;
}

function contract(input: {
  id: string;
  factKinds: readonly string[];
  primaryArtifactKinds: readonly string[];
  derivedArtifactKinds: readonly string[];
}): IndexerComposerContract {
  return {
    instruction: `references/composers/${input.id}.md`,
    primary_requirements: {
      fact_kinds: [...input.factKinds],
      artifact_kinds: [...input.primaryArtifactKinds],
    },
    derived_artifact_policy: {
      fragment_protocol: "context.indexer.layer-fragment/v1",
      fragment_kind: "derived-artifact-proposal",
      artifact_policy_variant: "standard",
      artifact_kinds: [...input.derivedArtifactKinds],
    },
    empty_result: {
      result_protocol: "context.indexer.layer-fragment-result/v1",
      behavior: "empty-fragment-set",
    },
  };
}

const ALL_CODE_PROFILES = [...BUNDLED_CODE_PROFILE_IDS];

export const BUNDLED_CODE_COMPOSER_SPECS: readonly BundledIndexerComposerSpec[] = [
  {
    id: "public-contract",
    supportedProfiles: [
      "component-library",
      "sdk-library",
      "cli-tool",
      "plugin-extension",
      "api-service",
      "gateway-facade",
      "domain-service",
      "adapter-integration",
      "contract-source",
      "derived-generated-source",
    ],
    contract: contract({
      id: "public-contract",
      factKinds: ["public-surface"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["contract"],
    }),
  },
  {
    id: "protocol-boundary",
    supportedProfiles: [
      "web-application",
      "sdk-library",
      "cli-tool",
      "plugin-extension",
      "api-service",
      "gateway-facade",
      "domain-service",
      "background-runtime",
      "event-consumer",
      "data-sync-reconciliation",
      "storage-repository",
      "adapter-integration",
      "contract-source",
      "derived-generated-source",
    ],
    contract: contract({
      id: "protocol-boundary",
      factKinds: ["protocol-operation"],
      primaryArtifactKinds: ["contract"],
      derivedArtifactKinds: ["contract"],
    }),
  },
  {
    id: "cross-module-chain",
    supportedProfiles: [
      "monorepo-container",
      "web-application",
      "component-library",
      "sdk-library",
      "cli-tool",
      "plugin-extension",
      "api-service",
      "gateway-facade",
      "domain-service",
      "background-runtime",
      "event-consumer",
      "data-sync-reconciliation",
      "storage-repository",
      "adapter-integration",
    ],
    contract: contract({
      id: "cross-module-chain",
      factKinds: ["module-dependency"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["content"],
    }),
  },
  {
    id: "contracts-and-chains",
    supportedProfiles: ALL_CODE_PROFILES,
    contract: contract({
      id: "contracts-and-chains",
      factKinds: ["contract-binding", "module-dependency"],
      primaryArtifactKinds: ["contract"],
      derivedArtifactKinds: ["contract"],
    }),
  },
  {
    id: "event-flow",
    supportedProfiles: [
      "web-application",
      "plugin-extension",
      "api-service",
      "gateway-facade",
      "domain-service",
      "background-runtime",
      "event-consumer",
      "data-sync-reconciliation",
      "adapter-integration",
      "contract-source",
    ],
    contract: contract({
      id: "event-flow",
      factKinds: ["event-binding"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["content"],
    }),
  },
  {
    id: "persistence-boundary",
    supportedProfiles: [
      "api-service",
      "gateway-facade",
      "domain-service",
      "background-runtime",
      "event-consumer",
      "data-sync-reconciliation",
      "storage-repository",
      "adapter-integration",
    ],
    contract: contract({
      id: "persistence-boundary",
      factKinds: ["persistence-binding"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["content"],
    }),
  },
  {
    id: "examples-and-documentation",
    supportedProfiles: ALL_CODE_PROFILES,
    contract: contract({
      id: "examples-and-documentation",
      factKinds: ["example-candidate"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["examples"],
    }),
  },
  {
    id: "development-and-delivery",
    supportedProfiles: ALL_CODE_PROFILES,
    contract: contract({
      id: "development-and-delivery",
      factKinds: ["development-entry"],
      primaryArtifactKinds: ["content"],
      derivedArtifactKinds: ["content"],
    }),
  },
];

export const BUNDLED_CODE_COMPOSER_IDS = BUNDLED_CODE_COMPOSER_SPECS.map(
  (composer) => composer.id,
);
