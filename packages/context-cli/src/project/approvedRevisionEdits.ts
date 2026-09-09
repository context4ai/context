import { approvedContextSectionsInMarkdown } from "./verifyContextSections.js";
import { expandRevisionProgramBlocks, type RevisionProgramBlock } from "./approvedRevisionPrograms.js";

export interface RevisionContentInput {
  markdown?: string;
  sections?: Array<{ section_id: string; content: Array<{ markdown: string } | { program: string }> }>;
}

/** Replace only explicitly identified source-bound sections. All untouched bytes
 * and each edited section's source scope survive; no heading/ordinal guessing. */
export function prepareRevisionMarkdown(base: string, input: RevisionContentInput, blocks: RevisionProgramBlock[]): string {
  if ((input.markdown === undefined) === (input.sections === undefined)) {
    throw new TypeError("Provide exactly one of markdown or sections from the current revision schema");
  }
  if (input.markdown !== undefined) return expandRevisionProgramBlocks(input.markdown, blocks);
  const edits = new Map(input.sections!.map(edit => [edit.section_id, edit]));
  if (edits.size !== input.sections!.length || edits.size === 0) throw new TypeError("Section edits must have distinct current section identities");
  const sections = approvedContextSectionsInMarkdown(base);
  for (const id of edits.keys()) {
    if (sections.filter(section => section.id === id).length !== 1) {
      throw new TypeError(`Unknown or ambiguous section ${id}. Use current_sections from the current Route, or submit full Markdown.`);
    }
  }
  let index = 0;
  const markdown = base.replace(/(<!--\s*context:section\b[\s\S]*?-->)([\s\S]*?)(<!--\s*\/context:section\s*-->|$)/giu,
    (whole: string, opening: string, _body: string, closing: string) => {
      const section = sections[index++]!;
      const edit = section.id === undefined ? undefined : edits.get(section.id);
      if (!edit) return whole;
      if (!closing) throw new TypeError("Section editing requires a closed source-bound section; submit full Markdown to repair structure");
      const content = edit.content.map(part => {
        if ("markdown" in part) return part.markdown;
        const block = blocks.find(item => item.token === part.program);
        if (!block) throw new TypeError("Select a program token listed in the current Route program_blocks");
        return block.markdown;
      }).join("\n\n");
      if (/<!--\s*\/?context:section\b/iu.test(content)) throw new TypeError("Section content must not contain section wrappers");
      return `${opening}\n\n<!-- context:source_refs\n${JSON.stringify(section.refs)}\n/context:source_refs -->\n\n${content.trim()}\n\n${closing}`;
    });
  return expandRevisionProgramBlocks(markdown, blocks);
}
