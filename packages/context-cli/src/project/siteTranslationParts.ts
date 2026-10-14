import { createHash } from "node:crypto";
import { z } from "zod";
import { stringify as yaml } from "yaml";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";

export const translationPartsSchema = z.object({
  title: z.string(), description: z.string(), order: z.array(z.string()),
  sections: z.record(z.string()), exterior: z.record(z.string()),
}).strict();
export type TranslationParts = z.infer<typeof translationPartsSchema>;
export const translationTextDigest = (text: string) => createHash("sha256").update(text).digest("hex");
type Segment = { kind: "sections" | "exterior"; key: string; text: string };

function parts(content: string) {
  const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(content);
  const meta = parseKnowledgeFrontmatter(content);
  const body = header ? content.slice(header[0].length) : content;
  const sections = approvedContextSectionsInMarkdown(body);
  const segments: Segment[] = [];
  let cursor = 0;
  let previous: string | null = null;
  for (const section of sections) {
    const start = body.lastIndexOf("\n", section.bodyStart - 2) + 1;
    const closing = body.indexOf("\n", section.bodyEnd);
    const end = closing < 0 ? body.length : closing + 1;
    segments.push({ kind: "exterior", key: JSON.stringify([previous, section.id]), text: body.slice(cursor, start) });
    segments.push({ kind: "sections", key: section.id, text: body.slice(start, end) });
    previous = section.id; cursor = end;
  }
  segments.push({ kind: "exterior", key: JSON.stringify([previous, null]), text: body.slice(cursor) });
  return { title: typeof meta.title === "string" ? meta.title : "", description: typeof meta.description === "string" ? meta.description : undefined,
    order: sections.map(section => section.id), segments };
}
export function translationSourceParts(content: string): TranslationParts {
  const parsed = parts(content);
  return { title: translationTextDigest(parsed.title), description: translationTextDigest(JSON.stringify(parsed.description ?? null)),
    order: parsed.order, sections: Object.fromEntries(parsed.segments.filter(s => s.kind === "sections").map(s => [s.key, translationTextDigest(s.text)])),
    exterior: Object.fromEntries(parsed.segments.filter(s => s.kind === "exterior").map(s => [s.key, translationTextDigest(s.text)])) };
}
export function translationPartsDiff(current: TranslationParts, previous?: TranslationParts) {
  if (!previous) return "unknown" as const;
  return { title: current.title !== previous.title, description: current.description !== previous.description,
    preamble: JSON.stringify(current.exterior) !== JSON.stringify(previous.exterior),
    order: JSON.stringify(current.order) !== JSON.stringify(previous.order),
    added: current.order.filter(id => !(id in previous.sections)),
    modified: current.order.filter(id => id in previous.sections && current.sections[id] !== previous.sections[id]),
    deleted: previous.order.filter(id => !(id in current.sections)) };
}
export function translationDraft(source: string, translation?: string, baseline?: TranslationParts): string {
  const current = parts(source);
  const hashes = translationSourceParts(source);
  const previous = translation === undefined ? undefined : parts(translation);
  const keepTitle = previous && baseline?.title === hashes.title;
  const keepDescription = previous && baseline?.description === hashes.description;
  const title = keepTitle ? previous.title : current.title;
  const description = keepDescription ? previous.description : current.description;
  const body = current.segments.map(segment => {
    if (!previous || baseline?.[segment.kind][segment.key] !== hashes[segment.kind][segment.key]) return segment.text;
    return previous.segments.find(old => old.kind === segment.kind && old.key === segment.key)?.text ?? segment.text;
  }).join("");
  return `---\n${yaml({ title, ...(description === undefined ? {} : { description }) }).trimEnd()}\n---\n${body}`;
}
