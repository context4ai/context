import { validateIndexerPrimaryResultView, type IndexerPrimaryResultView } from "@c4a/context";
import { readingBlock } from "./indexerAgentReading.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Strip only the known section/block carrier. Provider values remain verbatim. */
function sectionsReading(value: unknown, aliases: Map<string, string>): string {
  if (!Array.isArray(value)) return readingBlock(value);
  return value.map((value) => {
    const section = object(value);
    if (!section || !Array.isArray(section.blocks)) return readingBlock(value);
    const { blocks, ...metadata } = section;
    return [readingBlock(metadata), ...blocks.map((value) => {
      const block = object(value);
      if (!block) return readingBlock(value);
      if (block.layer === "semantic-prose" && typeof block.markdown === "string") {
        const { markdown, evidence_refs: _refs, block_id: _id, layer: _layer, ...extra } = block;
        void _refs; void _id; void _layer;
        return [Object.keys(extra).length ? readingBlock(extra) : "", markdown].filter(Boolean).join("\n\n");
      }
      if (block.layer === "deterministic-block" && Array.isArray(block.fact_refs)) {
        const { fact_refs, block_id: _id, ...rest } = block;
        void _id;
        return readingBlock({ ...rest, fact_refs: fact_refs.map((ref) => aliases.get(String(ref)) ?? ref) });
      }
      return readingBlock(block);
    })].join("\n\n");
  }).join("\n\n");
}

export function renderIndexerPostAuthorReading(input: IndexerPrimaryResultView): string {
  const view = validateIndexerPrimaryResultView(input);
  const subjects = new Map<string, string>();
  for (const item of [...view.facts, ...view.artifacts]) {
    const key = JSON.stringify(item.subject_key);
    if (!subjects.has(key)) subjects.set(key, `subject:${subjects.size + 1}`);
  }
  const aliases = new Map(view.facts.map((fact, index) => [fact.fact_ref, `fact:${index + 1}`]));
  const lines = ["# Current composer material", "Use fact:N or artifact:N as source_refs in this task. The CLI restores their original evidence bindings. These aliases are local to this View; use the current Route for targets and output constraints.",
    "## Subjects", ...[...subjects].map(([key, alias]) => {
      const { protocol: _protocol, ...subject } = JSON.parse(key);
      void _protocol;
      return readingBlock({ ref: alias, ...subject });
    }), "## Facts"];
  for (const [index, fact] of view.facts.entries()) lines.push(`### fact:${index + 1}`,
    readingBlock({ subject: subjects.get(JSON.stringify(fact.subject_key)), kind: fact.fact_kind, value: fact.value }));
  lines.push("## Primary pages");
  for (const [index, artifact] of view.artifacts.entries()) {
    lines.push(`### artifact:${index + 1}`, readingBlock({ subject: subjects.get(JSON.stringify(artifact.subject_key)),
      kind: artifact.artifact_kind, policy: artifact.artifact_policy_variant }));
    if (artifact.variables.representation === "sections") {
      const { sections, representation: _representation, ...extra } = artifact.variables;
      void _representation;
      if (Object.keys(extra).length) lines.push(readingBlock(extra));
      lines.push(sectionsReading(sections, aliases));
    } else lines.push(readingBlock(artifact.variables));
  }
  return `${lines.join("\n\n")}\n`;
}
