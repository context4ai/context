import { articleSourceLocatorSchema, articleSourceLocatorInputSchema, type ArticleSourceLocator, type ArticleSourceLocatorInput } from "@c4a/context";

export const submittedSourceLocatorSchema = articleSourceLocatorInputSchema;
export type SubmittedSourceLocator = ArticleSourceLocatorInput;
export interface SubmittedSourceReference { source_ref: string; locator: SubmittedSourceLocator }

/** Call only after authorization, with the same captured text used for hashing. */
export function resolveSubmittedSourceLocator(input: SubmittedSourceLocator, capturedText: string): ArticleSourceLocator {
  const locator = submittedSourceLocatorSchema.parse(input);
  if ("start_line" in locator) return locator;
  const text = capturedText.replace(/\r\n/gu, "\n");
  const lines = text.split("\n");
  const matches: Array<{ start_line: number; end_line: number }> = [];
  if ("quote" in locator) {
    const quote = locator.quote.replace(/\r\n/gu, "\n");
    for (let offset = text.indexOf(quote); offset >= 0; offset = text.indexOf(quote, offset + 1)) {
      matches.push({ start_line: text.slice(0, offset).split("\n").length,
        end_line: text.slice(0, offset + quote.length - 1).split("\n").length });
    }
  } else {
    if (!/\.(?:md|markdown|mdx)$/iu.test(locator.path)) throw new TypeError("heading requires a Markdown source; use quote or start_line/end_line instead.");
    const headings: Array<{ line: number; level: number; title: string }> = [];
    let fence: { character: string; length: number } | undefined;
    for (const [index, line] of lines.entries()) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (marker && marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
        continue;
      }
      if (marker) { fence = { character: marker[1]![0]!, length: marker[1]!.length }; continue; }
      const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(line);
      if (match) headings.push({ line: index + 1, level: match[1]!.length, title: (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trim() });
    }
    for (const [index, heading] of headings.entries()) {
      if (heading.title !== locator.heading) continue;
      let end = (headings.slice(index + 1).find(next => next.level <= heading.level)?.line ?? lines.length + 1) - 1;
      while (end > heading.line && !lines[end - 1]!.trim()) end--;
      matches.push({ start_line: heading.line, end_line: end });
    }
  }
  if (matches.length !== 1) throw new TypeError(`Source locator matched ${matches.length} regions in ${locator.path}; candidates: ${matches.slice(0, 5).map(m => `${m.start_line}-${m.end_line}`).join(", ") || "none"}. Use a unique heading/quote or explicit start_line/end_line.`);
  return articleSourceLocatorSchema.parse({ path: locator.path, ...matches[0] });
}
