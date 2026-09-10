import YAML from "yaml";
import type { IndexerApprovedKnowledge } from "@c4a/context";
import type { ApprovedKnowledgeRevisionInput } from "./approvedKnowledgeRevisionInput.js";

/** The Agent supplies the full support selection for each surviving section.
 * The CLI validates identities; it never guesses which new article proves a
 * sentence after an upstream split, merge or removal. */
export function rebindApprovedKnowledgeSupport(previous: IndexerApprovedKnowledge, input: ApprovedKnowledgeRevisionInput) {
  const plan = input.rebinding;
  if (!plan?.sections) throw new TypeError("Select section support through context task adjust with knowledge_dependencies.sections before submitting this revision. Approved content is unchanged.");
  if (input.status !== "ready") throw new TypeError("Supporting knowledge is pending. Finish the upstream approval or adjust knowledge_dependencies through context task adjust.");
  const oldDependencies = new Set(previous.dependencies.map(dependency => dependency.artifact_ref));
  const retainedFacts = previous.facts.filter(fact => {
    if (fact.fact_kind !== "approved-knowledge-fact") return true;
    const value = fact.value;
    return !value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.approved_artifact_ref !== "string" || !oldDependencies.has(value.approved_artifact_ref);
  });
  const facts = new Map([...retainedFacts, ...input.facts].map(fact => [fact.fact_ref, fact]));
  const retainedRefs = new Set(retainedFacts.flatMap(fact => fact.evidence_refs));
  const removedRefs = new Set(previous.facts.filter(fact => !retainedFacts.includes(fact)).flatMap(fact => fact.evidence_refs));
  // Document sections may bind raw source text without a parser fact. Preserve
  // that direct evidence; remove evidence carried only by retired support.
  const evidence = new Map([...previous.evidence_bindings.filter(binding => retainedRefs.has(binding.evidence_ref) || !removedRefs.has(binding.evidence_ref)), ...input.evidence_bindings].map(binding => [binding.evidence_ref, binding]));
  const keys = new Set<string>();
  const sections = plan.sections.map(selection => {
    if (keys.has(selection.section_key)) throw new TypeError("Section support repeats a section identity");
    keys.add(selection.section_key);
    const old = previous.sections.find(section => section.section_key === selection.section_key);
    if (!old) throw new TypeError("Section support must select an existing approved section identity");
    const selectedFacts = selection.fact_refs.map(ref => {
      const fact = facts.get(ref);
      if (!fact) throw new TypeError(`Section support uses an unavailable fact: ${ref}. Refresh context status and select current knowledge_dependencies.sections through context task adjust.`);
      return fact;
    });
    if (selection.evidence_refs.some(ref => !evidence.has(ref)) ||
      selectedFacts.some(fact => fact.evidence_refs.some(ref => !selection.evidence_refs.includes(ref)))) {
      throw new TypeError("Section support must include only authorized evidence and every selected fact's evidence");
    }
    return { ...old, fact_refs: [...new Set(selection.fact_refs)], evidence_refs: [...new Set(selection.evidence_refs)] };
  });
  // Dropped sections are removed by the Author's Markdown. Their old support
  // must never silently survive a full dependency replacement.
  const factRefs = new Set(sections.flatMap(section => section.fact_refs));
  const evidenceRefs = new Set(sections.flatMap(section => section.evidence_refs));
  return { ...previous, sections, facts: [...facts.values()].filter(fact => factRefs.has(fact.fact_ref)),
    evidence_bindings: [...evidence.values()].filter(binding => evidenceRefs.has(binding.evidence_ref)),
    dependencies: plan.dependencies, dependency_versions: input.versions };
}

/** Preserve the full revision target while exposing newly authorized support
 * sources in its editable frontmatter, including queued/reopened revisions. */
export function withApprovedKnowledgeSupportSources<T extends { markdown: string; source_refs: string[] }>(target: T, input: ApprovedKnowledgeRevisionInput): T {
  const sources = [...new Set([...target.source_refs, ...input.evidence_bindings.map(binding => binding.source_ref)])];
  const markdown = target.markdown.replace(/^---\r?\n([\s\S]*?)\r?\n---/u, (_all, raw: string) => {
    const metadata = YAML.parse(raw) as Record<string, unknown>;
    return `---\n${YAML.stringify({ ...metadata, sources }).trimEnd()}\n---`;
  });
  return { ...target, markdown, source_refs: sources };
}
