import { indexerArticleSectionKey, articleFragmentReferences, type ArticleSourceReference, type IndexerTemplateContract, type IndexerArtifactResult } from "@c4a/context";
import { renderIndexerTemplateSectionLayers } from "./indexerTemplateContentLayers.js";

export interface IndexerPageTemplate {
  contract: IndexerTemplateContract;
  section_bodies: Record<string, string>;
}

/** Templates format explicit writing slots. Missing slots preserve authored
 * sections; parser facts are not copied into variables or persistent results. */
export function applySelectedPageTemplate(input: {
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }>;
  template: IndexerPageTemplate;
  semanticVariables?: Readonly<Record<string, string | { value: string; references: ArticleSourceReference[] }>> | undefined;
  articleKey?: string | undefined;
  diagnostics?: Array<{ code: string; message: string }> | undefined;
}): void {
  const { artifact, template } = input;
  if (!template.contract.applicability.artifact_policy_variants.includes(artifact.artifact_policy_variant)) {
    throw new TypeError("Page template does not support the selected policy");
  }
  artifact.template_id = template.contract.template_id;
  const projection = artifact.sections[0];
  if (!projection) return;
  const variables: Extract<IndexerArtifactResult["artifacts"][number], { representation: "template" }>["variables"] = {};
  for (const [id, binding] of Object.entries(input.semanticVariables ?? {})) {
    const definition = template.contract.variables.find(variable => variable.id === id);
    if (!definition) {
      input.diagnostics?.push({ code: "template-unknown-writing-slot", message: `Unknown slot ${id}; authored sections are retained.` });
      continue;
    }
    const keys = new Set(template.contract.sections.filter(section => section.variable_ids.includes(id)).map(section =>
      input.articleKey === undefined ? section.section_key : indexerArticleSectionKey(input.articleKey, section.section_key)));
    // Reuse only this slot's own section citations, never the entire article.
    const references = typeof binding === "string"
      ? articleFragmentReferences(artifact.sections.filter(section => keys.has(section.section_key))
          .flatMap(section => section.blocks.flatMap(block => block.references)))
      : articleFragmentReferences(binding.references);
    variables[id] = { value: typeof binding === "string" ? binding : binding.value, references };
  }
  for (const definition of template.contract.sections) {
    if (definition.variable_ids.some(id => !variables[id])) continue;
    const rendered = renderIndexerTemplateSectionLayers({
      body: template.section_bodies[definition.section_key]!, section: definition, contract: template.contract,
      artifact: { artifact_id: artifact.artifact_id, artifact_kind: artifact.artifact_kind,
        artifact_policy_variant: artifact.artifact_policy_variant, representation: "template",
        template_id: template.contract.template_id, section_projections: [projection], variables },
    });
    if (!rendered.length) continue;
    const sectionKey = input.articleKey === undefined ? definition.section_key : indexerArticleSectionKey(input.articleKey, definition.section_key);
    const existing = artifact.sections.findIndex(section => section.section_key === sectionKey);
    const section = { ...projection, section_key: sectionKey,
      blocks: rendered.map(fragment => ({ block_id: fragment.section_key, layer: "semantic-prose" as const,
        markdown: fragment.markdown, references: fragment.references })) };
    if (existing < 0) artifact.sections.push(section);
    else artifact.sections[existing] = section;
  }
}
