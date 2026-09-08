import { posix } from "node:path";
import { replaceMarkdownInlineLinkTargets } from "./markdownLinks.js";

/** Only link destinations change. Code examples, prose, and external URLs stay
 * byte-identical; both incoming navigation and the moved page's relative links
 * resolve to the same destinations after the move. */
export function moveKnowledgeLinkTargets(content: string, pagePath: string,
  previousPath: string, moves: ReadonlyMap<string, string>): string {
  return replaceMarkdownInlineLinkTargets(content, (link) => {
    const target = link.target;
    if (target.startsWith("#") || target.startsWith("//")) return undefined;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
      if (!target.startsWith("knowledge:")) return undefined;
      const match = /^knowledge:([^#?]+)(.*)$/u.exec(target)!;
      const old = match[1]!.endsWith(".md") ? match[1]! : `${match[1]}.md`;
      const moved = moves.get(old);
      return moved === undefined ? undefined : `knowledge:${match[1]!.endsWith(".md") ? moved : moved.replace(/\.md$/u, "")}${match[2]}`;
    }
    const match = /^([^#?]*)(.*)$/u.exec(target)!;
    let path: string;
    try { path = decodeURI(match[1]!); } catch { return undefined; }
    if (!path || (path.startsWith("/") && !path.startsWith("/knowledge/"))) return undefined;
    const rooted = path.startsWith("knowledge/") || path.startsWith("/knowledge/");
    const resolved = rooted ? path.replace(/^\/?knowledge\//u, "") : posix.normalize(posix.join(posix.dirname(previousPath), path));
    const destination = moves.get(resolved) ?? resolved;
    if (destination === resolved && (rooted || posix.dirname(pagePath) === posix.dirname(previousPath))) return undefined;
    const rewritten = rooted ? `${path.startsWith("/") ? "/" : ""}knowledge/${destination}`
      : posix.relative(posix.dirname(pagePath), destination);
    return `${encodeURI(rewritten)}${match[2]}`;
  });
}
