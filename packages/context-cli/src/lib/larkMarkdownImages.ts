import { markdownReaderLinks } from "../project/markdownLinks.js";
import type { LarkExternalResource } from "./larkDocxResources.js";

function imageToken(target: string): string | undefined {
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" || !/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) return;
    return /^\/file\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  } catch { return; }
}

/** Parse real image nodes, not examples in code fences or ordinary file links. */
export function larkMarkdownImageResources(markdown: string): LarkExternalResource[] {
  const resources = new Map<string, LarkExternalResource>();
  for (const link of markdownReaderLinks(markdown)) {
    const token = link.image ? imageToken(link.target) : undefined;
    if (!token) continue;
    const locator = `lark:image:${token}`;
    if (!resources.has(locator)) resources.set(locator, { kind: "image", locator,
      title: link.label || "Image", attributes: { token } });
  }
  return [...resources.values()];
}

export function replaceLarkMarkdownImages(markdown: string, replacements: ReadonlyMap<string, string>): string {
  let output = markdown;
  for (const link of markdownReaderLinks(markdown).reverse()) {
    const token = link.image ? imageToken(link.target) : undefined;
    const replacement = token ? replacements.get(`lark:image:${token}`) : undefined;
    if (replacement !== undefined) output = output.slice(0, link.start) + replacement + output.slice(link.end);
  }
  return output;
}
