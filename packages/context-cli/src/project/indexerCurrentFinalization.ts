import { measureContextDebugOperation } from "./debugTrace.js";
import { loadCandidateRenderCache, saveCandidateRenderCache } from "./candidateRenderCache.js";
import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { readIndexerDelivery } from "./indexerDelivery.js";
import { partitionAuthorBinding, readPartitionStream } from "./indexerPartitionStream.js";
import { basename, join } from "node:path";
import {
  buildIndexerLayoutChangeConfirmation,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition,
  canonicalIndexerJson,
  indexerArtifactResultSchema,
  indexerLayoutArtifactRef,
  indexerLayoutSectionIdentityRef,
  indexerLayoutSectionRef,
  indexerProtocolDigest,
  indexerRegistryDigests,
  reconcileIndexerResults,
  resolveIndexerBaseQuestionBindingAuthority,
  resolveIndexerOverlayQuestionBindingAuthority,
  resolveIndexerLayout,
  resolveIndexerSubjectKeySchemas,
  validateIndexerApprovedLayoutProjection,
  type IndexerApprovedLayoutProjection,
  type IndexerArtifactResult,
  type IndexerLayoutChangeConfirmation,
  type IndexerLayoutProposal,
} from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";
import { readApprovedKnowledgeMetadataIndex } from "./approvedKnowledgeMetadata.js";
import {
  compileProjectIndexerCandidates,
  INDEXER_CURRENT_READINESS_PATH,
} from "./indexerCandidateCompileActions.js";
import {
  readAcceptedIndexerMainAuthorResultHistory,
  readAcceptedIndexerMainAuthorResultRecords,
} from "./indexerMainRunStore.js";
import { currentLedger, readJsonMaybe } from "./indexerMainRunStoreRecords.js";
import { buildProjectIndexerQuestionTargetInventory } from
  "./indexerQuestionTargetInventoryActions.js";
import { readCurrentIndexerPostAuthorEnvelopesForResults } from
  "./indexerPostAuthorRunStore.js";
import { resolveCurrentIndexerComposerBatch } from "./indexerCurrentComposer.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { loadCurrentIndexerProviderSelection } from
  "./indexerCurrentProviderSelection.js";
import {
  prepareIndexerReaderPaths,
  resolveIndexerReaderPaths,
  type IndexerReaderPathChoice,
  type IndexerReaderPathPreparation,
} from "./indexerLayoutPathResolution.js";

import { INDEXER_CURRENT_FINALIZATION_PATH, composerFinalizationState } from
  "./indexerComposerFinalization.js";
import { indexerInputScopeRecoveryIsCurrent, type IndexerInputScopeRecovery } from "./indexerInputScopeRecovery.js";
export { INDEXER_CURRENT_FINALIZATION_PATH } from "./indexerComposerFinalization.js";

type AcceptedAuthorRecord = Awaited<ReturnType<
  typeof readAcceptedIndexerMainAuthorResultRecords
>>[number];

export interface CurrentIndexerFinalizationState {
  state: "layout-confirmation-required" | "composer-required" | "blocked" | "ready";
  revision: string;
  diagnostic?: string;
  scope_recovery?: IndexerInputScopeRecovery;
  layout_proposal_set?: ReturnType<typeof buildIndexerLayoutProposalSet>;
  layout_transition?: ReturnType<typeof buildIndexerLayoutTransition>;
  confirmations?: IndexerLayoutChangeConfirmation[];
  compile_digest?: string;
  path_preparation?: IndexerReaderPathPreparation;
  path_resolution?: { input_digest: string; paths: IndexerReaderPathChoice[] };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readableId(value: string): string {
  const normalized = value.normalize("NFC")
    .replace(/\.md$/iu, "")
    .replace(/([^\p{Letter}\p{Number}])+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("en-US");
  return normalized.length === 0 ? "content" : normalized;
}

function viewsForNode(
  structure: Record<string, unknown> | undefined,
  nodeRef: string,
): Record<string, unknown>[] {
  return Array.isArray(structure?.views)
    ? structure.views.filter((value): value is Record<string, unknown> =>
        object(value)?.node_ref === nodeRef
      )
    : [];
}

function oldSections(input: {
  view: Record<string, unknown>;
  node_ref: string;
  indexer_id: string;
  artifact_ref: string;
  artifact_kind: string;
  fallback: IndexerLayoutProposal["artifacts"][number]["sections"];
}) {
  const values = Array.isArray(input.view.sections) ? input.view.sections : [];
  const sections = values.flatMap((value) => {
    const section = object(value);
    const key = text(section?.id);
    if (key === undefined) return [];
    const identity = indexerLayoutSectionIdentityRef({
      node_ref: input.node_ref,
      owner_indexer_id: input.indexer_id,
      artifact_kind: input.artifact_kind,
      section_key: readableId(key),
    });
    return [{
      section_ref: indexerLayoutSectionRef(input.artifact_ref, identity),
      section_identity_ref: identity,
    }];
  });
  return (sections.length > 0
    ? sections
    : input.fallback.map((section) => ({
        section_ref: section.section_ref,
        section_identity_ref: section.section_identity_ref,
      })))
    .sort((left, right) => left.section_identity_ref.localeCompare(right.section_identity_ref));
}

export function approvedBaseProjection(input: {
  proposal: IndexerLayoutProposal;
  structure: Record<string, unknown> | undefined;
}): IndexerApprovedLayoutProjection | undefined {
  const views = viewsForNode(input.structure, input.proposal.node.node_ref);
  if (views.length === 0) return undefined;
  const artifacts = views.flatMap((view) => {
    const path = text(view.path);
    const collection = text(view.collection);
    if (path === undefined || collection === undefined) return [];
    const outputPath = path.startsWith("knowledge/") ? path : `knowledge/${path}`;
    const identity = input.proposal.artifacts.find((artifact) =>
      artifact.internal_view_ref === view.view_ref
    );
    const exact = input.proposal.artifacts.find((artifact) => artifact.output_path === outputPath);
    const byName = input.proposal.artifacts.filter((artifact) =>
      readableId(artifact.artifact_id) === readableId(basename(path))
    );
    const proposed = identity ?? exact ?? (byName.length === 1 ? byName[0] : undefined);
    if (input.proposal.delivery_artifact_ids !== undefined && proposed === undefined) return [];
    const firstSection = Array.isArray(view.sections)
      ? object(view.sections[0])
      : undefined;
    const artifactId = proposed?.artifact_id ?? readableId(basename(path));
    const artifactKind = proposed?.artifact_kind ?? text(firstSection?.kind) ?? "content";
    const artifactRef = proposed?.artifact_ref ?? indexerLayoutArtifactRef(
      input.proposal.node.node_ref,
      { artifact_id: artifactId, artifact_kind: artifactKind },
    );
    return [{
      artifact_ref: artifactRef,
      artifact_id: artifactId,
      artifact_kind: artifactKind,
      collection,
      output_path: outputPath,
      shared_artifact_fingerprint_digest:
        input.proposal.shared_artifact_fingerprint.fingerprint_digest,
      purpose: proposed?.purpose ?? "required" as const,
      split_of_artifact_ref: proposed?.split_of_artifact_ref ?? null,
      split_boundary: proposed?.split_boundary ?? null,
      sections: oldSections({
        view,
        node_ref: input.proposal.node.node_ref,
        indexer_id: input.proposal.indexer_id,
        artifact_ref: artifactRef,
        artifact_kind: artifactKind,
        fallback: proposed?.sections ?? [],
      }),
    }];
  }).sort((left, right) => left.artifact_ref.localeCompare(right.artifact_ref));
  if (artifacts.length === 0) return undefined;
  const payload = {
    protocol: "context.indexer.approved-layout-projection/v1" as const,
    indexer_id: input.proposal.indexer_id,
    profile: input.proposal.profile,
    profile_contract_digest: input.proposal.profile_contract_digest,
    subject_key_schema_set_digest: input.proposal.subject_key_schema_set_digest,
    subject_key_schema_digest: input.proposal.subject_key_schema_digest,
    node_ref: input.proposal.node.node_ref,
    shared_artifact_fingerprint: input.proposal.shared_artifact_fingerprint,
    artifacts,
  };
  return validateIndexerApprovedLayoutProjection({
    ...payload,
    projection_digest: indexerProtocolDigest(payload),
  });
}

function acceptedRefs(records: readonly AcceptedAuthorRecord[]) {
  return records.map((item) => {
    const accepted = object(item.accepted_record)!;
    const artifact = indexerArtifactResultSchema.parse(item.artifact_result);
    return {
      workset_digest: String(accepted.workset_digest),
      execution_request_digest: String(accepted.execution_request_digest),
      acceptance_digest: String(accepted.acceptance_digest),
      artifact_result_digest: artifact.output_digest,
    };
  });
}

function registeredSources(results: readonly IndexerArtifactResult[]) {
  const bySource = new Map<string, IndexerArtifactResult["evidence_bindings"]>();
  for (const result of results) {
    for (const binding of result.evidence_bindings) {
      const entries = bySource.get(binding.source_ref) ?? [];
      entries.push(binding);
      bySource.set(binding.source_ref, entries);
    }
  }
  return [...bySource].map(([sourceRef, bindings]) => ({
    source_ref: sourceRef,
    source_input_digest: indexerProtocolDigest(bindings.map((binding) => ({
      binding_digest: binding.binding_digest,
      content_digest: binding.content_digest,
    }))),
    evidence_kinds: [...new Set(bindings.map((binding) => binding.kind))].sort(),
  }));
}

async function writeState(
  projectRoot: string,
  state: CurrentIndexerFinalizationState,
): Promise<CurrentIndexerFinalizationState> {
  await atomicWriteFile(
    join(projectRoot, INDEXER_CURRENT_FINALIZATION_PATH),
    `${JSON.stringify(JSON.parse(canonicalIndexerJson(state)), null, 2)}\n`,
  );
  return state;
}

export async function readCurrentIndexerFinalization(
  projectRoot: string,
): Promise<CurrentIndexerFinalizationState | undefined> {
  const value = await readJsonMaybe(projectRoot, INDEXER_CURRENT_FINALIZATION_PATH);
  const state = object(value);
  if (state === undefined || typeof state.state !== "string" || typeof state.revision !== "string") {
    return undefined;
  }
  const current = state as unknown as CurrentIndexerFinalizationState;
  if (current.scope_recovery && !await indexerInputScopeRecoveryIsCurrent(projectRoot, current.scope_recovery)) return undefined;
  return current;
}

export async function confirmCurrentIndexerLayout(input: {
  projectRoot: string;
  revision: string;
  actor_ref: string;
  paths?: readonly IndexerReaderPathChoice[];
}): Promise<void> {
  const current = await readCurrentIndexerFinalization(input.projectRoot);
  if (
    current?.state !== "layout-confirmation-required" ||
    current.revision !== input.revision
  ) {
    throw new TypeError("layout confirmation targets a stale transition");
  }
  const resolvingPaths = current.path_preparation !== undefined &&
    current.revision === current.path_preparation.input_digest &&
    current.path_preparation.conflicts.length > 0;
  const layoutSet = resolvingPaths
    ? resolveIndexerReaderPaths({ preparation: current.path_preparation!, paths: input.paths ?? [] })
    : current.layout_proposal_set;
  if (!resolvingPaths && input.paths !== undefined) {
    throw new TypeError("this layout confirmation does not request new output paths");
  }
  const transition = resolvingPaths
    ? buildIndexerLayoutTransition({
        layout_proposal_set: layoutSet!,
        base_projections: current.path_preparation!.base_projections,
      })
    : current.layout_transition;
  if (transition === undefined) throw new TypeError("layout confirmation has no current transition");
  // Choosing names is not approval of unrelated changes to existing pages.
  // If the resolved layout also moves/removes old content, present that Gate next.
  const confirmations = (resolvingPaths ? [] : transition.change_reports)
    .filter((report) => report.requires_confirmation)
    .map((report) => buildIndexerLayoutChangeConfirmation({
      report,
      actor_ref: input.actor_ref,
    }));
  const { path_preparation: _preparation, ...state } = current;
  void _preparation;
  await writeState(input.projectRoot, {
    ...state,
    revision: transition.transition_digest,
    ...(layoutSet === undefined ? {} : { layout_proposal_set: layoutSet }),
    layout_transition: transition,
    confirmations,
    ...(resolvingPaths ? { path_resolution: {
      input_digest: current.path_preparation!.input_digest,
      paths: [...input.paths!],
    } } : {}),
  });
}

export async function prepareCurrentIndexerLayout(input: {
  projectRoot: string;
  proposals: readonly IndexerLayoutProposal[];
}) {
  const metadata = await readApprovedKnowledgeMetadataIndex(input.projectRoot);
  const bases = input.proposals.flatMap((proposal) => {
    const base = approvedBaseProjection({ proposal, structure: metadata.structure });
    return base === undefined ? [] : [base];
  });
  const preparation = prepareIndexerReaderPaths({
    proposals: input.proposals,
    base_projections: bases,
    occupied_paths: [...metadata.byPath.keys()].map((path) =>
      path.startsWith("knowledge/") ? path : `knowledge/${path}`
    ),
  });
  const previous = await readCurrentIndexerFinalization(input.projectRoot);
  const choices = previous?.path_resolution?.input_digest === preparation.input_digest
    ? previous.path_resolution.paths
    : undefined;
  if (preparation.conflicts.length > 0 && choices === undefined) {
    return { pending: true as const, state: await writeState(input.projectRoot, {
      state: "layout-confirmation-required",
      revision: preparation.input_digest,
      path_preparation: preparation,
    }) };
  }
  const layoutSet = resolveIndexerReaderPaths({ preparation, paths: choices ?? [] });
  const transition = buildIndexerLayoutTransition({
    layout_proposal_set: layoutSet,
    base_projections: bases,
  });
  const confirmations = previous?.layout_transition?.transition_digest === transition.transition_digest
    ? previous.confirmations ?? []
    : [];
  const layout = {
    layout_proposal_set: layoutSet,
    layout_transition: transition,
    confirmations,
    ...(choices === undefined ? {} : { path_resolution: {
      input_digest: preparation.input_digest,
      paths: choices,
    } }),
  };
  if (transition.requires_confirmation && confirmations.length === 0) {
    return { pending: true as const, state: await writeState(input.projectRoot, {
      state: "layout-confirmation-required",
      revision: transition.transition_digest,
      ...layout,
    }) };
  }
  return { pending: false as const, layout };
}

export async function advanceCurrentIndexerFinalization(
  projectRoot: string,
  resolvedComposerWorksets?: ReadonlySet<string>,
): Promise<CurrentIndexerFinalizationState | undefined> {
  const ledger = await currentLedger(projectRoot);
  const delivery = await readIndexerDelivery(projectRoot);
  if (
    ledger === undefined || ledger.entries.length === 0 ||
    ledger.entries.some((entry) => entry.stage !== "author") ||
    (!delivery?.current.length && ledger.entries.some((entry) => entry.state !== "accepted"))
  ) return undefined;

  const worksets = delivery?.current.length ? new Set(delivery.current.map(page => page.workset_digest)) : undefined;
  // Only reuse the immediately preceding resolution for the exact same scope.
  // Derived pages may change the delivery selection; those require resolution again.
  const alreadyResolved = worksets !== undefined && resolvedComposerWorksets !== undefined &&
    worksets.size === resolvedComposerWorksets.size && [...worksets].every(key => resolvedComposerWorksets.has(key));
  const composerBatch = alreadyResolved ? undefined : await resolveCurrentIndexerComposerBatch(projectRoot, worksets);
  if (composerBatch !== undefined) {
    return composerFinalizationState({
      batch_digest: composerBatch.batch_digest,
      task_count: composerBatch.tasks.length,
    });
  }
  const loaded = await loadIndexerRegistry(projectRoot);
  const allRecords = await readAcceptedIndexerMainAuthorResultRecords(projectRoot);
  const records = delivery?.current.length ? allRecords.filter((record) => delivery.current.some(
    (page) => page.result_digest === indexerArtifactResultSchema.parse(record.artifact_result).output_digest)) : allRecords;
  const results = records.map((item) => indexerArtifactResultSchema.parse(item.artifact_result));
  const authorities = await Promise.all(loaded.registry.indexers.map((indexer) =>
    resolveCurrentProjectIndexerPrimaryAuthority({
      projectRoot,
      registry: loaded.registry,
      indexer_id: indexer.id,
    })
  ));
  const contracts = authorities[0];
  if (contracts === undefined) {
    throw new TypeError("current Indexer lifecycle has no Provider contract authority");
  }
  if (authorities.some((authority) =>
    authority.operator_contract.contract_digest !== contracts.operator_contract.contract_digest ||
    authority.profile_contract.contract_digest !== contracts.profile_contract.contract_digest
  )) {
    throw new TypeError("current Indexer Providers disagree on their contract authority");
  }
  let selectionState: Awaited<ReturnType<typeof loadCurrentIndexerProviderSelection>> | undefined;
  try {
    selectionState = await loadCurrentIndexerProviderSelection({
      projectRoot,
      registry: loaded.registry,
    });
  } catch (error) {
    if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const inventory = await buildProjectIndexerQuestionTargetInventory({
    projectRoot,
    value: {
      protocol: "context.indexer.question-target-inventory-input/v1",
      requirement_set_digest: loaded.requirementSetDigest,
    },
  });
  const allowedFactPaths = new Set(["target.eligible", "evidence.current"]);
  const stream = await readPartitionStream(projectRoot);
  const globalCoverageRequired = stream === undefined ||
    stream.partition_ledger.entries.every((entry) => entry.state === "accepted");
  const resolvedQuestions = globalCoverageRequired ? loaded.registry.requirements.flatMap((requirement) =>
    (requirement.questions ?? []).map((binding) => ({
      requirement_ref: `requirement:${requirement.id}`,
      question: binding.authority.kind === "cli-base-contract"
        ? resolveIndexerBaseQuestionBindingAuthority({
            registry: loaded.registry,
            requirement_id: requirement.id,
            binding,
            profile_contract: contracts.profile_contract,
            operator_contract: contracts.operator_contract,
          })
        : resolveIndexerOverlayQuestionBindingAuthority({
            registry: loaded.registry,
            binding,
            base_contract: contracts.profile_contract,
            operator_contract: contracts.operator_contract,
            proof: (() => {
              const matches = (selectionState?.overlay_question_authorities ?? []).filter((proof) =>
                proof.requirement_id === requirement.id &&
                proof.overlay_validation.overlay.overlay_digest === binding.authority.digest
              );
              if (matches.length !== 1) {
                throw new TypeError(`overlay question ${binding.ref} has no exact current authority`);
              }
              return matches[0]!;
            })(),
          }),
    }))
  ) : [];
  const targetFacts = Object.fromEntries(inventory.items.map((item) => [
    item.target_ref,
    { target: { eligible: true }, evidence: { current: true } },
  ]));
  const streamedAuthorBindings = stream === undefined ? undefined : new Set([
    ...stream.completed_bindings,
    ...stream.active_bindings,
  ]);
  const reconciliationRecords = stream !== undefined && globalCoverageRequired
    ? await readAcceptedIndexerMainAuthorResultHistory({
        projectRoot,
        include: (spec) => streamedAuthorBindings!.has(partitionAuthorBinding(spec)),
      })
    : allRecords;
  const reconciliationResults = reconciliationRecords.map((record) =>
    indexerArtifactResultSchema.parse(record.artifact_result));
  const reconciliation = globalCoverageRequired ? reconcileIndexerResults({
    registry: loaded.registry,
    question_target_inventory: inventory,
    resolved_questions: resolvedQuestions,
    target_facts: targetFacts,
    allowed_selector_fact_paths: allowedFactPaths,
    author_results: reconciliationResults,
    registered_material_sources: registeredSources(reconciliationResults),
  }) : undefined;
  if (ledger.entries.every((entry) => entry.state === "accepted") &&
      reconciliation !== undefined && !reconciliation.can_report_complete) {
    return writeState(projectRoot, {
      state: "blocked",
      revision: reconciliation.report_digest,
      diagnostic: reconciliation.outcome,
    });
  }

  const digests = indexerRegistryDigests(loaded.registry);
  const selections = loaded.registry.indexers.flatMap((indexer) => [{
    indexer_id: indexer.id,
    profile: indexer.profile.primary.id,
    role: "primary" as const,
    provider_layer_id: indexer.profile.primary.provider,
  }, ...(indexer.profile.additional ?? []).map((profile) => ({
    indexer_id: indexer.id,
    profile: profile.id,
    role: profile.kind,
    provider_layer_id: profile.provider,
  }))]);
  const subjectSchemas = selectionState === undefined
    ? resolveIndexerSubjectKeySchemas({
        profile_contract: contracts.profile_contract,
        operator_contract: contracts.operator_contract,
        selections,
        providers: [],
      })
    : {
        protocol: "context.indexer.resolved-subject-key-schema-set/v1" as const,
        schemas: selectionState.final_report.subject_key_schemas,
        set_digest: selectionState.final_report.subject_key_schema_set_digest,
      };
  const indexerById = new Map(loaded.registry.indexers.map((indexer) => [indexer.id, indexer]));
  const postAuthorEnvelopes = await readCurrentIndexerPostAuthorEnvelopesForResults({
    projectRoot,
    results: records.map((record) => ({
      author_workset_digest: String(record.accepted_record.workset_digest),
      primary_result_digest: String(record.accepted_record.result_digest),
    })),
  });
  const renderCache = await loadCandidateRenderCache(projectRoot);
  const renderCounters = { result_count: records.length, rendered_sections: 0, reused_sections: 0 };
  const proposals = await measureContextDebugOperation({ projectRoot, operation: "indexer.delivery-layout", counters: renderCounters }, async () => {
  const proposals: IndexerLayoutProposal[] = [];
  for (const [index, record] of records.entries()) {
    const result = results[index]!;
    const indexer = indexerById.get(result.indexer_id);
    if (indexer === undefined) throw new TypeError(`unknown accepted Indexer ${result.indexer_id}`);
    const postAuthor = postAuthorEnvelopes[index]!;
    proposals.push(resolveIndexerLayout({
      render_cache: renderCache.entries,
      artifact_result: result,
      ...(delivery?.current.length ? { delivery_artifact_ids: delivery.current.filter(
        (page) => page.result_digest === result.output_digest).map((page) => page.artifact_id) } : {}),
      ...(postAuthor === null ? {} : { post_author_envelope: postAuthor }),
      profile: indexer.profile.primary.id,
      profile_contract: contracts.profile_contract,
      operator_contract: contracts.operator_contract,
      subject_key_schema_set: subjectSchemas,
      shared_artifact_fingerprint: record.run_envelope.shared_artifact_fingerprint,
    }));
  }
  renderCounters.rendered_sections = renderCache.entries.misses;
  renderCounters.reused_sections = renderCache.entries.hits;
  return proposals;
  });
  await saveCandidateRenderCache(projectRoot, renderCache);
  const prepared = await prepareCurrentIndexerLayout({ projectRoot, proposals });
  if (prepared.pending) return prepared.state;
  const { layout_proposal_set: layoutSet, layout_transition: transition, confirmations } = prepared.layout;
  const compiled = await compileProjectIndexerCandidates({
    projectRoot,
    value: {
      protocol: "context.indexer.candidate-compile-input/v1",
      accepted_result_refs: acceptedRefs(records),
      subject_key_schema_set: subjectSchemas,
      layout_proposal_set: layoutSet,
      layout_transition: transition,
      layout_change_confirmations: confirmations,
      rendered_artifacts: results.map((result) => ({
        artifact_result_digest: result.output_digest,
        artifacts: [],
      })),
    },
  });
  const effectiveRevisionDigest = indexerProtocolDigest({
    compile_digest: compiled.compile.compile_digest,
    layout_transition_digest: transition.transition_digest,
  });
  const readinessDigest = indexerProtocolDigest({
    requirement_set_digest: digests.requirementSetDigest,
    registry_digest: digests.registryDigest,
    inventory_digest: inventory.inventory_digest,
    layout_digest: layoutSet.set_digest,
    compile_digest: compiled.compile.compile_digest,
    effective_revision_digest: effectiveRevisionDigest,
  });
  await atomicWriteFile(join(projectRoot, INDEXER_CURRENT_READINESS_PATH), canonicalIndexerJson({
    compile_digest: compiled.compile.compile_digest,
    readiness_digest: readinessDigest,
  }));
  return writeState(projectRoot, {
    state: "ready",
    revision: readinessDigest,
    ...prepared.layout,
    compile_digest: compiled.compile.compile_digest,
  });
}
