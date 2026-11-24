import { parseRepoContentRef, type ArticleSourceReference, type ArticleStructureEntry, type SourcesRegistry } from "@c4a/context";
import { fileSourceOriginFileUrl } from "./fileSourceOrigins.js";
import { repoContentWebUrl } from "./repoContentPages.js";

export interface SiteSource { label: string; href?: string }
/** Generated only for exported Markdown; the workspace keeps a single reference record. */
export function articleProvenanceMarkdown(article: ArticleStructureEntry | undefined, registry: SourcesRegistry, repositoryRemote?: string): string {
  const sources = siteArticleSources(article, registry, repositoryRemote);
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

/** Where one recorded reference points: its list label, its link, and the registered source it belongs to. */
export interface SiteReferenceSource extends SiteSource {
  kind: "repo" | "lark" | "note" | "other";
  /** Repository module, local repository id, Lark title, note id or the raw reference. */
  owner: string;
}
export function siteReferenceSource(reference: ArticleSourceReference, registry: SourcesRegistry, repositoryRemote?: string): SiteReferenceSource {
  const ref = reference.source_ref;
  const locator = reference.locator;
  const region = `L${locator.start_line}–L${locator.end_line}`;
  const local = parseRepoContentRef(ref);
  if (local) {
    const url = !local.worktree ? repoContentWebUrl(repositoryRemote, local.commit, locator.path) : undefined;
    return { label: `${local.id} · ${locator.path} ${region} · ${local.commit?.slice(0, 7) ?? "unknown revision"}${local.worktree ? " + worktree" : ""}`,
      ...(url ? { href: `${url}#L${locator.start_line}-L${locator.end_line}` } : {}), kind: "repo", owner: local.id };
  }
  const repo = registry.repos.find(entry => ref === `repo:${entry.id}` || ref === `repo:${entry.name}`);
  if (repo) {
    const base = repoUrl(repo.remote);
    const path = [repo.subpath ?? "", locator.path].filter(Boolean).join("/");
    const safe = !path.startsWith("/") && !path.split("/").some(part => part === ".." || part === ".");
    const href = base && safe
      ? `${base}/blob/${encodeURIComponent(repo.ref)}/${encodedPath(path)}#L${locator.start_line}-L${locator.end_line}`
      : undefined;
    const revision = /^[a-f0-9]{7,64}$/iu.test(repo.ref) ? repo.ref.slice(0, 7) : repo.ref;
    return { label: `${repo.module}/${locator.path} ${region} · ${revision}`, ...(href ? { href } : {}), kind: "repo", owner: repo.module };
  }
  const doc = registry.larks.find(entry => ref === `lark:${entry.id}` || ref === `lark:${entry.name}`);
  if (doc) {
    const href = webUrl(doc.url);
    return { label: `${doc.title ?? doc.name} · ${locator.path} ${region}`, ...(href ? { href } : {}), kind: "lark", owner: doc.title ?? doc.name };
  }
  const file = registry.files.find(entry => entry.origin !== undefined && (ref === `file:${entry.id}` || ref === `file:${entry.name}`));
  if (file?.origin) {
    const originPath = fileOriginPath(file, locator.path);
    // Line anchors only make sense on a file page; otherwise link the version page.
    const fileUrl = originPath === undefined ? undefined : webUrl(fileSourceOriginFileUrl(file.origin, originPath));
    const href = fileUrl !== undefined && !fileUrl.includes("#")
      ? `${fileUrl}#L${locator.start_line}-L${locator.end_line}` : webUrl(file.origin.url);
    const owner = `${file.origin.id}@${file.origin.version}`;
    return { label: `${owner} · ${originPath ?? locator.path} ${region}`, ...(href ? { href } : {}), kind: "other", owner };
  }
  return { label: `${ref} · ${locator.path} ${region}`, kind: ref.startsWith("note:") ? "note" : "other", owner: ref };
}

/**
 * Path of a snapshot file inside its origin version, when the snapshot keeps folders: the
 * registered subdirectory after `<name>@<version>` plus the path under the module folder.
 */
function fileOriginPath(file: SourcesRegistry["files"][number], snapshotPath: string): string | undefined {
  if (file.layout !== "tree" || file.local === undefined || file.origin === undefined) return undefined;
  const modulePrefix = file.module !== undefined ? `${file.module}/` : "";
  if (modulePrefix && !snapshotPath.startsWith(modulePrefix)) return undefined;
  const parts = file.local.split("/");
  const versionIndex = parts.findIndex(part => part.endsWith(`@${file.origin!.version}`));
  if (versionIndex < 0) return undefined;
  const within = parts.slice(versionIndex + 1);
  // A single registered file captures as its own name; the local path already names it.
  const relative = snapshotPath.slice(modulePrefix.length);
  if (within.length > 0 && within.at(-1) === relative && /\.[^/]+$/u.test(relative)) return within.join("/");
  return [...within, relative].filter(Boolean).join("/");
}

/** Project recorded provenance only; do not infer source files from prose or titles. */
export function siteArticleSources(article: ArticleStructureEntry | undefined, registry: SourcesRegistry, repositoryRemote?: string): SiteSource[] {
  const sources = (article?.sections.flatMap(section => section.references) ?? []).map(reference => {
    const { label, href } = siteReferenceSource(reference, registry, repositoryRemote);
    return { label, ...(href ? { href } : {}) };
  });
  return [...new Map(sources.map(source => [JSON.stringify(source), source])).values()];
}

/**
 * Inline code that spells a cited repository file, a cited file's directory (at least two
 * segments), or the distinctive name of exactly one such directory links to the cited revision.
 * Only recorded references produce links; ambiguous spellings stay plain text.
 */
export function siteSourceLinks(article: ArticleStructureEntry | undefined, registry: SourcesRegistry, repositoryRemote?: string): Record<string, string> {
  const candidates = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, url: string) => map.set(key, (map.get(key) ?? new Set()).add(url));
  for (const reference of article?.sections.flatMap(section => section.references) ?? []) {
    const ref = reference.source_ref;
    const local = parseRepoContentRef(ref);
    const repo = local ? undefined : registry.repos.find(entry => ref === `repo:${entry.id}` || ref === `repo:${entry.name}`);
    const prefix = repo?.subpath?.replace(/^\/+|\/+$/gu, "") ?? "";
    const base = repo && repoUrl(repo.remote);
    const target = (path: string, directory: boolean) => local
      ? local.worktree ? undefined : repoContentWebUrl(repositoryRemote, local.commit, path, directory)
      : base ? `${base}/${directory ? "tree" : "blob"}/${encodeURIComponent(repo!.ref)}/${encodedPath(path)}` : undefined;
    const path = reference.locator.path;
    const parts = path.split("/");
    if (!local && !repo || path.startsWith("/") || parts.some(part => !part || part === "." || part === "..")) continue;
    // Authors may write a path relative to the registered module or to its repository root.
    for (const written of new Set([path, prefix ? `${prefix}/${path}` : path])) {
      const segments = written.split("/");
      for (let depth = segments.length; depth >= 1; depth--) {
        const spelled = segments.slice(0, depth).join("/");
        const full = prefix && !written.startsWith(`${prefix}/`) ? `${prefix}/${spelled}` : spelled;
        const directory = depth < segments.length;
        const url = target(local ? spelled : full, directory);
        if (!url) break;
        if (!directory) add(candidates, spelled, url);
        else if (depth >= 2) { add(candidates, spelled, url); add(candidates, `${spelled}/`, url); }
        // File names such as README.md recur across projects, so only directory names stand alone.
        const name = segments[depth - 1]!;
        if (directory && /[._-]/u.test(name)) add(names, name, url);
      }
    }
  }
  const links: Record<string, string> = {};
  for (const map of [names, candidates]) {
    for (const [key, urls] of map) if (urls.size === 1) links[key] = [...urls][0]!;
  }
  return links;
}
