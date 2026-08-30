import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  type IndexerProviderSelectionProposal,
  type IndexerRegistry,
} from "@c4a/context";
import type { HostActionResult } from "@c4a/agent-graph";
import { loadCliIndexerBaseContracts } from "./indexerCliBundledProvider.js";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import {
  dispatchProjectIndexerProviderResolution,
  stageProjectIndexerProviderResolution,
} from "./indexerProviderProjectFlow.js";
import { routeProjectIndexerProviderSelection } from "./indexerProviderRouting.js";
import { validateProjectIndexerSelectionProposal } from "./indexerSelectionProposal.js";
import {
  validateIndexerSelectionFinal,
  type IndexerResolvedSelectionInput,
} from "./indexerSelectionValidation.js";
import type { IndexerProviderHostManagedOutput } from
  "./indexerProviderDispatcher.js";
import { readSourceStatus } from "./statusReaders.js";

const MARKDOWN_SKILL = "context-markdown-indexer";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  const values = [...value].sort();
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return values;
}

export interface MarkdownProviderCaptureReport {
  protocol: "context.indexer.markdown-provider-capture-report/v1";
  project_ref: string;
  requested_source_refs: string[];
  source_inputs: Array<{
    source_ref: string;
    snapshot_digest: string;
    normalizer_version: string;
  }>;
  unavailable_source_refs: string[];
  capture_set_digest: string;
  outcome:
    | "markdown-provider-discovery-required"
    | "index-document-capture-not-current";
  graph_outcome: "completed" | "blocked";
  report_digest: string;
}

function captureReportDigest(
  value: Omit<MarkdownProviderCaptureReport, "report_digest">,
): string {
  return indexerProtocolDigest(value);
}

export async function inspectProjectMarkdownProviderCapture(input: {
  projectRoot: string;
  value: unknown;
}): Promise<MarkdownProviderCaptureReport> {
  const value = record(input.value, "Markdown Provider capture input");
  if (value.protocol !== "context.indexer.markdown-provider-capture-input/v1") {
    throw new TypeError("Markdown Provider capture input protocol is invalid");
  }
  const projectRef = text(value.project_ref, "project_ref");
  const requestedSourceRefs = stringList(value.source_refs, "source_refs");
  if (requestedSourceRefs.length === 0) {
    throw new TypeError("Markdown Provider discovery requires at least one source_ref");
  }
  const status = await readSourceStatus(input.projectRoot);
  if (status.diagnostics.length > 0) {
    throw new TypeError(`document source status is invalid: ${status.diagnostics.join("; ")}`);
  }
  const current = new Map(status.documentSources.map((source) => [
    `${source.type}:${source.name}`,
    source,
  ]));
  const sourceInputs = requestedSourceRefs.flatMap((sourceRef) => {
    const source = current.get(sourceRef);
    return source?.snapshotReady === true &&
        source.snapshotHash !== undefined &&
        source.normalizerVersion !== undefined
      ? [{
          source_ref: sourceRef,
          snapshot_digest: source.snapshotHash,
          normalizer_version: source.normalizerVersion,
        }]
      : [];
  });
  const ready = new Set(sourceInputs.map((item) => item.source_ref));
  const unavailableSourceRefs = requestedSourceRefs.filter((ref) => !ready.has(ref));
  const captureSetDigest = indexerProtocolDigest({ source_inputs: sourceInputs });
  const base: Omit<MarkdownProviderCaptureReport, "report_digest"> = {
    protocol: "context.indexer.markdown-provider-capture-report/v1",
    project_ref: projectRef,
    requested_source_refs: requestedSourceRefs,
    source_inputs: sourceInputs,
    unavailable_source_refs: unavailableSourceRefs,
    capture_set_digest: captureSetDigest,
    outcome: unavailableSourceRefs.length === 0
      ? "markdown-provider-discovery-required"
      : "index-document-capture-not-current",
    graph_outcome: unavailableSourceRefs.length === 0 ? "completed" : "blocked",
  };
  return { ...base, report_digest: captureReportDigest(base) };
}

async function validateCaptureReport(
  projectRoot: string,
  value: unknown,
): Promise<MarkdownProviderCaptureReport> {
  const report = record(value, "Markdown Provider capture report") as unknown as
    MarkdownProviderCaptureReport;
  if (report.protocol !== "context.indexer.markdown-provider-capture-report/v1") {
    throw new TypeError("Markdown Provider capture report protocol is invalid");
  }
  const expected = await inspectProjectMarkdownProviderCapture({
    projectRoot,
    value: {
      protocol: "context.indexer.markdown-provider-capture-input/v1",
      project_ref: report.project_ref,
      source_refs: report.requested_source_refs,
    },
  });
  if (canonicalIndexerJson(expected) !== canonicalIndexerJson(report)) {
    throw new TypeError("Markdown Provider capture report is stale");
  }
  if (report.graph_outcome !== "completed") {
    throw new TypeError("Markdown Provider discovery requires complete current capture");
  }
  return report;
}

function markdownSkill(skill: string): boolean {
  return skill === MARKDOWN_SKILL || skill.startsWith(`${MARKDOWN_SKILL}-`);
}

function scopeSourceRefs(registry: IndexerRegistry, ref: string): string[] {
  const match = /^requirement:([^#]+)#(target_scope|evidence_source_scope)$/u.exec(ref);
  if (match === null) return [ref];
  const requirement = registry.requirements.find((item) => item.id === match[1]);
  if (requirement === undefined) return [];
  const scope = match[2] === "target_scope"
    ? requirement.target_scope
    : requirement.evidence_source_scope;
  return scope.targets.map((target) => target.source_ref);
}

function assertMarkdownCoverage(input: {
  registry: IndexerRegistry;
  sourceRefs: readonly string[];
}): string[] {
  const markdownIndexers = input.registry.indexers.filter((indexer) =>
    indexer.providers.some((provider) => markdownSkill(provider.skill))
  );
  if (markdownIndexers.length === 0) {
    throw new TypeError("Markdown Provider route selected no context-markdown-indexer Skill");
  }
  const covered = new Set(markdownIndexers.flatMap((indexer) =>
    indexer.read_scope.refs.flatMap((ref) => scopeSourceRefs(input.registry, ref))
  ));
  const missing = input.sourceRefs.filter((sourceRef) => !covered.has(sourceRef));
  if (missing.length > 0) {
    throw new TypeError(`Markdown Provider read scope does not cover ${missing.join(", ")}`);
  }
  return markdownIndexers.map((indexer) => indexer.id).sort();
}

interface MarkdownProviderHostResultInput {
  indexer_id: string;
  provider_id: string;
  result: HostActionResult;
  managed_output?: IndexerProviderHostManagedOutput;
}

function suppliedHostResults(value: unknown): MarkdownProviderHostResultInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("host_results must be an array");
  return value.map((item, index) => {
    const input = record(item, `host_results[${index}]`);
    return {
      indexer_id: text(input.indexer_id, `host_results[${index}].indexer_id`),
      provider_id: text(input.provider_id, `host_results[${index}].provider_id`),
      result: record(
        input.result,
        `host_results[${index}].result`,
      ) as unknown as HostActionResult,
      ...(input.managed_output === undefined
        ? {}
        : {
            managed_output: record(
              input.managed_output,
              `host_results[${index}].managed_output`,
            ) as unknown as IndexerProviderHostManagedOutput,
          }),
    };
  });
}

function resolvedKey(value: { indexer_id: string; provider_id: string }): string {
  return `${value.indexer_id}\u0000${value.provider_id}`;
}

export async function validateProjectMarkdownProviderSelection(input: {
  projectRoot: string;
  value: unknown;
  assetsRoot?: string;
}) {
  const value = record(input.value, "Markdown Provider validation input");
  if (value.protocol !== "context.indexer.markdown-provider-validation-input/v1") {
    throw new TypeError("Markdown Provider validation input protocol is invalid");
  }
  const capture = await validateCaptureReport(input.projectRoot, value.capture_report);
  const routeReport = await routeProjectIndexerProviderSelection({
    projectRoot: input.projectRoot,
    value: value.provider_route_input,
  });
  if (canonicalIndexerJson(routeReport) !== canonicalIndexerJson(value.provider_route_report)) {
    throw new TypeError("Markdown Provider route report is stale");
  }
  if (
    routeReport.route.graph_outcome !== "completed" ||
    routeReport.selection_proposal_input === null
  ) {
    throw new TypeError("Markdown Provider route is not ready for selection validation");
  }
  if (capture.project_ref !== routeReport.project_ref) {
    throw new TypeError("Markdown Provider capture and selection target different projects");
  }
  const staticValidation = await validateProjectIndexerSelectionProposal({
    projectRoot: input.projectRoot,
    value: routeReport.selection_proposal_input,
  });
  if (canonicalIndexerJson(staticValidation) !== canonicalIndexerJson(value.static_validation)) {
    throw new TypeError("Markdown Provider static validation is stale");
  }
  const proposal: IndexerProviderSelectionProposal = staticValidation.proposal;
  const markdownIndexerIds = assertMarkdownCoverage({
    registry: proposal.registry,
    sourceRefs: capture.requested_source_refs,
  });
  const customizationRequired = proposal.registry.indexers
    .filter((indexer) => (indexer.customization?.mode ?? "none") !== "none")
    .map((indexer) => indexer.id)
    .sort();
  if (customizationRequired.length > 0) {
    return {
      protocol: "context.indexer.markdown-provider-validation-result/v1" as const,
      outcome: "indexer-customization-required" as const,
      capture_report_digest: capture.report_digest,
      provider_route_report_digest: routeReport.report_digest,
      static_validation_digest: staticValidation.validation_digest,
      indexer_ids: customizationRequired,
      graph_outcome: "blocked" as const,
    };
  }

  const hostResults = suppliedHostResults(value.host_results);
  const hostByKey = new Map(hostResults.map((item) => [resolvedKey(item), item]));
  if (hostByKey.size !== hostResults.length) {
    throw new TypeError("Markdown Provider Host results contain duplicate Provider layers");
  }
  const requestByKey = new Map(staticValidation.resolution_requests.map((request) => [
    resolvedKey({
      indexer_id: request.provider.indexer_id,
      provider_id: request.provider.provider_id,
    }),
    request,
  ]));
  for (const [key] of hostByKey) {
    const request = requestByKey.get(key);
    if (request === undefined || request.provider.distribution.kind === "cli-bundled") {
      throw new TypeError("Markdown Provider Host result is not authorized for external resolution");
    }
  }
  const resolvedByKey = new Map<string, IndexerResolvedSelectionInput>();
  const hostRequired: unknown[] = [];
  for (const request of staticValidation.resolution_requests) {
    const key = resolvedKey({
      indexer_id: request.provider.indexer_id,
      provider_id: request.provider.provider_id,
    });
    const host = hostByKey.get(key);
    const dispatch = await dispatchProjectIndexerProviderResolution({
      projectRoot: input.projectRoot,
      selection: proposal,
      request,
      ...(input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot }),
      ...(host === undefined ? {} : { host_result: host.result }),
      ...(host?.managed_output === undefined
        ? {}
        : { managed_output: host.managed_output }),
    });
    if (dispatch.state === "host-action-required") {
      hostRequired.push(dispatch);
      continue;
    }
    const staged = await stageProjectIndexerProviderResolution({
      projectRoot: input.projectRoot,
      selection: proposal,
      request,
      resolution: dispatch,
    });
    resolvedByKey.set(key, {
      indexer_id: request.provider.indexer_id,
      provider_id: request.provider.provider_id,
      bundle: dispatch.output.envelope,
      staged: staged.staged,
      execution_policy_digest: null,
    });
  }
  if (hostRequired.length > 0) {
    return {
      protocol: "context.indexer.markdown-provider-validation-result/v1" as const,
      outcome: "markdown-provider-host-resolution-required" as const,
      capture_report_digest: capture.report_digest,
      provider_route_report_digest: routeReport.report_digest,
      static_validation_digest: staticValidation.validation_digest,
      host_requests: hostRequired,
      graph_outcome: "partial" as const,
    };
  }

  const finalResolved = [...resolvedByKey.values()];
  const customizations = [];
  for (const indexer of proposal.registry.indexers) {
    const primary = indexer.providers.find((provider) => provider.role === "primary")!;
    const authority = resolvedByKey.get(resolvedKey({
      indexer_id: indexer.id,
      provider_id: primary.id,
    }));
    if (authority === undefined) {
      throw new TypeError(`Markdown Provider finalization is missing ${indexer.id}/${primary.id}`);
    }
    const manifest = await loadIndexerProviderManifest(authority.staged.stage_path);
    if (markdownIndexerIds.includes(indexer.id) && !manifest.domains.includes("markdown")) {
      throw new TypeError(`Provider ${manifest.id} does not declare the markdown domain`);
    }
    customizations.push(await loadIndexerCustomization({
      workspaceRoot: input.projectRoot,
      projectRef: capture.project_ref,
      indexer,
      manifest,
      providerIntegrity: authority.bundle.resolved.integrity,
    }));
  }
  const contracts = await loadCliIndexerBaseContracts(
    input.assetsRoot === undefined ? {} : { assetsRoot: input.assetsRoot },
  );
  const finalReport = await validateIndexerSelectionFinal({
    registry: proposal.registry,
    static_report: staticValidation.static_report,
    resolved: finalResolved,
    customizations,
    operator_contract: contracts.operators,
    profile_contract: contracts.profiles,
  });
  return {
    protocol: "context.indexer.markdown-provider-validation-result/v1" as const,
    outcome: "markdown-provider-selection-current" as const,
    capture_report_digest: capture.report_digest,
    provider_route_report_digest: routeReport.report_digest,
    static_validation_digest: staticValidation.validation_digest,
    final_report: finalReport,
    graph_outcome: "completed" as const,
  };
}
