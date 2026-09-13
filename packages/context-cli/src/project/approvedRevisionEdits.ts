import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { expandRevisionProgramBlocks, type RevisionProgramBlock } from "./approvedRevisionPrograms.js";
import type { ArticleSourceReference } from "@c4a/context";

export interface RevisionContentInput {
  markdown?: string;
  sections?: Array<{ section_id: string; content?: Array<{ markdown: string } | { program: string }> | undefined;
    references?: Array<Omit<ArticleSourceReference, "content_digest">> | undefined }>;
}

/** Replace only explicitly identified source-bound sections. All untouched bytes
 * and each edited section's source scope survive; no heading/ordinal guessing. */
export function prepareRevisionMarkdown(base: string, input: RevisionContentInput, blocks: RevisionProgramBlock[]): string {
  if (input.markdown === undefined && input.sections === undefined) {
    throw new TypeError("Provide markdown or sections from the current revision schema");
  }
  if (input.markdown !== undefined) {
    if (input.sections?.some(section => section.content !== undefined)) {
      throw new TypeError("With full Markdown, sections only supplies fragment references");
    }
    return expandRevisionProgramBlocks(input.markdown, blocks);
  }
  const edits = new Map(input.sections!.map(edit => [edit.section_id, edit]));
  if (edits.size !== input.sections!.length || edits.size === 0) throw new TypeError("Section edits must have distinct current section identities");
  const sections = approvedContextSectionsInMarkdown(base);
  for (const id of edits.keys()) {
    if (sections.filter(section => section.id === id).length !== 1) {
      throw new TypeError(`Unknown or ambiguous section ${id}. Use current_sections from the current Route, or submit full Markdown.`);
    }
  }
  let markdown = base;
  for (const section of [...sections].reverse()) {
    const edit = edits.get(section.id);
    if (!edit || edit.content === undefined) continue;
    const content = edit.content.map(part => {
      if ("markdown" in part) return part.markdown;
      const block = blocks.find(item => item.token === part.program);
      if (!block) throw new TypeError("Select a program token listed in the current Route program_blocks");
      return block.markdown;
    }).join("\n\n");
    // The parser distinguishes literal examples in fences from real wrappers.
    if (approvedContextSectionsInMarkdown(content).length) throw new TypeError("Section content must not contain section wrappers");
    markdown = markdown.slice(0, section.bodyStart) + "\n" + content.trim() + "\n\n" + markdown.slice(section.bodyEnd);
  }
  return expandRevisionProgramBlocks(markdown, blocks);
}
