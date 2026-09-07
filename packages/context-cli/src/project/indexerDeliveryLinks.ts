import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { indexerProtocolDigest } from "@c4a/context";
import { markdownReaderLinks } from "./markdownLinks.js";

function knowledgeTarget(outputPath: string, href: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(href)) return undefined;
  let path: string;
  try { path = decodeURIComponent(href.split(/[?#]/u)[0]!); } catch { return undefined; }
  if (!/\.md$/iu.test(path)) return undefined;
  const target = posix.normalize(posix.join(posix.dirname(outputPath), path));
  return target.startsWith("knowledge/") ? target : undefined;
}

export function deliveryLinkDigest(projectRoot: string, base: string, targets: readonly string[] = [],
  currentPaths: ReadonlySet<string> = new Set()): string {
  if (targets.length === 0) return base;
  return indexerProtocolDigest({ base, links: targets.map((target) => ({ target,
    available: currentPaths.has(target) || existsSync(join(projectRoot, target)) })) });
}

/** Keep code examples and external/source links untouched. Link text remains
 * readable until a later batch delivers its knowledge target. Original Markdown
 * lives in the accepted Result and is rendered again when that target appears. */
export function createDeliveryLinkProjection(projectRoot: string, currentPaths: ReadonlySet<string>) {
  const targets: Record<string, string[]> = {};
  return {
    targets,
    project(input: { markdown: string; output_path: string; artifact_ref: string }): string {
      const refs = new Set(targets[input.artifact_ref] ?? []);
      let markdown = input.markdown;
      for (const link of markdownReaderLinks(input.markdown).reverse()) {
        if (link.image) continue;
        const target = knowledgeTarget(input.output_path, link.target);
        if (target === undefined) continue;
        refs.add(target);
        if (currentPaths.has(target) || existsSync(join(projectRoot, target))) continue;
        markdown = `${markdown.slice(0, link.start)}${link.label}${markdown.slice(link.end)}`;
      }
      targets[input.artifact_ref] = [...refs].sort();
      return markdown;
    },
  };
}
