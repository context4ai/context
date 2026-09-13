export interface ApprovedContextSection {
  id: string;
  line: number;
  readerVisibleBody: string;
  bodyStart: number;
  bodyEnd: number;
}

function decodeAttribute(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** Stable fragment markers only. Source locations live in structure, not comments.
 * A line scan avoids repeatedly slicing the complete document to count lines.
 * Markers shown inside fenced examples are ordinary reader content. */
export function approvedContextSectionsInMarkdown(content: string): ApprovedContextSection[] {
  const result: ApprovedContextSection[] = [];
  let current: { id: string; line: number; bodyStart: number; lines: string[] } | undefined;
  let fence: { character: string; length: number } | undefined;
  let offset = 0;
  const lines = content.split(/(?<=\n)/u);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const start = offset;
    offset += raw.length;
    const line = raw.replace(/\r?\n$/u, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      current?.lines.push(raw);
      if (delimiter && delimiter[1]![0] === fence.character &&
          delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = undefined;
      continue;
    }
    if (delimiter) {
      fence = { character: delimiter[1]![0]!, length: delimiter[1]!.length };
      current?.lines.push(raw);
      continue;
    }
    const opening = /^\s*<!--\s*context:section\s+id="([^"]+)"\s*-->\s*$/u.exec(line);
    if (opening) {
      if (current) throw new TypeError(`Nested article fragment at line ${index + 1}`);
      current = { id: decodeAttribute(opening[1]!), line: index + 1, bodyStart: offset, lines: [] };
      continue;
    }
    if (/^\s*<!--\s*\/context:section\s*-->\s*$/u.test(line)) {
      if (!current) throw new TypeError(`Unmatched article fragment end at line ${index + 1}`);
      result.push({ id: current.id, line: current.line, readerVisibleBody: current.lines.join("").trim(), bodyStart: current.bodyStart, bodyEnd: start });
      current = undefined;
      continue;
    }
    if (/^\s*<!--\s*context:section\b/u.test(line)) throw new TypeError(`Invalid article fragment marker at line ${index + 1}`);
    current?.lines.push(raw);
  }
  if (current) throw new TypeError(`Unclosed article fragment ${current.id}`);
  return result;
}
