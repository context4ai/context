import { publicContractSupport, reconcilePublicContractFacts } from "./indexerPublicContractFacts.js";
import { projectIndexerPublicContractTable } from "./indexerPublicContractTable.js";
import { z } from "zod";
import { articleSourceReferenceSchema, type ArticleSourceReference } from "./articleStructure.js";
import {
  canonicalIndexerJson,
  compareIndexerCanonicalText,
  indexerCanonicalRefSchema,
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
  "multi-column-table",
  "public-contract-table",
  "json-code-block",
]);

export const indexerArtifactContentBlockSchema = z.object({
  block_id: indexerIdSchema,
  layer: z.literal("semantic-prose"),
  markdown: z.string().min(1),
  references: z.array(articleSourceReferenceSchema).max(3),
}).strict();

const renderedContentBlockPayloadSchema = z.object({
  layer: z.enum(["deterministic-block", "semantic-prose"]),
  markdown: z.string().min(1),
  references: z.array(articleSourceReferenceSchema).max(3),
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
  supporting_facts?: readonly IndexerArtifactFact[];
}): string {
  if (input.facts.length === 0) {
    throw new TypeError("deterministic block requires at least one canonical Fact");
  }
  const facts = [...input.facts].sort((left, right) =>
    compareIndexerCanonicalText(left.fact_ref, right.fact_ref)
  );
  const value = projectIndexerFactValue(facts);
  if (input.renderer === "public-contract-table") {
    const support = publicContractSupport(facts, input.supporting_facts ?? []);
    const supportingRefs = new Set(support.map(fact => fact.fact_ref));
    const tables = reconcilePublicContractFacts([...facts, ...support]).flatMap((fact) => {
      if (supportingRefs.has(fact.fact_ref) && typeof fact.value === "object" && fact.value !== null
        && !Array.isArray(fact.value) && fact.value.kind === "component") return [];
      const table = projectIndexerPublicContractTable(fact);
      return table === undefined ? [] : [table];
    });
    if (tables.length === 0) throw new TypeError("public-contract-table requires declared public contracts");
    const rendered = renderIndexerDeterministicFacts({ renderer: "multi-column-table", facts: [{
      ...facts[0]!, value: { columns: tables[0]!.columns, rows: tables.flatMap((table) => table.rows) },
    }] });
    const declarations = [...new Map(tables.filter(table => table.declaration !== undefined)
      .map(table => [JSON.stringify([table.declarationName, table.declaration]), table])).values()];
    return [rendered, ...declarations.map((table) => {
      const declaration = table.declaration!;
      const name = (table.declarationName || "Contract").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const fence = "`".repeat(Math.max(3, ...[...declaration.matchAll(/`+/gu)].map(match => match[0].length + 1)));
      return `<details>\n<summary>${name}: type details</summary>\n\n${fence}typescript\n${declaration}\n${fence}\n\n</details>`;
    })].join("\n\n");
  }
  if (input.renderer === "multi-column-table") {
    const table = z.object({ columns: z.array(z.string()).min(1), rows: z.array(z.array(z.string())) }).strict().parse(value);
    if (table.rows.some((row) => row.length !== table.columns.length)) {
      throw new TypeError("multi-column-table rows must match the declared columns");
    }
    const cell = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll("|", "&#124;").replace(/\r?\n/gu, "<br>");
    return [table.columns, table.columns.map(() => "---"), ...table.rows]
      .map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n");
  }
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
  references: readonly ArticleSourceReference[];
}): IndexerRenderedContentBlock {
  const payload = renderedContentBlockPayloadSchema.parse(input);
  return indexerRenderedContentBlockSchema.parse({
    ...payload, content_digest: indexerRenderedContentBlockDigest(payload),
  });
}

export function validateIndexerRenderedContentBlock(value: unknown): IndexerRenderedContentBlock {
  const block = indexerRenderedContentBlockSchema.parse(value);
  const { content_digest, ...payload } = block;
  if (indexerRenderedContentBlockDigest(payload) !== content_digest) {
    throw new TypeError("rendered content block digest is invalid");
  }
  return block;
}

export function materializeIndexerStructuredContent(input: {
  blocks: readonly IndexerArtifactContentBlock[];
  render_cache?: Map<string, IndexerRenderedContentBlock[]> | undefined;
}): IndexerRenderedContentBlock[] {
  // No full fact array is hashed, cloned or rebound to a prose section.
  return input.blocks.map(block => buildIndexerRenderedContentBlock({
    layer: block.layer, markdown: block.markdown, references: block.references,
  }));
}
