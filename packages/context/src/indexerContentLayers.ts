import { z } from "zod";
import { indexerCanonicalRefSchema } from "./indexerLayerComposition.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerDigestSchema,
  indexerIdSchema,
  indexerProtocolDigest,
} from "./indexerProtocolCommon.js";
import type { IndexerJson } from "./indexerRegistry.js";
import { indexerSubjectKeySchema } from "./indexerSubjectIdentity.js";

export const indexerCanonicalJsonSchema: z.ZodType<IndexerJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(indexerCanonicalJsonSchema),
    z.record(indexerCanonicalJsonSchema),
  ])
);

export const indexerArtifactFactSchema = z.object({
  fact_ref: indexerCanonicalRefSchema,
  fact_kind: indexerIdSchema,
  subject_key: indexerSubjectKeySchema,
  value: indexerCanonicalJsonSchema,
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerDeterministicBlockRendererSchema = z.enum([
  "bullet-list",
  "key-value-table",
  "json-code-block",
]);

const deterministicArtifactBlockSchema = z.object({
  block_id: indexerIdSchema,
  layer: z.literal("deterministic-block"),
  renderer: indexerDeterministicBlockRendererSchema,
  fact_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

const semanticProseArtifactBlockSchema = z.object({
  block_id: indexerIdSchema,
  layer: z.literal("semantic-prose"),
  markdown: z.string().min(1),
  evidence_refs: z.array(indexerCanonicalRefSchema).min(1),
}).strict();

export const indexerArtifactContentBlockSchema = z.discriminatedUnion("layer", [
  deterministicArtifactBlockSchema,
  semanticProseArtifactBlockSchema,
]);

const renderedContentBlockPayloadSchema = z.object({
  layer: z.enum(["deterministic-block", "semantic-prose"]),
  markdown: z.string().min(1),
  fact_refs: z.array(indexerCanonicalRefSchema),
  evidence_refs: z.array(indexerCanonicalRefSchema),
}).strict();

export const indexerRenderedContentBlockSchema = renderedContentBlockPayloadSchema.extend({
  content_digest: indexerDigestSchema,
}).strict();

export type IndexerArtifactFact = z.infer<typeof indexerArtifactFactSchema>;
export type IndexerArtifactContentBlock = z.infer<
  typeof indexerArtifactContentBlockSchema
>;
export type IndexerDeterministicBlockRenderer = z.infer<
  typeof indexerDeterministicBlockRendererSchema
>;
export type IndexerRenderedContentBlock = z.infer<
  typeof indexerRenderedContentBlockSchema
>;

function assertCanonicalRefs(values: readonly string[], label: string): void {
  const expected = [...new Set(values)].sort(compareIndexerCanonicalText);
  if (
    expected.length !== values.length ||
    expected.some((value, index) => value !== values[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }
}

export function projectIndexerFactValue(
  facts: readonly IndexerArtifactFact[],
): IndexerJson {
  const ordered = [...facts].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
  return ordered.length === 1
    ? ordered[0]!.value
    : ordered.map((fact) => fact.value);
}

export function renderIndexerDeterministicFacts(input: {
  renderer: IndexerDeterministicBlockRenderer;
  facts: readonly IndexerArtifactFact[];
}): string {
  if (input.facts.length === 0) {
    throw new TypeError("deterministic block requires at least one canonical Fact");
  }
  const facts = [...input.facts].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
  const value = projectIndexerFactValue(facts);
  if (input.renderer === "bullet-list") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new TypeError("bullet-list deterministic block requires a string-list Fact projection");
    }
    return value.map((item) => `- ${item.replaceAll("\n", "<br>")}`).join("\n");
  }
  if (input.renderer === "key-value-table") {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      !Object.values(value).every((item) => typeof item === "string")
    ) {
      throw new TypeError("key-value-table deterministic block requires a string-map Fact projection");
    }
    const values = value as Record<string, string>;
    return [
      "| Key | Value |",
      "| --- | --- |",
      ...Object.entries(values)
        .sort(([left], [right]) => compareIndexerCanonicalText(left, right))
        .map(([key, item]) =>
          `| ${key.replaceAll("|", "\\|").replaceAll("\n", "<br>")} | ${item.replaceAll("|", "\\|").replaceAll("\n", "<br>")} |`
        ),
    ].join("\n");
  }
  return `\`\`\`json\n${JSON.stringify(JSON.parse(canonicalIndexerJson(value)), null, 2)}\n\`\`\``;
}

export function indexerRenderedContentBlockDigest(
  value: z.infer<typeof renderedContentBlockPayloadSchema>,
): string {
  return indexerProtocolDigest(value);
}

export function buildIndexerRenderedContentBlock(input: {
  layer: "deterministic-block" | "semantic-prose";
  markdown: string;
  fact_refs?: readonly string[];
  evidence_refs?: readonly string[];
}): IndexerRenderedContentBlock {
  const payload = renderedContentBlockPayloadSchema.parse({
    layer: input.layer,
    markdown: input.markdown,
    fact_refs: [...new Set(input.fact_refs ?? [])].sort(compareIndexerCanonicalText),
    evidence_refs: [...new Set(input.evidence_refs ?? [])].sort(compareIndexerCanonicalText),
  });
  if (
    (payload.layer === "deterministic-block" && payload.fact_refs.length === 0) ||
    (payload.layer === "semantic-prose" && payload.fact_refs.length !== 0)
  ) {
    throw new TypeError("rendered content block does not match its Fact/prose layer");
  }
  return indexerRenderedContentBlockSchema.parse({
    ...payload,
    content_digest: indexerRenderedContentBlockDigest(payload),
  });
}

export function validateIndexerRenderedContentBlock(
  value: unknown,
): IndexerRenderedContentBlock {
  const block = indexerRenderedContentBlockSchema.parse(value);
  assertCanonicalRefs(block.fact_refs, "rendered content block fact_refs");
  assertCanonicalRefs(block.evidence_refs, "rendered content block evidence_refs");
  if (
    (block.layer === "deterministic-block" && block.fact_refs.length === 0) ||
    (block.layer === "semantic-prose" && block.fact_refs.length !== 0)
  ) {
    throw new TypeError("rendered content block does not match its Fact/prose layer");
  }
  const { content_digest: _digest, ...payload } = block;
  void _digest;
  if (indexerRenderedContentBlockDigest(payload) !== block.content_digest) {
    throw new TypeError("rendered content block digest is invalid");
  }
  return block;
}

export function materializeIndexerStructuredContent(input: {
  blocks: readonly IndexerArtifactContentBlock[];
  facts: readonly IndexerArtifactFact[];
}): IndexerRenderedContentBlock[] {
  const facts = new Map(input.facts.map((fact) => [fact.fact_ref, fact]));
  return input.blocks.map((block) => {
    if (block.layer === "semantic-prose") {
      return buildIndexerRenderedContentBlock({
        layer: block.layer,
        markdown: block.markdown,
        evidence_refs: block.evidence_refs,
      });
    }
    const referenced = block.fact_refs.map((ref) => {
      const fact = facts.get(ref);
      if (fact === undefined) {
        throw new TypeError(`deterministic block references unknown Fact ${ref}`);
      }
      return fact;
    });
    return buildIndexerRenderedContentBlock({
      layer: block.layer,
      markdown: renderIndexerDeterministicFacts({
        renderer: block.renderer,
        facts: referenced,
      }),
      fact_refs: referenced.map((fact) => fact.fact_ref),
      evidence_refs: referenced.flatMap((fact) => fact.evidence_refs),
    });
  });
}
