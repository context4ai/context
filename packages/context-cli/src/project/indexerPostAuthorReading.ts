import { isDeepStrictEqual } from "node:util";
import { validateIndexerPrimaryResultView, type IndexerPrimaryResultView } from "@c4a/context";
import { readingBlock } from "./indexerAgentReading.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Strip only the known section/block carrier. Provider values remain verbatim. */
function sectionsReading(value: unknown): string {
  if (!Array.isArray(value)) return readingBlock(value);
  const first = object(value[0]);
  const common = Object.fromEntries(Object.entries(first ?? {}).filter(([key, entry]) =>
    key !== "blocks" && key !== "section_key" && value.length > 1 &&
    value.every(section => Object.hasOwn(object(section) ?? {}, key) && isDeepStrictEqual(object(section)?.[key], entry))));
  const sections = value.map((value) => {
    const section = object(value);
    if (!section || !Array.isArray(section.blocks)) return readingBlock(value);
    const { blocks, ...metadata } = section;
    for (const key of Object.keys(common)) delete metadata[key];
    return [readingBlock(metadata), ...blocks.map((value) => {
      const block = object(value);
      if (!block) return readingBlock(value);
      if (block.layer === "semantic-prose" && typeof block.markdown === "string") {
        const { markdown, block_id: _id, layer: _layer, ...extra } = block;
        void _id; void _layer;
        return [Object.keys(extra).length ? readingBlock(extra) : "", markdown].filter(Boolean).join("\n\n");
      }
      return readingBlock(block);
    })].join("\n\n");
  }).join("\n\n");
  return [Object.keys(common).length ? `Shared section fields (apply to every section):\n${readingBlock(common)}` : "", sections].filter(Boolean).join("\n\n");
}

export function renderIndexerPostAuthorReading(input: IndexerPrimaryResultView): string {
  const view = validateIndexerPrimaryResultView(input);
  const lines = ["# Current composer material",
    "Read the primary pages and their actual region references. Use the current Route for output targets and captured source access. References identify source text, not proof that all useful content is covered. Do not submit fact IDs or subject identities.",
    "## Primary pages"];
  for (const [index, artifact] of view.artifacts.entries()) {
    lines.push(`### artifact:${index + 1}`, readingBlock({
      kind: artifact.artifact_kind, policy: artifact.artifact_policy_variant }));
    if (artifact.variables.representation === "sections") {
      const { sections, representation: _representation, ...extra } = artifact.variables;
      void _representation;
      if (Object.keys(extra).length) lines.push(readingBlock(extra));
      lines.push(sectionsReading(sections));
    } else lines.push(readingBlock(artifact.variables));
  }
  return `${lines.join("\n\n")}\n`;
}
