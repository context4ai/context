import {
  buildIndexerAuthorDependencyView,
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDependencyNodeRef,
  indexerInventoryMembersDigest,
  indexerPartitionGroupProjectionDigest,
  indexerProtocolDigest,
  type IndexerAuthorDependencyView,
  type IndexerInventoryMember,
  type IndexerParserFact,
  type IndexerPartitionPlan,
} from "@c4a/context";
import type {
  ProjectIndexerCapturedDocumentsSourceBinding,
  ProjectIndexerMainSourceBinding,
  ProjectIndexerParserFactsSourceBinding,
} from "./indexerMainSourceAdapter.js";
import type { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";
import { capturedDocumentIndexerRef } from "./indexerWorksetEvidenceProjection.js";
import type { IndexerConsumerWorksetProjection } from "./indexerConsumerWorksetPlanner.js";

type CompletePartitionPlan = Extract<IndexerPartitionPlan, { status: "complete" }>;
type PartitionGroup = CompletePartitionPlan["groups"][number];
type CurrentPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

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
  authority: CurrentPrimaryAuthority;
  binding: ProjectIndexerParserFactsSourceBinding;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
  members: IndexerInventoryMember[];
  parser_projection?: IndexerConsumerWorksetProjection;
}): IndexerAuthorDependencyView {
  const fileByRef = new Map(input.binding.parser_fact_view.files.map((file) => [
    file.file_ref,
    file,
  ]));
  const selectedFacts = new Map<string, IndexerParserFact>();
  const unrepresentedFiles = new Map<string, string>();
  const ownedMemberIds = new Set(input.members.map((member) => member.member_id));
  if (input.parser_projection === undefined) {
    throw new TypeError("Author dependency view requires its Partition consumer projection");
  }
  const projectedFactRefs = new Set(input.parser_projection.fact_items.map((item) => item.fact_ref));
  for (const factRef of projectedFactRefs) {
    const projected = input.binding.parser_fact_index.get(factRef)?.fact;
    if (projected === undefined) {
      throw new TypeError(`author group references unknown projected Fact ${factRef}`);
    }
    selectedFacts.set(projected.fact_ref, projected);
  }
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
    if (file.disposition !== "analyzed") {
      // A parser may deliberately classify a file as unsupported or catalog-only.
      // The Author stage still needs its source identity so it can account for the
      // member without inventing parser facts or publishing unsupported content.
      unrepresentedFiles.set(member.member_id, file.normalized_path);
      continue;
    }
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
  authority: CurrentPrimaryAuthority;
  binding: ProjectIndexerMainSourceBinding;
  plan: CompletePartitionPlan;
  group: PartitionGroup;
  members: IndexerInventoryMember[];
  parser_projection?: IndexerConsumerWorksetProjection;
}): IndexerAuthorDependencyView {
  return input.binding.adapter === "parser-facts"
    ? parserDependencyView({ ...input, binding: input.binding })
    : documentDependencyView({ ...input, binding: input.binding });
}

export function buildProjectIndexerAuthorDependencyView(inputView: {
  primary_binding: ProjectIndexerMainSourceBinding;
  synthetic_plan: CompletePartitionPlan;
  synthetic_group: PartitionGroup;
  synthetic_members: readonly IndexerInventoryMember[];
  origins: readonly Parameters<typeof dependencyView>[0][];
}): IndexerAuthorDependencyView {
  const positiveByRef = new Map<string, IndexerAuthorDependencyView["positive_nodes"][number]>();
  const negativeByRef = new Map<string, IndexerAuthorDependencyView["negative_nodes"][number]>();
  for (const origin of inputView.origins) {
    const view = dependencyView(origin);
    for (const node of view.positive_nodes) {
      if (node.kind === "logical-unit") continue;
      const previous = positiveByRef.get(node.node_ref);
      if (previous !== undefined && canonicalIndexerJson(previous) !== canonicalIndexerJson(node)) {
        throw new TypeError(`dependency node ${node.node_ref} has conflicting source projections`);
      }
      positiveByRef.set(node.node_ref, node);
    }
    for (const node of view.negative_nodes) {
      if (node.kind === "group-input-set") continue;
      const previous = negativeByRef.get(node.node_ref);
      if (previous !== undefined && canonicalIndexerJson(previous) !== canonicalIndexerJson(node)) {
        throw new TypeError(`dependency node ${node.node_ref} has conflicting negative projections`);
      }
      negativeByRef.set(node.node_ref, node);
    }
  }
  const withoutNodeRef = (node: { node_ref: string; [key: string]: unknown }) =>
    Object.fromEntries(Object.entries(node).filter(([key]) => key !== "node_ref"));
  return buildIndexerAuthorDependencyView({
    source_ref: inputView.primary_binding.source_ref,
    module_ref: inputView.primary_binding.module_ref,
    logical_unit_ref: inputView.synthetic_group.logical_unit_ref,
    positive_nodes: [
      ...[...positiveByRef.values()].map(withoutNodeRef),
      {
        kind: "logical-unit",
        logical_unit_ref: inputView.synthetic_group.logical_unit_ref,
        group_projection_digest: indexerPartitionGroupProjectionDigest(
          inputView.synthetic_plan,
          inputView.synthetic_group.group_key,
        ),
        targets: [{ level: "logical-unit" }],
      },
    ],
    negative_nodes: [
      ...[...negativeByRef.values()].map(withoutNodeRef),
      {
        kind: "group-input-set",
        scope_ref: inputView.synthetic_group.logical_unit_ref,
        set_digest: indexerInventoryMembersDigest(inputView.synthetic_members),
        targets: [{ level: "logical-unit" }],
      },
    ],
  });
}
