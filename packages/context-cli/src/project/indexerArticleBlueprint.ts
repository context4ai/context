import { indexerTemplateContractSchema, type IndexerTemplateContract } from "@c4a/context";

interface ArticleProgram {
  article: string;
  policies: string[];
  sections: Record<string, string>;
  contract_table?: string;
}

/** A profile binding selects a shared blueprint; it does not change its prose.
 * Legacy full template contracts remain supported by their existing loader. */
export function expandArticleBlueprint(metadata: unknown, binding: {
  id: string; profile: string; reader_goal?: string | undefined; accepted_evidence_kinds?: string[];
}): { contract: IndexerTemplateContract; section_bodies: Record<string, string> } | undefined {
  const program = (metadata as { program?: ArticleProgram } | null)?.program;
  if (program === undefined) return undefined;
  if (!program || typeof program.article !== "string" || !Array.isArray(program.policies) ||
      !program.sections || typeof program.sections !== "object" || !binding.reader_goal) {
    throw new TypeError("Article blueprint needs declared sections, policies and a bound reader goal");
  }
  const slots = Object.entries(program.sections);
  if (slots.some(([key, title]) => !/^[a-z0-9][a-z0-9._/-]*$/u.test(key) || typeof title !== "string" || !title.trim())) {
    throw new TypeError("Article blueprint section identities and headings must be valid");
  }
  const api = program.contract_table;
  const sections = slots.map(([key]) => ({
    section_key: key, presence: "optional", question_ref: `question:${program.article}-${key}`,
    reader_goal: binding.reader_goal, variable_ids: [key], deterministic_block_ids: [] as string[],
    accepted_evidence_kinds: binding.accepted_evidence_kinds ?? ["code", "contract", "configuration", "documentation"],
    minimum_evidence_items: 0, on_missing: "omit",
    deletion_condition: "Omit when not applicable or no supported value is supplied.",
  }));
  const variables = slots.map(([id]) => ({ id, type: "string", content_layer: "semantic-prose", required: false, evidence_required: true }));
  const bodies = slots.map(([key, heading]) => [key, `## ${heading}\n\n{{variable:${key}}}`]);
  if (api) {
    sections.splice(3, 0, { ...sections[0]!, section_key: api, question_ref: "question:public-contract", variable_ids: [api], deterministic_block_ids: ["api-table"] });
    bodies.splice(3, 0, [api, "## API\n\n{{block:api-table}}"]);
  }
  const contract = indexerTemplateContractSchema.parse({
    protocol: "context.indexer.template/v1", template_id: binding.id, profile: binding.profile, reader_goal: binding.reader_goal,
    applicability: { artifact_policy_variants: program.policies, condition_refs: [] },
    variables: [...variables, ...(api ? [{ id: api, type: "json", content_layer: "deterministic-fact", required: false, evidence_required: true }] : [])],
    deterministic_blocks: api ? [{ id: "api-table", renderer: "public-contract-table", source_variable_id: api }] : [],
    sections,
    page_policy: { split_suggestion: "Split by independently useful reader task when supported; preserve stable article identities.", semantic_boundaries: ["reader-task", "source-boundary"], keep_single_page_conditions: ["one-reader-subject"] },
    anonymous_section_examples: ["A source-backed explanation that names an entry and the next investigation step."],
    anti_examples: ["Invented relationships or current runtime values inferred from names alone."],
    forbidden_outputs: ["Unresolved internal identifiers in reader-facing prose."], maximum_rendered_bytes: 1048576,
  });
  return { contract, section_bodies: Object.fromEntries(bodies) };
}
