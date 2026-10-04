import { readdir, readFile, mkdir, lstat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import YAML from "yaml";
import { repoContentPathSchema, type PackageDefinition } from "@c4a/context";
import type { ApprovedKnowledgeFile } from "./packageIndexes.js";
import { markdownReaderLinks } from "./markdownLinks.js";
import { canReadRepoObjects, optionalRepoGit, readRepoContentAt, repoContentGit } from "./repoContentGit.js";
import { readRepoContentRegistry, repoContentError, repoContentExcluded,
  type RepoContentRegistration, type RegisteredRepoContent } from "./repoContentRegistry.js";

export function repoContentWebUrl(remote: string | undefined, revision: string | undefined, path: string, directory = false): string | undefined {
  if (!remote || !revision || !repoContentPathSchema.safeParse(path).success) return undefined;
  const ssh = /^(?:git@|ssh:\/\/git@)([^/:]+)[:/](.+)$/u.exec(remote);
  try {
    const url = new URL((ssh ? `https://${ssh[1]}/${ssh[2]}` : remote).replace(/\.git\/?$/u, ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    if (["bitbucket.org", "dev.azure.com"].includes(url.hostname)) return undefined;
    const route = url.hostname === "gitlab.com" ? "-/" : "";
    return `${url.href.replace(/\/$/u, "")}/${route}${directory ? "tree" : "blob"}/${encodeURIComponent(revision)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  } catch { return undefined; }
}

export async function repoContentLinkProjector(projectRoot: string) {
  const registry = await readRepoContentRegistry(projectRoot);
  const remote = registry && await optionalRepoGit(registry.repoRoot, ["remote", "get-url", "origin"]);
  const branch = registry && (await optionalRepoGit(registry.repoRoot, ["symbolic-ref", "--short", "HEAD"])
    ?? await optionalRepoGit(registry.repoRoot, ["rev-parse", "HEAD"]));
  return (markdown: string): string => {
    const edits: { start: number; end: number; text: string }[] = [];
    for (const link of markdownReaderLinks(markdown)) {
      if (!link.target.startsWith("context:repo/")) continue;
      const [id, ...suffix] = link.target.slice("context:repo/".length).split("/");
      const entry = registry?.entries.find(item => item.id === id);
      const subpath = suffix.join("/");
      const safe = entry && (!subpath || (entry.kind !== "document" && repoContentPathSchema.safeParse(subpath).success));
      const path = safe ? [entry.path, subpath].filter(Boolean).join("/") : undefined;
      const url = path && !repoContentExcluded(entry!, path)
        ? repoContentWebUrl(remote, branch, path, !subpath && entry!.kind !== "document") : undefined;
      edits.push({ start: link.start, end: link.end, text: url ? `[${link.label}](<${url}>)`
        : `${link.label} (${path ?? `unresolved repository entry: ${id}`})` });
    }
    for (const edit of edits.reverse()) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end);
    return markdown;
  };
}

export interface RepoContentPage { path: string; content: string; revision: string | null; source: "repo-content.yaml" | "imports.yaml" }
export async function repoContentLabels(projectRoot: string) {
  let chinese = false;
  try { chinese = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).context?.language === "zh-CN"; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return chinese ? { title: "仓库内容", description: "项目文档与技能", skills: "技能", skill: "技能", summary: "说明", project: "项目",
    working: "基于工作树文件生成", commit: "基于仓库提交生成", authoritative: "以仓库原文为准", missing: "不可用的 README 或技能条目" }
    : { title: "Repository content", description: "Project documentation and Skills", skills: "Skills", skill: "Skill", summary: "Description", project: "Project",
      working: "Generated from working-tree files", commit: "Generated from repository commit", authoritative: "Original repository content is authoritative", missing: "Unavailable README or Skill entries" };
}

/** Navigation-only records; these are not approved knowledge or copied sources. */
export function repoContentNavigation(pages: RepoContentPage[]): ApprovedKnowledgeFile[] {
  return pages.filter(page => page.path === "wikis/repo-content.md" || page.path === "wikis/imports.md")
    .map(page => ({ relPath: page.path, absPath: "", content: page.content }));
}
function stripHeader(text: string): { body: string; description: string; title?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  let metadata: Record<string, unknown> = {};
  if (match) { try { metadata = YAML.parse(match[1]!) ?? {}; } catch { /* README frontmatter is optional. */ } }
  const body = match ? text.slice(match[0].length) : text;
  const firstParagraph = body.split(/\r?\n\s*\r?\n/u).find(p => p.trim() && !p.trim().startsWith("#")) ?? "";
  let description = typeof metadata.description === "string" ? metadata.description : firstParagraph;
  for (const link of markdownReaderLinks(description).reverse()) {
    description = description.slice(0, link.start) + link.label + description.slice(link.end);
  }
  return { body, description: description.replace(/\s+/gu, " ").trim(),
    ...(typeof metadata.title === "string" ? { title: metadata.title } : {}) };
}
const cell = (value: string) => value.replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ");
async function localFiles(root: string, path: string): Promise<string[]> {
  const output: string[] = [];
  const info = await lstat(join(root, path));
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];
  for (const item of await readdir(join(root, path), { withFileTypes: true })) {
    if (item.name === ".git" || item.isSymbolicLink()) continue;
    output.push(...await localFiles(root, `${path}/${item.name}`));
  }
  return output;
}

export async function repoContentPages(projectRoot: string, pkg: PackageDefinition): Promise<RepoContentPage[]> {
  if (pkg.kind !== "package.kb" || !pkg.repoContentPage) return [];
  const registry = await readRepoContentRegistry(projectRoot);
  if (!registry) return [];
  const labels = await repoContentLabels(projectRoot);
  const head = await optionalRepoGit(registry.repoRoot, ["rev-parse", "HEAD"]);
  const remote = await optionalRepoGit(registry.repoRoot, ["remote", "get-url", "origin"]);
  const branch = await optionalRepoGit(registry.repoRoot, ["symbolic-ref", "--short", "HEAD"]);
  const objects = !!head && await canReadRepoObjects(registry.repoRoot);
  const groups = new Map<string, RegisteredRepoContent[]>();
  for (const entry of registry.entries) {
    const group = entry.group ?? "";
    groups.set(group, [...groups.get(group) ?? [], entry]);
  }
  const pages: RepoContentPage[] = [];
  const rows: string[] = [];
  for (const [group, entries] of groups) {
    let working = !objects;
    async function read(path: string): Promise<string> {
      if (objects) {
        try { return await readRepoContentAt(registry!.repoRoot, path, head); } catch { working = true; }
      }
      return readRepoContentAt(registry!.repoRoot, path);
    }
    let readmePath: string | undefined;
    let readme = "";
    for (const entry of [...entries.filter(e => e.kind === "document" && posix.basename(e.path) === "README.md"),
      ...entries.filter(e => e.kind === "docs")]) {
      const path = entry.kind === "document" ? entry.path : `${entry.path}/README.md`;
      if (repoContentExcluded(entry, path)) continue;
      try { readme = await read(path); readmePath = path; break; } catch { /* Missing README does not block skills. */ }
    }
    const skills: { name: string; description: string; path: string }[] = [];
    const missing: string[] = [];
    for (const entry of entries.filter(e => e.kind === "skill" || e.kind === "skills")) {
      let files: string[] = [];
      try {
        files = objects ? (await repoContentGit(registry.repoRoot, ["ls-tree", "-r", "-z", "--name-only", head!, "--", entry.path])).split("\0").filter(Boolean)
          : await localFiles(registry.repoRoot, entry.path);
      } catch { working = true; try { files = await localFiles(registry.repoRoot, entry.path); } catch { missing.push(entry.path); } }
      for (const path of files.filter(path => posix.basename(path) === "SKILL.md" && !repoContentExcluded(entry, path))) {
        try {
          const text = await read(path);
          const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
          const metadata: unknown = match ? YAML.parse(match[1]!) : undefined;
          if (metadata && typeof metadata === "object" && "name" in metadata && "description" in metadata &&
            typeof metadata.name === "string" && metadata.name.trim() && typeof metadata.description === "string" && metadata.description.trim()) {
            skills.push({ name: metadata.name, description: metadata.description, path });
          } else missing.push(path);
        } catch { missing.push(path); }
      }
    }
    const parsed = stripHeader(readme);
    const title = /^#\s+(.+)$/mu.exec(parsed.body)?.[1] ?? parsed.title ?? (group || labels.title);
    const revision = working ? branch : head;
    let body = parsed.body || `# ${title}\n`;
    if (readmePath) {
      const edits: { start: number; end: number; text: string }[] = [];
      for (const link of markdownReaderLinks(body)) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(link.target)) continue;
        const split = link.target.search(/[?#]/u);
        const raw = split < 0 ? link.target : link.target.slice(0, split);
        const suffix = split < 0 ? "" : link.target.slice(split);
        let path: string;
        try { path = posix.normalize(posix.join(posix.dirname(readmePath), decodeURIComponent(raw))); } catch { continue; }
        const url = repoContentWebUrl(remote, revision, path);
        // Repository web pages are not image bytes. Keep images as ordinary
        // source links rather than inventing provider-specific raw endpoints.
        edits.push({ start: link.start, end: link.end, text: url ? `[${link.label}](<${url}${suffix}>)` : `${link.label} (${path})` });
      }
      for (const edit of edits.reverse()) body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
    }
    const origin = working ? labels.working : `${labels.commit} ${head}`;
    body += `\n\n## ${labels.skills}\n\n| ${labels.skill} | ${labels.summary} |\n| --- | --- |\n${skills.map(skill => {
      const url = repoContentWebUrl(remote, revision, skill.path);
      return `| ${url ? `[${cell(skill.name)}](<${url}>)` : cell(skill.name)} | ${cell(skill.description)} |`;
    }).join("\n")}\n`;
    if (!readmePath) missing.push(...entries.filter(e => e.kind === "document" || e.kind === "docs").map(e => e.path));
    if (missing.length) body += `\n${labels.missing}: ${missing.map(cell).join(", ")}.\n`;
    const path = group ? `wikis/repo-content/${group}.md` : "wikis/repo-content.md";
    const front = YAML.stringify({ title, type: "repo-content", description: parsed.description });
    pages.push({ path, content: `---\n${front}---\n\n> ${origin}; ${labels.authoritative}.\n\n${body}`,
      revision: working ? null : head ?? null, source: "repo-content.yaml" });
    if (group) rows.push(`| [${cell(title)}](repo-content/${group}.md) | ${cell(parsed.description)} | ${skills.length} |`);
  }
  if (rows.length) {
    let main = pages.find(page => page.path === "wikis/repo-content.md");
    if (!main) { main = { path: "wikis/repo-content.md", source: "repo-content.yaml", revision: head ?? null,
      content: `---\n${YAML.stringify({ title: labels.title, type: "repo-content", description: labels.description })}---\n\n# ${labels.title}\n\n${labels.authoritative}.\n` }; pages.unshift(main); }
    main.content += `\n| ${labels.project} | ${labels.summary} | ${labels.skills} |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
  }
  return pages;
}

export async function writeRepoContentPages(projectRoot: string, pkg: PackageDefinition, pages: RepoContentPage[]) {
  for (const page of pages) {
    const path = join(projectRoot, pkg.outDir, page.path);
    try { await lstat(path); throw repoContentError(`Generated page collides with existing output: ${page.path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, page.content);
  }
}

export async function repoContentFingerprint(projectRoot: string, pkg: PackageDefinition) {
  const registry: RepoContentRegistration | undefined = await readRepoContentRegistry(projectRoot);
  if (!registry) return null;
  return { registry: registry.content, pages: await repoContentPages(projectRoot, pkg),
    remote: await optionalRepoGit(registry.repoRoot, ["remote", "get-url", "origin"]),
    branch: await optionalRepoGit(registry.repoRoot, ["symbolic-ref", "--short", "HEAD"]) };
}
