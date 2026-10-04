import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import type { PackageDefinition } from "@c4a/context";
import { markdownReaderLinks, markdownLinkDestination, replaceMarkdownInlineLinkTargets } from "./markdownLinks.js";
import { readImportsRegistry } from "./importsRegistry.js";
import { optionalRepoGit } from "./repoContentGit.js";
import type { RepoContentPage } from "./repoContentPages.js";

const cell = (value: string | undefined) => (value ?? "").replace(/&/gu, "&amp;")
  .replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/[\r\n]+/gu, " ")
  .replace(/([\\|\[\]`*_])/gu, "\\$1");

export interface PackageImportWarning {
  code: "package-import-unresolved" | "package-imports-unavailable";
  path: string;
  target: string;
  message?: string;
}

/** Imports are optional navigation, not a build gate or source evidence. */
async function readBuildImports(projectRoot: string) {
  try { return { registry: await readImportsRegistry(projectRoot), problem: undefined }; }
  catch (error) { return { registry: undefined, problem: error instanceof Error ? error.message : String(error) }; }
}

function importLinks(markdown: string) {
  return markdownReaderLinks(markdown).filter(link => link.target.startsWith("context:import/"));
}

function declaredUrl(entries: NonNullable<Awaited<ReturnType<typeof readImportsRegistry>>>["imports"] | undefined, target: string) {
  const id = target.slice("context:import/".length);
  return entries && Object.hasOwn(entries, id) ? entries[id]?.url : undefined;
}

export async function importsWarnings(projectRoot: string, pkg: PackageDefinition,
  files: readonly { relPath: string; content: string }[]): Promise<PackageImportWarning[]> {
  const links = files.flatMap(file => importLinks(file.content).map(link => ({ path: file.relPath, target: link.target })));
  if (!(pkg.kind === "package.kb" && pkg.importsPage) && !links.length) return [];
  const { registry, problem } = await readBuildImports(projectRoot);
  const warnings: PackageImportWarning[] = problem ? [{ code: "package-imports-unavailable", path: "imports.yaml",
    target: "imports.yaml", message: `${problem}. Correct imports.yaml; optional imports navigation was omitted.` }] : [];
  for (const link of links) {
    if (!declaredUrl(registry?.imports, link.target) && !warnings.some(item => item.path === link.path && item.target === link.target)) {
      warnings.push({ code: "package-import-unresolved", ...link,
        message: "Declare the ID in imports.yaml or correct the article link; the reader label was retained without a link." });
    }
  }
  return warnings;
}

export async function importsLabels(projectRoot: string) {
  let chinese = false;
  try { chinese = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")).context?.language === "zh-CN"; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return chinese
    ? { title: "外部内容", notice: "以下内容未随本包附带，由提供方维护；版本为声明线索，不代表已安装或已核实。",
      knowledge: "知识", skill: "Skills", plugin: "插件", other: "其他", columns: "名称 | 用途 | 路径 | 版本 | 形态" }
    : { title: "External content", notice: "Content is maintained by its provider and is not bundled. Declared versions do not establish installation or verification.",
      knowledge: "Knowledge", skill: "Skills", plugin: "Plugins", other: "Other", columns: "Name | Purpose | Path | Version | Format" };
}

interface DefinitionNode { type: string; url?: string; position?: { start?: { offset?: number }; end?: { offset?: number } }; children?: DefinitionNode[] }

/** Declared definitions were already rewritten; remaining ones would leak raw context:import targets. */
function removeUnresolvedDefinitions(markdown: string): string {
  if (!markdown.includes("context:import/")) return markdown;
  const spans: { start: number; end: number }[] = [];
  const visit = (node: DefinitionNode) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (node.type === "definition" && node.url?.startsWith("context:import/") && start !== undefined && end !== undefined) {
      spans.push({ start, end: markdown[end] === "\n" ? end + 1 : end });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(unified().use(remarkParse).parse(markdown) as DefinitionNode);
  for (const span of spans.reverse()) markdown = markdown.slice(0, span.start) + markdown.slice(span.end);
  return markdown;
}

export async function importsLinkProjector(projectRoot: string) {
  // Read lazily: an unused malformed declaration must not break unrelated pages.
  let registry: ReturnType<typeof readBuildImports> | undefined;
  return async (markdown: string): Promise<string> => {
    const links = importLinks(markdown);
    if (!links.length) return markdown;
    registry ??= readBuildImports(projectRoot);
    const entries = (await registry).registry?.imports;
    const targets = new Set(links.map(link => link.target));
    markdown = replaceMarkdownInlineLinkTargets(markdown, (link) => {
      if (!targets.has(link.target)) return undefined;
      return declaredUrl(entries, link.target);
    });
    // Replace whole unresolved occurrences only. Flatten nested labels so a
    // broken enclosing link cannot leave another broken link inside its label.
    let end = -1;
    const edits = importLinks(markdown).filter(link => {
      if (link.start < end) return false;
      end = link.end;
      return true;
    });
    for (const link of edits.reverse()) {
      const label = cell(toString(unified().use(remarkParse).parse(link.label))).replace(/([!#])/gu, "\\$1");
      const id = cell(link.target.slice("context:import/".length));
      markdown = markdown.slice(0, link.start) + `${label} (unresolved import: ${id})` + markdown.slice(link.end);
    }
    return removeUnresolvedDefinitions(markdown);
  };
}

export async function importsPages(projectRoot: string, pkg: PackageDefinition): Promise<RepoContentPage[]> {
  if (pkg.kind !== "package.kb" || !pkg.importsPage) return [];
  const { registry } = await readBuildImports(projectRoot);
  if (!registry) return [];
  const labels = await importsLabels(projectRoot);
  const groups = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(registry.imports)) {
    const kind = entry.kind ?? "other";
    const rows = groups.get(kind) ?? [];
    rows.push(`| [${cell(entry.title ?? id)}](<${markdownLinkDestination(entry.url)}>) | ${cell(entry.description)} | ${cell(entry.path)} | ${cell(entry.version)} | ${cell(entry.format)} |`);
    groups.set(kind, rows);
  }
  let content = `---\n${YAML.stringify({ title: labels.title, type: "imports", description: labels.notice })}---\n\n# ${labels.title}\n\n> ${labels.notice}\n`;
  const kinds = [...new Set(["knowledge", "skill", "plugin", ...groups.keys()])];
  for (const kind of kinds) {
    const rows = groups.get(kind);
    if (!rows) continue;
    const title = kind === "knowledge" ? labels.knowledge : kind === "skill" ? labels.skill
      : kind === "plugin" ? labels.plugin : kind === "other" ? labels.other : cell(kind);
    content += `\n## ${title}\n\n| ${labels.columns} |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
  }
  return [{ path: "wikis/imports.md", content, source: "imports.yaml",
    revision: await optionalRepoGit(projectRoot, ["rev-parse", "HEAD"]) ?? null }];
}

export async function importsFingerprint(projectRoot: string, pkg: PackageDefinition, contents: readonly string[] = []): Promise<unknown> {
  const page = pkg.kind === "package.kb" ? pkg.importsPage ?? false : false;
  // Only packages that consume imports depend on their declaration. Use the
  // same Markdown parser as projection; code examples are not dependencies.
  if (!page && !contents.some(content => markdownReaderLinks(content).some(link => link.target.startsWith("context:import/")))) return null;
  const { registry, problem } = await readBuildImports(projectRoot);
  return { declaration: registry ?? null, problem, page,
    labels: page && registry ? await importsLabels(projectRoot) : null,
    revision: page && registry ? await optionalRepoGit(projectRoot, ["rev-parse", "HEAD"]) ?? null : null };
}
