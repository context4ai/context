import { canonicalIndexerJson, IndexerKnowledgeDependencyCycleError, validateIndexerKnowledgeDependencyGraph, type IndexerApprovedKnowledge, type IndexerRegistry } from "@c4a/context";
import type { ApprovedKnowledgeRevisionInput, ApprovedKnowledgeRebinding } from "./approvedKnowledgeRevisionInput.js";
import { rebindApprovedKnowledgeSupport } from "./approvedKnowledgeRebinding.js";
import { readApprovedKnowledgeInput, assertApprovedKnowledgeInputCurrent } from "./approvedKnowledgeInput.js";
import { approvedKnowledgeSnapshotsFromStructure } from "./approvedKnowledgeSnapshots.js";
import { readKnowledgeStructure } from "./packageBuildInventory.js";
import { resolveApprovedKnowledgeSources } from "./approvedKnowledgeSources.js";
import { projectIndexerReadTargets, projectIndexerReadTargetAllows } from "./indexerReadScopeAuthorization.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";

/** Explicit revision preparation supplies the same authorized support as Author.
 * Read-only status merely exposes the recorded input and performs no capture. */
export async function prepareApprovedKnowledgeRevision(root: string, path: string, registry: IndexerRegistry, rebinding?: ApprovedKnowledgeRebinding): Promise<ApprovedKnowledgeRevisionInput | undefined> {
  const snapshots = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed);
  const target = snapshots.find(snapshot => snapshot.path === path);
  if (!target || (!target.dependencies.length && !rebinding)) return undefined;
  const dependencies = rebinding?.dependencies ?? target.dependencies;
  if (rebinding) {
    try {
      validateIndexerKnowledgeDependencyGraph(snapshots.map(snapshot => ({
        artifact_ref: snapshot.artifact_ref, dependencies: snapshot === target ? dependencies : snapshot.dependencies,
      })));
    } catch (error) {
      if (!(error instanceof IndexerKnowledgeDependencyCycleError)) throw error;
      throw new TypeError(`Knowledge dependency cycle: ${error.artifact_refs.join(" -> ")}. Use context task adjust with an acyclic knowledge_dependencies selection; approved pages are unchanged.`);
    }
  }
  const indexer = registry.indexers.find(indexer => indexer.id === target.primary_indexer_id);
  // Older/custom Subjects need their existing primary, identified by source
  // ownership; do not union scopes of unrelated Providers.
  const candidates = indexer ? [indexer] : target.primary_indexer_id ? [] : registry.indexers.filter(indexer => indexer.requirement_bindings.some(binding => {
    if (binding.role !== "primary") return false;
    const targets = "targets" in binding.owned_scope ? binding.owned_scope.targets : registry.requirements.find(requirement =>
      binding.owned_scope && "ref" in binding.owned_scope && binding.owned_scope.ref === `requirement:${requirement.id}#target_scope`)?.target_scope.targets;
    return targets?.some(source => target.source_versions.some(version => source.source_ref === version.source_ref &&
      (!source.module_refs.length || (version.module_ref !== null && source.module_refs.includes(version.module_ref)))));
  }));
  if (candidates.length !== 1) return undefined;
  const owner = candidates[0]!;
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: root, registry, indexer_id: owner.id });
  const authorizedTargets = projectIndexerReadTargets({ registry, indexer_id: owner.id });
  if (rebinding?.sections) {
    const retained = new Set(rebinding.sections.flatMap(section => section.evidence_refs));
    if (target.evidence_bindings.some(binding => retained.has(binding.evidence_ref) &&
      !projectIndexerReadTargetAllows({ targets: authorizedTargets, source_ref: binding.source_ref, module_ref: binding.module_ref }))) {
      throw new TypeError("Replacement section support is outside the current primary Provider read scope");
    }
  }
  const sources = await resolveApprovedKnowledgeSources({ projectRoot: root, registry, authorized_targets: authorizedTargets,
    snapshots: snapshots.filter(snapshot => dependencies.some(dependency => dependency.artifact_ref === snapshot.artifact_ref)), current: [] });
  const input = await readApprovedKnowledgeInput({ projectRoot: root, subject_key: target.subject_key, dependencies,
    authorized_targets: authorizedTargets, bindings: sources.map(source => source.binding),
    evidence_kinds: new Set(authority.profile.reader_question_contracts.flatMap(question => question.evidence_contract.accepted_kinds)) });
  return { ...input, ...(rebinding ? { rebinding } : {}) };
}

export async function assertApprovedKnowledgeRevisionCurrent(root: string, path: string, registry: IndexerRegistry, input: ApprovedKnowledgeRevisionInput) {
  // A plain wording edit may continue with an unavailable dependency, but does
  // not record it as refreshed. Ready input is subject to concurrency checks.
  if (input.status !== "ready") {
    if (input.rebinding) throw new TypeError("Replacement supporting knowledge is pending; adjust knowledge_dependencies through context task adjust or finish its upstream approval first.");
    return;
  }
  await assertApprovedKnowledgeInputCurrent(root, input);
  const current = await prepareApprovedKnowledgeRevision(root, path, registry, input.rebinding);
  if (!current || current.status !== "ready" || current.dependency_fingerprint !== input.dependency_fingerprint) {
    throw new TypeError("Supporting knowledge changed during revision. Run context revise for this same path and instruction to refresh the existing task before submitting; approved content is unchanged.");
  }
  // Reprojection above checked current captured source versions as well.
  if (input.rebinding) {
    const target = approvedKnowledgeSnapshotsFromStructure((await readKnowledgeStructure(root)).parsed).find(snapshot => snapshot.path === path);
    if (!target) throw new TypeError("The approved support target disappeared; refresh the current revision.");
    rebindApprovedKnowledgeSupport(target, current);
  }
}

/** Refresh support facts only in sections that already cite the same source
 * locations. Prose remains an approved interpretation, never a new parser fact. */
export function refreshApprovedKnowledgeRevisionSupport(previous: IndexerApprovedKnowledge, input: ApprovedKnowledgeRevisionInput) {
  if (input.rebinding) return rebindApprovedKnowledgeSupport(previous, input);
  if (input.status !== "ready") return previous;
  const replacement = new Map(input.evidence_bindings.map(binding => [canonicalIndexerJson([binding.source_ref, binding.module_ref, binding.locator]), binding]));
  const evidence = previous.evidence_bindings.map(binding => replacement.get(canonicalIndexerJson([binding.source_ref, binding.module_ref, binding.locator])) ?? binding);
  const byOldRef = new Map(previous.evidence_bindings.map((binding, index) => [binding.evidence_ref, evidence[index]!]));
  const replacedArticles = new Set(input.versions.map(version => version.artifact_ref));
  const facts = previous.facts.filter(fact => {
    const value = fact.value;
    if (fact.fact_kind === "approved-knowledge-fact" && value && typeof value === "object" && !Array.isArray(value) &&
      typeof value.approved_artifact_ref === "string" && replacedArticles.has(value.approved_artifact_ref)) return false;
    return fact.evidence_refs.every(ref => byOldRef.get(ref)?.evidence_ref === ref);
  });
  facts.push(...input.facts.filter(fact => fact.evidence_refs.every(ref => evidence.some(binding => binding.evidence_ref === ref))));
  const uniqueFacts = [...new Map(facts.map(fact => [fact.fact_ref, fact])).values()];
  const sections = previous.sections.map(section => {
    const refs = [...new Set(section.evidence_refs.map(ref => byOldRef.get(ref)!.evidence_ref))];
    return { ...section, evidence_refs: refs,
      fact_refs: uniqueFacts.filter(fact => fact.evidence_refs.length && fact.evidence_refs.every(ref => refs.includes(ref))).map(fact => fact.fact_ref) };
  });
  return { ...previous, sections, facts: uniqueFacts, evidence_bindings: [...new Map(evidence.map(binding => [binding.evidence_ref, binding])).values()],
    dependency_versions: input.versions };
}
