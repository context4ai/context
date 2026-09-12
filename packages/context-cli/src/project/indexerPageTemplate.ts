import { expandArticleBlueprint } from "./indexerArticleBlueprint.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerArticleSectionKey, indexerTemplateContractSchema, articleFragmentReferences, type ArticleSourceReference, type IndexerTemplateContract,
  type IndexerArtifactResult } from "@c4a/context";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import type { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import { parseSectionBodies, splitFrontmatter, validateTemplateBody } from "./indexerTemplateRendering.js";
import { renderIndexerTemplateSectionLayers } from "./indexerTemplateContentLayers.js";

export interface IndexerPageTemplate {
  contract: IndexerTemplateContract;
  section_bodies: Record<string, string>;
}

async function loadSelectedPageSource(input: {
  projectRoot: string;
  authority: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>;
  templateId?: string | undefined;
}) {
  if (input.templateId === undefined) return undefined;
  const { authority } = input;
  const template = authority.manifest.provider.templates?.find((item) =>
    item.id === input.templateId && item.profile === authority.profile.id);
  if (template === undefined) throw new TypeError(`selected page template is unavailable: ${input.templateId}`);
  const customization = await loadIndexerCustomization({ workspaceRoot: input.projectRoot,
    projectRef: input.projectRoot, indexer: authority.indexer, manifest: authority.manifest,
    providerIntegrity: authority.provider.integrity });
  const override = customization.files.find((item) => item.capability === "template-override" &&
    item.origin.profile === authority.profile.id && item.path === `templates/${template.id}.md`);
  const path = override === undefined ? join(authority.bundle_root, template.path)
    : join(input.projectRoot, "src", "indexer", authority.indexer.id, override.path);
  const raw = await readFile(path, "utf8");
  const source = override === undefined ? raw : raw.replace(/^[^\n]*(?:\n|$)/u, "");
  const parsed = splitFrontmatter(source);
  return { template, authority, parsed };
}

export async function loadSelectedArticleGuidance(input: Parameters<typeof loadSelectedPageSource>[0]) {
  const source = await loadSelectedPageSource(input);
  if (source === undefined) return undefined;
  if (source.template.guidance_path !== undefined) {
    const raw = await readFile(join(source.authority.bundle_root, source.template.guidance_path), "utf8");
    return { template_id: source.template.id, content: splitFrontmatter(raw).body };
  }
  if ((source.parsed.metadata as { kind?: unknown })?.kind !== "procedure") return undefined;
  return { template_id: source.template.id, content: source.parsed.body };
}

export async function loadSelectedPageTemplate(input: Parameters<typeof loadSelectedPageSource>[0]): Promise<IndexerPageTemplate | undefined> {
  const source = await loadSelectedPageSource(input);
  if (source === undefined) return undefined;
  const { template, authority, parsed } = source;
  const shared = template.kind === "page-program" ? expandArticleBlueprint(parsed.metadata, template) : undefined;
  if (shared !== undefined) return shared;
  // Procedure resources guide prose; executable resources additionally render
  // fields. Keep that distinction explicit in the current Provider catalog.
  if ((parsed.metadata as { kind?: unknown })?.kind === "procedure") return undefined;
  const contract = indexerTemplateContractSchema.parse(parsed.metadata);
  if (contract.template_id !== template.id || contract.profile !== authority.profile.id) {
    throw new TypeError("selected template program has a mismatched identity");
  }
  if (template.reader_goal !== undefined && template.reader_goal !== contract.reader_goal) {
    throw new TypeError("selected template program differs from its registered reader goal");
  }
  const section_bodies = parseSectionBodies(parsed.body);
  validateTemplateBody(contract, section_bodies);
  return { contract, section_bodies };
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
