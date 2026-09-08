import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexerTemplateContractSchema, projectIndexerFactValue, projectIndexerPublicContractTable, type IndexerTemplateContract,
  type IndexerArtifactResult, type IndexerArtifactFact } from "@c4a/context";
import { loadIndexerCustomization } from "./indexerCustomization.js";
import type { resolveCurrentProjectIndexerPrimaryAuthority } from "./indexerCurrentPrimaryAuthority.js";
import { parseSectionBodies, splitFrontmatter, validateTemplateBody } from "./indexerTemplateRendering.js";
import { renderIndexerTemplateSectionLayers } from "./indexerTemplateContentLayers.js";

export interface IndexerPageTemplate {
  contract: IndexerTemplateContract;
  section_bodies: Record<string, string>;
}

export async function loadSelectedPageTemplate(input: {
  projectRoot: string;
  authority: Awaited<ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>>;
  templateId?: string | undefined;
}): Promise<IndexerPageTemplate | undefined> {
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
  // Procedure resources guide prose; executable resources additionally render
  // fields. Keep that distinction explicit in the current Provider catalog.
  if ((parsed.metadata as { kind?: unknown })?.kind === "procedure") return undefined;
  const contract = indexerTemplateContractSchema.parse(parsed.metadata);
  if (contract.template_id !== template.id || contract.profile !== authority.profile.id) {
    throw new TypeError("selected template program has a mismatched identity");
  }
  const section_bodies = parseSectionBodies(parsed.body);
  validateTemplateBody(contract, section_bodies);
  return { contract, section_bodies };
}

/** Use the existing template language and content layers. Semantic text is a
 * value, never parsed a second time as executable template syntax. */
export function applySelectedPageTemplate(input: {
  artifact: Extract<IndexerArtifactResult["artifacts"][number], { representation: "sections" }>;
  template: IndexerPageTemplate;
  facts: readonly IndexerArtifactFact[];
  supportingFacts?: readonly IndexerArtifactFact[];
  semanticVariables?: Readonly<Record<string, string>> | undefined;
}): IndexerArtifactFact[] {
  const { artifact, template } = input;
  if (!template.contract.applicability.artifact_policy_variants.includes(artifact.artifact_policy_variant)) {
    throw new TypeError("page template does not support the selected Artifact policy");
  }
  if (artifact.sections.some((section) => section.reader_goal !== template.contract.reader_goal)) {
    throw new TypeError("selected template reader goal differs from the accepted page intent");
  }
  artifact.template_id = template.contract.template_id;
  const contractFacts = input.facts.filter((fact) => projectIndexerPublicContractTable(fact) !== undefined);
  const projection = artifact.sections[0];
  if (projection === undefined) return [];
  const availableFacts = [...new Map([...contractFacts, ...(input.supportingFacts ?? [])].map(fact => [fact.fact_ref, fact])).values()];
  const semanticEvidence = [...new Set(artifact.sections.flatMap((section) => section.blocks.flatMap((block) =>
    block.layer === "semantic-prose" ? block.evidence_refs : [])))].sort();
  const variables: Extract<IndexerArtifactResult["artifacts"][number], { representation: "template" }>["variables"] = {};
  for (const [id, value] of Object.entries(input.semanticVariables ?? {})) {
    const definition = template.contract.variables.find((variable) => variable.id === id);
    if (definition?.content_layer !== "semantic-prose") {
      throw new TypeError(`template variable ${id} is not an authorized semantic-prose variable`);
    }
    variables[id] = { value, fact_refs: [], evidence_refs: semanticEvidence };
  }
  const evidence = [...new Set(contractFacts.flatMap((fact) => fact.evidence_refs))].sort();
  if (contractFacts.length > 0) {
    variables.api = { value: projectIndexerFactValue(contractFacts),
      fact_refs: contractFacts.map((fact) => fact.fact_ref), evidence_refs: evidence };
  }
  const acceptedEvidence = [...new Set([...availableFacts.flatMap(fact => fact.evidence_refs), ...semanticEvidence])];
  let renderedBytes = 0;
  let usesContractFact = false;
  for (const definition of template.contract.sections) {
    const missing = definition.variable_ids.filter((id) => variables[id] === undefined);
    if (missing.length > 0) {
      if (definition.presence === "optional" && definition.on_missing === "omit") continue;
      throw new TypeError(`selected template section ${definition.section_key} requires variables: ${missing.join(", ")}`);
    }
    const body = template.section_bodies[definition.section_key]!;
    const rendered = renderIndexerTemplateSectionLayers({
      body, section: definition, result: { facts: availableFacts },
      contract: template.contract, acceptedEvidenceRefs: new Set(acceptedEvidence), artifact: {
        artifact_id: artifact.artifact_id, artifact_kind: artifact.artifact_kind,
        artifact_policy_variant: artifact.artifact_policy_variant,
        representation: "template", template_id: template.contract.template_id,
        section_projections: [projection], variables,
      },
    });
    usesContractFact ||= rendered.contentBlocks.some((block) => contractFacts.some((fact) => block.fact_refs.includes(fact.fact_ref)));
    renderedBytes += new TextEncoder().encode(rendered.markdown).byteLength;
    if (renderedBytes > template.contract.maximum_rendered_bytes) throw new TypeError("selected page template exceeds its rendered byte limit");
    const sectionKey = `${template.contract.template_id}-${definition.section_key}`;
    if (artifact.sections.some((section) => section.section_key === sectionKey)) {
      throw new TypeError("semantic section conflicts with a selected template section");
    }
    const renderers = [...body.matchAll(/\{\{\s*block:([^}\s]+)\s*\}\}/gu)]
      .map((match) => template.contract.deterministic_blocks.find((block) => block.id === match[1])!.renderer);
    let deterministicIndex = 0;
    artifact.sections.push({ section_key: sectionKey, owner_indexer_id: projection.owner_indexer_id,
      document_kind: projection.document_kind, reader_goal: projection.reader_goal,
      artifact_kind: projection.artifact_kind, blocks: rendered.contentBlocks.map((block, index) =>
        block.layer === "deterministic-block" ? { block_id: `template-${index}`, layer: block.layer,
          renderer: renderers[deterministicIndex++]!, fact_refs: block.fact_refs.filter(ref => contractFacts.some(fact => fact.fact_ref === ref)) }
          : { block_id: `template-${index}`, layer: block.layer, markdown: block.markdown,
            evidence_refs: block.evidence_refs.length ? block.evidence_refs : acceptedEvidence }),
    });
  }
  return usesContractFact ? [...contractFacts] : [];
}
