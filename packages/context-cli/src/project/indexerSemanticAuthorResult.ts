import { articleReferenceResolver } from "./articleReferenceInput.js";
import { validateIndexerSourceIdentityInventory } from "@c4a/context";
import { renderVisualDecisions, visualResourcesFromView, removeConvertedVisualLinks } from "./visualSourceProcessing.js";
import { prepareAuthorArticles } from "./indexerAuthorArticles.js";
import { primaryIntentKey, resolvePrimaryArtifactIntent, selectAuthorPolicy, type PrimaryArtifactPolicy } from "./indexerPrimaryArtifactPolicy.js";
import { applySelectedPageTemplate, type IndexerPageTemplate } from "./indexerPageTemplate.js";
import {
  buildIndexerArtifactBundle,
  buildIndexerCapabilityGroupEvidence,
  buildIndexerInventoryDispositionSet,
  compareIndexerCanonicalText,
  indexerArtifactResultDigest,
  indexerProtocolDigest,
  validateIndexerArtifactPolicyEligibilityReport,
  validateIndexerPlannedArticles,
  type IndexerArticlePlan,
  type IndexerArtifactResult,
  type IndexerAuthorizedWorksetView,
  type IndexerAuthorSemanticInput,
  type IndexerInventoryMember,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
} from "@c4a/context";
import { ensureMarkdownPageTitle, renderMarkdownSection } from "./markdownPageTitle.js";

type AuthorValidation = {
  source_identity_inventory?: unknown;
  page_template?: IndexerPageTemplate;
  page_plan?: { artifact_intent?: string | undefined; template_id?: string; articles?: IndexerArticlePlan[] };
  article_templates?: Record<string, IndexerPageTemplate>;
  dependency_view: unknown;
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

function chooseIntent(input: {
  semantic: IndexerAuthorSemanticInput;
  validation: AuthorValidation;
  policy: PrimaryArtifactPolicy;
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
  const resolved = resolvePrimaryArtifactIntent(selected, choices, input.policy);
  const planned = input.validation.page_plan?.artifact_intent;
  if (planned !== undefined) {
    const plan = choices.find(choice => primaryIntentKey(choice) === resolveAlias(aliases, planned, "planned artifact intent"));
    if (plan === undefined || primaryIntentKey(resolvePrimaryArtifactIntent(plan, choices, input.policy)) !== primaryIntentKey(resolved)) {
      throw new TypeError(`author intent differs from the accepted page plan: planned=${planned}; received=${requested}. ` +
        `To keep the accepted purpose, omit artifact_intent or set it to ${planned}; keep the prose and other fields. ` +
        "If the purpose really changed, revise the affected plan through the current Context workflow before resubmitting this task. Do not reset state or resubmit accepted peers.");
    }
  }
  return resolved;
}

export function buildIndexerAuthorRunResultFromSemantic(input: {
  projectRoot: string;
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
  const preparedArticles = prepareAuthorArticles(input.semantic, input.validation.page_plan?.articles);
  input = { ...input, semantic: preparedArticles.semantic };
  const sectionKey = (key: string) => preparedArticles.articles === undefined ? slug(key) : key;
  const resolveReferences = articleReferenceResolver({ projectRoot: input.projectRoot, view: input.view,
    sourceIdentity: input.validation.source_identity_inventory === undefined ? undefined
      : validateIndexerSourceIdentityInventory(input.validation.source_identity_inventory) });
  const visualResources = visualResourcesFromView(input.view);
  const visualSections = new Map<string, string>();
  for (const section of input.semantic.sections) {
    if (!section.visuals?.length) continue;
    const allowed = visualResources.filter(resource => section.references.some(reference =>
      reference.source_ref === resource.source_ref && reference.locator.path === resource.document_path));
    const rendered = renderVisualDecisions(section.visuals, allowed);
    input.semantic.diagnostics.push(...rendered.warnings.map(message => ({ code: "visual-retained", message })));
    visualSections.set(sectionKey(section.key), rendered.markdown);
  }
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
  const resolvedSections = input.semantic.sections.map(section => ({
    semantic: section,
    references: resolveReferences(section.references),
    answers: uniqueSorted(section.answers.map(answer =>
      resolveAlias(questionAliases, answer, `${section.key}.answers`))),
  }));
  const artifactId = "main";
  const eligibility = validateIndexerArtifactPolicyEligibilityReport(
    input.validation.artifact_policy_eligibility,
  );
  const variant = selectAuthorPolicy(eligibility.eligible_variants, input.semantic.policy,
    input.semantic.outcome === "publish");
  const intent = input.semantic.outcome === "publish"
    ? chooseIntent({ semantic: preparedArticles.articles === undefined ? input.semantic : { ...input.semantic, artifact_intent: preparedArticles.articles[0]!.artifact_intent }, validation: input.validation, policy: variant })
    : undefined;
  const articleInputs = preparedArticles.articles ?? [{ key: artifactId, title: input.semantic.title ?? "", summary: input.semantic.summary ?? "", section_keys: resolvedSections.map(section => section.semantic.key), artifact_intent: input.semantic.artifact_intent, template_id: input.validation.page_plan?.template_id, template_variables: input.semantic.template_variables }];
  const artifacts: IndexerArtifactResult["artifacts"] = intent === undefined ? [] : articleInputs.map(article => {
    const articleIntent = preparedArticles.articles === undefined ? intent : chooseIntent({
      semantic: { ...input.semantic, artifact_intent: article.artifact_intent },
      validation: { ...input.validation, page_plan: { artifact_intent: article.artifact_intent } }, policy: variant,
    });
    return {
    artifact_id: article.key,
    ...(preparedArticles.articles === undefined || article.template_id === undefined ? {} : { template_id: article.template_id }),
    artifact_kind: articleIntent.artifact_kind,
    artifact_policy_variant: variant.id,
    representation: "sections",
    sections: resolvedSections.filter(section => article.section_keys.includes(section.semantic.key)).map((section, index) => ({
      section_key: sectionKey(section.semantic.key),
      owner_indexer_id: workset.indexer_id,
      document_kind: articleIntent.document_kind,
      reader_goal: articleIntent.reader_goal,
      artifact_kind: articleIntent.artifact_kind,
      blocks: [{
        block_id: `${slug(section.semantic.key)}-prose`,
        layer: "semantic-prose",
        markdown: renderMarkdownSection({
          markdown: section.semantic.markdown,
          heading: section.semantic.heading,
          ...(index === 0 ? { pageTitle: article.title } : {}),
          ...(index === 0 ? { summary: article.summary } : {}),
        }),
        references: section.references,
      }],
    })),
  }; });
  const templateDiagnostics: Array<{ code: string; message: string }> = [];
  for (const [index, artifact] of artifacts.entries()) {
    const article = articleInputs[index]!;
    const template = preparedArticles.articles === undefined ? input.validation.page_template : input.validation.article_templates?.[article.key];
    if (template === undefined || artifact.representation !== "sections") continue;
    const semanticVariables = Object.fromEntries(Object.entries(article.template_variables ?? {}).map(([id, value]) =>
      [id, typeof value === "string" ? value : { value: value.value, references: resolveReferences(value.references) }]));
    applySelectedPageTemplate({ artifact, template, semanticVariables, diagnostics: templateDiagnostics,
      articleKey: preparedArticles.articles === undefined ? undefined : article.key });
  }
  // A rendered slot may replace the opening Author section. Preserve the
  // accepted article title regardless of which supported section comes first.
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.representation !== "sections") continue;
    for (const section of artifact.sections) {
      const visual = visualSections.get(section.section_key);
      if (!visual) continue;
      const source = resolvedSections.find(item => sectionKey(item.semantic.key) === section.section_key);
      for (const block of section.blocks) if (block.layer === "semantic-prose") {
        block.markdown = removeConvertedVisualLinks(block.markdown, visual, visualResources);
      }
      if (source) section.blocks.push({ block_id: `${slug(section.section_key)}-visual`,
        layer: "semantic-prose", markdown: visual, references: source.references });
    }
    const opening = artifact.sections[0]?.blocks[0];
    if (opening?.layer === "semantic-prose") {
      opening.markdown = ensureMarkdownPageTitle(opening.markdown, articleInputs[index]!.title);
    }
  }
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
          artifact_id: preparedArticles.articles?.find(article => article.section_keys.includes(section.semantic.key))?.key ?? artifactId,
          section_key: sectionKey(section.semantic.key),
        }],
      };
    }
    if (entry.state === "catalog-only") {
      return {
        member_id: memberId,
        member_kind: memberKind,
        inventory_disposition: "owned" as const,
        projection_disposition: "catalog-only" as const,
      };
    }
    return {
      member_id: memberId,
      member_kind: memberKind,
      inventory_disposition: "unsupported" as const,
      missing_capabilities: [entry.reason_code ?? "authoring-not-supported"],
    };
  });
  const answered = new Set<string>();
  for (const section of resolvedSections) {
    for (const target of section.answers) {
      // Several sections may answer the same reader question. Keep one
      // coverage marker; this is not a conflicting write or a second approval.
      const plannedArticle = input.validation.page_plan?.articles?.find(article => article.question_targets.includes(target));
      if (plannedArticle !== undefined && !section.semantic.key.startsWith(plannedArticle.key + "--")) {
        throw new TypeError("question " + target + " belongs to article " + plannedArticle.key + "; answer it in its planned primary article");
      }
      answered.add(target);
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
    return !answered.has(target.question_target_key)
      ? {
          question_target_key: target.question_target_key,
          state: "material-gap" as const,
          material_question_proposal_ref: proposalByTarget.get(target.question_target_key)!
            .proposal_ref,
        }
      : {
          question_target_key: target.question_target_key,
          state: "answered" as const,
        };
  });
  const bundle = artifacts.length === 0 ? null : buildIndexerArtifactBundle({
    logical_unit_ref: workset.logical_unit_ref,
    artifact_policy_variant: variant.id,
    artifacts: artifacts.map(artifact => ({
      artifact_id: artifact.artifact_id,
      artifact_kind: artifact.artifact_kind,
      purpose: variant.required_artifact_kinds.includes(artifact.artifact_kind)
        ? "required"
        : "discretionary",
      reader_question_refs: uniqueSorted(
        input.validation.allowed_question_targets
          .filter((target) => answered.has(target.question_target_key) && (input.validation.page_plan?.articles === undefined || input.validation.page_plan.articles.find(article => article.key === artifact.artifact_id)?.question_targets.includes(target.question_target_key)))
          .map((target) => target.question_ref),
      ),
    })),
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
      logical_unit_ref: workset.logical_unit_ref,
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
    artifacts,
    artifact_bundle: bundle,
    material_question_proposals: materialProposals,
    question_target_dispositions: questionDispositions,
    diagnostics: [
      ...templateDiagnostics,
      ...(intent !== undefined && input.validation.page_plan?.artifact_intent !== undefined &&
        input.validation.page_plan.artifact_intent !== primaryIntentKey(intent) ? [{
          code: "primary-artifact-policy-normalized",
          message: `Primary artifact normalized from ${input.validation.page_plan.artifact_intent} to ${primaryIntentKey(intent)} for policy ${variant.id}; source role, document kind and reader goal are unchanged.`,
        }] : []),
      ...input.semantic.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.target === undefined ? {} : {
        target_ref: resolveAlias(questionAliases, diagnostic.target, "diagnostic target"),
      }),
    }))],
    input_digest: input.request.execution_request_digest,
  };
  if (input.validation.page_plan?.articles !== undefined) {
    payload.diagnostics.push(...validateIndexerPlannedArticles(payload, input.validation.page_plan.articles));
  }
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
