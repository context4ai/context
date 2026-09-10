import type { SourcesRegistry } from "@c4a/context";
import { parseKnowledgeFrontmatter } from "./packageKnowledgeProjection.js";

export interface SiteSource { label: string; href?: string }
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
export function siteArticleSources(content: string, registry: SourcesRegistry): SiteSource[] {
  const meta = parseKnowledgeFrontmatter(content);
  const refs = new Set<string>(Array.isArray(meta.sources) ? meta.sources.filter((v): v is string => typeof v === "string") : []);
  for (const match of content.matchAll(/<!--\s*context:section\b[^>]*\bsource_ref="([^"]+)"/gu)) refs.add(match[1]!);
  const sources: SiteSource[] = [];
  for (const ref of refs) {
    const repo = registry.repos.find(entry => ref === `repo:${entry.id}` || ref.startsWith(`repo:${entry.id}/`) || ref.startsWith(`repo:${entry.id}#`));
    if (repo) {
      const base = repoUrl(repo.remote);
      const suffix = ref.slice(`repo:${repo.id}`.length).split("#")[0]!;
      const file = suffix.startsWith("/") ? suffix.slice(1) : "";
      // Only registry-relative paths belong in a repository URL.
      const parts = [repo.subpath ?? "", file].filter(Boolean);
      const safe = parts.every(part => !part.startsWith("/") && !part.split("/").includes(".."));
      const path = parts.join("/");
      const name = base ? new URL(base).pathname.replace(/^\//u, "") : repo.module;
      const href = base && safe ? `${base}/${file ? "blob" : "tree"}/${encodeURIComponent(repo.ref)}/${encodedPath(path)}` : undefined;
      const revisionLabel = /^[a-f0-9]{7,64}$/iu.test(repo.ref) ? repo.ref.slice(0, 6) : repo.ref;
      sources.push({ label: `${name}${safe && path ? `/${path}` : ""} # ${revisionLabel}`, ...(href ? { href } : {}) });
      continue;
    }
    const doc = registry.larks.find(entry => ref === `lark:${entry.id}` || ref.startsWith(`lark:${entry.id}#`));
    if (doc) {
      const href = webUrl(doc.url);
      sources.push({ label: doc.title ?? doc.name, ...(href ? { href } : {}) });
      continue;
    }
    const local = [ ...registry.files.map(entry => ({ ...entry, prefix: "file" })), ...registry.notes.map(entry => ({ ...entry, prefix: "note" })), ...registry.sessions.map(entry => ({ ...entry, prefix: "sessions" })) ].find(entry => ref === `${entry.prefix}:${entry.id}` || ref.startsWith(`${entry.prefix}:${entry.id}#`));
    if (local) sources.push({ label: local.name });
  }
  return [...new Map(sources.map(source => [source.href ?? source.label, source])).values()];
}
