import {
  articleFragmentReferences, buildIndexerRenderedContentBlock,
  indexerProtocolDigest,
  type ArticleSourceReference, type IndexerArtifactResult, type IndexerJson,
  type IndexerRenderedContentBlock, type IndexerTemplateContract,
} from "@c4a/context";
import { unified } from "unified";
import remarkParse from "remark-parse";

const PLACEHOLDER = /\{\{\s*(variable|block):([a-z0-9][a-z0-9._/-]*)\s*\}\}/gu;
type TemplateArtifact = Extract<IndexerArtifactResult["artifacts"][number], { representation: "template" }>;

function renderValue(value: IndexerJson, renderer?: string): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (renderer === "bullet-list" && Array.isArray(value) && value.every(item => typeof item === "string")) {
    return value.map(item => `- ${item}`).join("\n");
  }
  if (renderer === "key-value-table" && value !== null && !Array.isArray(value) && typeof value === "object") {
    const escape = (item: unknown) => String(item).replaceAll("|", "\\|").replaceAll("\n", "<br>");
    return ["| Key | Value |", "| --- | --- |", ...Object.entries(value).map(([key, item]) =>
      `| ${escape(key)} | ${escape(item)} |`)].join("\n");
  }
  if (renderer === "json-code-fence") return "\x60\x60\x60json\n" + JSON.stringify(value, null, 2) + "\n\x60\x60\x60";
  throw new TypeError("Template collection needs a supported formatter or pre-rendered Markdown");
}

/** Variables carry source regions directly, not a secondary fact ledger. */
export function validateIndexerTemplateVariableLayers(input: {
  artifact: TemplateArtifact; contract: IndexerTemplateContract;
}): void {
  for (const [id, variable] of Object.entries(input.artifact.variables)) {
    if (!input.contract.variables.some(contract => contract.id === id)) {
      throw new TypeError(`Unknown template variable ${id}`);
    }
    articleFragmentReferences(variable.references);
  }
}

export function renderIndexerTemplateSectionLayers(input: {
  body: string;
  section: IndexerTemplateContract["sections"][number];
  artifact: TemplateArtifact;
  contract: IndexerTemplateContract;
}): Array<{ section_key: string; markdown: string; contentBlocks: IndexerRenderedContentBlock[]; references: ArticleSourceReference[] }> {
  // Parse the template, not substituted prose: one writing slot keeps its own
  // citations, and fenced blocks or lists are never cut at arbitrary newlines.
  const nodes = unified().use(remarkParse).parse(input.body).children;
  const occurrences = new Map<string, number>();
  const fragments = nodes.flatMap(node => {
    const body = input.body.slice(node.position!.start.offset!, node.position!.end.offset!);
    const references: ArticleSourceReference[] = [];
    const slots: string[] = [];
    const markdown = body.replace(PLACEHOLDER, (_token, kind: string, id: string) => {
    const block = kind === "block" ? input.contract.deterministic_blocks.find(item => item.id === id) : undefined;
    if (kind === "block" && !block) throw new TypeError(`Unknown template block ${id}`);
    const variable = input.artifact.variables[block?.source_variable_id ?? id];
    if (!variable) throw new TypeError(`Missing template variable ${id}`);
    slots.push(`${kind}-${id}`);
    references.push(...variable.references);
    return renderValue(variable.value, block?.renderer);
  }).trim();
    if (!markdown) return [];
    const merged = articleFragmentReferences(references);
    const identity = slots.length ? slots.join("--") : `text-${indexerProtocolDigest(body).slice(7, 23)}`;
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    const contentBlocks = [buildIndexerRenderedContentBlock({
    layer: "semantic-prose", markdown, references: merged,
    })];
    return [{ section_key: `${input.section.section_key}--${identity}${occurrence > 1 ? `--${occurrence}` : ""}`,
      markdown, contentBlocks, references: merged }];
  });
  // Keep the planned section's navigation target on its opening fragment.
  // Further fragments retain slot-derived identities instead of line numbers.
  if (fragments[0]) fragments[0].section_key = input.section.section_key;
  return fragments;
}
