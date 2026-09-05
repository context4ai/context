import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  indexerRegistryDigests,
  validateIndexerOperatorContract,
  validateIndexerProfileContract,
  type IndexerOperatorContract,
  type IndexerProfileContract,
  type IndexerOverlayQuestionAuthorityProof,
  type IndexerRegistry,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import {
  validateStagedIndexerProviderBundle,
} from "./indexerProviderStage.js";
import type {
  IndexerResolvedSelectionInput,
  IndexerSelectionFinalReport,
} from "./indexerSelectionValidation.js";
import type { IndexerCustomizationView } from "./indexerCustomization.js";

const CURRENT_PROVIDER_SELECTION_PATH = join(
  ".tmp",
  "context-runtime",
  "indexer",
  "current-provider-selection.json",
);

export interface CurrentIndexerProviderSelection {
  format: "context-runtime-indexer-provider-selection";
  registry_digest: string;
  indexer_selection_digest: string;
  resolved: IndexerResolvedSelectionInput[];
  customizations: IndexerCustomizationView[];
  overlay_question_authorities: IndexerOverlayQuestionAuthorityProof[];
  operator_contract: IndexerOperatorContract;
  profile_contract: IndexerProfileContract;
  final_report: IndexerSelectionFinalReport;
  state_digest: string;
}

function statePayload(
  value: Omit<CurrentIndexerProviderSelection, "state_digest"> |
    CurrentIndexerProviderSelection,
) {
  return {
    format: value.format,
    registry_digest: value.registry_digest,
    indexer_selection_digest: value.indexer_selection_digest,
    resolved: value.resolved,
    customizations: value.customizations,
    overlay_question_authorities: value.overlay_question_authorities,
    operator_contract: value.operator_contract,
    profile_contract: value.profile_contract,
    final_report: value.final_report,
  };
}

function parseState(value: unknown): CurrentIndexerProviderSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("current Indexer Provider selection must be an object");
  }
  const state = value as Partial<CurrentIndexerProviderSelection>;
  if (
    state.format !== "context-runtime-indexer-provider-selection" ||
    typeof state.registry_digest !== "string" ||
    typeof state.indexer_selection_digest !== "string" ||
    !Array.isArray(state.resolved) ||
    !Array.isArray(state.customizations) ||
    !Array.isArray(state.overlay_question_authorities) ||
    state.operator_contract === undefined ||
    state.profile_contract === undefined ||
    state.final_report === undefined ||
    typeof state.state_digest !== "string"
  ) {
    throw new TypeError("current Indexer Provider selection is incomplete");
  }
  const parsed = state as CurrentIndexerProviderSelection;
  parsed.operator_contract = validateIndexerOperatorContract(parsed.operator_contract);
  parsed.profile_contract = validateIndexerProfileContract(
    parsed.profile_contract,
    parsed.operator_contract,
  );
  if (parsed.state_digest !== indexerProtocolDigest(statePayload(parsed))) {
    throw new TypeError("current Indexer Provider selection digest is invalid");
  }
  return parsed;
}

export async function persistCurrentIndexerProviderSelection(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  resolved: readonly IndexerResolvedSelectionInput[];
  customizations: readonly IndexerCustomizationView[];
  overlay_question_authorities?: readonly IndexerOverlayQuestionAuthorityProof[];
  operator_contract: unknown;
  profile_contract: unknown;
  final_report: IndexerSelectionFinalReport;
}): Promise<void> {
  const digests = indexerRegistryDigests(input.registry);
  if (
    input.final_report.indexer_selection_digest !== digests.indexerSelectionDigest ||
    input.final_report.requirement_set_digest !== digests.requirementSetDigest
  ) {
    throw new TypeError("current Provider selection does not match the applied registry");
  }
  const payload = {
    format: "context-runtime-indexer-provider-selection" as const,
    registry_digest: digests.registryDigest,
    indexer_selection_digest: digests.indexerSelectionDigest,
    resolved: [...input.resolved],
    customizations: [...input.customizations],
    overlay_question_authorities: [...(input.overlay_question_authorities ?? [])],
    operator_contract: validateIndexerOperatorContract(input.operator_contract),
    profile_contract: validateIndexerProfileContract(
      input.profile_contract,
      validateIndexerOperatorContract(input.operator_contract),
    ),
    final_report: input.final_report,
  };
  const state: CurrentIndexerProviderSelection = {
    ...payload,
    state_digest: indexerProtocolDigest(payload),
  };
  await atomicWriteFile(
    join(input.projectRoot, CURRENT_PROVIDER_SELECTION_PATH),
    `${JSON.stringify(JSON.parse(canonicalIndexerJson(state)), null, 2)}\n`,
  );
}

function matchesRegistry(state: CurrentIndexerProviderSelection, registry: IndexerRegistry): boolean {
  const digests = indexerRegistryDigests(registry);
  return state.registry_digest === digests.registryDigest &&
    state.indexer_selection_digest === digests.indexerSelectionDigest &&
    state.final_report.indexer_selection_digest === digests.indexerSelectionDigest &&
    state.final_report.requirement_set_digest === digests.requirementSetDigest;
}

/** Check only the saved selection identity; routing must not rescan staged bundles. */
export async function currentIndexerProviderSelectionNeedsRefresh(input: {
  projectRoot: string;
  registry: IndexerRegistry;
}): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(join(input.projectRoot, CURRENT_PROVIDER_SELECTION_PATH), "utf8");
  } catch (error) {
    // A finalized, directly configured bundled registry need not have a setup snapshot.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return !matchesRegistry(parseState(JSON.parse(raw) as unknown), input.registry);
}

export async function loadCurrentIndexerProviderSelection(input: {
  projectRoot: string;
  registry: IndexerRegistry;
}): Promise<CurrentIndexerProviderSelection> {
  const raw = await readFile(
    join(input.projectRoot, CURRENT_PROVIDER_SELECTION_PATH),
    "utf8",
  );
  const state = parseState(JSON.parse(raw) as unknown);
  if (!matchesRegistry(state, input.registry)) {
    throw new TypeError("current Indexer Provider selection is stale");
  }
  if (!state.final_report.report_digest ||
      state.resolved.length !== state.final_report.providers.length) {
    throw new TypeError("current Indexer Provider selection is incomplete");
  }
  for (const resolved of state.resolved) {
    const indexer = input.registry.indexers.find((item) => item.id === resolved.indexer_id);
    const layer = indexer?.providers.find((item) => item.id === resolved.provider_id);
    if (
      layer === undefined ||
      resolved.bundle.request.skill !== layer.skill ||
      resolved.bundle.request.version !== layer.version ||
      resolved.bundle.resolved.integrity !== layer.integrity
    ) {
      throw new TypeError("current Indexer Provider layer no longer matches the registry");
    }
    validateStagedIndexerProviderBundle(resolved.staged, resolved.bundle);
    const actualFiles = await collectIndexerBundleFiles(resolved.staged.stage_path);
    if (canonicalIndexerJson(actualFiles) !== canonicalIndexerJson(resolved.staged.files)) {
      throw new TypeError("current Indexer Provider stage changed after selection");
    }
  }
  return state;
}
