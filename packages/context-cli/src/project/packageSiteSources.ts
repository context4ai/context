import type { ArticleStructureEntry, SourcesRegistry } from "@c4a/context";

export interface SiteSource { label: string; href?: string }
/** Generated only for exported Markdown; the workspace keeps a single reference record. */
export function articleProvenanceMarkdown(article: ArticleStructureEntry | undefined, registry: SourcesRegistry): string {
  const sources = siteArticleSources(article, registry);
  if (!sources.length) return "";
  const label = (value: string) => value.replace(/[\\[\]<>`*]/gu, "\\$&").replace(/[\r\n]/gu, " ");
  return ["", "---", "", "## Sources", "", ...sources.map(source => source.href
    ? `- [${label(source.label)}](<${source.href}>)` : `- ${label(source.label)}`), ""].join("\n");
}
function webUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
function repoUrl(remote: string): string | undefined {
  const ssh = /^(?:git@|ssh:\/\/git@)([^/:]+)[:/](.+)$/u.exec(remote);
  return webUrl((ssh ? `https://${ssh[1]}/${ssh[2]}` : remote).replace(/\.git\/?$/u, ""));
}
const encodedPath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

/** Project recorded provenance only; do not infer source files from prose or titles. */
export function siteArticleSources(article: ArticleStructureEntry | undefined, registry: SourcesRegistry): SiteSource[] {
  const sources: SiteSource[] = [];
  for (const reference of article?.sections.flatMap(section => section.references) ?? []) {
    const ref = reference.source_ref;
    const locator = reference.locator;
    const region = `L${locator.start_line}–L${locator.end_line}`;
    const repo = registry.repos.find(entry => ref === `repo:${entry.id}` || ref === `repo:${entry.name}`);
    if (repo) {
      const base = repoUrl(repo.remote);
      const path = [repo.subpath ?? "", locator.path].filter(Boolean).join("/");
      const safe = !path.startsWith("/") && !path.split("/").some(part => part === ".." || part === ".");
      const href = base && safe
        ? `${base}/blob/${encodeURIComponent(repo.ref)}/${encodedPath(path)}#L${locator.start_line}-L${locator.end_line}`
        : undefined;
      const revision = /^[a-f0-9]{7,64}$/iu.test(repo.ref) ? repo.ref.slice(0, 7) : repo.ref;
      sources.push({ label: `${repo.module}/${locator.path} ${region} · ${revision}`, ...(href ? { href } : {}) });
      continue;
    }
    const doc = registry.larks.find(entry => ref === `lark:${entry.id}` || ref === `lark:${entry.name}`);
    if (doc) {
      const href = webUrl(doc.url);
      sources.push({ label: `${doc.title ?? doc.name} · ${locator.path} ${region}`, ...(href ? { href } : {}) });
      continue;
    }
    sources.push({ label: `${ref} · ${locator.path} ${region}` });
  }
  return [...new Map(sources.map(source => [JSON.stringify(source), source])).values()];
}
