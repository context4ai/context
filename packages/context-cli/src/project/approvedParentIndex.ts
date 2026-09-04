import { dirname, relative } from "node:path/posix";

export const PARENT_INDEX_GENERATED_KIND = "parent_index";

export interface ParentIndexChild {
  view_ref: string;
  node_ref: string;
  title: string;
  path: string;
  summary?: string;
}

function relativeMarkdownLink(fromPath: string, toPath: string): string {
  const link = relative(dirname(fromPath), toPath);
  return link.length === 0 ? toPath : link;
}

export function renderParentIndexBody(input: {
  title: string;
  path: string;
  children: readonly ParentIndexChild[];
}): string {
  return [
    `# ${input.title}`,
    "",
    ...input.children.map((child) => {
      const suffix = child.summary === undefined || child.summary.trim().length === 0
        ? ""
        : ` — ${child.summary.trim()}`;
      return `- [${child.title}](${relativeMarkdownLink(input.path, child.path)})${suffix}`;
    }),
  ].join("\n").trimEnd();
}
