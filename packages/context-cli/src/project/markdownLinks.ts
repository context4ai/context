import remarkParse from "remark-parse";
import { unified } from "unified";

interface MdastPoint {
  line?: number;
  offset?: number;
}

interface MdastNode {
  type?: string;
  alt?: string;
  children?: MdastNode[];
  position?: {
    start?: MdastPoint;
    end?: MdastPoint;
  };
}

export interface MarkdownInlineLink {
  image: boolean;
  label: string;
  target: string;
  targetStart: number;
  targetEnd: number;
  start: number;
  end: number;
  line?: number;
}

function destinationRange(raw: string): { start: number; end: number } | undefined {
  const labelStart = raw.startsWith("![") ? 2 : raw.startsWith("[") ? 1 : -1;
  if (labelStart < 0) return undefined;
  let depth = 1;
  let index = labelStart;
  for (; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    if (char !== "]") continue;
    depth -= 1;
    if (depth === 0) break;
  }
  if (depth !== 0 || raw[index + 1] !== "(") return undefined;
  index += 2;
  while (index < raw.length && /\s/u.test(raw[index] ?? "")) index += 1;
  if (raw[index] === "<") {
    const start = index + 1;
    index += 1;
    while (index < raw.length) {
      if (raw[index] === "\\") {
        index += 2;
        continue;
      }
      if (raw[index] === ">") return { start, end: index };
      index += 1;
    }
    return undefined;
  }
  const start = index;
  let parentheses = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      if (parentheses === 0) break;
      parentheses -= 1;
      index += 1;
      continue;
    }
    if (parentheses === 0 && /\s/u.test(char ?? "")) break;
    index += 1;
  }
  return index > start ? { start, end: index } : undefined;
}

export function markdownInlineLinks(content: string): MarkdownInlineLink[] {
  const tree = unified().use(remarkParse).parse(content) as MdastNode;
  const links: MarkdownInlineLink[] = [];
  const visit = (node: MdastNode): void => {
    if (node.type === "link" || node.type === "image") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start !== undefined && end !== undefined) {
        const raw = content.slice(start, end);
        const range = destinationRange(raw);
        if (range !== undefined) {
          links.push({
            image: node.type === "image",
            label: node.type === "image"
              ? node.alt ?? ""
              : raw.slice(raw.startsWith("![") ? 2 : 1, raw.indexOf("](")),
            target: raw.slice(range.start, range.end),
            targetStart: start + range.start,
            targetEnd: start + range.end,
            start,
            end,
            ...(node.position?.start?.line === undefined ? {} : { line: node.position.start.line }),
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return links.sort((left, right) => left.start - right.start);
}

export function replaceMarkdownInlineLinkTargets(
  content: string,
  replacement: (link: MarkdownInlineLink) => string | undefined,
): string {
  const links = markdownInlineLinks(content);
  let cursor = 0;
  let output = "";
  for (const link of links) {
    const target = replacement(link);
    if (target === undefined || target === link.target) continue;
    output += content.slice(cursor, link.targetStart);
    output += target;
    cursor = link.targetEnd;
  }
  return cursor === 0 ? content : `${output}${content.slice(cursor)}`;
}
