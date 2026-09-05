import {
  buildIndexerMainRunRequest,
  buildIndexerRunEnvironment,
  buildIndexerSourceIdentityInventory,
  canonicalIndexerInventoryMembers,
  composeIndexerLayerInput,
  indexerInventoryMembersDigest,
  indexerPartitionStrategySetDigest,
  indexerProtocolDigest,
  validateIndexerArtifactPolicyEligibilityReport,
  validateIndexerAuthorDependencyView,
  validateIndexerMainWorkset,
  type IndexerInventoryMember,
  type IndexerRegistry,
} from "@c4a/context";
import {
  assertProjectIndexerMainSourceBinding,
  type ProjectIndexerMainSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { normalizeRunSpec, type MainRunSpec } from "./indexerMainRunStoreRecords.js";
import { projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import type { CurrentIndexerExtensionFacts } from "./indexerCurrentInspector.js";
import type { IndexerConsumerWorksetProjection } from
  "./indexerConsumerWorksetPlanner.js";

function primarySourceRole(
  adapter: "parser-facts" | "captured-documents",
  declared: readonly string[],
): string {
  const role = adapter === "parser-facts"
    ? "authoritative-source"
    : "authoritative-document";
  if (!declared.includes(role)) {
    throw new TypeError(`primary Provider does not declare source role ${role}`);
  }
  return role;
}

type CurrentPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

export interface AuthorSupplementarySource {
  indexer_id: string;
  source_ref: string;
  module_ref: string | null;
  profile_contract_digest: string;
  source_binding_digest: string;
}

function supplementarySourceIdentity(source: AuthorSupplementarySource): string {
  return [source.indexer_id, source.source_ref, source.module_ref ?? ""].join("\u0000");
}

export function canonicalProjectIndexerSupplementarySources(
  sources: readonly AuthorSupplementarySource[],
): AuthorSupplementarySource[] {
  const byIdentity = new Map<string, AuthorSupplementarySource>();
  for (const source of sources) {
    const identity = supplementarySourceIdentity(source);
    const previous = byIdentity.get(identity);
    if (
      previous !== undefined &&
      (previous.profile_contract_digest !== source.profile_contract_digest ||
        previous.source_binding_digest !== source.source_binding_digest)
    ) {
      throw new TypeError(
        `author supplementary source ${source.indexer_id}/${source.source_ref} has conflicting authority`,
      );
    }
    byIdentity.set(identity, source);
  }
  return [...byIdentity.values()].sort((left, right) =>
    supplementarySourceIdentity(left).localeCompare(supplementarySourceIdentity(right))
  );
}

function assertCurrentAuthority(input: {
  workset: ReturnType<typeof validateIndexerMainWorkset>;
  binding: ProjectIndexerMainSourceBinding;
  authority: CurrentPrimaryAuthority;
  dependency_view?: unknown;
}): void {
  assertProjectIndexerMainSourceBinding({
    workset: input.workset,
    binding: input.binding,
    ...(input.dependency_view === undefined
      ? {}
      : { dependency_view: input.dependency_view }),
  });
  if (
    input.authority.primary_registry.projection_digest !==
      input.workset.primary_registry_projection_digest ||
    input.authority.primary_execution.primary_execution_fingerprint !==
      input.workset.primary_execution_fingerprint ||
    input.authority.primary_execution.primary_resource_binding_digest !==
      input.workset.primary_resource_binding_digest ||
    input.authority.profile_contract.contract_digest !==
      input.workset.profile_contract_digest
  ) {
    throw new TypeError("main workset no longer matches current Provider authority");
  }
}

function finalAuthority(authority: CurrentPrimaryAuthority) {
  return {
    layer_ref: `provider:${authority.provider.id}#layer:${authority.provider.role}`,
    integrity: authority.provider.integrity,
    bundle_digest: authority.provider.integrity,
    config_fingerprint: authority.primary_execution.config_digest,
    customization_fingerprint: null,
  };
}

function sourcePrecedenceDigest(input: {
  binding: ProjectIndexerMainSourceBinding;
}): string {
  return input.binding.adapter === "parser-facts"
    ? input.binding.parser_binding.source_merge_digest
    : indexerProtocolDigest({
        source_snapshot_digest: input.binding.source_snapshot_digest,
        source_identity_inventory_digest:
          input.binding.source_identity_inventory.inventory_digest,
      });
}

function allowedArtifactIntents(input: {
  authority: CurrentPrimaryAuthority;
  eligibility: ReturnType<typeof validateIndexerArtifactPolicyEligibilityReport>;
  sourceRole: string;
}): Array<{
  source_role: string;
  document_kind: string;
  reader_goal: string;
  artifact_kind: string;
}> {
  const eligibleKinds = new Set(input.eligibility.eligible_variants.flatMap((variant) => [
    ...variant.required_artifact_kinds,
    ...variant.discretionary_artifact_kinds,
  ]));
  const intents = input.authority.profile.layout_mappings.flatMap((mapping) =>
    mapping.source_roles.includes(input.sourceRole)
      ? mapping.artifact_kinds
          .filter((artifactKind) => eligibleKinds.has(artifactKind))
          .map((artifactKind) => ({
            source_role: input.sourceRole,
            document_kind: mapping.document_kind,
            reader_goal: mapping.reader_goal,
            artifact_kind: artifactKind,
          }))
      : []
  ).sort((left, right) => {
    const leftKey = [
      left.source_role,
      left.document_kind,
      left.reader_goal,
      left.artifact_kind,
    ].join("\u0000");
    const rightKey = [
      right.source_role,
      right.document_kind,
      right.reader_goal,
      right.artifact_kind,
    ].join("\u0000");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (intents.length === 0) {
    throw new TypeError("author workset has no eligible profile layout mapping");
  }
  return intents;
}

function runEnvironment(input: {
  workset: ReturnType<typeof validateIndexerMainWorkset>;
  binding: ProjectIndexerMainSourceBinding;
  authority: CurrentPrimaryAuthority;
  dependency_view: ReturnType<typeof validateIndexerAuthorDependencyView> | null;
}) {
  const sourceSnapshotDigest = input.dependency_view === null
    ? input.binding.source_snapshot_digest
    : indexerProtocolDigest({
        source_ref: input.dependency_view.source_ref,
        module_ref: input.dependency_view.module_ref,
        source_spans: input.dependency_view.positive_nodes.flatMap((node) =>
          node.kind === "source-span"
            ? [{ node_ref: node.node_ref, content_digest: node.content_digest }]
            : []
        ),
      });
  const sourcePrecedence = input.dependency_view === null
    ? sourcePrecedenceDigest({ binding: input.binding })
    : indexerProtocolDigest({
        selected_facts: input.dependency_view.positive_nodes.flatMap((node) =>
          node.kind === "selected-fact"
            ? [{ fact_ref: node.fact_ref, fact_digest: node.fact_digest }]
            : []
        ),
        precedence_winners: input.dependency_view.negative_nodes.filter((node) =>
          node.kind === "precedence-winner"
        ),
      });
  return buildIndexerRunEnvironment({
    source_snapshot_digest: sourceSnapshotDigest,
    source_dependency_fingerprint: input.workset.source_binding_digest,
    source_role: primarySourceRole(
      input.binding.adapter,
      input.authority.manifest.provides.source_roles ?? [],
    ),
    source_precedence_digest: sourcePrecedence,
    metric_set_digest: indexerProtocolDigest({
      profile: input.authority.profile.id,
      metrics: input.authority.profile.metrics,
    }),
    dependency_view_digest: input.dependency_view?.view_digest ?? null,
    primary_execution_projection: input.authority.primary_execution,
  });
}

export function buildCurrentProjectIndexerPartitionRunSpec(input: {
  workset: unknown;
  binding: ProjectIndexerMainSourceBinding;
  authority: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>;
  canonical_inventory_members?: readonly IndexerInventoryMember[];
  partition_projection?: IndexerConsumerWorksetProjection;
  enrichment?: CurrentIndexerExtensionFacts;
}): MainRunSpec {
  const workset = validateIndexerMainWorkset(input.workset);
  const authority = input.authority;
  const binding = input.binding;
  if (workset.stage !== "partition") {
    throw new TypeError("partition run preparation only accepts partition worksets");
  }
  assertCurrentAuthority({ workset, binding, authority });
  const strategies = authority.partition_strategies.strategies.map((strategy) => ({
    strategy_ref: strategy.strategy_ref,
    strategy_digest: strategy.strategy_digest,
  }));
  if (
    indexerPartitionStrategySetDigest(strategies) !== workset.strategy_set_digest ||
    authority.primary_registry.projection_digest !==
      workset.primary_registry_projection_digest
  ) {
    throw new TypeError("partition workset no longer matches current Provider authority");
  }
  const currentFinalAuthority = finalAuthority(authority);
  const subjectSchema = authority.profile_contract.subject_key_schemas.find((candidate) =>
    candidate.profile === authority.profile.id
  );
  if (subjectSchema === undefined) {
    throw new TypeError(`missing partition SubjectKey contract for ${authority.profile.id}`);
  }
  const { profile: _subjectProfile, ...subjectKeyContract } = subjectSchema;
  void _subjectProfile;
  const enrichment = input.enrichment ?? { inspector_materializations: [], fragments: [] };
  const canonicalInventory = canonicalIndexerInventoryMembers(
    input.canonical_inventory_members ?? binding.partition_inventory,
  );
  if (
    indexerInventoryMembersDigest(canonicalInventory) !==
      workset.partition_inventory_digest
  ) {
    throw new TypeError("partition inventory members do not match their workset");
  }
  const request = buildIndexerMainRunRequest({
    workset,
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: currentFinalAuthority.layer_ref,
      fragments: enrichment.fragments,
    }),
    final_authority: currentFinalAuthority,
    run_environment: runEnvironment({
      workset,
      binding,
      authority,
      dependency_view: null,
    }),
    partition_strategy_attempt: {
      strategy_order: 0,
      strategy_ref: authority.partition_strategies.strategies[0]!.strategy_ref,
      strategy_digest: authority.partition_strategies.strategies[0]!.strategy_digest,
      previous_attempt_digest: null,
    },
  });
  return normalizeRunSpec({
    protocol: "context.indexer.main-run-spec/v1",
    request,
    validation: {
      stage: "partition",
      canonical_inventory_members: canonicalInventory,
      authorized_source_refs: [workset.source_ref],
      authorized_strategies: strategies,
      subject_key_contract: subjectKeyContract,
      required_question_target_refs: workset.allowed_question_target_refs,
      inspector_materializations: enrichment.inspector_materializations,
      ...(input.partition_projection === undefined
        ? {}
        : { partition_projection: input.partition_projection }),
    },
  });
}

export function buildCurrentProjectIndexerAuthorRunSpec(input: {
  workset: unknown;
  binding: ProjectIndexerMainSourceBinding;
  authority: CurrentPrimaryAuthority;
  registry: IndexerRegistry;
  dependency_view: unknown;
  canonical_inventory_members: readonly IndexerInventoryMember[];
  expected_subject_key: unknown;
  artifact_policy_eligibility: unknown;
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
  enrichment?: CurrentIndexerExtensionFacts;
  supplementary_sources?: readonly AuthorSupplementarySource[];
}): MainRunSpec {
  const workset = validateIndexerMainWorkset(input.workset);
  if (workset.stage !== "author") {
    throw new TypeError("author run preparation only accepts author worksets");
  }
  const dependencyView = validateIndexerAuthorDependencyView(input.dependency_view);
  assertCurrentAuthority({
    workset,
    binding: input.binding,
    authority: input.authority,
    dependency_view: dependencyView,
  });
  const canonicalInventory = canonicalIndexerInventoryMembers(
    input.canonical_inventory_members,
  );
  if (
    dependencyView.view_digest !== workset.group_dependency_view_digest ||
    dependencyView.source_ref !== workset.source_ref ||
    dependencyView.module_ref !== workset.module_ref ||
    dependencyView.logical_unit_ref !== workset.logical_unit_ref
  ) {
    throw new TypeError("author dependency view does not match its workset");
  }
  if (indexerInventoryMembersDigest(canonicalInventory) !== workset.member_inventory_digest) {
    throw new TypeError("author inventory members do not match their workset");
  }
  const eligibility = validateIndexerArtifactPolicyEligibilityReport(
    input.artifact_policy_eligibility,
  );
  if (
    eligibility.eligibility_digest !== workset.artifact_policy_eligibility_digest ||
    eligibility.eligible_variants.length !== workset.allowed_artifact_policy_variants.length ||
    eligibility.eligible_variants.some((variant, index) =>
      variant.id !== workset.allowed_artifact_policy_variants[index]
    )
  ) {
    throw new TypeError("author Artifact policy eligibility does not match its workset");
  }
  const currentFinalAuthority = finalAuthority(input.authority);
  const selectedFactRefs = dependencyView.positive_nodes.flatMap((node) =>
    node.kind === "selected-fact" ? [node.fact_ref] : []
  );
  const enrichment = input.enrichment ?? { inspector_materializations: [], fragments: [] };
  const request = buildIndexerMainRunRequest({
    workset,
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: currentFinalAuthority.layer_ref,
      fragments: enrichment.fragments,
    }),
    final_authority: currentFinalAuthority,
    run_environment: runEnvironment({
      workset,
      binding: input.binding,
      authority: input.authority,
      dependency_view: dependencyView,
    }),
  });
  const selectedPaths = new Set(dependencyView.positive_nodes.flatMap((node) =>
    node.kind === "source-span" && node.source_ref === input.binding.source_ref &&
        node.module_ref === input.binding.module_ref
      ? [node.locator.path]
      : []
  ));
  const selectedFacts = new Set(selectedFactRefs);
  const selectedIdentityFiles = input.binding.source_identity_inventory.files.flatMap((file) =>
    selectedPaths.has(file.normalized_path)
      ? [{
          ...file,
          facts: file.facts.filter((fact) => selectedFacts.has(fact.fact_ref)),
        }]
      : []
  );
  if (selectedIdentityFiles.length === 0) {
    throw new TypeError(
      `author group ${workset.indexer_id}/${workset.group_key} has no source identity files for its selected source spans`,
    );
  }
  const sourceIdentityInventory = buildIndexerSourceIdentityInventory({
    source_ref: input.binding.source_identity_inventory.source_ref,
    module_ref: input.binding.source_identity_inventory.module_ref,
    source_input_digest: workset.source_binding_digest,
    files: selectedIdentityFiles,
  });
  const artifactIntents = allowedArtifactIntents({
    authority: input.authority,
    eligibility,
    sourceRole: request.run_environment.source_role,
  });
  return normalizeRunSpec({
    protocol: "context.indexer.main-run-spec/v1",
    request,
    validation: {
      stage: "author",
      dependency_view: dependencyView,
      canonical_inventory_members: canonicalInventory,
      expected_subject_key: input.expected_subject_key,
      artifact_policy_eligibility: eligibility,
      allowed_artifact_intents: artifactIntents,
      allowed_source_roles: [request.run_environment.source_role],
      authorized_evidence_targets: projectIndexerReadTargets({
        registry: input.registry,
        indexer_id: workset.indexer_id,
      }),
      source_identity_inventory: sourceIdentityInventory,
      allowed_question_targets: [...input.allowed_question_targets],
      inspector_materializations: enrichment.inspector_materializations,
      supplementary_sources: canonicalProjectIndexerSupplementarySources(
        input.supplementary_sources ?? [],
      ),
    },
  });
}
