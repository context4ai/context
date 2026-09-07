import { applySelectedPageTemplate, type IndexerPageTemplate } from "./indexerPageTemplate.js";
import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  compareIndexerCanonicalText,
  indexerArtifactResultDigest,
  indexerProtocolDigest,
  validateIndexerArtifactPolicyEligibilityReport,
  validateIndexerAuthorDependencyView,
  type IndexerArtifactFact,
  type IndexerArtifactResult,
  type IndexerAuthorizedWorksetView,
  type IndexerAuthorSemanticInput,
  type IndexerInventoryMember,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
  type IndexerSubjectKey,
} from "@c4a/context";
import { renderMarkdownSection } from "./markdownPageTitle.js";
import { buildIndexerAuthorSourceItems, resolveIndexerAuthorSourceItems } from "./indexerAuthorSourceItems.js";

type AuthorValidation = {
  page_template?: IndexerPageTemplate;
  page_plan?: { artifact_intent?: string; template_id?: string };
  dependency_view: unknown;
  expected_subject_key: unknown;
  artifact_policy_eligibility: unknown;
  allowed_source_roles: readonly string[];
  allowed_artifact_intents: readonly {
    source_role: string;
    document_kind: string;
    reader_goal: string;
    artifact_kind: string;
  }[];
  canonical_inventory_members: readonly IndexerInventoryMember[];
  allowed_question_targets: readonly {
    question_target_key: string;
    question_ref: string;
  }[];
};

type IndexerEvidenceBinding = IndexerArtifactResult["evidence_bindings"][number];

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareIndexerCanonicalText);
}

function aliasMap(entries: readonly { canonical: string; aliases: readonly string[] }[]) {
  const aliases = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of entries) {
    for (const alias of [entry.canonical, ...entry.aliases]) {
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== entry.canonical) ambiguous.add(alias);
      else aliases.set(alias, entry.canonical);
    }
  }
  for (const alias of ambiguous) aliases.delete(alias);
  return aliases;
}

function resolveAlias(aliases: ReadonlyMap<string, string>, value: string, label: string): string {
  const result = aliases.get(value);
  if (result === undefined) throw new TypeError(`${label} is not authorized: ${value}`);
  return result;
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "content";
}

function isAuthorizedFactCategory(category: string): boolean {
  return category === "fact" || category === "consumer-anchor" ||
    category === "supporting-fact";
}

function factIndex(input: {
  dependencyView: ReturnType<typeof validateIndexerAuthorDependencyView>;
  view: IndexerAuthorizedWorksetView;
  subjectKey: IndexerSubjectKey;
  evidence: ReadonlyMap<string, IndexerEvidenceBinding>;
}) {
  const spanRef = new Map(input.dependencyView.positive_nodes.flatMap((node) =>
    node.kind === "source-span" ? [[node.node_ref, node.evidence_ref] as const] : []
  ));
  const selected = new Map(input.dependencyView.positive_nodes.flatMap((node) =>
    node.kind === "selected-fact" ? [[node.fact_ref, node] as const] : []
  ));
  const facts = new Map<string, IndexerArtifactFact>();
  const memberFacts = new Map<string, Set<string>>();
  const aliases: Array<{ canonical: string; aliases: string[] }> = [];
  for (const item of input.view.items) {
    if (!isAuthorizedFactCategory(item.category)) continue;
    const value = object(item.value, `fact ${item.ref}`);
    const factRef = typeof value.fact_ref === "string" ? value.fact_ref : item.ref;
    const node = selected.get(factRef);
    const sourceFactRefs = Array.isArray(value.source_fact_refs)
      ? value.source_fact_refs.map((ref) => String(ref))
      : [];
    if (node === undefined && sourceFactRefs.length === 0) continue;
    const resolvedEvidenceRefs = (node === undefined
      ? sourceFactRefs.flatMap((sourceFactRef) => {
          const sourceNode = selected.get(sourceFactRef);
          if (sourceNode === undefined) {
            throw new TypeError(`fact ${factRef} references unavailable source fact ${sourceFactRef}`);
          }
          return sourceNode.source_span_node_refs;
        })
      : node.source_span_node_refs).map((ref) => {
        const evidenceRef = spanRef.get(ref);
        if (evidenceRef === undefined || !input.evidence.has(evidenceRef)) {
          throw new TypeError(`fact ${factRef} has no authorized source span`);
        }
        return evidenceRef;
      });
    const evidenceRefs = [...new Set(resolvedEvidenceRefs)].sort(compareIndexerCanonicalText);
    facts.set(factRef, {
      fact_ref: factRef,
      fact_kind: typeof value.kind === "string" ? value.kind : "source-fact",
      subject_key: input.subjectKey,
      value: (value.payload ?? null) as IndexerArtifactFact["value"],
      evidence_refs: evidenceRefs,
    });
    // Parser members are exact Fact identities or file identities. Use the
    // authorized projection's container, never a path/name heuristic or every
    // Fact used elsewhere in the page. Provider-derived facts do not establish
    // a new inventory identity.
    if (node !== undefined) {
      for (const memberId of [factRef, item.provenance.container_ref]) {
        if (memberId === undefined) continue;
        const refs = memberFacts.get(memberId) ?? new Set<string>();
        refs.add(factRef);
        memberFacts.set(memberId, refs);
      }
    }
    const locator = object(value.locator ?? {}, `${factRef}.locator`);
    aliases.push({
      canonical: factRef,
      aliases: [item.ref, ...(typeof locator.qualified_item_path === "string"
        ? [locator.qualified_item_path]
        : [])],
    });
  }
  return { facts, aliases: aliasMap(aliases), memberFacts };
}

function chooseIntent(input: {
  semantic: IndexerAuthorSemanticInput;
  validation: AuthorValidation;
}) {
  const choices = input.validation.allowed_artifact_intents;
  const aliases = aliasMap(choices.map((intent) => ({
    canonical: [
      intent.source_role,
      intent.document_kind,
      intent.reader_goal,
      intent.artifact_kind,
    ].join("/"),
    aliases: [`intent:${intent.artifact_kind}`, intent.artifact_kind],
  })));
  const requested = input.semantic.artifact_intent ?? input.validation.page_plan?.artifact_intent;
  if (input.validation.page_plan?.artifact_intent !== undefined && requested !== input.validation.page_plan.artifact_intent) {
    throw new TypeError("author intent differs from the accepted page plan; revise the affected plan before changing its purpose");
  }
  const selected = requested === undefined
    ? choices.length === 1 ? choices[0] : undefined
    : choices.find((intent) => [
        intent.source_role,
        intent.document_kind,
        intent.reader_goal,
        intent.artifact_kind,
      ].join("/") === resolveAlias(aliases, requested!, "artifact intent"));
  if (selected === undefined) {
    throw new TypeError(`author output must choose one allowed artifact intent. Set artifact_intent from the current task's author-authority: ${choices.map((intent) => [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/")).join(", ")}`);
  }
  return selected;
}

export function buildIndexerAuthorRunResultFromSemantic(input: {
  request: IndexerMainRunRequest;
  view: IndexerAuthorizedWorksetView;
  semantic: IndexerAuthorSemanticInput;
  validation: AuthorValidation;
}): IndexerMainRunResult {
  if (input.request.workset.stage !== "author") {
    throw new TypeError("author semantic input requires the current author workset");
  }
  const workset = input.request.workset;
  if (input.semantic.group_key !== workset.group_key) {
    throw new TypeError("author semantic output belongs to another group");
  }
  // A missing source body need not correspond to a predeclared reader question.
  // Keep the existing task pending via the normal failed-task response instead
  // of committing an empty ArtifactResult or inventing question authority.
  if (input.semantic.outcome === "request-material" &&
      input.validation.allowed_question_targets.length === 0) {
    const gaps = input.semantic.material_gaps.map((gap) =>
      `${gap.question}${gap.source_hints.length ? ` (sources: ${gap.source_hints.join(", ")})` : ""}`
    );
    const details = gaps.length ? gaps : input.semantic.diagnostics.map((item) => item.message);
    throw new TypeError(`Author requested source material: ${details.join("; ") || "required source content is missing"}. This task remains pending; other accepted tasks are preserved. Read the current Source material and resubmit this task when the required content is available; do not invent a question target or restart collection/Partition.`);
  }
  const subjectKey = input.validation.expected_subject_key as IndexerSubjectKey;
  const dependencyView = validateIndexerAuthorDependencyView(input.validation.dependency_view);
  const evidence = buildIndexerAuthorSourceItems({ nodes: dependencyView.positive_nodes, view: input.view });
  const facts = factIndex({
    dependencyView,
    view: input.view,
    subjectKey,
    evidence: evidence.bindings,
  });
  const memberKinds = new Map(input.validation.canonical_inventory_members.map((member) => [
    member.member_id,
    member.member_kind,
  ]));
  const memberAliases = aliasMap(input.validation.canonical_inventory_members.map((member) => ({
    canonical: member.member_id,
    aliases: input.view.items.flatMap((item) => {
      if (item.category !== "inventory-member") return [];
      const value = object(item.value, `inventory ${item.ref}`);
      return value.member_id === member.member_id ? [item.ref] : [];
    }),
  })));
  const questionAliases = aliasMap(input.validation.allowed_question_targets.map((target, index) => ({
    canonical: target.question_target_key,
    aliases: [`question-target:${index + 1}`, target.question_ref],
  })));
  const targetResolutionAliases = input.request.workset.target_resolution_view === undefined
    ? new Map<string, string>()
    : aliasMap(input.request.workset.target_resolution_view.entries.map((entry, index) => ({
        canonical: entry.query_ref,
        aliases: [`target:${index + 1}`, `target-resolution:${index + 1}`],
      })));
  const resolvedSections = input.semantic.sections.map((section) => {
    const evidenceRefs = resolveIndexerAuthorSourceItems(evidence, section.source_items, `${section.key}.source_items`);
    const factRefs = uniqueSorted(section.facts.map((fact) =>
      resolveAlias(facts.aliases, fact, `${section.key}.facts`)
    ));
    const factEvidence = factRefs.flatMap((ref) => facts.facts.get(ref)?.evidence_refs ?? []);
    const allEvidence = [...new Set([...evidenceRefs, ...factEvidence])]
      .sort(compareIndexerCanonicalText);
    if (allEvidence.length === 0) throw new TypeError(`${section.key} has no source material`);
    return {
      semantic: section,
      evidenceRefs: allEvidence,
      factRefs,
      answers: uniqueSorted(section.answers.map((answer) =>
        resolveAlias(questionAliases, answer, `${section.key}.answers`)
      )),
    };
  });
  const catalogFacts = new Map<string, string[]>();
  for (const entry of input.semantic.member_dispositions) {
    if (entry.state !== "catalog-only") continue;
    const memberId = resolveAlias(memberAliases, entry.item, "member disposition");
    const refs = [...(facts.memberFacts.get(memberId) ?? [])].sort(compareIndexerCanonicalText);
    if (refs.length === 0) {
      throw new TypeError(`${entry.item} has no authorized catalog facts; use unsupported or request material instead`);
    }
    catalogFacts.set(memberId, refs);
  }
  const usedFacts = [...new Set([
    ...resolvedSections.flatMap((section) => section.factRefs),
    ...[...catalogFacts.values()].flat(),
  ])]
    .sort(compareIndexerCanonicalText);
  const usedEvidence = [...new Set([
    ...resolvedSections.flatMap((section) => section.evidenceRefs),
    ...usedFacts.flatMap((ref) => facts.facts.get(ref)!.evidence_refs),
  ])].sort(compareIndexerCanonicalText);
  const bindings = usedEvidence.map((ref) => evidence.bindings.get(ref)!);
  const artifactId = slug(`${subjectKey.namespace}-${subjectKey.local_key}`);
  const eligibility = validateIndexerArtifactPolicyEligibilityReport(
    input.validation.artifact_policy_eligibility,
  );
  const variant = input.semantic.policy === undefined
    ? eligibility.eligible_variants.length === 1
      ? eligibility.eligible_variants[0]
      : undefined
    : eligibility.eligible_variants.find((candidate) => candidate.id === input.semantic.policy);
  if (variant === undefined) throw new TypeError("author output must choose one eligible policy");
  const intent = input.semantic.outcome === "publish"
    ? chooseIntent({ semantic: input.semantic, validation: input.validation })
    : undefined;
  const artifacts: IndexerArtifactResult["artifacts"] = intent === undefined ? [] : [{
    artifact_id: artifactId,
    artifact_kind: intent.artifact_kind,
    artifact_policy_variant: variant.id,
    representation: "sections",
    sections: resolvedSections.map((section, index) => ({
      section_key: slug(section.semantic.key),
      owner_indexer_id: workset.indexer_id,
      document_kind: intent.document_kind,
      reader_goal: intent.reader_goal,
      artifact_kind: intent.artifact_kind,
      blocks: [{
        block_id: `${slug(section.semantic.key)}-prose`,
        layer: "semantic-prose",
        markdown: renderMarkdownSection({
          markdown: section.semantic.markdown,
          heading: section.semantic.heading,
          ...(index === 0 && input.semantic.title !== undefined
            ? { pageTitle: input.semantic.title } : {}),
          ...(index === 0 && input.semantic.summary !== undefined
            ? { summary: input.semantic.summary } : {}),
        }),
        evidence_refs: section.evidenceRefs,
      }],
    })),
  }];
  const pageMembers = new Set(input.semantic.member_dispositions.filter((entry) => entry.state === "covered")
    .map((entry) => resolveAlias(memberAliases, entry.item, "member disposition")));
  const templateFacts = input.validation.page_template === undefined || artifacts[0]?.representation !== "sections"
    ? [] : applySelectedPageTemplate({ artifact: artifacts[0], template: input.validation.page_template,
      semanticVariables: input.semantic.template_variables,
      facts: [...facts.facts.values()].filter((fact) => input.validation.canonical_inventory_members.some((member) =>
        pageMembers.has(member.member_id) && facts.memberFacts.get(member.member_id)?.has(fact.fact_ref))),
    });
  for (const fact of templateFacts) {
    facts.facts.set(fact.fact_ref, fact);
    if (!usedFacts.includes(fact.fact_ref)) usedFacts.push(fact.fact_ref);
    for (const ref of fact.evidence_refs) if (!usedEvidence.includes(ref)) {
      usedEvidence.push(ref); bindings.push(evidence.bindings.get(ref)!);
    }
  }
  usedFacts.sort(compareIndexerCanonicalText);
  usedEvidence.sort(compareIndexerCanonicalText);
  const memberDispositions = input.semantic.member_dispositions.map((entry) => {
    const memberId = resolveAlias(memberAliases, entry.item, "member disposition");
    const memberKind = memberKinds.get(memberId)!;
    if (entry.state === "covered" && input.semantic.outcome === "publish") {
      const section = resolvedSections.find((candidate) =>
        candidate.semantic.key === entry.section ||
        slug(candidate.semantic.key) === entry.section
      );
      if (section === undefined) throw new TypeError(`${entry.item} has no covered section`);
      return {
        member_id: memberId,
        member_kind: memberKind,
        inventory_disposition: "owned" as const,
        projection_disposition: "detailed" as const,
        section_evidence: [{
          artifact_id: artifactId,
          section_key: slug(section.semantic.key),
          evidence_refs: section.evidenceRefs,
        }],
      };
    }
    if (entry.state === "catalog-only") {
      return {
        member_id: memberId,
        member_kind: memberKind,
        inventory_disposition: "owned" as const,
        projection_disposition: "catalog-only" as const,
        fact_refs: catalogFacts.get(memberId)!,
      };
    }
    return {
      member_id: memberId,
      member_kind: memberKind,
      inventory_disposition: "unsupported" as const,
      missing_capabilities: [entry.reason_code ?? "authoring-not-supported"],
    };
  });
  const answered = new Map<string, string>();
  for (const section of resolvedSections) {
    const bindingDigest = evidence.bindings.get(section.evidenceRefs[0]!)!.binding_digest;
    for (const target of section.answers) {
      // Several sections may answer the same reader question. Keep one
      // coverage marker; this is not a conflicting write or a second approval.
      if (!answered.has(target)) answered.set(target, bindingDigest);
    }
  }
  const gapByTarget = new Map(input.semantic.material_gaps.map((gap) => [
    resolveAlias(questionAliases, gap.question, "material gap question"),
    gap,
  ]));
  const materialProposals = input.validation.allowed_question_targets.flatMap((target) => {
    if (answered.has(target.question_target_key)) return [];
    const gap = gapByTarget.get(target.question_target_key);
    if (gap === undefined) throw new TypeError(`question target is neither answered nor a material gap: ${target.question_target_key}`);
    const proposalRef = `proposal:${indexerProtocolDigest({
      workset_digest: workset.workset_digest,
      question_target_key: target.question_target_key,
      source_hints: gap.source_hints,
    })}`;
    return [{
      proposal_ref: proposalRef,
      requirement_ref: workset.requirement_ref,
      question_ref: target.question_ref,
      question_target_key: target.question_target_key,
      source_hints: gap.source_hints.length === 0 ? [workset.source_ref] : gap.source_hints,
    }];
  });
  const proposalByTarget = new Map(materialProposals.map((proposal) => [
    proposal.question_target_key,
    proposal,
  ]));
  const questionDispositions = input.validation.allowed_question_targets.map((target) => {
    const bindingDigest = answered.get(target.question_target_key);
    return bindingDigest === undefined
      ? {
          question_target_key: target.question_target_key,
          state: "material-gap" as const,
          material_question_proposal_ref: proposalByTarget.get(target.question_target_key)!
            .proposal_ref,
        }
      : {
          question_target_key: target.question_target_key,
          state: "answered" as const,
          evidence_binding_digest: bindingDigest,
        };
  });
  const targetDispositions: IndexerArtifactResult["logical_unit"]["target_resolution_dispositions"] = [];
  const targetView = workset.target_resolution_view;
  if (targetView !== undefined) {
    if (targetView.entries.length !== input.semantic.target_resolutions.length) {
      throw new TypeError("author target resolution count does not match the current View");
    }
    const semanticByQuery = new Map(input.semantic.target_resolutions.map((semantic) => [
      resolveAlias(targetResolutionAliases, semantic.target, "target resolution"),
      semantic,
    ]));
    if (semanticByQuery.size !== input.semantic.target_resolutions.length) {
      throw new TypeError("author target resolutions contain duplicate targets");
    }
    for (const entry of targetView.entries) {
      const semantic = semanticByQuery.get(entry.query_ref);
      if (semantic === undefined) {
        throw new TypeError("author target resolution is missing a current target");
      }
      if (semantic.disposition === "reuse-existing") {
        if (entry.state !== "resolved") throw new TypeError("cannot reuse an absent target");
        targetDispositions.push({
          query_ref: entry.query_ref,
          disposition: "reuse-existing",
          target_subject_key: entry.subject_key,
          target_node_ref: entry.node_ref,
        });
      } else if (semantic.disposition === "create-independent") {
        if (entry.state !== "absent") throw new TypeError("independent target requires an absent catalog result");
        targetDispositions.push({
          query_ref: entry.query_ref,
          disposition: "create-independent",
          subject_key: subjectKey,
          reason_code: semantic.reason_code ?? "catalog-target-absent",
          evidence_refs: usedEvidence,
        });
      } else {
        targetDispositions.push({
          query_ref: entry.query_ref,
          disposition: "request-material",
          missing_facts: [semantic.reason_code ?? "target-resolution"],
          source_hints: [workset.source_ref],
        });
      }
    }
  } else if (input.semantic.target_resolutions.length > 0) {
    throw new TypeError("primary author group must not return target resolutions");
  }
  const bundle = artifacts.length === 0 ? null : buildIndexerArtifactBundle({
    logical_unit_ref: workset.logical_unit_ref,
    artifact_policy_variant: variant.id,
    artifacts: [{
      artifact_id: artifactId,
      artifact_kind: artifacts[0]!.artifact_kind,
      purpose: variant.required_artifact_kinds.includes(artifacts[0]!.artifact_kind)
        ? "required"
        : "discretionary",
      reader_question_refs: uniqueSorted(
        input.validation.allowed_question_targets
          .filter((target) => answered.has(target.question_target_key))
          .map((target) => target.question_ref),
      ),
      evidence_refs: usedEvidence,
    }],
  });
  const payload: Omit<IndexerArtifactResult, "output_digest"> = {
    protocol: "context.indexer.artifact-result/v1",
    author_workset_digest: workset.workset_digest,
    partition_plan_binding_digest: workset.partition_plan_binding_digest,
    group_projection_digest: workset.group_projection_digest,
    indexer_id: workset.indexer_id,
    provider_layer_ref: input.request.final_authority.layer_ref,
    provider_integrity: input.request.final_authority.integrity,
    provider_bundle_digest: input.request.final_authority.bundle_digest,
    config_fingerprint: input.request.final_authority.config_fingerprint,
    customization_fingerprint: input.request.final_authority.customization_fingerprint,
    requirement_ref: workset.requirement_ref,
    source_ref: workset.source_ref,
    module_ref: workset.module_ref,
    source_role: input.request.run_environment.source_role,
    logical_unit: {
      group_key: workset.group_key,
      subject_key: subjectKey,
      logical_unit_ref: workset.logical_unit_ref,
      target_resolution_dispositions: targetDispositions,
    },
    capability_group_evidence: buildIndexerCapabilityGroupEvidence({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      member_ids: input.validation.canonical_inventory_members.map((member) => member.member_id),
      capability_groups: [],
    }),
    inventory_dispositions: buildIndexerInventoryDispositionSet({
      author_workset_digest: workset.workset_digest,
      group_projection_digest: workset.group_projection_digest,
      logical_unit_ref: workset.logical_unit_ref,
      dispositions: memberDispositions,
    }),
    facts: usedFacts.map((ref) => facts.facts.get(ref)!),
    evidence_bindings: bindings,
    artifacts,
    artifact_bundle: bundle,
    material_question_proposals: materialProposals,
    question_target_dispositions: questionDispositions,
    diagnostics: input.semantic.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.target === undefined ? {} : {
        target_ref: resolveAlias(questionAliases, diagnostic.target, "diagnostic target"),
      }),
    })),
    input_digest: input.request.execution_request_digest,
  };
  const result: IndexerArtifactResult = {
    ...payload,
    output_digest: indexerArtifactResultDigest(payload),
  };
  return {
    protocol: "context.indexer.run-result/v1",
    operation: "main-index",
    consumed_input_view_digest: input.request.composition_input.view_digest,
    result: {
      protocol: "context.indexer.main-result/v1",
      stage: "author",
      workset_digest: workset.workset_digest,
      execution_request_digest: input.request.execution_request_digest,
      result,
    },
  };
}
