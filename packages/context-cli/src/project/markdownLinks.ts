import remarkParse from "remark-parse";
import { unified } from "unified";

interface MdastPoint {
  line?: number;
  offset?: number;
}

interface MdastNode {
  type?: string;
  alt?: string;
  identifier?: string;
  url?: string;
  children?: MdastNode[];
  position?: {
    start?: MdastPoint;
    end?: MdastPoint;
  };
}

/** Reader link occurrences, including reference-style links. Unlike destination
 * rewrites, a presentation projection replaces the whole link with its label. */
export function markdownReaderLinks(content: string): Array<Pick<MarkdownInlineLink, "image" | "label" | "target" | "start" | "end">> {
  // Both supported link forms require a bracket. This is only a lexical
  // absence check; anything potentially containing a link still uses Markdown.
  if (!content.includes("[")) return [];
  const tree = unified().use(remarkParse).parse(content) as MdastNode;
  const links: Array<Pick<MarkdownInlineLink, "image" | "label" | "target" | "start" | "end">> = inlineLinksFromTree(content, tree);
  const definitions = new Map<string, string>();
  const walk = (node: MdastNode, visit: (node: MdastNode) => void): void => {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  };
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier !== undefined && node.url !== undefined && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
  });
  walk(tree, (node) => {
    if (node.type !== "linkReference" && node.type !== "imageReference") return;
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    const target = definitions.get(node.identifier ?? "");
    if (start === undefined || end === undefined || target === undefined) return;
    const labelStart = node.children?.[0]?.position?.start?.offset;
    const labelEnd = node.children?.at(-1)?.position?.end?.offset;
    links.push({ image: node.type === "imageReference", start, end, target,
      label: labelStart === undefined || labelEnd === undefined ? node.alt ?? "" : content.slice(labelStart, labelEnd) });
  });
  return links.sort((left, right) => left.start - right.start);
}

export interface MarkdownInlineLink {
  image: boolean;
  label: string;
  /** Parsed URL: Markdown escapes/entities are decoded; URI percent escapes are retained. */
  target: string;
  targetStart: number;
  targetEnd: number;
  start: number;
  end: number;
  line?: number;
}

function closingLabelOffset(raw: string): number | undefined {
  const labelStart = raw.startsWith("![") ? 2 : raw.startsWith("[") ? 1 : -1;
  if (labelStart < 0) return;
  let depth = 1;
  for (let index = labelStart; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    if (char !== "]") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return;
}

function destinationRange(raw: string): { start: number; end: number; labelEnd: number } | undefined {
  const labelEnd = closingLabelOffset(raw);
  if (labelEnd === undefined || raw[labelEnd + 1] !== "(") return undefined;
  let index = labelEnd + 2;
  while (index < raw.length && /\s/u.test(raw[index] ?? "")) index += 1;
  if (raw[index] === "<") {
    const start = index + 1;
    index += 1;
    while (index < raw.length) {
      if (raw[index] === "\\") {
        index += 2;
        continue;
      }
      if (raw[index] === ">") return { start, end: index, labelEnd };
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
  return { start, end: index, labelEnd };
}

export function markdownInlineLinks(content: string): MarkdownInlineLink[] {
  if (!content.includes("[")) return [];
  const tree = unified().use(remarkParse).parse(content) as MdastNode;
  return inlineLinksFromTree(content, tree);
}

function inlineLinksFromTree(content: string, tree: MdastNode): MarkdownInlineLink[] {
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
              : raw.slice(1, range.labelEnd),
            target: node.url ?? raw.slice(range.start, range.end),
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

/** Serialize a URL inside an inline destination, definition or table cell. */
export function markdownLinkDestination(target: string): string {
  // URI escapes protect bare destinations and table cells. Only an '&' that
  // starts a character reference is escaped, so raw Markdown keeps usable URLs.
  return target.replace(/[\u0000-\u0020\u007f<>\\()|]/gu, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)
    .replace(/&(?=(?:[A-Za-z][A-Za-z0-9]{0,31}|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});)/gu, "&amp;");
}

export function replaceMarkdownInlineLinkTargets(
  content: string,
  replacement: (link: MarkdownInlineLink) => string | undefined,
): string {
  const links = markdownInlineLinks(content);
  // Reference-style destinations live in definitions, not at the [label][id]
  // occurrence. Rewrite each definition once without changing reader labels.
  if (content.includes("]:")) {
    const tree = unified().use(remarkParse).parse(content) as MdastNode;
    const visit = (node: MdastNode): void => {
      if (node.type === "definition" && node.url !== undefined) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (start !== undefined && end !== undefined) {
          const raw = content.slice(start, end);
          const labelEnd = closingLabelOffset(raw);
          if (labelEnd !== undefined && raw[labelEnd + 1] === ":") {
            let offset = labelEnd + 2;
            while (/\s/u.test(raw[offset] ?? "") && offset < raw.length) offset += 1;
            const angle = raw[offset] === "<";
            const match = angle ? /^<((?:\\.|[^>])*)>/u.exec(raw.slice(offset)) : /^((?:\\.|[^\s])+)/u.exec(raw.slice(offset));
            if (match) {
              const targetStart = start + offset + (angle ? 1 : 0);
              links.push({ image: false, label: node.identifier ?? "", target: node.url, start, end,
                targetStart, targetEnd: targetStart + match[1]!.length });
            }
          }
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  }
  // A nested image starts after its enclosing link, but its destination comes
  // first. Sort edit spans rather than nodes to preserve both destinations.
  links.sort((a, b) => a.targetStart - b.targetStart);
  let cursor = 0;
  let output = "";
  for (const link of links) {
    const target = replacement(link);
    if (target === undefined || target === link.target) continue;
    output += content.slice(cursor, link.targetStart);
    output += markdownLinkDestination(target);
    cursor = link.targetEnd;
  }
  return cursor === 0 ? content : `${output}${content.slice(cursor)}`;
}
