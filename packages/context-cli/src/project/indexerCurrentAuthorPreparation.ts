import {
  buildIndexerAuthorDependencyView,
  buildIndexerMainAuthorWorksets,
  canonicalIndexerInventoryMembers,
  compareIndexerCanonicalText,
  indexerDependencyNodeRef,
  indexerInventoryMembersDigest,
  indexerMaterialQuestionKey,
  indexerPartitionGroupProjectionDigest,
  indexerPartitionGroupRef,
  indexerProtocolDigest,
  indexerResolvedMaterialQuestionDigest,
  ownerCells,
  resolveIndexerArtifactPolicyEligibility,
  validateIndexerPartitionInputs,
  validateIndexerQuestionTargetInventory,
  validateIndexerTargetResolutionView,
  type IndexerAuthorDependencyView,
  type IndexerInventoryMember,
  type IndexerParserFact,
  type IndexerPartitionPlan,
  type IndexerPartitionValidationInput,
  type IndexerQuestionTargetInventory,
  type IndexerRegistry,
  type IndexerTargetResolutionView,
} from "@c4a/context";
import {
  assertProjectIndexerMainSourceBinding,
  resolveProjectIndexerMainSourceBinding,
  type ProjectIndexerCapturedDocumentsSourceBinding,
  type ProjectIndexerMainSourceBinding,
  type ProjectIndexerParserFactsSourceBinding,
} from "./indexerMainSourceAdapter.js";
import { capturedDocumentIndexerRef } from "./indexerWorksetEvidenceProjection.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { buildCurrentProjectIndexerAuthorRunSpec } from
  "./indexerCurrentMainRunSpec.js";

type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
type PartitionGroup = CompletePartitionPlan["groups"][number];
type CurrentPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

function artifactLogicalUnit(input: {
  authority: CurrentPrimaryAuthority;
  partition_unit_type: string;
}) {
  const candidates = (input.authority.manifest.provides.logical_units ?? []).filter((unit) =>
    unit.artifacts !== undefined
  );
  const exact = candidates.find((unit) => unit.id === input.partition_unit_type);
  if (exact !== undefined) return exact;
  if (candidates.length === 1) return candidates[0]!;
  throw new TypeError(
    `Provider cannot uniquely map partition unit ${input.partition_unit_type} to an Artifact policy`,
  );
}

export interface ProjectIndexerTargetResolutionViewBinding {
  group_ref: string;
  view: IndexerTargetResolutionView;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function relationSourceSymbols(input: {
  file: ProjectIndexerParserFactsSourceBinding["parser_fact_view"]["files"][number];
  relation: IndexerParserFact;
}): IndexerParserFact[] {
  const payload = jsonObject(input.relation.payload);
  if (typeof payload.from !== "string" || payload.from.length === 0) return [];
  const candidates = input.file.facts.filter((fact) => {
    if (fact.kind !== "code-symbol") return false;
    return jsonObject(fact.payload).name === payload.from;
  });
  const line = positiveInteger(payload.line);
  if (line === null) return candidates;
  const containing = candidates.filter((fact) => {
    const symbol = jsonObject(fact.payload);
    const start = positiveInteger(symbol.line);
    const end = positiveInteger(symbol.endLine) ?? positiveInteger(symbol.end_line);
    return start !== null && end !== null && start <= line && end >= line;
  });
  return containing.length > 0 ? containing : candidates;
}

export function selectProjectIndexerAuthorRelationFacts(input: {
  files: ProjectIndexerParserFactsSourceBinding["parser_fact_view"]["files"];
  owned_member_ids: ReadonlySet<string>;
}): IndexerParserFact[] {
  const selected = new Map<string, IndexerParserFact>();
  for (const file of input.files) {
    for (const fact of file.facts) {
      if (fact.kind !== "code-relation") continue;
      const payload = jsonObject(fact.payload);
      const from = typeof payload.from === "string" ? payload.from : null;
      if (from === file.normalized_path) {
        if (input.owned_member_ids.has(file.file_ref)) selected.set(fact.fact_ref, fact);
        continue;
      }
      const sourceSymbols = relationSourceSymbols({ file, relation: fact });
      if (
        sourceSymbols.length > 0 &&
        sourceSymbols.every((symbol) => input.owned_member_ids.has(symbol.fact_ref))
      ) {
        selected.set(fact.fact_ref, fact);
      }
    }
  }
  return [...selected.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
}

export function parseProjectIndexerTargetResolutionViewBindings(
  values: readonly unknown[],
): ProjectIndexerTargetResolutionViewBinding[] {
  const bindings = values.map((candidate) => {
    const item = object(candidate, "target resolution view binding");
    if (typeof item.group_ref !== "string" || item.group_ref.length === 0) {
      throw new TypeError("target resolution view binding.group_ref must be a string");
    }
    return {
      group_ref: item.group_ref,
      view: validateIndexerTargetResolutionView(item.view),
    };
  }).sort((left, right) => compareIndexerCanonicalText(left.group_ref, right.group_ref));
  if (new Set(bindings.map((item) => item.group_ref)).size !== bindings.length) {
    throw new TypeError("target resolution view bindings must have unique group refs");
  }
  return bindings;
}

function groupMembers(input: {
  partition: IndexerPartitionValidationInput;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
}): IndexerInventoryMember[] {
  const inventoryById = new Map(input.partition.canonical_inventory_members.map((member) => [
    member.member_id,
    member,
  ]));
  return canonicalIndexerInventoryMembers(input.group.member_ids.map((memberId) => {
    const member = inventoryById.get(memberId);
    if (member === undefined) {
      throw new TypeError(`partition group references unknown inventory member ${memberId}`);
    }
    const disposition = input.plan.member_dispositions.find((candidate) =>
      candidate.member_id === memberId
    );
    if (
      disposition?.inventory_disposition !== "owned" ||
      disposition.group_key !== input.group.group_key
    ) {
      throw new TypeError(`partition group does not own inventory member ${memberId}`);
    }
    return member;
  }));
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function factLines(input: {
  fact: IndexerParserFact;
  binding: ProjectIndexerParserFactsSourceBinding;
}): { start_line: number; end_line: number } {
  const payload = jsonObject(input.fact.payload);
  const start = positiveInteger(payload.line) ?? positiveInteger(payload.start_line);
  const explicitEnd = positiveInteger(payload.endLine) ?? positiveInteger(payload.end_line);
  if (start !== null) {
    return {
      start_line: start,
      end_line: explicitEnd !== null && explicitEnd >= start ? explicitEnd : start,
    };
  }
  const file = input.binding.parser_fact_view.files.find((candidate) =>
    candidate.normalized_path === input.fact.locator.normalized_path
  );
  const lineCount = file?.facts.flatMap((candidate) => {
    const candidatePayload = candidate.payload !== null &&
        typeof candidate.payload === "object" &&
        !Array.isArray(candidate.payload)
      ? candidate.payload as Record<string, unknown>
      : {};
    const lines = positiveInteger(candidatePayload.lines);
    return lines === null ? [] : [lines];
  }).sort((left, right) => right - left)[0] ?? 1;
  return { start_line: 1, end_line: lineCount };
}

function sourceContentDigest(input: {
  binding: ProjectIndexerMainSourceBinding;
  path: string;
}): string {
  const sourceFile = input.binding.source_identity_inventory.files.find((file) =>
    file.normalized_path === input.path
  );
  if (sourceFile === undefined) {
    throw new TypeError(`source identity inventory is missing ${input.path}`);
  }
  return sourceFile.content_digest;
}

function parserEvidenceRef(factRef: string): string {
  return `evidence:${indexerProtocolDigest({ fact_ref: factRef })}`;
}

function memberEvidenceRef(memberId: string): string {
  return `evidence:${indexerProtocolDigest({ member_id: memberId })}`;
}

function authorFact(input: {
  fact: IndexerParserFact;
  subject_key: PartitionGroup["subject_key"];
  evidence_ref: string;
}) {
  return {
    fact_ref: input.fact.fact_ref,
    fact_kind: input.fact.kind,
    subject_key: input.subject_key,
    value: input.fact.payload,
    evidence_refs: [input.evidence_ref],
  };
}

function parserDependencyView(input: {
  binding: ProjectIndexerParserFactsSourceBinding;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
  members: IndexerInventoryMember[];
}): IndexerAuthorDependencyView {
  const fileByRef = new Map(input.binding.parser_fact_view.files.map((file) => [
    file.file_ref,
    file,
  ]));
  const selectedFacts = new Map<string, IndexerParserFact>();
  const unrepresentedFiles = new Map<string, string>();
  const ownedMemberIds = new Set(input.members.map((member) => member.member_id));
  for (const member of input.members) {
    const direct = input.binding.parser_fact_index.get(member.member_id)?.fact;
    if (direct !== undefined) {
      selectedFacts.set(direct.fact_ref, direct);
      continue;
    }
    const file = fileByRef.get(member.member_id);
    if (file === undefined) {
      throw new TypeError(`author group references unknown parser member ${member.member_id}`);
    }
    if (file.disposition !== "analyzed") continue;
    const identityFact = file.facts.find((fact) => fact.kind === "source-file") ??
      file.facts.find((fact) => fact.kind === "source-loc");
    if (identityFact === undefined) {
      unrepresentedFiles.set(member.member_id, file.normalized_path);
    } else {
      selectedFacts.set(identityFact.fact_ref, identityFact);
    }
  }
  for (const relation of selectProjectIndexerAuthorRelationFacts({
    files: input.binding.parser_fact_view.files,
    owned_member_ids: ownedMemberIds,
  })) {
    selectedFacts.set(relation.fact_ref, relation);
  }
  const facts = [...selectedFacts.values()].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
  const sourceSpans = facts.map((fact) => ({
    kind: "source-span" as const,
    evidence_ref: parserEvidenceRef(fact.fact_ref),
    source_ref: fact.locator.source_ref,
    module_ref: fact.locator.module_ref,
    locator: {
      path: fact.locator.normalized_path,
      ...factLines({ fact, binding: input.binding }),
    },
    content_digest: sourceContentDigest({
      binding: input.binding,
      path: fact.locator.normalized_path,
    }),
    targets: [],
  }));
  const rawFileSpans = [...unrepresentedFiles.entries()].map(([memberId, path]) => ({
    kind: "source-span" as const,
    evidence_ref: memberEvidenceRef(memberId),
    source_ref: input.binding.source_ref,
    module_ref: input.binding.module_ref,
    locator: { path, start_line: 1, end_line: 1 },
    content_digest: sourceContentDigest({ binding: input.binding, path }),
    targets: [],
  }));
  const spanRefByEvidence = new Map([...sourceSpans, ...rawFileSpans].map((span) => [
    span.evidence_ref,
    indexerDependencyNodeRef({ polarity: "positive", node: span }),
  ]));
  const selectedFactNodes = facts.map((fact) => {
    const evidenceRef = parserEvidenceRef(fact.fact_ref);
    return {
      kind: "selected-fact" as const,
      fact_ref: fact.fact_ref,
      fact_digest: indexerProtocolDigest(authorFact({
        fact,
        subject_key: input.group.subject_key,
        evidence_ref: evidenceRef,
      })),
      source_span_node_refs: [spanRefByEvidence.get(evidenceRef)!],
      targets: [],
    };
  });
  return buildIndexerAuthorDependencyView({
    source_ref: input.binding.source_ref,
    module_ref: input.binding.module_ref,
    logical_unit_ref: input.group.logical_unit_ref,
    positive_nodes: [...sourceSpans, ...rawFileSpans, ...selectedFactNodes, {
      kind: "logical-unit",
      logical_unit_ref: input.group.logical_unit_ref,
      group_projection_digest: indexerPartitionGroupProjectionDigest(
        input.plan,
        input.group.group_key,
      ),
      targets: [{ level: "logical-unit" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: input.group.logical_unit_ref,
      set_digest: indexerInventoryMembersDigest(input.members),
      targets: [{ level: "logical-unit" }],
    }],
  });
}

function documentDependencyView(input: {
  binding: ProjectIndexerCapturedDocumentsSourceBinding;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
  members: IndexerInventoryMember[];
}): IndexerAuthorDependencyView {
  const documentByMember = new Map(input.binding.evidence.index.documents.map((document) => [
    capturedDocumentIndexerRef({
      source_ref: input.binding.source_ref,
      path: document.path,
    }),
    document,
  ]));
  const sourceSpans = input.members.map((member) => {
    if (member.member_kind !== "document") {
      throw new TypeError("captured-document author group contains a non-document member");
    }
    const document = documentByMember.get(member.member_id);
    if (document === undefined) {
      throw new TypeError(`author group references unknown document ${member.member_id}`);
    }
    return {
      kind: "source-span" as const,
      evidence_ref: memberEvidenceRef(member.member_id),
      source_ref: input.binding.source_ref,
      module_ref: null,
      locator: {
        path: document.path,
        start_line: 1,
        end_line: Math.max(1, document.line_count),
      },
      content_digest: document.content_hash,
      targets: [],
    };
  });
  return buildIndexerAuthorDependencyView({
    source_ref: input.binding.source_ref,
    module_ref: null,
    logical_unit_ref: input.group.logical_unit_ref,
    positive_nodes: [...sourceSpans, {
      kind: "logical-unit",
      logical_unit_ref: input.group.logical_unit_ref,
      group_projection_digest: indexerPartitionGroupProjectionDigest(
        input.plan,
        input.group.group_key,
      ),
      targets: [{ level: "logical-unit" }],
    }],
    negative_nodes: [{
      kind: "group-input-set",
      scope_ref: input.group.logical_unit_ref,
      set_digest: indexerInventoryMembersDigest(input.members),
      targets: [{ level: "logical-unit" }],
    }],
  });
}

function dependencyView(input: {
  binding: ProjectIndexerMainSourceBinding;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
  members: IndexerInventoryMember[];
}): IndexerAuthorDependencyView {
  return input.binding.adapter === "parser-facts"
    ? parserDependencyView({ ...input, binding: input.binding })
    : documentDependencyView({ ...input, binding: input.binding });
}

function resolvedQuestionDigest(input: {
  authority: CurrentPrimaryAuthority;
  question_ref: string;
}): {
  question_ref: string;
  contract_digest: string;
  coverage_domain: string;
  target_domain_ref: string;
} {
  const question = input.authority.profile.reader_question_contracts.find((candidate) =>
    candidate.ref === input.question_ref
  );
  if (question === undefined) {
    throw new TypeError(`partition group references unknown reader question ${input.question_ref}`);
  }
  const authority = {
    kind: "cli-base-contract" as const,
    ref: `profile:${input.authority.profile.id}/${input.authority.profile_contract.version}`,
    digest: input.authority.profile_contract.contract_digest,
  };
  const payload = {
    ref: question.ref,
    authority,
    contract_version: question.version,
    semantic: question.semantic,
    coverage_domain: question.coverage_domain,
    target_domain_ref: question.target_domain_ref,
    target_selector: question.target_selector,
    evidence_contract: question.evidence_contract,
    ...(question.allowed_exclusion_reason_codes === undefined
      ? {}
      : { allowed_exclusion_reason_codes: question.allowed_exclusion_reason_codes }),
  };
  return {
    question_ref: question.ref,
    contract_digest: indexerResolvedMaterialQuestionDigest(payload),
    coverage_domain: question.coverage_domain,
    target_domain_ref: question.target_domain_ref,
  };
}

export function projectIndexerPrimaryCarrierQuestionTargetRefs(
  bindings: readonly {
    target_ref: string;
    role: "primary-carrier" | "enricher";
  }[],
): string[] {
  return bindings
    .filter((binding) => binding.role === "primary-carrier")
    .map((binding) => binding.target_ref);
}

function allowedQuestionTargets(input: {
  registry: IndexerRegistry;
  inventory: IndexerQuestionTargetInventory;
  authority: CurrentPrimaryAuthority;
  group: PartitionGroup;
}): Array<{ question_target_key: string; question_ref: string }> {
  const targetByRef = new Map(input.inventory.items.map((item) => [item.target_ref, item]));
  const ownerByRef = new Map(ownerCells(input.registry).map((owner) => [
    owner.owner_cell_ref,
    owner,
  ]));
  const questions = input.group.reader_question_refs.map((questionRef) =>
    resolvedQuestionDigest({ authority: input.authority, question_ref: questionRef })
  );
  const primaryTargetRefs = projectIndexerPrimaryCarrierQuestionTargetRefs(
    input.group.question_target_bindings,
  );
  const result = primaryTargetRefs.flatMap((targetRef) => {
    const target = targetByRef.get(targetRef);
    if (target === undefined) {
      throw new TypeError(`partition group references unknown question target ${targetRef}`);
    }
    const owner = ownerByRef.get(target.owner_cell_ref);
    if (owner === undefined) {
      throw new TypeError(`question target references unknown owner ${target.owner_cell_ref}`);
    }
    return questions.flatMap((question) =>
      question.coverage_domain === owner.coverage_domain &&
        question.target_domain_ref === target.target_domain_ref
        ? [{
            question_target_key: indexerMaterialQuestionKey({
              owner_cell_ref: target.owner_cell_ref,
              question_contract_digest: question.contract_digest,
              question_subject_target_ref: target.target_ref,
            }),
            question_ref: question.question_ref,
          }]
        : []
    );
  }).sort((left, right) =>
    compareIndexerCanonicalText(left.question_target_key, right.question_target_key)
  );
  if (new Set(result.map((item) => item.question_target_key)).size !== result.length) {
    throw new TypeError("author question target authority contains duplicate keys");
  }
  return result;
}

function targetViewForGroup(input: {
  views: Map<string, IndexerTargetResolutionView>;
  partition_workset_digest: string;
  group: PartitionGroup;
}): IndexerTargetResolutionView | undefined {
  const groupRef = indexerPartitionGroupRef({
    partition_workset_digest: input.partition_workset_digest,
    group_key: input.group.group_key,
  });
  const view = input.views.get(groupRef);
  if (input.group.subject_intent === "primary") {
    if (view !== undefined) {
      throw new TypeError("primary partition group must not receive a TargetResolutionView");
    }
    return undefined;
  }
  if (view === undefined) {
    throw new TypeError("enrich-or-independent group requires a TargetResolutionView");
  }
  input.views.delete(groupRef);
  return view;
}

export async function prepareCurrentProjectIndexerAuthorRuns(input: {
  projectRoot: string;
  registry: IndexerRegistry;
  partitions: readonly IndexerPartitionValidationInput[];
  question_target_inventory: unknown;
  target_resolution_views: readonly ProjectIndexerTargetResolutionViewBinding[];
}) {
  const inventory = validateIndexerQuestionTargetInventory(input.question_target_inventory);
  const partitions = validateIndexerPartitionInputs(input.partitions);
  const views = new Map(input.target_resolution_views.map((binding) => [
    binding.group_ref,
    binding.view,
  ]));
  if (views.size !== input.target_resolution_views.length) {
    throw new TypeError("target resolution view bindings must have unique group refs");
  }
  const authorityByIndexer = new Map<string, CurrentPrimaryAuthority>();
  const bindingByPartition = new Map<string, ProjectIndexerMainSourceBinding>();
  for (const partition of partitions) {
    if (partition.plan.status !== "complete") {
      throw new TypeError("failed PartitionPlan cannot produce author worksets");
    }
    if (
      partition.workset.question_target_inventory_digest !== inventory.inventory_digest ||
      partition.workset.requirement_set_digest !== inventory.requirement_set_digest
    ) {
      throw new TypeError("author workset input targets a stale question inventory");
    }
    let authority = authorityByIndexer.get(partition.workset.indexer_id);
    if (authority === undefined) {
      authority = await resolveCurrentProjectIndexerPrimaryAuthority({
        registry: input.registry,
        indexer_id: partition.workset.indexer_id,
      });
      authorityByIndexer.set(partition.workset.indexer_id, authority);
    }
    const binding = await resolveProjectIndexerMainSourceBinding({
      projectRoot: input.projectRoot,
      indexer_id: partition.workset.indexer_id,
      source_ref: partition.workset.source_ref,
      module_ref: partition.workset.module_ref,
      profile_contract_digest: partition.workset.profile_contract_digest,
    });
    assertProjectIndexerMainSourceBinding({ workset: partition.workset, binding });
    bindingByPartition.set(partition.workset.workset_digest, binding);
  }

  const preparations = partitions.flatMap((partition) => {
    if (partition.plan.status !== "complete") return [];
    const plan = partition.plan;
    const authority = authorityByIndexer.get(partition.workset.indexer_id)!;
    const binding = bindingByPartition.get(partition.workset.workset_digest)!;
    const logicalUnit = artifactLogicalUnit({
      authority,
      partition_unit_type: plan.unit_type,
    });
    const artifactPolicy = logicalUnit.artifacts;
    if (artifactPolicy === undefined) {
      throw new TypeError("Author logical unit requires an Artifact policy");
    }
    const eligibility = resolveIndexerArtifactPolicyEligibility({
      profile_id: authority.profile.id,
      canonical_facts: { target: { eligible: true } },
      provider_supported_variants: artifactPolicy.supported_policy_variants,
      profile_contract: authority.profile_contract,
      operator_contract: authority.operator_contract,
    });
    return plan.groups.map((group) => {
      const members = groupMembers({
        partition: input.partitions.find((candidate) =>
          candidate.workset.workset_digest === partition.workset.workset_digest
        )!,
        plan,
        group,
      });
      const view = dependencyView({ binding, plan, group, members });
      const targetResolutionView = targetViewForGroup({
        views,
        partition_workset_digest: partition.workset.workset_digest,
        group,
      });
      return {
        partition,
        authority,
        binding,
        group,
        members,
        dependency_view: view,
        eligibility,
        allowed_question_targets: allowedQuestionTargets({
          registry: input.registry,
          inventory,
          authority,
          group,
        }),
        group_context: {
          partition_workset_digest: partition.workset.workset_digest,
          group_key: group.group_key,
          group_dependency_view_digest: view.view_digest,
          allowed_artifact_policy_variants: eligibility.eligible_variants.map((variant) =>
            variant.id
          ),
          artifact_policy_eligibility_digest: eligibility.eligibility_digest,
          ...(targetResolutionView === undefined
            ? {}
            : { target_resolution_view: targetResolutionView }),
        },
      };
    });
  });
  if (views.size > 0) {
    throw new TypeError("target resolution views contain unknown partition groups");
  }
  const built = buildIndexerMainAuthorWorksets({
    partitions: input.partitions,
    group_contexts: preparations.map((item) => item.group_context),
  });
  const groupIdentity = (value: {
    indexer_id: string;
    requirement_ref: string;
    source_ref: string;
    module_ref: string | null;
    group_key: string;
  }) => [
    value.indexer_id,
    value.requirement_ref,
    value.source_ref,
    value.module_ref ?? "",
    value.group_key,
  ].join("\u0000");
  const preparationByGroup = new Map(preparations.map((item) => [
    groupIdentity({
      indexer_id: item.partition.workset.indexer_id,
      requirement_ref: item.partition.workset.requirement_ref,
      source_ref: item.partition.workset.source_ref,
      module_ref: item.partition.workset.module_ref,
      group_key: item.group.group_key,
    }),
    item,
  ]));
  if (preparationByGroup.size !== preparations.length) {
    throw new TypeError("author preparation contains duplicate group identities");
  }
  const runSpecs = built.worksets.map((workset) => {
    const prepared = preparationByGroup.get(groupIdentity(workset));
    if (prepared === undefined) {
      throw new TypeError(`author run preparation is missing ${workset.group_key}`);
    }
    return buildCurrentProjectIndexerAuthorRunSpec({
      workset,
      binding: prepared.binding,
      authority: prepared.authority,
      registry: input.registry,
      dependency_view: prepared.dependency_view,
      canonical_inventory_members: prepared.members,
      expected_subject_key: prepared.group.subject_key,
      artifact_policy_eligibility: prepared.eligibility,
      allowed_question_targets: prepared.allowed_question_targets,
    });
  });
  return {
    requirement_set_digest: inventory.requirement_set_digest,
    ...built,
    run_specs: runSpecs,
  };
}
