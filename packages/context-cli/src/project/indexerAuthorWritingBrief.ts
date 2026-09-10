import type { IndexerPageTemplate } from "./indexerPageTemplate.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Present selected writing guidance and submission slots together. Complete
 * executable contracts stay in the run spec, outside the Agent's source View. */
export function projectAuthorWritingBrief(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.writing_brief === "string") return { ...value };
  const entries = Object.entries(record(value.article_templates));
  if (value.page_template) entries.unshift(["page", value.page_template]);
  const guidance = record(value.article_guidance);
  const briefs: string[] = [];
  const rendered = new Set<string>();
  const consumed = new Set<string>();
  for (const [key, raw] of entries) {
    const template = raw as IndexerPageTemplate | undefined;
    if (!template?.contract?.sections || !template.section_bodies) return { ...value };
    const contract = template.contract;
    const prose = record(key === "page" ? value.page_guidance : guidance[key]).content;
    consumed.add(key);
    const identity = JSON.stringify([template, prose]);
    if (rendered.has(identity)) continue;
    rendered.add(identity);
    briefs.push(`## ${contract.template_id}`, "", ...(typeof prose === "string" ? [prose.trim(), ""] : []),
      "Writing slots (use the accepted article key from the plan):", "",
      "| Section key | Heading | Input |", "| --- | --- | --- |");
    for (const section of contract.sections) {
      const heading = template.section_bodies[section.section_key]?.match(/^#+\s+(.+)$/mu)?.[1] ?? section.section_key;
      briefs.push(`| ${section.section_key} | ${heading.replaceAll("|", "\\|")} | ${section.deterministic_block_ids.length ? "CLI renders authorized facts; do not hand-copy the contract table." : section.variable_ids.map(id => `\`${id}\``).join(", ")} |`);
    }
    briefs.push("");
  }
  for (const [key, raw] of Object.entries({ ...guidance, ...(value.page_guidance ? { page: value.page_guidance } : {}) })) {
    if (consumed.has(key)) continue;
    const item = record(raw);
    if (typeof item.content !== "string") continue;
    briefs.push(`## ${String(item.template_id ?? key)}`, "", item.content.trim(), "");
  }
  if (!briefs.length) return { ...value };
  const result = { ...value };
  for (const key of ["page_template", "article_templates", "page_guidance", "article_guidance"]) delete result[key];
  result.writing_brief = [
    "# Selected writing guidance", "",
    "Follow the accepted plan and the relevant blueprint below. Keep useful evidence-backed text; optional headings are guidance, not completion gates. Bind semantic values to authorized evidence in their own article. Do not invent facts to fill a slot. Shared examples illustrate writing, not evidence for this task.", "",
    ...briefs,
  ].join("\n");
  return result;
}
