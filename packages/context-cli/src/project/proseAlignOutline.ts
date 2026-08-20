import {
  isMarkdownIndentedCodeLine,
  updateMarkdownFenceState,
  type FenceState,
} from "../incremental/rawBlocks.js";
import type { RawBlock } from "../incremental/rawBlocks.js";

function stableRawLineQuote(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 180);
}

export interface AlignRawHeading {
  level: number;
  line: number;
  title: string;
  path: string[];
}

export interface AlignRawOutline {
  source_id: string;
  file: string;
  source_type?: string;
  headings: AlignRawHeading[];
  relation_lines: Array<{
    file: string;
    line: number;
    quote: string;
  }>;
  relation_hints: AlignRelationHint[];
  evidence_blocks: Array<{
    kind: RawBlock["kind"];
    heading_path: string[];
    line_range: string;
    text_preview: string;
  }>;
}

export interface AlignRelationHint {
  kind: "parent" | "children" | "related" | "relations";
  file: string;
  line: number;
  quote: string;
  targets: Array<{
    title: string;
    href?: string;
  }>;
}

function relationKind(label: string): AlignRelationHint["kind"] {
  const normalized = label.trim().toLowerCase();
  if (normalized === "parent" || normalized === "parents" || normalized === "父级") return "parent";
  if (normalized === "child" || normalized === "children" || normalized === "子级") return "children";
  if (normalized === "related" || normalized === "关联") return "related";
  return normalized === "relation" ? "related" : "relations";
}

function relationTargets(line: string): AlignRelationHint["targets"] {
  const targets: AlignRelationHint["targets"] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/gu;
  for (const match of line.matchAll(linkPattern)) {
    const title = match[1]?.trim();
    const href = match[2]?.trim();
    if (!title) continue;
    targets.push(href ? { title, href } : { title });
  }
  return targets;
}

function parseRelationLine(line: string, file: string, bodyLine: number): {
  mention: { file: string; line: number; quote: string };
  hint: AlignRelationHint;
} | null {
  const normalized = line
    .trim()
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/u, "")
    .replace(/^\*\*(.+?)\*\*/u, "$1");
  const match = /^(Parent|Parents|Children|Child|Related|Relations|Relation|父级|子级|关联|关系)\s*[:：]/iu.exec(normalized);
  const label = match?.[1];
  if (!label) return null;
  const quote = stableRawLineQuote(line);
  return {
    mention: { file, line: bodyLine, quote },
    hint: {
      kind: relationKind(label),
      file,
      line: bodyLine,
      quote,
      targets: relationTargets(line),
    },
  };
}

const IGNORED_RELATION_HEADINGS = new Set([
  "relations",
  "relation",
  "related",
  "parent",
  "children",
  "references",
  "links",
  "导航",
  "关系",
  "关联",
  "父级",
  "子级",
  "参考",
  "参考链接",
]);

function isRelationHeadingTitle(title: string | undefined): boolean {
  return title !== undefined && IGNORED_RELATION_HEADINGS.has(title.trim().replace(/[:：]\s*$/u, "").toLowerCase());
}

function dropTrailingRelationHeadings(stack: Array<{ level: number; title: string }>): void {
  while (isRelationHeadingTitle(stack.at(-1)?.title)) {
    stack.pop();
  }
}

export function buildRawOutline(input: {
  sourceId: string;
  rawFile: string;
  markdown: string;
  blocks: readonly RawBlock[];
  sourceType?: string;
}): AlignRawOutline {
  const headings: AlignRawHeading[] = [];
  const relationLines: AlignRawOutline["relation_lines"] = [];
  const relationHints: AlignRelationHint[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let fence: FenceState | null = null;
  const lines = input.markdown.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceUpdate = updateMarkdownFenceState(fence, line);
    if (fenceUpdate.matched) {
      fence = fenceUpdate.fence;
      continue;
    }
    if (fence !== null) continue;
    if (isMarkdownIndentedCodeLine(line)) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      const level = heading[1].length;
      const title = heading[2]?.trim() ?? "";
      if (title.length > 0) {
        const relationParent = stack.at(-1);
        if (relationParent && isRelationHeadingTitle(relationParent.title) && level > relationParent.level) {
          dropTrailingRelationHeadings(stack);
        }
        while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
        stack.push({ level, title });
        headings.push({ level, line: index + 1, title, path: stack.map((entry) => entry.title) });
      }
      continue;
    }
    const relation = parseRelationLine(line, input.rawFile, index + 1);
    if (relation) {
      relationLines.push(relation.mention);
      relationHints.push(relation.hint);
    }
  }
  return {
    source_id: input.sourceId,
    file: input.rawFile,
    ...(input.sourceType !== undefined ? { source_type: input.sourceType } : {}),
    headings,
    relation_lines: relationLines,
    relation_hints: relationHints,
    evidence_blocks: input.blocks.slice(0, 80).map((block) => ({
      kind: block.kind,
      heading_path: block.heading_path,
      line_range: block.line_range,
      text_preview: block.text_preview,
    })),
  };
}
