import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  DEFAULT_INDEXER_REGISTRY_PATH,
  buildIndexerDependencyIntentSet,
  buildIndexerProjectProposal,
  canonicalIndexerJson,
  indexerProjectContentDigest,
  indexerProtocolDigest,
  indexerRegistryDigests,
  loadIndexerProviderManifest,
  parseIndexerRegistry,
  type IndexerProgramExecutionAuthorizationReport,
  type IndexerProjectProposal,
} from "@c4a/context";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import {
  loadStagedProjectIndexerCustomizationDraft,
  projectIndexerCustomizationDraftStagePath,
} from "./indexerCustomizationDraftStage.js";
import {
  stageIndexerProjectProposal,
  type StagedIndexerProjectProposalReceipt,
} from "./indexerProjectApply.js";
import {
  validateIndexerSelectionFinal,
  type IndexerResolvedSelectionInput,
  type IndexerSelectionStaticReport,
} from "./indexerSelectionValidation.js";
import {
  indexerProjectLocalProgramScopeDigest,
  type IndexerProjectStagingValidationInput,
} from "./indexerProjectFlow.js";
import {
  buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace,
  validateIndexerProgramExecutionAuthorizationResult,
  type IndexerProgramExecutionAuthorizationResult,
} from "./indexerProgramExecutionAuthorization.js";

export interface IndexerCustomizationProjectPreparationInput {
  protocol: "context.indexer.customization-project-preparation-input/v1";
  validation_digest: string;
  static_report: IndexerSelectionStaticReport;
  resolved: IndexerResolvedSelectionInput[];
  operator_contract: unknown;
  profile_contract: unknown;
  program_authorization?: IndexerProgramExecutionAuthorizationResult;
}

export interface IndexerCustomizationProgramAuthorizationRequiredResult {
  protocol: "context.indexer.customization-project-preparation-result/v1";
  outcome: "program-authorization-required";
  validation_digest: string;
  authorization_report: IndexerProgramExecutionAuthorizationReport;
  result_digest: string;
}

export interface IndexerCustomizationProjectProposalResult {
  protocol: "context.indexer.customization-project-preparation-result/v1";
  outcome: "project-confirmation-required";
  validation_digest: string;
  proposal: IndexerProjectProposal;
  stage_receipt: StagedIndexerProjectProposalReceipt;
  staging_validation: IndexerProjectStagingValidationInput;
  result_digest: string;
}

export type IndexerCustomizationProjectPreparationResult =
  | IndexerCustomizationProgramAuthorizationRequiredResult
  | IndexerCustomizationProjectProposalResult;

function preparationInput(value: unknown): IndexerCustomizationProjectPreparationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Indexer customization project preparation input must be an object");
  }
  const input = value as Partial<IndexerCustomizationProjectPreparationInput>;
  if (
    input.protocol !== "context.indexer.customization-project-preparation-input/v1" ||
    typeof input.validation_digest !== "string" ||
    input.static_report === undefined ||
    !Array.isArray(input.resolved) ||
    input.operator_contract === undefined ||
    input.profile_contract === undefined
  ) {
    throw new TypeError("Indexer customization project preparation input is incomplete");
  }
  return input as IndexerCustomizationProjectPreparationInput;
}

function selectionKey(indexerId: string, providerId: string): string {
  return `${indexerId}\u0000${providerId}`;
}

async function loadCustomizationViews(input: {
  projectRoot: string;
  validated: Awaited<ReturnType<typeof loadStagedProjectIndexerCustomizationDraft>>;
  resolved: readonly IndexerResolvedSelectionInput[];
}) {
  const resolvedByKey = new Map(input.resolved.map((item) => [
    selectionKey(item.indexer_id, item.provider_id),
    item,
  ]));
  const stageRoot = projectIndexerCustomizationDraftStagePath(
    input.projectRoot,
    input.validated.validation_digest,
  );
  return Promise.all(input.validated.target_registry.indexers.map(async (indexer) => {
    const primary = indexer.providers.find((provider) => provider.role === "primary");
    if (primary === undefined) throw new TypeError(`Indexer ${indexer.id} has no primary Provider`);
    const resolved = resolvedByKey.get(selectionKey(indexer.id, primary.id));
    if (resolved === undefined) {
      throw new TypeError(`Indexer ${indexer.id} has no resolved primary Provider`);
    }
    const manifest = await loadIndexerProviderManifest(resolved.staged.stage_path);
    return loadIndexerCustomization({
      workspaceRoot: stageRoot,
      projectRef: input.validated.project_ref,
      indexer,
      manifest,
      providerIntegrity: resolved.bundle.resolved.integrity,
      ...(indexer.id === input.validated.indexer_id
        ? { customizationPlan: input.validated.customization_plan }
        : {}),
    });
  }));
}

function registrySnapshot(content: string) {
  const registry = parseIndexerRegistry(content);
  const digests = indexerRegistryDigests(registry);
  return {
    registry,
    snapshot: {
      document_digest: indexerProjectContentDigest(content),
      requirement_set_digest: digests.requirementSetDigest,
      indexer_selection_digest: digests.indexerSelectionDigest,
      registry_digest: digests.registryDigest,
    },
  };
}

async function localProgramAuthorizationReport(input: {
  projectRoot: string;
  request: IndexerCustomizationProjectPreparationInput;
  validated: Awaited<ReturnType<typeof loadStagedProjectIndexerCustomizationDraft>>;
  dependencies: ReturnType<typeof buildIndexerDependencyIntentSet>;
}): Promise<IndexerProgramExecutionAuthorizationReport | null> {
  if (input.validated.selected_step !== "program-extend") return null;
  const indexer = input.validated.target_registry.indexers.find((item) =>
    item.id === input.validated.indexer_id
  )!;
  const primary = indexer.providers.find((provider) => provider.role === "primary")!;
  const resolved = input.request.resolved.find((item) =>
    item.indexer_id === indexer.id && item.provider_id === primary.id
  );
  if (resolved === undefined) {
    throw new TypeError("project-local program customization has no resolved primary Provider");
  }
  const manifest = await loadIndexerProviderManifest(resolved.staged.stage_path);
  if (manifest.provider.program === undefined) {
    throw new TypeError("program-extend requires a base Provider program contract");
  }
  const entry = `src/indexer/${indexer.id}/index.ts`;
  return buildProjectLocalIndexerProgramExecutionAuthorizationReportFromWorkspace({
    projectRoot: projectIndexerCustomizationDraftStagePath(
      input.projectRoot,
      input.validated.validation_digest,
    ),
    project_ref: input.validated.project_ref,
    indexer_id: indexer.id,
    base_manifest: manifest,
    base_bundle: resolved.bundle,
    execution: {
      ...manifest.provider.program.execution,
      entry,
    },
    capabilities: manifest.provider.program.capabilities,
    dependency_set_digest: input.dependencies.intent_set_digest,
    scope_digest: indexerProjectLocalProgramScopeDigest({
      project_ref: input.validated.project_ref,
      indexer_id: indexer.id,
      read_scope: indexer.read_scope,
    }),
    limits: {
      timeout_ms: 60_000,
      max_stdin_bytes: 16 * 1024 * 1024,
      max_stdout_bytes: 16 * 1024 * 1024,
      max_stderr_bytes: 1024 * 1024,
    },
  });
}

export async function prepareProjectIndexerCustomizationProposal(input: {
  projectRoot: string;
  value: unknown;
}): Promise<IndexerCustomizationProjectPreparationResult> {
  const request = preparationInput(input.value);
  const validated = await loadStagedProjectIndexerCustomizationDraft({
    projectRoot: input.projectRoot,
    validation_digest: request.validation_digest,
  });
  const customizations = await loadCustomizationViews({
    projectRoot: input.projectRoot,
    validated,
    resolved: request.resolved,
  });
  const finalReport = await validateIndexerSelectionFinal({
    registry: validated.target_registry,
    static_report: request.static_report,
    resolved: request.resolved,
    customizations,
    operator_contract: request.operator_contract,
    profile_contract: request.profile_contract,
  });
  const baseContent = await readFile(
    join(input.projectRoot, DEFAULT_INDEXER_REGISTRY_PATH),
    "utf8",
  );
  const base = registrySnapshot(baseContent);
  const targetContent = YAML.stringify(validated.target_registry);
  const target = registrySnapshot(targetContent);
  if (
    base.snapshot.requirement_set_digest !== target.snapshot.requirement_set_digest ||
    canonicalIndexerJson(base.registry.requirements) !==
      canonicalIndexerJson(target.registry.requirements)
  ) {
    throw new TypeError("Indexer customization project preparation cannot change requirements");
  }
  if (
    base.registry.indexers.length > 0 &&
    base.snapshot.indexer_selection_digest !== validated.source_indexer_selection_digest
  ) {
    throw new TypeError("Indexer customization project preparation base selection is stale");
  }
  const dependencies = buildIndexerDependencyIntentSet([]);
  const programReport = await localProgramAuthorizationReport({
    projectRoot: input.projectRoot,
    request,
    validated,
    dependencies,
  });
  let programAuthorization: IndexerProgramExecutionAuthorizationResult | undefined;
  if (programReport !== null) {
    if (request.program_authorization === undefined) {
      const payload = {
        protocol: "context.indexer.customization-project-preparation-result/v1" as const,
        outcome: "program-authorization-required" as const,
        validation_digest: validated.validation_digest,
        authorization_report: programReport,
      };
      return { ...payload, result_digest: indexerProtocolDigest(payload) };
    }
    programAuthorization = validateIndexerProgramExecutionAuthorizationResult(
      request.program_authorization,
    );
    if (
      programAuthorization.report_digest !== programReport.report_digest ||
      programAuthorization.authorization.execution_policy_digest !==
        programReport.execution_policy_digest
    ) {
      throw new TypeError("program authorization does not consume the current preparation report");
    }
  } else if (request.program_authorization !== undefined) {
    throw new TypeError("non-program customization cannot carry program authorization");
  }
  const targets = [{
    path: DEFAULT_INDEXER_REGISTRY_PATH,
    operation: "write" as const,
    base_digest: base.snapshot.document_digest,
    target_digest: target.snapshot.document_digest,
    content: targetContent,
  }, ...validated.files.map((file) => ({
    path: file.path,
    operation: "write" as const,
    base_digest: null,
    target_digest: file.content_digest,
    content: file.content,
  }))].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const proposal = buildIndexerProjectProposal({
    protocol: "context.indexer.project-proposal/v1",
    project_ref: validated.project_ref,
    mode: "customization",
    requirement_set_digest: base.snapshot.requirement_set_digest,
    base_registry: base.snapshot,
    target_registry: target.snapshot,
    target_document: target.registry,
    targets,
    dependencies,
    capability_gap_digest: validated.capability_gap_digest,
    finalized_validation_report_digests: [finalReport.report_digest],
    program_execution_policy_digest: programReport?.execution_policy_digest ?? null,
  });
  const stageReceipt = await stageIndexerProjectProposal({
    projectRoot: input.projectRoot,
    proposal,
  });
  const stagingValidation: IndexerProjectStagingValidationInput = {
    protocol: "context.indexer.project-staging-validation-input/v1",
    static_report: request.static_report,
    resolved: request.resolved,
    customizations,
    operator_contract: request.operator_contract,
    profile_contract: request.profile_contract,
    ...(programAuthorization === undefined
      ? {}
      : { program_authorization: programAuthorization }),
    capability_gap: validated.capability_gap,
  };
  const payload = {
    protocol: "context.indexer.customization-project-preparation-result/v1" as const,
    outcome: "project-confirmation-required" as const,
    validation_digest: validated.validation_digest,
    proposal,
    stage_receipt: stageReceipt,
    staging_validation: stagingValidation,
  };
  return { ...payload, result_digest: indexerProtocolDigest(payload) };
}
