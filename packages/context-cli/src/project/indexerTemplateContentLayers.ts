import {
  buildIndexerRenderedContentBlock,
  canonicalIndexerJson,
  projectIndexerFactValue,
  renderIndexerDeterministicFacts,
  type IndexerArtifactResult,
  type IndexerJson,
  type IndexerRenderedContentBlock,
  type IndexerTemplateContract,
} from "@c4a/context";

const PLACEHOLDER = /\{\{\s*(variable|block):([a-z0-9][a-z0-9._/-]*)\s*\}\}/gu;

type TemplateArtifact = Extract<
  IndexerArtifactResult["artifacts"][number],
  { representation: "template" }
>;

function renderSemanticVariable(value: IndexerJson): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new TypeError("collection/json variables must use a registered deterministic block");
}

function referencedFacts(input: {
  result: IndexerArtifactResult;
  factRefs: readonly string[];
  variableId: string;
}) {
  const facts = new Map(input.result.facts.map((fact) => [fact.fact_ref, fact]));
  return input.factRefs.map((ref) => {
    const fact = facts.get(ref);
    if (fact === undefined) {
      throw new TypeError(`template variable ${input.variableId} references unknown Fact ${ref}`);
    }
    return fact;
  });
}

function sameCanonicalValue(left: IndexerJson, right: IndexerJson): boolean {
  return canonicalIndexerJson(left) === canonicalIndexerJson(right);
}

export function validateIndexerTemplateVariableLayers(input: {
  result: IndexerArtifactResult;
  artifact: TemplateArtifact;
  contract: IndexerTemplateContract;
}): void {
  const contracts = new Map(input.contract.variables.map((variable) => [variable.id, variable]));
  for (const [variableId, binding] of Object.entries(input.artifact.variables)) {
    const contract = contracts.get(variableId);
    if (contract === undefined) continue;
    if (contract.content_layer === "semantic-prose") {
      if (binding.fact_refs.length !== 0) {
        throw new TypeError(`semantic-prose variable ${variableId} cannot cite deterministic Facts`);
      }
      continue;
    }
    if (binding.fact_refs.length === 0) {
      throw new TypeError(`deterministic-fact variable ${variableId} requires canonical Facts`);
    }
    const facts = referencedFacts({
      result: input.result,
      factRefs: binding.fact_refs,
      variableId,
    });
    if (!sameCanonicalValue(binding.value, projectIndexerFactValue(facts))) {
      throw new TypeError(`deterministic-fact variable ${variableId} does not equal its Fact projection`);
    }
    const expectedEvidence = [...new Set(facts.flatMap((fact) => fact.evidence_refs))].sort();
    const actualEvidence = [...binding.evidence_refs].sort();
    if (
      expectedEvidence.length !== actualEvidence.length ||
      expectedEvidence.some((ref, index) => ref !== actualEvidence[index])
    ) {
      throw new TypeError(`deterministic-fact variable ${variableId} changes Fact evidence`);
    }
  }
}

function assertStandaloneBlockDirective(
  body: string,
  start: number,
  end: number,
  blockId: string,
): void {
  const lineStart = body.lastIndexOf("\n", start - 1) + 1;
  const nextLine = body.indexOf("\n", end);
  const lineEnd = nextLine === -1 ? body.length : nextLine;
  if (
    body.slice(lineStart, start).trim().length > 0 ||
    body.slice(end, lineEnd).trim().length > 0
  ) {
    throw new TypeError(`deterministic block ${blockId} must occupy its own template line`);
  }
}

function trimOuterContentBlocks(
  blocks: IndexerRenderedContentBlock[],
): IndexerRenderedContentBlock[] {
  const values = blocks.flatMap((block, index) => {
    const markdown = index === 0 ? block.markdown.trimStart() : block.markdown;
    const finalMarkdown = index === blocks.length - 1 ? markdown.trimEnd() : markdown;
    if (finalMarkdown.length === 0) return [];
    return [finalMarkdown === block.markdown
      ? block
      : buildIndexerRenderedContentBlock({
        layer: block.layer,
        markdown: finalMarkdown,
        fact_refs: block.fact_refs,
        evidence_refs: block.evidence_refs,
      })];
  });
  if (values.length === blocks.length || values.length === 0) return values;
  return trimOuterContentBlocks(values);
}

export function renderIndexerTemplateSectionLayers(input: {
  body: string;
  section: IndexerTemplateContract["sections"][number];
  result: IndexerArtifactResult;
  artifact: TemplateArtifact;
  contract: IndexerTemplateContract;
  acceptedEvidenceRefs: ReadonlySet<string>;
}): {
  markdown: string;
  contentBlocks: IndexerRenderedContentBlock[];
  evidenceRefs: string[];
} {
  const variableContracts = new Map(
    input.contract.variables.map((variable) => [variable.id, variable]),
  );
  const deterministicBlocks = new Map(
    input.contract.deterministic_blocks.map((block) => [block.id, block]),
  );
  const contentBlocks: IndexerRenderedContentBlock[] = [];
  let semanticMarkdown = "";
  const semanticEvidence = new Set<string>();
  let cursor = 0;

  const flushSemantic = (): void => {
    if (semanticMarkdown.length === 0) return;
    contentBlocks.push(buildIndexerRenderedContentBlock({
      layer: "semantic-prose",
      markdown: semanticMarkdown,
      evidence_refs: [...semanticEvidence].filter((ref) =>
        input.acceptedEvidenceRefs.has(ref)
      ),
    }));
    semanticMarkdown = "";
    semanticEvidence.clear();
  };

  for (const match of input.body.matchAll(PLACEHOLDER)) {
    const start = match.index;
    const token = match[0];
    const kind = match[1];
    const id = match[2]!;
    semanticMarkdown += input.body.slice(cursor, start);
    cursor = start + token.length;
    if (kind === "variable") {
      const contract = variableContracts.get(id);
      const binding = input.artifact.variables[id];
      if (contract?.content_layer !== "semantic-prose") {
        throw new TypeError(`direct template variable ${id} must use content_layer=semantic-prose`);
      }
      if (binding !== undefined) {
        semanticMarkdown += renderSemanticVariable(binding.value);
        binding.evidence_refs.forEach((ref) => semanticEvidence.add(ref));
      }
      continue;
    }
    const block = deterministicBlocks.get(id);
    if (block === undefined) {
      throw new TypeError(`template references unknown deterministic block ${id}`);
    }
    assertStandaloneBlockDirective(input.body, start, cursor, id);
    flushSemantic();
    const binding = input.artifact.variables[block.source_variable_id];
    if (binding === undefined) continue;
    const facts = referencedFacts({
      result: input.result,
      factRefs: binding.fact_refs,
      variableId: block.source_variable_id,
    });
    contentBlocks.push(buildIndexerRenderedContentBlock({
      layer: "deterministic-block",
      markdown: renderIndexerDeterministicFacts({ renderer: block.renderer, facts }),
      fact_refs: binding.fact_refs,
      evidence_refs: binding.evidence_refs.filter((ref) =>
        input.acceptedEvidenceRefs.has(ref)
      ),
    }));
  }
  semanticMarkdown += input.body.slice(cursor);
  flushSemantic();

  const fallbackEvidence = [...new Set(
    input.section.variable_ids.flatMap((id) =>
      input.artifact.variables[id]?.evidence_refs ?? []
    ).filter((ref) => input.acceptedEvidenceRefs.has(ref)),
  )];
  const layered = trimOuterContentBlocks(contentBlocks.map((block) =>
    block.layer === "semantic-prose" && block.evidence_refs.length === 0
      ? buildIndexerRenderedContentBlock({
        layer: block.layer,
        markdown: block.markdown,
        evidence_refs: fallbackEvidence,
      })
      : block
  ));
  const evidenceRefs = [...new Set(layered.flatMap((block) => block.evidence_refs))].sort();
  return {
    markdown: layered.map((block) => block.markdown).join(""),
    contentBlocks: layered,
    evidenceRefs,
  };
}
