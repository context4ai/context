import YAML from "yaml";
import { z } from "zod";
import { articleSourceLocatorSchema, type ArticleSourceReference } from "@c4a/context";
import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { durableContentDigest } from "./durableSingleFileTransaction.js";
import type { FixedProductionFile, FixedProductionTask } from "./productionSubmissionFiles.js";

export const productionReferenceInputSchema = z.object({ source_ref: z.string().min(1), locator: articleSourceLocatorSchema }).strict();
const fragment = z.object({
  id: z.string().min(1).regex(/^[^"\r\n<>]+$/u),
  markdown: z.string().optional(),
  references: z.array(productionReferenceInputSchema).optional(),
}).strict();

// One explicit old -> new mapping covers replacement, deletion, split and
// merge. An empty old list inserts after a stable fragment (null means first).
export const productionArticleEditsSchema = z.object({
  edits: z.array(z.object({
    replace: z.array(z.string().min(1)),
    with: z.array(fragment),
    after: z.string().min(1).nullable().optional(),
  }).strict()).min(1),
}).strict();

type BaseReference = Omit<ArticleSourceReference, "content_digest"> & { content_digest?: string };
export interface ProductionArticleBase {
  markdown: string;
  sections: Array<{ id: string; references: BaseReference[] }>;
}

function fixed(path: string, text: string): FixedProductionFile {
  return { path, text, digest: durableContentDigest(text), bytes: Buffer.byteLength(text) };
}

/** Apply all edits against one fixed base, not successively guessed headings.
 * Untouched bytes and references survive. The caller validates the complete
 * resulting article before accepting it. Nothing is written here. */
export function applyProductionArticleEdits(base: ProductionArticleBase, files: FixedProductionTask): {
  files: FixedProductionTask;
  retainedReferences: ReadonlyMap<string, BaseReference[]>;
} {
  if (!files.edits || files.content || files.references) throw new TypeError("A fragment revision uses only an edits file; references belong with each changed fragment.");
  const input = productionArticleEditsSchema.parse(YAML.parse(files.edits.text));
  const sections = approvedContextSectionsInMarkdown(base.markdown);
  const previous = new Map(base.sections.map(section => [section.id, section.references]));
  if (!sections.length || previous.size !== base.sections.length || previous.size !== sections.length ||
      new Set(sections.map(section => section.id)).size !== sections.length || sections.some(section => !previous.has(section.id))) {
    throw new TypeError("The base article and its fragment references disagree. Read and repair the current article before revising it.");
  }
  const spans = sections.map(section => {
    const start = base.markdown.lastIndexOf("\n", section.bodyStart - 2) + 1;
    const endLine = base.markdown.indexOf("\n", section.bodyEnd);
    return { ...section, start, end: endLine < 0 ? base.markdown.length : endLine + 1 };
  });
  const used = new Set<string>();
  const retainedReferences = new Map(previous);
  const resulting = new Map<string, Array<Omit<ArticleSourceReference, "content_digest">>>(previous);
  const patches: Array<{ start: number; end: number; text: string }> = [];
  const anchors: string[] = [];
  const additions = new Set<string | null>();
  for (const edit of input.edits) {
    if (!edit.replace.length && !edit.with.length) throw new TypeError("An edit must replace or insert fragments.");
    const old = edit.replace.map(id => {
      const section = spans.find(section => section.id === id);
      if (!section || used.has(id)) throw new TypeError(`Unknown, ambiguous or repeated fragment: ${id}. Read the current article.`);
      used.add(id);
      return section;
    });
    if (old.length && edit.after !== undefined) throw new TypeError("Use after only for an insertion with an empty replace list.");
    for (let index = 1; index < old.length; index++) {
      if (spans.indexOf(old[index]!) !== spans.indexOf(old[index - 1]!) + 1 ||
          base.markdown.slice(old[index - 1]!.end, old[index]!.start).trim()) {
        throw new TypeError("A merge must list adjacent fragments in their current order without deleting intervening article text. Otherwise submit the complete article.");
      }
    }
    let start: number;
    let end: number;
    if (old.length) { start = old[0]!.start; end = old.at(-1)!.end; }
    else {
      if (edit.after === undefined || additions.has(edit.after)) throw new TypeError("Each insertion needs a unique after anchor, or null before the first fragment.");
      additions.add(edit.after);
      const anchor = edit.after === null ? undefined : spans.find(section => section.id === edit.after);
      if (edit.after !== null && !anchor) throw new TypeError(`Unknown insertion anchor: ${edit.after}`);
      if (anchor) anchors.push(anchor.id);
      start = end = anchor?.end ?? spans[0]!.start;
    }
    for (const section of old) { resulting.delete(section.id); retainedReferences.delete(section.id); }
    const replacement = edit.with.map(value => {
      const source = old.find(section => section.id === value.id);
      if (resulting.has(value.id)) throw new TypeError(`Fragment identity already exists: ${value.id}`);
      if (!source && (value.markdown === undefined || value.references === undefined)) {
        throw new TypeError(`New fragment ${value.id} requires markdown and references; do not infer citations across a split or merge.`);
      }
      const references = value.references ?? previous.get(value.id)!;
      // Agent reference inputs are validated and hashed later. Retained source
      // digests must still match; a content-only edit cannot bless changed evidence.
      resulting.set(value.id, references);
      if (value.references === undefined) retainedReferences.set(value.id, previous.get(value.id)!);
      if (value.markdown === undefined) return base.markdown.slice(source!.start, source!.end);
      if (approvedContextSectionsInMarkdown(value.markdown).length) throw new TypeError(`Fragment ${value.id} markdown must not contain fragment wrappers.`);
      const id = value.id.replaceAll("&", "&amp;");
      return `<!-- context:section id="${id}" -->\n${value.markdown}\n<!-- /context:section -->\n`;
    }).join("\n");
    patches.push({ start, end, text: replacement });
  }
  if (anchors.some(id => used.has(id))) throw new TypeError("An insertion anchor cannot also be replaced in the same revision. Include the new fragment in that replacement instead.");
  let markdown = base.markdown;
  for (const patch of patches.sort((a, b) => b.start - a.start || b.end - a.end)) {
    markdown = markdown.slice(0, patch.start) + patch.text + markdown.slice(patch.end);
  }
  const references = { sections: approvedContextSectionsInMarkdown(markdown).map(section => ({
    id: section.id, references: resulting.get(section.id)!.map(ref => ({ source_ref: ref.source_ref, locator: ref.locator })),
  })) };
  return { files: { task: files.task, input: files.input,
    content: fixed(files.edits.path, markdown), references: fixed(files.edits.path, YAML.stringify(references)) }, retainedReferences };
}
