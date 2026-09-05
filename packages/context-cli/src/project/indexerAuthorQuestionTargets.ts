import {
  compareIndexerCanonicalText,
  indexerMaterialQuestionKey,
  indexerPartitionGroupRef,
  indexerResolvedMaterialQuestionDigest,
  ownerCells,
  validateIndexerTargetResolutionView,
  type IndexerPartitionPlan,
  type IndexerQuestionTargetInventory,
  type IndexerRegistry,
  type IndexerTargetResolutionView,
} from "@c4a/context";
import type { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";

type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
type PartitionGroup = CompletePartitionPlan["groups"][number];
type CurrentPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

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

export function resolveProjectIndexerAuthorQuestionTargets(input: {
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

export function takeProjectIndexerGroupTargetView(input: {
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
