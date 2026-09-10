import { posix } from "node:path";
import { markdownReaderLinks } from "./markdownLinks.js";
import { isKnowledgeCollection } from "./okfTypes.js";

export interface PackageArticleLinkWarning {
  code: "package-article-not-selected";
  path: string;
  target: string;
}

/** Resolve against the approved file, then project through the selected output
 * map. The directory containing the package copy is not the source coordinate. */
export function projectPackageArticleLinks(input: {
  markdown: string;
  approvedPath: string;
  outputPath: string;
  selected: ReadonlyMap<string, string>;
}): { markdown: string; warnings: PackageArticleLinkWarning[] } {
  const warnings: PackageArticleLinkWarning[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const link of markdownReaderLinks(input.markdown)) {
    if (link.image || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(link.target)) continue;
    const split = link.target.search(/[?#]/u);
    const rawPath = split < 0 ? link.target : link.target.slice(0, split);
    const suffix = split < 0 ? "" : link.target.slice(split);
    let path: string;
    try { path = decodeURIComponent(rawPath.replace(/\\([\\()[\] ])/gu, "$1")); } catch { continue; }
    const absolute = path.startsWith("/knowledge/");
    if (path.startsWith("/") && !absolute) continue;
    const approved = absolute ? posix.normalize(path.slice("/knowledge/".length))
      : posix.normalize(posix.join(posix.dirname(input.approvedPath), path));
    if (!isKnowledgeCollection(approved.split("/")[0] ?? "") || !/\.md$/iu.test(approved)) continue;
    const output = input.selected.get(approved);
    if (output === undefined) {
      warnings.push({ code: "package-article-not-selected", path: input.approvedPath, target: approved });
      // Do not expand the package selection to make a link work. Preserve the
      // reader's label and a non-clickable source location for later inspection.
      const coordinate = approved.replaceAll("`", "\\`");
      edits.push({ start: link.start, end: link.end, text: `${link.label} (not included in this package; knowledge source: \`${coordinate}\`)` });
      continue;
    }
    const relative = posix.relative(posix.dirname(input.outputPath), output);
    const target = relative.split("/").map(segment => encodeURIComponent(segment)).join("/") + suffix;
    edits.push({ start: link.start, end: link.end, text: `[${link.label}](<${target}>)` });
  }
  let markdown = input.markdown;
  for (const edit of edits.reverse()) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end);
  return { markdown, warnings };
}
